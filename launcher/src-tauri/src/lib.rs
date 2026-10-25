mod achievements;
pub mod bridge;
pub mod engine;
mod files;
mod model;
mod network;
mod process;
mod social;
mod usage;

pub use engine::Engine;

#[cfg(feature = "desktop")]
#[tauri::command]
async fn launcher_call(
    engine: tauri::State<'_, Engine>,
    action: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.call(&action, payload.unwrap_or_else(|| serde_json::json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(feature = "desktop")]
pub fn run() {
    let engine = Engine::open().expect("Cannot open EAC Launcher data directory");
    tauri::Builder::default()
        .manage(engine)
        .invoke_handler(tauri::generate_handler![launcher_call])
        .run(tauri::generate_context!())
        .expect("EAC Launcher failed");
}
