#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    if let Err(error) = eac_launcher_lib::gui::run() {
        // 没有控制台时至少把失败原因写进临时日志，方便排查。
        let path = std::env::temp_dir().join("eac-launcher-gui.log");
        let _ = std::fs::write(path, format!("EAC Launcher GUI failed: {error}\n"));
    }
}
