param(
    [Parameter(Mandatory = $true)][ValidateSet('Inspect','Extract')][string]$Action,
    [Parameter(Mandatory = $true)][string]$Archive,
    [string]$Destination
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Get-Item -LiteralPath $Archive).FullName)
try {
    if ($zip.Entries.Count -gt 200000) { throw 'update-archive-entry-limit' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $entries = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        if ($name.Contains('\') -or $name -match '[<>:"|?*\x00-\x1f]' -or $name.StartsWith('/')) { throw 'update-archive-path-invalid' }
        $directory = $name.EndsWith('/')
        $relative = $name.TrimEnd([char]'/')
        foreach ($part in $relative.Split('/')) {
            if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'update-archive-path-invalid' }
        }
        if (-not $seen.Add($relative)) { throw 'update-archive-duplicate-path' }
        $attributes = [int64]$entry.ExternalAttributes
        if ((($attributes -shr 16) -band 61440) -eq 40960 -or ($attributes -band 1024) -ne 0) { throw 'update-archive-link' }
        $entries.Add([pscustomobject]@{path=$relative;size=$entry.Length;directory=$directory})
    }
    $files = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $entries) { if (-not $entry.directory) { $files.Add($entry.path) | Out-Null } }
    foreach ($entry in $entries) {
        $parts = $entry.path.Split('/')
        for ($i = 1; $i -lt $parts.Length; $i++) {
            if ($files.Contains(($parts[0..($i-1)] -join '/'))) { throw 'update-archive-path-collision' }
        }
    }
    $manifest = $zip.GetEntry('eac-release-files.json')
    if ($null -eq $manifest -or $manifest.Length -gt 67108864) { throw 'update-archive-manifest-required' }
    $reader = New-Object System.IO.StreamReader($manifest.Open(), [Text.Encoding]::UTF8)
    try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($Action -eq 'Inspect') {
        @{manifest=($text | ConvertFrom-Json);entries=@($entries.ToArray())} | ConvertTo-Json -Depth 12 -Compress
        exit 0
    }
    if (-not $Destination -or -not [IO.Path]::IsPathRooted($Destination)) { throw 'update-archive-stage-required' }
    $stage = [IO.Path]::GetFullPath($Destination)
    if ([IO.Directory]::Exists($stage) -or [IO.File]::Exists($stage)) { throw 'update-archive-stage-exists' }
    $parent = [IO.Path]::GetDirectoryName($stage)
    if (-not [IO.Directory]::Exists($parent)) { throw 'update-archive-parent-required' }
    $ancestor = New-Object IO.DirectoryInfo($parent)
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'update-archive-parent-link' }
        $ancestor = $ancestor.Parent
    }
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $prefix = $stage.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $zip.Entries) {
        $relative = $entry.FullName.TrimEnd([char]'/').Replace('/', [IO.Path]::DirectorySeparatorChar)
        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($stage, $relative))
        if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'update-archive-stage-escape' }
        if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        $source = $entry.Open()
        $output = New-Object IO.FileStream($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $source.CopyTo($output); $output.Flush($true) } finally { $output.Dispose(); $source.Dispose() }
    }
    @{extracted=$true} | ConvertTo-Json -Compress
} finally { $zip.Dispose() }
