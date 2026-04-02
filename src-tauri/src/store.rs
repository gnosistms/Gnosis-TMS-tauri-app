pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
  tauri_plugin_store::Builder::default().build()
}
