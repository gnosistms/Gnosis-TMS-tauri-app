mod broker;
mod broker_auth;
mod broker_auth_storage;
mod callbacks;
mod constants;
mod drafts;
mod github;
mod github_app_test;
mod insecure_github_app_config;
mod state;
mod store;
mod updater;
mod window;

use tauri::Manager;
use std::sync::Mutex;
use std::time::Duration;

use crate::{
  broker_auth::{begin_broker_auth, inspect_broker_auth_session},
  broker_auth_storage::{
    clear_broker_auth_session, load_broker_auth_session, save_broker_auth_session,
  },
  callbacks::spawn_callback_server,
  constants::MAIN_WINDOW_BACKGROUND,
  drafts::create_team_setup_draft,
  github::{
    add_organization_admin_for_installation,
    begin_github_app_install, create_gnosis_project_repo, delete_organization_for_installation,
    ensure_gnosis_repo_properties_schema, inspect_github_app_installation,
    invite_user_to_organization_for_installation,
    leave_organization_for_installation, list_gnosis_projects_for_installation,
    list_accessible_github_app_installations, list_organization_members_for_installation,
    mark_gnosis_project_repo_deleted, permanently_delete_gnosis_project_repo, restore_gnosis_project_repo,
    revoke_organization_admin_for_installation,
    search_github_users_for_installation,
    rename_gnosis_project_repo, update_organization_name_for_installation,
    setup_organization_for_installation,
    update_organization_description_for_installation,
  },
  github_app_test::{
    begin_github_app_test_install, get_github_app_test_config,
    inspect_github_app_test_installation, list_github_app_test_repositories,
  },
  state::AuthState,
  updater::{check_for_app_update, install_app_update, PendingUpdate},
};

#[tauri::command]
fn ping() -> &'static str {
  "pong"
}

#[tauri::command]
fn check_internet_connection() -> bool {
  let client = match reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(3))
    .build()
  {
    Ok(client) => client,
    Err(_) => return false,
  };

  client
    .get("https://github.com")
    .header("User-Agent", "gnosis-tms")
    .send()
    .map(|response| response.status().is_success() || response.status().is_redirection())
    .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AuthState {
      pending_github_app_install: Mutex::new(None),
      pending_broker_auth: Mutex::new(None),
    })
    .manage(PendingUpdate(Mutex::new(None)))
    .plugin(store::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_updater::Builder::new()
        .pubkey(include_str!("../updater-public-key.txt").trim())
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      ping,
      check_internet_connection,
      check_for_app_update,
      install_app_update,
      begin_broker_auth,
      inspect_broker_auth_session,
      load_broker_auth_session,
      save_broker_auth_session,
      clear_broker_auth_session,
      create_team_setup_draft,
      begin_github_app_install,
      begin_github_app_test_install,
      get_github_app_test_config,
      create_gnosis_project_repo,
      rename_gnosis_project_repo,
      mark_gnosis_project_repo_deleted,
      restore_gnosis_project_repo,
      permanently_delete_gnosis_project_repo,
      inspect_github_app_installation,
      list_accessible_github_app_installations,
      inspect_github_app_test_installation,
      ensure_gnosis_repo_properties_schema,
      list_gnosis_projects_for_installation,
      list_github_app_test_repositories,
      list_organization_members_for_installation,
      search_github_users_for_installation,
      invite_user_to_organization_for_installation,
      setup_organization_for_installation,
      add_organization_admin_for_installation,
      revoke_organization_admin_for_installation,
      update_organization_name_for_installation,
      update_organization_description_for_installation,
      delete_organization_for_installation,
      leave_organization_for_installation
    ])
    .setup(|app| {
      #[cfg(target_os = "macos")]
      for label in ["main"] {
        if let Some(window) = app.get_webview_window(label) {
          let _ = window.set_background_color(Some(MAIN_WINDOW_BACKGROUND));
        }
      }

      let app_handle = app.handle().clone();
      std::thread::spawn(move || spawn_callback_server(app_handle));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
