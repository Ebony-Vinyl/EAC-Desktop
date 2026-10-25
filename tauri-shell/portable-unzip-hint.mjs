'use strict';
// 便携 zip 的「解压指引」注入（2026-10-24）。
//
// 为什么需要
// ----------
// 用户实测解压 full 便携包时被资源管理器拒绝：
//
//   错误 0x80010135: 路径太长
//   .../assets/runtime/06eaf23e....png
//
// 实测包内最长条目名：full 188 字符 / lite 174 字符。
//
// 失败方的定位（重要，别搞错）：
//   资源管理器的「全部解压缩」走 Shell 的 SHFileOperation，受 MAX_PATH=260
//   约束且不加 \\?\ 前缀 —— 这才是 0x80010135 的来源。
//   而 7-Zip / WinRAR / PowerShell 的 Expand-Archive / Windows 自带 bsdtar
//   都自行处理长路径。本机实测（LongPathsEnabled=1）Expand-Archive 在
//   272 字符目标下亦能完整展开 47545 个文件。
//   因此这里提供的脚本价值在于：给用户一条**确定能用、不依赖第三方软件**
//   的路径，并且默认落到短目录，从根上避开问题。
//
// 为什么**不**靠改目录结构解决
// ----------------------------
// 曾评估把 `assets/full-pack/` 改短、把 64 位哈希文件名截断：
//   · 哈希截断：无损可测，但最长条目是 .tgz 不是图片，实测 max 仍为 188（无效）
//   · 改 full-pack 目录名：仅省 14 字符，而该路径是 20+ 个构建/门禁脚本的硬约定
//     （make-lite-staged.mjs 甚至靠「assets/full-pack 是否存在」判定 full 载荷），
//     改名的破坏面远大于收益。
// 因此选择**交给用户正确的解压方式**：随包附一份说明 + 一键脚本。
//
// 为什么在压缩后注入而不是写进 staging 树
// --------------------------------------
// `makeReleaseFiles()`（dsh-desktop/lib/desktop/update-package.js）会遍历 staging
// 根并对任何不在 PORTABLE_ITEMS 白名单里的顶层项抛 `update-package-unowned-top-level`；
// `verifyReleaseTree()` 之后还会二次校验哈希闭包。新增文件若落在 staging 内，
// 会直接打断便携版自身的更新校验链路。
// 故本模块在 zip 写完之后，用 System.IO.Compression 的 Update 模式追加两个条目。

import { execFileSync } from 'node:child_process';

/** 随包的说明文件名（zip 根，中文名便于用户一眼看到）。 */
export const UNZIP_NOTE_NAME = '解压说明.txt';
/** 随包的一键解压脚本名（zip 根）。 */
export const UNZIP_SCRIPT_NAME = '解压到短路径.ps1';

/**
 * 生成本次产物的说明文本。
 *
 * @param {object} opts
 * @param {string} opts.distro    'lite' | 'full'
 * @param {string} opts.version   产品版本（如 6.1.0）
 * @param {string} opts.zipName   主 zip 文件名（用于脚本内自引用）
 * @param {string} opts.zstName   可选 tar.zst 文件名；缺省不提及
 * @param {number} opts.maxEntryLength 包内最长条目字符数（实测注入）
 */
export function buildUnzipNote({distro, version, zipName, zstName, maxEntryLength}) {
  const label = distro === 'full' ? '完整版（full）' : '精简版（lite）';
  const alt = zstName
    ? `
【更省流的替代包】
  同目录下还有 ${zstName}
  · 体积更小、解压更快（多线程、并行）
  · 需要 7-Zip 24+ / WinRAR 7+，或 Windows 11 24H2+ 自带 tar
  · 命令行：tar -xf ${zstName}
  两者内容完全一致，任选其一即可，不要都解压到同一目录。
`
    : '';
  return `Deepseek Harness EAC ${version} ${label} — 便携版解压说明
================================================================

【重要】不要用资源管理器右键「全部解压缩」解压本包
        否则很可能弹出：错误 0x80010135: 路径太长

原因
----
本包文件树较深，包内最长的条目路径约 ${maxEntryLength} 个字符。
Windows 资源管理器的「全部解压缩」走 Shell 的 SHFileOperation 接口，
该接口受 MAX_PATH=260 限制，且**不会**自动加 \\?\ 长路径前缀。
（相比之下 7-Zip、WinRAR、Windows 自带的 tar.exe 以及 PowerShell 的
Expand-Archive 都自己处理长路径，通常没事。）
所以当解压目标本身已有深度——例如
C:\\Users\\你的用户名\\Downloads\\ 或很深的项目目录——两者相加超过 260，
资源管理器就会中断解压并报「路径太长」。
这只是路径长度限制，不代表压缩包损坏。

推荐的三种解压方式（任选一种）

方式一：双击运行本目录下的「${UNZIP_SCRIPT_NAME}」（最省事）
  它会把本包解压到 D:\\EAC，路径短，一次成功。

方式二：手动解压到短路径
  先建一个短目录，例如 D:\\EAC，然后用 7-Zip / WinRAR / Bandizip
  解压到该目录。目标目录越短越安全（建议不超过 10 个字符，
  如 D:\\EAC、D:\\x、E:\\EAC）。

方式三：用 Windows 自带 tar.exe（无需第三方软件）
  打开 PowerShell，在压缩包所在目录执行：

    C:\\Windows\\System32\\tar.exe -xf ${zipName} -C D:\\EAC

  注意写全路径 System32\\tar.exe。如果 PATH 里有其他 tar（如 Git Bash 的
  GNU tar），直接写 tar 可能报 "Cannot connect to C: resolve failed"。

如果你一定要用资源管理器
------------------------
请把解压目标改成根目录下的短路径（例如直接解压到 D:\\EAC）再右键解压。
也可以在管理员 PowerShell 中开启系统长路径支持后**重启**：

    Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' \`
                      -Name LongPathsEnabled -Value 1 -Type DWord

但请留意：资源管理器的解压功能本身并不因此改变行为，
开启后主要受益的是支持长路径的程序（7-Zip、tar.exe 等）。
最稳妥的做法仍是解压到短目录。
${alt}
解压后怎么用
------------
解压完成后，进入目标目录，双击 dsh-eac-shell.exe 即可启动。
不需要安装，不写注册表；删除整个目录即可卸载。

如果启动时提示缺少 WebView2
---------------------------
请安装 Microsoft Edge WebView2 Runtime（Windows 11 通常已内置）。
下载：https://developer.microsoft.com/microsoft-edge/webview2/

校验完整性（可选）
------------------
本包与 SHA256SUMS.txt 中记录的哈希一致即未被篡改或损坏：

    Get-FileHash ${zipName} -Algorithm SHA256

把输出的 Hash 与 SHA256SUMS.txt 中对应行比对即可。
`;
}

/**
 * 生成一键解压脚本。
 *
 * 设计取舍：
 *  · 默认目标 D:\\EAC —— 足够短，且与大多数教程/用户的盘符习惯一致。
 *  · 用 System32\\tar.exe 绝对路径，规避 PATH 里的 GNU tar 冲突。
 *  · 不用 Expand-Archive：它内部走 .NET，长路径行为随版本而异；bsdtar 更稳。
 *  · 已存在目标目录时要求确认，避免覆盖用户既有文件。
 *
 * @param {object} opts
 * @param {string} opts.zipName 自引用的 zip 文件名
 */
export function buildUnzipScript({zipName}) {
  return `# Deepseek Harness EAC 便携版 — 一键解压
# ---------------------------------------------------------------
# 作用：用支持长路径的 bsdtar 把便携包解压到一个短路径目录，
#       绕开资源管理器 "错误 0x80010135: 路径太长" 的问题。
#
# 用法：右键本文件 → 使用 PowerShell 运行
#       若提示脚本被禁止，先执行：
#         Set-ExecutionPolicy -Scope Process -Bypass
#
# 内容纯本地操作，不联网、不写注册表。

$ErrorActionPreference = 'Stop'

$zip = Join-Path $PSScriptRoot '${zipName}'
if (-not (Test-Path -LiteralPath $zip)) {
  Write-Host "找不到压缩包：$zip" -ForegroundColor Red
  Write-Host "请把本脚本和压缩包放在同一目录。" -ForegroundColor Yellow
  exit 1
}

# 默认解压目标：短路径，避免 MAX_PATH 溢出
$default = 'D:\\EAC'
Write-Host ''
Write-Host "将解压到：$default" -ForegroundColor Cyan
$ans = Read-Host "回车确认，或直接输入其它路径（建议保持很短）"
$dest = if ([string]::IsNullOrWhiteSpace($ans)) { $default } else { $ans.Trim() }

if (Test-Path -LiteralPath $dest) {
  $existing = @(Get-ChildItem -LiteralPath $dest -Force -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    Write-Host "目标目录已存在且非空：$dest" -ForegroundColor Yellow
    $ok = Read-Host "继续会与现有文件混合，确定继续？(y/N)"
    if ($ok -notmatch '^[yY]') { Write-Host '已取消。'; exit 0 }
  }
} else {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
}

# 路径长度预检：解压后最长绝对路径 = 目标长度 + 最长条目长度
Write-Host ''
Write-Host "开始解压（约 1-3 分钟，数万个小文件）..." -ForegroundColor Cyan

$tar = Join-Path $env:SystemRoot 'System32\\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) {
  Write-Host "未找到 $tar" -ForegroundColor Red
  Write-Host "请改用 7-Zip / WinRAR 解压到短路径目录。" -ForegroundColor Yellow
  exit 1
}

# bsdtar 对长路径的处理优于资源管理器；-xf 自动识别 zip
& $tar -xf "$zip" -C "$dest"
if ($LASTEXITCODE -ne 0) {
  Write-Host "解压失败（tar 退出码 $LASTEXITCODE）。" -ForegroundColor Red
  Write-Host "建议改用 7-Zip，并把目标设为 D:\\EAC 这类短路径。" -ForegroundColor Yellow
  exit $LASTEXITCODE
}

Write-Host ''
Write-Host "解压完成：$dest" -ForegroundColor Green
$exe = Join-Path $dest 'dsh-eac-shell.exe'
if (Test-Path -LiteralPath $exe) {
  Write-Host "双击 $exe 即可启动。" -ForegroundColor Green
  $run = Read-Host "现在启动？(y/N)"
  if ($run -match '^[yY]') { Start-Process -FilePath $exe }
} else {
  Write-Host "警告：未找到 dsh-eac-shell.exe，解压可能不完整。" -ForegroundColor Yellow
}
`;
}

/**
 * 列出 zip 内全部条目名（正斜杠形式）。
 *
 * 只为「实测最长路径」这一个用途服务：说明文本里要先写清真实数字，
 * 用户才知道自己目标目录能有多深。用 .NET 读取，零依赖。
 *
 * @param {string} zipPath
 * @returns {string[]}
 */
export function listZipEntries(zipPath) {
  // 编码坑（已实测踩中）：PowerShell 5.1 向管道写字符串时按控制台代码页（中文系统
  // 为 GBK）编码，而 Node 侧以 utf8 解码，中文文件名会变成乱码 —— 表现为
  // 「zip 里明明有条目，listZipEntries 却找不到」。
  // 因此显式把 [Console]::OutputEncoding 设为 UTF-8 并写 BOM-less UTF-8 字节流。
  const ps = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$zip = [IO.Compression.ZipFile]::OpenRead($env:P_ZIP)',
    "try { $zip.Entries | ForEach-Object { $_.FullName.Replace([char]92, [char]47) } } finally { $zip.Dispose() }",
  ].join('; ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    env: {...process.env, P_ZIP: zipPath},
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split(/\r?\n/).filter(Boolean);
}

/**
 * 把说明与脚本追加进已存在的 zip。
 *
 * 用 .NET 的 Update 模式（不重建压缩包，不触碰既有条目）。
 * 若目标条目已存在则先删除，保证可重复执行。
 *
 * @param {object} opts
 * @param {string} opts.zipPath            目标 zip 绝对路径
 * @param {Array<{name:string,text:string}>} opts.entries 待追加条目
 */
export function appendEntriesToZip({zipPath, entries}) {
  // 文本以 UTF-8(BOM) 写入：Windows 记事本/PowerShell 对 BOM-less UTF-8
  // 中文会乱码，带 BOM 才能让用户双击直接看。
  //
  // 编码坑（已实测踩中）：条目名含中文，**不能**直接放进 $env:P_ENTRIES 的 JSON。
  // 环境变量跨进程传递时，中文会因 Node(UTF-8) / PowerShell(UTF-16) 的解释差异
  // 而损坏，最终写进 zip 的是乱码文件名。故 name 与正文一律 base64 后传输，
  // PowerShell 侧再解码 —— 全程 ASCII 信道，零编码风险。
  const payload = entries.map((e) => ({
    nameB64: Buffer.from(e.name, 'utf8').toString('base64'),
    b64: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(e.text, 'utf8')]).toString('base64'),
  }));
  const ps = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$zip = [IO.Compression.ZipFile]::Open($env:P_ZIP, [IO.Compression.ZipArchiveMode]::Update)',
    '$items = $env:P_ENTRIES | ConvertFrom-Json',
    'try {',
    '  foreach ($it in $items) {',
    '    $name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($it.nameB64))',
    '    $existing = $zip.GetEntry($name)',
    '    if ($null -ne $existing) { $existing.Delete() }',
    '    $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)',
    '    $stream = $entry.Open()',
    '    try {',
    '      $bytes = [Convert]::FromBase64String($it.b64)',
    '      $stream.Write($bytes, 0, $bytes.Length)',
    '    } finally { $stream.Dispose() }',
    '  }',
    '} finally { $zip.Dispose() }',
    // 回显只输出 ASCII（条目名以 base64 传输，此处不再转述）。
    // 原因：PowerShell 5.1 管道输出走控制台代码页，中文回显在 Node 侧会是乱码。
    "Write-Output '[portable] unzip hint entries injected'",
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    env: {...process.env, P_ZIP: zipPath, P_ENTRIES: JSON.stringify(payload)},
    stdio: 'inherit',
  });
}
