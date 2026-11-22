pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_store::Builder::default().build()
}

#[tauri::command]
pub async fn save_error_reporting_settings(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.store("app-state.json").map_err(|e| e.to_string())?;
        store.set("telemetry-enabled", enabled);
        store.set("telemetry-disclosure-shown", true);
        store.save().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            use tauri::Manager;
            app.state::<crate::windows_crash::Reporter>()
                .settings_saved(enabled);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
