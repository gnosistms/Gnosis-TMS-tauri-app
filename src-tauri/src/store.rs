pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_store::Builder::default().build()
}

#[tauri::command]
pub async fn save_error_reporting_settings(
    app: tauri::AppHandle,
    enabled: bool,
    install_id: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.store("app-state.json").map_err(|e| e.to_string())?;
        store.set("telemetry-enabled", enabled);
        store.set("telemetry-disclosure-shown", true);
        if let Some(id) = install_id
            .filter(|_| enabled)
            .and_then(|id| uuid::Uuid::parse_str(&id).ok())
        {
            store.set("telemetry-install-id", id.to_string());
        }
        let saved = store.save().map_err(|e| e.to_string());
        #[cfg(windows)]
        {
            use tauri::Manager;
            // An attempted opt-out also stops capture when the disk write fails.
            // Enabling delivery requires a durable choice.
            if !enabled || saved.is_ok() {
                app.state::<crate::windows_crash::Reporter>()
                    .apply_choice(enabled);
            }
        }
        saved
    })
    .await
    .map_err(|e| e.to_string())?
}
