use crate::model::Result;
use fs2::FileExt;
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};

pub const MAX_JSON: u64 = 8 * 1024 * 1024;

pub fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn external(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let file = File::open(path).map_err(|e| format!("Read {}: {e}", path.display()))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_JSON {
        return Err(format!("JSON is too large: {}", path.display()));
    }
    serde_json::from_reader(file).map_err(|e| format!("Invalid JSON at {}: {e}", path.display()))
}

pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    atomic_bytes(path, &bytes)
}

pub fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path)
        .map_err(|e| format!("Atomic save {}: {}", path.display(), e.error))?;
    #[cfg(unix)]
    File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn lock(path: &Path, wait: bool) -> Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Lock {}: {e}", path.display()))?;
    if wait {
        file.lock_exclusive()
    } else {
        file.try_lock_exclusive()
    }
    .map_err(|e| format!("Operation already active ({}): {e}", path.display()))?;
    Ok(file)
}

pub fn valid_id(id: &str) -> Result<()> {
    let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid managed ID".to_string())?;
    if parsed.to_string() != id {
        return Err("ID must use canonical UUID format".into());
    }
    Ok(())
}

pub fn valid_name(name: &str) -> Result<()> {
    if name.trim().is_empty()
        || name.len() > 160
        || name.chars().any(|c| c.is_control())
        || name.contains(['/', '\\'])
        || name == "."
        || name == ".."
    {
        return Err("Name must be 1-160 bytes without controls or path separators".into());
    }
    Ok(())
}

pub fn safe_filename(name: &str) -> Result<()> {
    valid_name(name)?;
    if name.ends_with(['.', ' '])
        || name.contains([':', '<', '>', '"', '|', '?', '*'])
        || is_reserved(name)
    {
        return Err("Unsafe filename".into());
    }
    Ok(())
}

fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'0'..=b'9'))
}

pub fn canonical(path: &Path) -> Result<PathBuf> {
    fs::canonicalize(path).map_err(|e| format!("Resolve {}: {e}", path.display()))
}

pub fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

/// Resolve every existing ancestor, including reparse points, before trusting a managed path.
pub fn managed(root: &Path, path: &Path) -> Result<PathBuf> {
    let root = canonical(root)?;
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        root.join(path)
    };
    if path.components().any(|c| c == Component::ParentDir) {
        return Err("Parent traversal is not allowed".into());
    }
    let mut existing = path.as_path();
    let mut suffix = Vec::new();
    while !existing.try_exists().map_err(|e| e.to_string())? {
        suffix.push(existing.file_name().ok_or("Invalid path")?.to_os_string());
        existing = existing.parent().ok_or("Invalid path")?;
    }
    let mut resolved = canonical(existing)?;
    if !resolved.starts_with(&root) {
        return Err(format!("Path escapes managed root: {}", path.display()));
    }
    for part in suffix.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved)
}

pub fn valid_digest(value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("SHA-256 must contain exactly 64 hexadecimal digits".into());
    }
    Ok(())
}

/// Copy file contents, never hard-link mutable profiles. Internal links are relocated.
pub fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    let source = canonical(source)?;
    if destination.exists() {
        return Err(format!(
            "Copy destination exists: {}",
            destination.display()
        ));
    }
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let destination = canonical(destination)?;
    if destination.starts_with(&source) || source.starts_with(&destination) {
        return Err("Copy trees must not overlap".into());
    }
    let mut links = Vec::new();
    copy_entries(&source, &source, &destination, &mut links)?;
    for (link, target, directory) in links {
        let target = destination.join(target);
        #[cfg(windows)]
        if directory {
            junction::create(&target, &link)
                .map_err(|e| format!("Relocate directory link {}: {e}", link.display()))?;
        } else {
            fs::copy(&target, &link).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        {
            let _ = directory;
            std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn rebase_links(root: &Path, old_root: &Path) -> Result<()> {
    let root = canonical(root)?;
    rebase_entries(&root, &root, old_root)
}

fn rebase_entries(root: &Path, current: &Path, old_root: &Path) -> Result<()> {
    for item in fs::read_dir(current).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        #[cfg(windows)]
        if matches!(junction::exists(&path), Ok(true)) {
            let target = junction::get_target(&path).map_err(|e| e.to_string())?;
            if let Ok(relative) = target.strip_prefix(old_root) {
                let new_target = root.join(relative);
                junction::delete(&path).map_err(|e| e.to_string())?;
                junction::create(&new_target, &path).map_err(|e| e.to_string())?;
            }
            continue;
        }
        #[cfg(unix)]
        if fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            let target = fs::read_link(&path).map_err(|e| e.to_string())?;
            if target.is_absolute() {
                if let Ok(relative) = target.strip_prefix(old_root) {
                    let new_target = root.join(relative);
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                    std::os::unix::fs::symlink(&new_target, &path).map_err(|e| e.to_string())?;
                }
            }
            continue;
        }
        if item.file_type().map_err(|e| e.to_string())?.is_dir() {
            rebase_entries(root, &path, old_root)?;
        }
    }
    Ok(())
}

fn copy_entries(
    root: &Path,
    source: &Path,
    destination: &Path,
    links: &mut Vec<(PathBuf, PathBuf, bool)>,
) -> Result<()> {
    for item in fs::read_dir(source).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let dest = destination.join(item.file_name());
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if is_link(&meta) {
            let target = canonical(&path)?;
            let relative = target
                .strip_prefix(root)
                .map_err(|_| format!("Link escapes copied home: {}", path.display()))?;
            links.push((dest, relative.to_owned(), target.is_dir()));
        } else if meta.is_dir() {
            fs::create_dir(&dest).map_err(|e| e.to_string())?;
            copy_entries(root, &path, &dest, links)?;
        } else if meta.is_file() {
            fs::copy(&path, &dest).map_err(|e| format!("Copy {}: {e}", path.display()))?;
        } else {
            return Err(format!("Unsupported special file: {}", path.display()));
        }
    }
    Ok(())
}

pub fn archive_path(name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.starts_with(['/', '\\']) || name.contains(['\\', ':', '\0']) {
        return Err(format!("Unsafe ZIP entry: {name}"));
    }
    let path = Path::new(name.trim_end_matches('/'));
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("Unsafe ZIP entry: {name}"));
    }
    for component in path.iter() {
        safe_filename(component.to_str().ok_or("ZIP path is not UTF-8")?)?;
    }
    Ok(path.to_owned())
}

pub fn extract_zip(archive: &Path, destination: &Path) -> Result<()> {
    if destination.exists() {
        return Err("Extraction destination must be new".into());
    }
    let file = File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP: {e}"))?;
    if zip.len() > 100_000 {
        return Err("ZIP has too many entries".into());
    }
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    let mut names = std::collections::HashSet::new();
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let relative = archive_path(entry.name())?;
        let normalized = text(&relative).to_ascii_lowercase();
        if !names.insert(normalized) {
            return Err("ZIP has duplicate or case-colliding paths".into());
        }
        let kind = entry.unix_mode().unwrap_or(0) & 0o170000;
        if !matches!(kind, 0 | 0o100000 | 0o040000) {
            return Err("ZIP symlinks and special files are forbidden".into());
        }
        total = total.checked_add(entry.size()).ok_or("ZIP size overflow")?;
        if total > 8 * 1024 * 1024 * 1024 || entry.size() > 2 * 1024 * 1024 * 1024 {
            return Err("ZIP exceeds extraction size limit".into());
        }
        let dest = managed(destination, &destination.join(relative))?;
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(dest.parent().ok_or("Invalid ZIP path")?)
                .map_err(|e| e.to_string())?;
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&dest)
                .map_err(|e| e.to_string())?;
            let copied = std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
            if copied != entry.size() {
                return Err("ZIP entry size mismatch".into());
            }
        }
    }
    Ok(())
}
