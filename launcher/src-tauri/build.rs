fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::build()
}
