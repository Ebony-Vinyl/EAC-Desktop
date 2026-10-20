use std::path::{Path, PathBuf};
use serde_json::Value;

fn plain(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {return Err("update-startup-path-link".into());}
                #[cfg(windows)] {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {return Err("update-startup-path-link".into());}
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("update-startup-path-unavailable".into()),
        }
    }
    Ok(())
}

fn same_owned_path(actual: &Path, expected: &Path) -> bool {
    if actual.components().chain(expected.components()).any(|component| matches!(component, std::path::Component::ParentDir)) {return false;}
    if actual == expected {return true;}
    #[cfg(windows)] {
        if !actual.is_absolute() || !expected.is_absolute() || plain(actual).is_err() || plain(expected).is_err() {return false;}
        return match (std::fs::canonicalize(actual), std::fs::canonicalize(expected)) {
            (Ok(actual), Ok(expected)) => actual == expected,
            _ => false,
        };
    }
    #[cfg(not(windows))] {false}
}

fn transaction(root: &Path, value: &Value) -> Result<PathBuf, String> {
    let id=value.get("transactionId").and_then(Value::as_str).ok_or("update-recovery-pointer-invalid")?;
    if value.get("schemaVersion").and_then(Value::as_u64)!=Some(1) || id.len()!=36 || !id.bytes().enumerate().all(|(index,byte)| {
        if [8,13,18,23].contains(&index) {byte==b'-'} else {byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)}
    }) {return Err("update-recovery-pointer-invalid".into());}
    let directory=root.parent().ok_or("update-recovery-pointer-invalid")?.join(format!(".eac-update-{id}"));
    let supplied=PathBuf::from(value.get("transactionDir").and_then(Value::as_str).ok_or("update-recovery-pointer-invalid")?);
    if !same_owned_path(&supplied, &directory) {return Err("update-recovery-pointer-invalid".into());}
    plain(&supplied)?;
    plain(&directory)?;Ok(directory)
}
fn helper_script(value: &Value) -> Result<&'static str, String> {
    match value.get("installKind") {
        None => Ok("update-portable-helper.js"),
        Some(kind) if kind.as_str()==Some("portable") => Ok("update-portable-helper.js"),
        Some(kind) if kind.as_str()==Some("nsis") => Ok("update-nsis-helper.js"),
        _ => Err("update-recovery-pointer-invalid".into()),
    }
}
pub fn gate(exe: &Path, version: &str) -> Result<String, String> {
    let root=exe.parent().ok_or("update-startup-root-unavailable")?;
    let pointer=root.join(".eac-update-recovery.json");
    if !pointer.exists() {return Ok("normal".into());}
    plain(root)?;plain(&pointer)?;
    let value:Value=serde_json::from_slice(&std::fs::read(&pointer).map_err(|_|"update-recovery-pointer-unavailable")?).map_err(|_|"update-recovery-pointer-invalid")?;
    let directory=transaction(root,&value)?;
    let copied=directory.join("helper");
    let script_name=helper_script(&value)?;
    let (node,script)=if copied.join("handoff.json").exists() {
        (copied.join("node.exe"),copied.join("lib/desktop").join(script_name))
    } else {
        (root.join("dsh-desktop/vendor/node/node.exe"),root.join("dsh-desktop/lib/desktop").join(script_name))
    };
    plain(&node)?;plain(&script)?;
    if !node.is_file() || !script.is_file() {return Err("update-recovery-helper-unavailable".into());}
    let mut command=std::process::Command::new(node);
    command.arg(script).arg("--startup-gate").arg(root).arg(std::process::id().to_string()).arg(version);
    command.stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x0800_0000);}
    let output=command.output().map_err(|_|"update-startup-helper-unavailable")?;
    if !output.status.success() {return Err("update-startup-recovery-unconfirmed".into());}
    let result:Value=serde_json::from_slice(&output.stdout).map_err(|_|"update-startup-response-invalid")?;
    let mode=result.get("mode").and_then(Value::as_str).ok_or("update-startup-response-invalid")?;
    if !["normal","health","recovering"].contains(&mode) {return Err("update-startup-response-invalid".into());}
    Ok(mode.into())
}

// The AppImage file and transaction live outside the runtime mount, which disappears on exit.
fn appimage_pointer(exe: &Path, image: &Path, app_dir: &Path) -> Result<PathBuf, String> {
    if !exe.is_absolute() || !image.is_absolute() || !app_dir.is_absolute() || !exe.starts_with(app_dir) || exe==app_dir
        || image.starts_with(app_dir) || app_dir.starts_with(image)
        || exe.components().chain(image.components()).chain(app_dir.components()).any(|part|matches!(part,std::path::Component::ParentDir)) {
        return Err("update-appimage-runtime-invalid".into());
    }
    plain(image)?;plain(app_dir)?;plain(exe)?;
    let name=image.file_name().and_then(|name|name.to_str()).ok_or("update-appimage-runtime-invalid")?;
    Ok(image.parent().ok_or("update-appimage-runtime-invalid")?.join(format!(".{name}.eac-update.json")))
}
pub fn appimage_gate(exe: &Path, version: &str) -> Result<String, String> {
    let image=PathBuf::from(std::env::var_os("APPIMAGE").ok_or("update-appimage-runtime-invalid")?);
    let app_dir=PathBuf::from(std::env::var_os("APPDIR").ok_or("update-appimage-runtime-invalid")?);
    let pointer=appimage_pointer(exe,&image,&app_dir)?;
    if !pointer.try_exists().map_err(|_|"update-recovery-pointer-unavailable")? {
        return if std::env::var_os("DSH_EAC_UPDATE_HEALTH_TOKEN").is_some() {Err("update-health-pointer-unavailable".into())} else {Ok("normal".into())};
    }
    plain(&pointer)?;
    let value:Value=serde_json::from_slice(&std::fs::read(&pointer).map_err(|_|"update-recovery-pointer-unavailable")?).map_err(|_|"update-recovery-pointer-invalid")?;
    if value.get("installKind").and_then(Value::as_str)!=Some("appimage")
        || value.get("image").and_then(Value::as_str)!=image.to_str() {return Err("update-recovery-pointer-invalid".into());}
    let directory=transaction(&image,&value)?;
    let node=directory.join("helper/node");let script=directory.join("helper/lib/desktop/update-appimage-helper.js");
    plain(&node)?;plain(&script)?;
    if !node.is_file() || !script.is_file() {return Err("update-recovery-helper-unavailable".into());}
    let output=std::process::Command::new(node).arg(script).arg("--startup-gate").arg(image).arg(std::process::id().to_string()).arg(version)
        .stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().map_err(|_|"update-startup-helper-unavailable")?;
    if !output.status.success() {return Err("update-startup-recovery-unconfirmed".into());}
    let response:Value=serde_json::from_slice(&output.stdout).map_err(|_|"update-startup-response-invalid")?;
    let mode=response.get("mode").and_then(Value::as_str).ok_or("update-startup-response-invalid")?;
    if !["normal","health"].contains(&mode) {return Err("update-startup-response-invalid".into());}Ok(mode.into())
}

fn linux_package_helper_paths(directory: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !directory.is_absolute() || directory.file_name().and_then(|name|name.to_str())!=Some("linux-install")
        || directory.components().any(|part|matches!(part,std::path::Component::ParentDir)) {
        return Err("update-linux-startup-directory-invalid".into());
    }
    let id=directory.parent().and_then(Path::file_name).and_then(|name|name.to_str()).ok_or("update-linux-startup-directory-invalid")?;
    if id.len()!=36 || !id.bytes().enumerate().all(|(index,byte)|if [8,13,18,23].contains(&index){byte==b'-'}else{byte.is_ascii_digit()||(b'a'..=b'f').contains(&byte)}) {
        return Err("update-linux-startup-directory-invalid".into());
    }
    plain(directory)?;
    Ok((directory.join("helper/node"),directory.join("helper/lib/desktop/update-linux-helper.js")))
}
pub fn linux_package_gate(exe: &Path, version: &str) -> Result<String, String> {
    let token=std::env::var("DSH_EAC_UPDATE_HEALTH_TOKEN").map_err(|_|"update-linux-startup-token-invalid")?;
    if token.len()!=64 || !token.bytes().all(|byte|byte.is_ascii_digit()||(b'a'..=b'f').contains(&byte)) {return Err("update-linux-startup-token-invalid".into());}
    let directory=PathBuf::from(std::env::var_os("DSH_EAC_UPDATE_TRANSACTION_DIR").ok_or("update-linux-startup-directory-invalid")?);
    let (node,script)=linux_package_helper_paths(&directory)?;
    plain(exe)?;plain(&node)?;plain(&script)?;
    if !node.is_file() || !script.is_file() {return Err("update-recovery-helper-unavailable".into());}
    let output=std::process::Command::new(node).arg(script).arg("--startup-gate").arg(directory).arg(exe).arg(std::process::id().to_string()).arg(version)
        .stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().map_err(|_|"update-startup-helper-unavailable")?;
    if !output.status.success() {return Err("update-startup-recovery-unconfirmed".into());}
    let response:Value=serde_json::from_slice(&output.stdout).map_err(|_|"update-startup-response-invalid")?;
    if response.get("mode").and_then(Value::as_str)!=Some("health") {return Err("update-startup-response-invalid".into());}Ok("health".into())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairInfo {
    schema_version: u64,
    install_kind: String,
    transaction_id: String,
    pub transaction_dir: PathBuf,
    install_root: PathBuf,
    pub version: String,
    previous_version: String,
    pub phase: String,
    installer_file: PathBuf,
    program_backup_manifest_present: bool,
    pub error: String,
}
fn valid_stable_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty()
        && (part.len() == 1 || !part.starts_with('0')) && part.bytes().all(|byte| byte.is_ascii_digit()))
}
fn validate_repair_info(value: Value, root: &Path, directory: &Path, id: &str, native_version: &str) -> Result<RepairInfo, String> {
    let info: RepairInfo = serde_json::from_value(value).map_err(|_| "update-repair-response-invalid")?;
    if info.schema_version != 1 || info.install_kind != "nsis" || info.transaction_id != id
        || !same_owned_path(&info.transaction_dir, directory) || !same_owned_path(&info.install_root, root)
        || !same_owned_path(&info.installer_file, &directory.join("installer.exe"))
        || !["installing", "installed", "health", "failed"].contains(&info.phase.as_str())
        || !valid_stable_version(&info.version) || !valid_stable_version(&info.previous_version)
        || ![info.version.as_str(), info.previous_version.as_str()].contains(&native_version)
        || info.error.len() < 8 || info.error.len() > 96 || !info.error.starts_with("update-")
        || !info.error.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'-') {
        return Err("update-repair-response-invalid".into());
    }
    Ok(info)
}
pub fn repair_info(exe: &Path, version: &str) -> Result<RepairInfo, String> {
    if std::env::var_os("DSH_EAC_UPDATE_HEALTH_TOKEN").is_some() {return Err("update-repair-health-boot-refused".into());}
    let root = exe.parent().ok_or("update-startup-root-unavailable")?;
    let pointer = root.join(".eac-update-recovery.json");
    plain(root)?; plain(&pointer)?;
    let value: Value = serde_json::from_slice(&std::fs::read(&pointer).map_err(|_| "update-recovery-pointer-unavailable")?).map_err(|_| "update-recovery-pointer-invalid")?;
    if value.get("installKind").and_then(Value::as_str) != Some("nsis") {return Err("update-repair-kind-invalid".into());}
    let directory = transaction(root, &value)?;
    let id = value.get("transactionId").and_then(Value::as_str).ok_or("update-recovery-pointer-invalid")?;
    let node = directory.join("helper/node.exe");
    let script = directory.join("helper/lib/desktop/update-nsis-helper.js");
    plain(&node)?; plain(&script)?;
    if !node.is_file() || !script.is_file() {return Err("update-recovery-helper-unavailable".into());}
    let mut command = std::process::Command::new(node);
    command.arg(script).arg("--repair-info").arg(root).arg(version);
    command.stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x0800_0000);}
    let output = command.output().map_err(|_| "update-repair-helper-unavailable")?;
    if !output.status.success() || output.stdout.len() > 16384 {return Err("update-repair-validation-failed".into());}
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|_| "update-repair-response-invalid")?;
    let info = validate_repair_info(result, root, &directory, id, version)?;
    plain(&info.transaction_dir)?; plain(&info.installer_file)?;
    if !info.transaction_dir.is_dir() || !info.installer_file.is_file() {return Err("update-repair-material-unavailable".into());}
    Ok(info)
}
fn repair_text(info: &RepairInfo, chinese: bool) -> (String, String) {
    let directory = info.transaction_dir.to_string_lossy();
    if chinese {
        let backup = if info.program_backup_manifest_present {"目录中也保留了程序备份清单。\n"} else {""};
        ("EAC-Lite 更新恢复".into(), format!("更新尚未确认完成，当前启动已停止。\n\n目标版本：{}\n错误代码：{}\n\n完整安装包和诊断记录位于：\n{}\n{}\n是否打开这个目录以便检查和修复？", info.version, info.error, directory, backup))
    } else {
        let backup = if info.program_backup_manifest_present {"A program backup manifest is also available.\n"} else {""};
        ("EAC-Lite update recovery".into(), format!("The update has not been confirmed complete. Startup has stopped.\n\nTarget version: {}\nError code: {}\n\nThe complete installer and diagnostic records are in:\n{}\n{}\nOpen this folder for inspection and repair?", info.version, info.error, directory, backup))
    }
}
#[cfg(windows)]
pub fn show_repair_dialog(info: &RepairInfo, chinese: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::{MessageBoxW, IDYES, MB_YESNO, MB_ICONWARNING, MB_DEFBUTTON2, MB_SETFOREGROUND, SW_SHOWNORMAL}};
    let wide = |value: &str| value.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (title, body) = repair_text(info, chinese);
    let title = wide(&title); let body = wide(&body);
    let selected = unsafe {MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND)};
    if selected == IDYES {
        plain(&info.transaction_dir)?;
        let verb = wide("open"); let directory = wide(&info.transaction_dir.to_string_lossy());
        let result = unsafe {ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), directory.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)} as isize;
        if result <= 32 {return Err("update-repair-folder-unavailable".into());}
    }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn native_package_helper_stays_in_the_owned_transaction() {
        let base=std::env::temp_dir().join("eac-native-package-path-test");
        let directory=base.join("12345678-1234-4234-8234-1234567890ab/linux-install");
        let (node,script)=linux_package_helper_paths(&directory).unwrap();
        assert_eq!(node,directory.join("helper/node"));
        assert_eq!(script,directory.join("helper/lib/desktop/update-linux-helper.js"));
        assert!(linux_package_helper_paths(&base.join("invalid/linux-install")).is_err());
        assert!(linux_package_helper_paths(&directory.join("../linux-install")).is_err());
        assert!(linux_package_helper_paths(&directory.join("helper")).is_err());
    }
    #[test] fn appimage_pointer_stays_outside_the_runtime_mount() {
        let base=std::env::temp_dir().join("eac-native-appimage-path-test");
        let image=base.join("EAC-Lite.AppImage");let mount=base.join("mount");let exe=mount.join("usr/bin/dsh-eac-shell");
        assert_eq!(appimage_pointer(&exe,&image,&mount).unwrap(),base.join(".EAC-Lite.AppImage.eac-update.json"));
        assert!(appimage_pointer(&base.join("other-shell"),&image,&mount).is_err());
        assert!(appimage_pointer(&exe,&mount.join("image"),&mount).is_err());
        assert!(appimage_pointer(&exe,&image,&image).is_err());
        assert!(appimage_pointer(&mount.join("../other-shell"),&image,&mount).is_err());
    }
    #[test] fn helper_entry_is_owned_by_the_install_kind() {
        assert_eq!(helper_script(&serde_json::json!({})).unwrap(),"update-portable-helper.js");
        assert_eq!(helper_script(&serde_json::json!({"installKind":"nsis"})).unwrap(),"update-nsis-helper.js");
        for kind in ["../unowned.js", "deb", "", "NSIS"] {
            assert!(helper_script(&serde_json::json!({"installKind":kind})).is_err());
        }
        assert!(helper_script(&serde_json::json!({"installKind":null})).is_err());
    }
    #[test] fn fixed_sibling_pointer_only() {
        let root=std::env::temp_dir().join("eac-startup-fixture");let id="41976fc6-7415-4e08-b539-d2f6a4742663";
        let next=root.parent().unwrap().join(format!(".eac-update-{id}"));
        let mut value=serde_json::json!({"schemaVersion":1,"transactionId":id,"transactionDir":next});
        assert_eq!(transaction(&root,&value).unwrap(),next);
        value["transactionDir"]=serde_json::json!(root.join("unowned"));assert!(transaction(&root,&value).is_err());
        value["transactionId"]=serde_json::json!("../../unowned");assert!(transaction(&root,&value).is_err());
    }

    fn repair_fixture() -> (PathBuf, PathBuf, &'static str, Value) {
        let root = std::env::temp_dir().join("eac-repair-应用 目录");
        let id = "41976fc6-7415-4e08-b539-d2f6a4742663";
        let directory = root.parent().unwrap().join(format!(".eac-update-{id}"));
        let value = serde_json::json!({"schemaVersion":1,"installKind":"nsis","transactionId":id,
            "transactionDir":directory,"installRoot":root,"version":"6.1.1","previousVersion":"6.1.0","phase":"failed",
            "installerFile":directory.join("installer.exe"),"programBackupManifestPresent":true,"error":"update-health-unconfirmed"});
        (root, directory, id, value)
    }
    #[test] fn repair_response_is_bound_to_the_exact_owned_transaction() {
        let (root, directory, id, value) = repair_fixture();
        assert!(validate_repair_info(value.clone(), &root, &directory, id, "6.1.0").is_ok());
        assert!(validate_repair_info(value.clone(), &root, &directory, id, "6.1.1").is_ok());
        assert!(validate_repair_info(value.clone(), &root, &directory, id, "6.2.0").is_err());
        for key in ["transactionDir", "installRoot", "installerFile"] {
            let mut changed = value.clone(); changed[key] = serde_json::json!(root.join("unowned"));
            assert!(validate_repair_info(changed, &root, &directory, id, "6.1.0").is_err());
        }
        let mut changed = value.clone(); changed["phase"] = serde_json::json!("committed");
        assert!(validate_repair_info(changed, &root, &directory, id, "6.1.0").is_err());
    }
    #[test] fn repair_response_refuses_raw_errors_and_unknown_fields() {
        let (root, directory, id, value) = repair_fixture();
        for error in ["update-", "raw secret error", "update-bad\nvalue", "update-code?token=value"] {
            let mut changed = value.clone(); changed["error"] = serde_json::json!(error);
            assert!(validate_repair_info(changed, &root, &directory, id, "6.1.0").is_err());
        }
        let mut changed = value.clone(); changed["token"] = serde_json::json!("private-field");
        assert!(validate_repair_info(changed, &root, &directory, id, "6.1.0").is_err());
    }
    #[test] fn repair_text_identifies_the_version_and_materials_without_claiming_completion() {
        let (root, directory, id, value) = repair_fixture();
        let info = validate_repair_info(value, &root, &directory, id, "6.1.0").unwrap();
        let (title, text) = repair_text(&info, true);
        assert!(title.contains("EAC-Lite")); assert!(text.contains("6.1.1")); assert!(text.contains(directory.to_string_lossy().as_ref()));
        assert!(text.contains("更新尚未确认完成")); assert!(text.contains("备份清单"));
        let (title, text) = repair_text(&info, false);
        assert_eq!(title, "EAC-Lite update recovery"); assert!(text.contains("not been confirmed complete"));
    }

    #[cfg(windows)]
    #[test] fn owned_windows_path_comparison_accepts_real_case_variation_and_refuses_traversal() {
        let directory = std::env::temp_dir().join(format!("eac-repair-case-{}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        let varied = PathBuf::from(directory.to_string_lossy().to_uppercase());
        let result = same_owned_path(&varied, &directory);
        assert!(!same_owned_path(&directory.join(".."), directory.parent().unwrap()));
        std::fs::remove_dir(&directory).unwrap();
        assert!(result);
    }
}
