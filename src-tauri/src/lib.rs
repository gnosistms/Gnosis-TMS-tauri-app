mod auth;
mod callbacks;
mod constants;
mod drafts;
mod github;
mod insecure_github_app_config;
mod state;
mod window;

use tauri::Manager;
use std::sync::Mutex;

use crate::{
  auth::begin_github_oauth,
  callbacks::spawn_callback_server,
  constants::MAIN_WINDOW_BACKGROUND,
  drafts::create_team_setup_draft,
  github::{
    begin_github_app_install, inspect_github_app_installation, list_user_organizations,
  },
  state::AuthState,
};

#[tauri::command]
fn ping() -> &'static str {
  "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AuthState {
      pending_oauth: Mutex::new(None),
      pending_github_app_install: Mutex::new(None),
    })
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      ping,
      begin_github_oauth,
      create_team_setup_draft,
      begin_github_app_install,
      inspect_github_app_installation,
      list_user_organizations
    ])
    .setup(|app| {
      #[cfg(target_os = "macos")]
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(MAIN_WINDOW_BACKGROUND));
      }

      let app_handle = app.handle().clone();
      std::thread::spawn(move || spawn_callback_server(app_handle));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
