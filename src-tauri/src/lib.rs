mod broker;
mod broker_auth;
mod broker_auth_storage;
mod callbacks;
mod constants;
mod drafts;
mod glossary_storage;
mod github;
mod github_app_test;
mod insecure_github_app_config;
mod project_import;
mod project_repo_sync;
mod state;
mod store;
mod updater;
mod window;

use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use std::sync::Mutex;
use std::time::Duration;

use crate::{
  broker_auth::{begin_broker_auth, inspect_broker_auth_session, refresh_broker_auth_session},
  broker_auth_storage::{
    clear_broker_auth_session, load_broker_auth_session, save_broker_auth_session,
  },
  callbacks::spawn_callback_server,
  constants::MAIN_WINDOW_BACKGROUND,
  drafts::create_team_setup_draft,
  glossary_storage::{
    delete_gtms_glossary_term, list_local_gtms_glossaries, load_gtms_glossary_editor_data,
    upsert_gtms_glossary_term,
  },
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
  project_import::{
    import_xlsx_to_gtms, list_local_gtms_project_files, load_gtms_chapter_editor_data, permanently_delete_gtms_chapter,
    rename_gtms_chapter, restore_gtms_chapter, soft_delete_gtms_chapter,
    update_gtms_chapter_language_selection, update_gtms_editor_row_fields,
  },
  project_repo_sync::{list_project_repo_sync_states, reconcile_project_repo_sync_states},
  state::{AuthState, ProjectRepoSyncStore},
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

const SYNC_WITH_SERVER_MENU_ID: &str = "sync-with-server";
const SYNC_WITH_SERVER_EVENT: &str = "sync-with-server";
const CHECK_FOR_UPDATES_MENU_ID: &str = "check-for-updates";
const CHECK_FOR_UPDATES_EVENT: &str = "check-for-updates";

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
  let sync_shortcut = if cfg!(target_os = "macos") {
    "Cmd+S"
  } else {
    "Ctrl+R"
  };
  let sync_item = MenuItemBuilder::with_id(SYNC_WITH_SERVER_MENU_ID, "Sync with Server")
    .accelerator(sync_shortcut)
    .build(app)?;
  let check_for_updates_item =
    MenuItemBuilder::with_id(CHECK_FOR_UPDATES_MENU_ID, "Check for Updates...").build(app)?;

  let file_menu = SubmenuBuilder::new(app, "File")
    .item(&sync_item)
    .separator()
    .item(&PredefinedMenuItem::close_window(app, None)?)
    .build()?;

  #[cfg(not(target_os = "macos"))]
  let file_menu = Submenu::with_items(
    app,
    "File",
    true,
    &[
      &sync_item,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::close_window(app, None)?,
      &PredefinedMenuItem::quit(app, None)?,
    ],
  )?;

  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(app, None)?,
      &PredefinedMenuItem::redo(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  let window_menu = Submenu::with_items(
    app,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, None)?,
      &PredefinedMenuItem::maximize(app, None)?,
      #[cfg(target_os = "macos")]
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::close_window(app, None)?,
    ],
  )?;

  #[cfg(target_os = "macos")]
  {
    let pkg_info = app.package_info();
    let about_metadata = tauri::menu::AboutMetadata {
      name: Some(pkg_info.name.clone()),
      version: Some(pkg_info.version.to_string()),
      ..Default::default()
    };

    let app_menu = Submenu::with_items(
      app,
      pkg_info.name.clone(),
      true,
      &[
        &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
        &PredefinedMenuItem::separator(app)?,
        &check_for_updates_item,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::services(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, None)?,
      ],
    )?;

    let view_menu = Submenu::with_items(
      app,
      "View",
      true,
      &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let help_menu = Submenu::with_items(app, "Help", true, &[])?;

    return Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu]);
  }

  #[cfg(not(target_os = "macos"))]
  {
    let help_menu = Submenu::with_items(app, "Help", true, &[&check_for_updates_item])?;
    return Menu::with_items(app, &[&file_menu, &edit_menu, &window_menu, &help_menu]);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AuthState {
      pending_github_app_install: Mutex::new(None),
      pending_broker_auth: Mutex::new(None),
    })
    .manage(ProjectRepoSyncStore::default())
    .manage(PendingUpdate(Mutex::new(None)))
    .plugin(store::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(
      tauri_plugin_updater::Builder::new()
        .pubkey(include_str!("../updater-public-key.txt").trim())
        .build(),
    )
    .on_menu_event(|app, event| {
      if event.id().0 == SYNC_WITH_SERVER_MENU_ID {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit(SYNC_WITH_SERVER_EVENT, ());
        }
      } else if event.id().0 == CHECK_FOR_UPDATES_MENU_ID {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit(CHECK_FOR_UPDATES_EVENT, ());
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      ping,
      check_internet_connection,
      check_for_app_update,
      install_app_update,
      begin_broker_auth,
      inspect_broker_auth_session,
      refresh_broker_auth_session,
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
      reconcile_project_repo_sync_states,
      list_project_repo_sync_states,
      import_xlsx_to_gtms,
      list_local_gtms_project_files,
      load_gtms_chapter_editor_data,
      rename_gtms_chapter,
      soft_delete_gtms_chapter,
      restore_gtms_chapter,
      permanently_delete_gtms_chapter,
      update_gtms_chapter_language_selection,
      update_gtms_editor_row_fields,
      list_local_gtms_glossaries,
      load_gtms_glossary_editor_data,
      upsert_gtms_glossary_term,
      delete_gtms_glossary_term,
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
      let menu = build_app_menu(&app.handle())?;
      let _ = app.set_menu(menu)?;

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
