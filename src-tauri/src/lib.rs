mod ai;
mod ai_secret_storage;
mod broker;
mod broker_auth;
mod broker_auth_storage;
mod callbacks;
mod constants;
mod drafts;
mod git_commit;
mod github;
mod github_app_test;
mod glossary_repo_sync;
mod glossary_storage;
mod insecure_github_app_config;
mod local_repo_sync_state;
mod project_import;
mod project_repo_paths;
mod project_repo_sync;
mod project_search;
mod repo_sync_shared;
mod state;
mod storage_paths;
mod store;
mod team_metadata_local;
mod updater;
mod window;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, Manager};

use crate::{
    ai::{
        load_ai_provider_models as load_ai_provider_models_task,
        prepare_ai_translated_glossary as prepare_ai_translated_glossary_task,
        probe_ai_model as probe_ai_model_task, run_ai_review as run_ai_review_task,
        run_ai_translation as run_ai_translation_task,
        types::{
            AiModelProbeRequest, AiProviderId, AiProviderModel, AiReviewRequest, AiReviewResponse,
            AiTranslatedGlossaryPreparationRequest, AiTranslatedGlossaryPreparationResponse,
            AiTranslationRequest, AiTranslationResponse,
        },
    },
    ai_secret_storage::{
        clear_ai_provider_secret as clear_ai_provider_secret_value,
        load_ai_provider_secret as load_ai_provider_secret_value,
        save_ai_provider_secret as save_ai_provider_secret_value,
    },
    broker_auth::{begin_broker_auth, inspect_broker_auth_session, refresh_broker_auth_session},
    broker_auth_storage::{
        clear_broker_auth_session, load_broker_auth_session, save_broker_auth_session,
    },
    callbacks::spawn_callback_server,
    constants::MAIN_WINDOW_BACKGROUND,
    drafts::create_team_setup_draft,
    github::{
        add_organization_admin_for_installation, begin_github_app_install,
        create_gnosis_glossary_repo, create_gnosis_project_repo,
        delete_gnosis_glossary_metadata_record, delete_gnosis_project_metadata_record,
        delete_organization_for_installation, ensure_gnosis_repo_properties_schema,
        inspect_github_app_installation, inspect_team_metadata_repo_for_installation,
        invite_user_to_organization_for_installation, leave_organization_for_installation,
        list_accessible_github_app_installations, list_gnosis_glossaries_for_installation,
        list_gnosis_glossary_metadata_records, list_gnosis_project_metadata_records,
        list_gnosis_projects_for_installation, list_organization_members_for_installation,
        mark_gnosis_project_repo_deleted, permanently_delete_gnosis_glossary_repo,
        permanently_delete_gnosis_project_repo, purge_local_installation_data,
        remove_organization_member_for_installation, rename_gnosis_project_repo,
        restore_gnosis_project_repo, revoke_organization_admin_for_installation,
        search_github_users_for_installation, setup_organization_for_installation,
        update_organization_description_for_installation,
        update_organization_name_for_installation, upsert_gnosis_glossary_metadata_record,
        upsert_gnosis_project_metadata_record,
    },
    github_app_test::{
        begin_github_app_test_install, get_github_app_test_config,
        inspect_github_app_test_installation, list_github_app_test_repositories,
    },
    glossary_repo_sync::{sync_gtms_glossary_editor_repo, sync_gtms_glossary_repos},
    glossary_storage::{
        delete_gtms_glossary_term, import_tmx_to_gtms_glossary_repo, initialize_gtms_glossary_repo,
        inspect_tmx_glossary_import, list_local_gtms_glossaries, load_gtms_glossary_editor_data,
        load_gtms_glossary_term, prepare_local_gtms_glossary_repo, purge_local_gtms_glossary_repo,
        rename_gtms_glossary, rename_local_gtms_glossary_repo, restore_gtms_glossary,
        soft_delete_gtms_glossary, upsert_gtms_glossary_term,
    },
    project_import::{
        delete_gtms_editor_row_comment, import_xlsx_to_gtms, initialize_gtms_project_repo,
        insert_gtms_editor_row_after, insert_gtms_editor_row_before, list_local_gtms_project_files,
        load_gtms_chapter_editor_data, load_gtms_editor_field_history, load_gtms_editor_row,
        load_gtms_editor_row_comments, permanently_delete_gtms_chapter,
        permanently_delete_gtms_editor_row, purge_local_gtms_project_repo, rename_gtms_chapter,
        restore_gtms_chapter, restore_gtms_editor_field_from_history, restore_gtms_editor_row,
        reverse_gtms_editor_batch_replace_commit, save_gtms_editor_row_comment,
        soft_delete_gtms_chapter, soft_delete_gtms_editor_row, update_gtms_chapter_glossary_links,
        update_gtms_chapter_language_selection, update_gtms_editor_row_field_flag,
        update_gtms_editor_row_fields, update_gtms_editor_row_fields_batch,
    },
    project_repo_sync::{
        inspect_gtms_project_editor_repo_sync_state, list_project_repo_sync_states,
        reconcile_project_repo_sync_states, sync_gtms_project_editor_repo,
    },
    project_search::{refresh_project_search_index, search_projects},
    repo_sync_shared::initialize_git_runtime,
    state::{AuthState, ProjectRepoSyncStore},
    team_metadata_local::{
        delete_local_gnosis_glossary_metadata_record, delete_local_gnosis_project_metadata_record,
        ensure_local_team_metadata_repo, inspect_and_migrate_local_repo_bindings,
        list_local_gnosis_glossary_metadata_records, list_local_gnosis_project_metadata_records,
        lookup_local_team_metadata_tombstone, push_local_team_metadata_repo,
        repair_local_repo_binding, sync_local_team_metadata_repo,
        upsert_local_gnosis_glossary_metadata_record, upsert_local_gnosis_project_metadata_record,
    },
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

#[tauri::command]
async fn load_ai_provider_secret(
    app: tauri::AppHandle,
    provider_id: AiProviderId,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || load_ai_provider_secret_value(&app, provider_id))
        .await
        .map_err(|error| format!("The AI key load worker failed: {error}"))?
}

#[tauri::command]
async fn save_ai_provider_secret(
    app: tauri::AppHandle,
    provider_id: AiProviderId,
    api_key: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_ai_provider_secret_value(&app, provider_id, &api_key)
    })
    .await
    .map_err(|error| format!("The AI key save worker failed: {error}"))?
}

#[tauri::command]
async fn list_ai_provider_models(
    app: tauri::AppHandle,
    provider_id: AiProviderId,
) -> Result<Vec<AiProviderModel>, String> {
    tauri::async_runtime::spawn_blocking(move || load_ai_provider_models_task(&app, provider_id))
        .await
        .map_err(|error| format!("The AI models worker failed: {error}"))?
}

#[tauri::command]
async fn clear_ai_provider_secret(
    app: tauri::AppHandle,
    provider_id: AiProviderId,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_ai_provider_secret_value(&app, provider_id))
        .await
        .map_err(|error| format!("The AI key clear worker failed: {error}"))?
}

#[tauri::command]
async fn run_ai_review(
    app: tauri::AppHandle,
    request: AiReviewRequest,
) -> Result<AiReviewResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_ai_review_task(&app, request))
        .await
        .map_err(|error| format!("The AI review worker failed: {error}"))?
}

#[tauri::command]
async fn run_ai_translation(
    app: tauri::AppHandle,
    request: AiTranslationRequest,
) -> Result<AiTranslationResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_ai_translation_task(&app, request))
        .await
        .map_err(|error| format!("The AI translation worker failed: {error}"))?
}

#[tauri::command]
async fn prepare_editor_ai_translated_glossary(
    app: tauri::AppHandle,
    request: AiTranslatedGlossaryPreparationRequest,
) -> Result<AiTranslatedGlossaryPreparationResponse, String> {
    tauri::async_runtime::spawn_blocking(move || prepare_ai_translated_glossary_task(&app, request))
        .await
        .map_err(|error| format!("The translated glossary worker failed: {error}"))?
}

#[tauri::command]
async fn probe_ai_provider_model(
    app: tauri::AppHandle,
    request: AiModelProbeRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || probe_ai_model_task(&app, request))
        .await
        .map_err(|error| format!("The AI model probe worker failed: {error}"))?
}

const SYNC_WITH_SERVER_MENU_ID: &str = "sync-with-server";
const SYNC_WITH_SERVER_EVENT: &str = "sync-with-server";
const CHECK_FOR_UPDATES_MENU_ID: &str = "check-for-updates";
const CHECK_FOR_UPDATES_EVENT: &str = "check-for-updates";
const EDITOR_SCROLL_DEBUG_LOG_FILE: &str = "editor-scroll-debug.jsonl";
const EDITOR_SCROLL_DEBUG_LOG_DIR: &str = "logs";
const EDITOR_SCROLL_DEBUG_LOG_MAX_BYTES: u64 = 512 * 1024;

fn append_editor_scroll_debug_log_blocking<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    lines: Vec<String>,
) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
    let log_dir = app_data_dir.join(EDITOR_SCROLL_DEBUG_LOG_DIR);
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Could not create the editor debug log directory: {error}"))?;

    let log_path = log_dir.join(EDITOR_SCROLL_DEBUG_LOG_FILE);
    let rotated_log_path = log_dir.join(format!("{EDITOR_SCROLL_DEBUG_LOG_FILE}.1"));
    if fs::metadata(&log_path)
        .map(|metadata| metadata.len() > EDITOR_SCROLL_DEBUG_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(&rotated_log_path);
        let _ = fs::rename(&log_path, &rotated_log_path);
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Could not open the editor debug log file: {error}"))?;

    for line in lines {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            continue;
        }

        writeln!(file, "{trimmed}")
            .map_err(|error| format!("Could not append to the editor debug log file: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn append_editor_scroll_debug_log(
    app: tauri::AppHandle,
    lines: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        append_editor_scroll_debug_log_blocking(&app, lines)
    })
    .await
    .map_err(|error| format!("The editor debug log worker failed: {error}"))?
}

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

        return Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &view_menu,
                &window_menu,
                &help_menu,
            ],
        );
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
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                use sha2::{Digest, Sha256};

                Sha256::digest(password.as_bytes()).to_vec()
            })
            .build(),
        )
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
            append_editor_scroll_debug_log,
            check_for_app_update,
            install_app_update,
            begin_broker_auth,
            inspect_broker_auth_session,
            refresh_broker_auth_session,
            load_broker_auth_session,
            save_broker_auth_session,
            clear_broker_auth_session,
            load_ai_provider_secret,
            save_ai_provider_secret,
            list_ai_provider_models,
            clear_ai_provider_secret,
            run_ai_review,
            prepare_editor_ai_translated_glossary,
            run_ai_translation,
            probe_ai_provider_model,
            create_team_setup_draft,
            begin_github_app_install,
            begin_github_app_test_install,
            get_github_app_test_config,
            create_gnosis_project_repo,
            upsert_gnosis_project_metadata_record,
            delete_gnosis_project_metadata_record,
            delete_gnosis_glossary_metadata_record,
            rename_gnosis_project_repo,
            mark_gnosis_project_repo_deleted,
            restore_gnosis_project_repo,
            permanently_delete_gnosis_project_repo,
            inspect_github_app_installation,
            inspect_team_metadata_repo_for_installation,
            ensure_local_team_metadata_repo,
            sync_local_team_metadata_repo,
            list_local_gnosis_project_metadata_records,
            list_local_gnosis_glossary_metadata_records,
            lookup_local_team_metadata_tombstone,
            inspect_and_migrate_local_repo_bindings,
            repair_local_repo_binding,
            upsert_local_gnosis_project_metadata_record,
            delete_local_gnosis_project_metadata_record,
            upsert_local_gnosis_glossary_metadata_record,
            delete_local_gnosis_glossary_metadata_record,
            push_local_team_metadata_repo,
            list_accessible_github_app_installations,
            inspect_github_app_test_installation,
            ensure_gnosis_repo_properties_schema,
            list_gnosis_project_metadata_records,
            list_gnosis_projects_for_installation,
            reconcile_project_repo_sync_states,
            list_project_repo_sync_states,
            sync_gtms_project_editor_repo,
            inspect_gtms_project_editor_repo_sync_state,
            initialize_gtms_project_repo,
            import_xlsx_to_gtms,
            list_local_gtms_project_files,
            purge_local_gtms_project_repo,
            load_gtms_chapter_editor_data,
            load_gtms_editor_row,
            insert_gtms_editor_row_before,
            insert_gtms_editor_row_after,
            load_gtms_editor_field_history,
            load_gtms_editor_row_comments,
            refresh_project_search_index,
            search_projects,
            rename_gtms_chapter,
            soft_delete_gtms_chapter,
            restore_gtms_chapter,
            restore_gtms_editor_field_from_history,
            reverse_gtms_editor_batch_replace_commit,
            permanently_delete_gtms_chapter,
            soft_delete_gtms_editor_row,
            restore_gtms_editor_row,
            permanently_delete_gtms_editor_row,
            update_gtms_chapter_glossary_links,
            update_gtms_chapter_language_selection,
            save_gtms_editor_row_comment,
            delete_gtms_editor_row_comment,
            update_gtms_editor_row_field_flag,
            update_gtms_editor_row_fields,
            update_gtms_editor_row_fields_batch,
            list_local_gtms_glossaries,
            list_gnosis_glossary_metadata_records,
            list_gnosis_glossaries_for_installation,
            sync_gtms_glossary_repos,
            sync_gtms_glossary_editor_repo,
            create_gnosis_glossary_repo,
            upsert_gnosis_glossary_metadata_record,
            prepare_local_gtms_glossary_repo,
            rename_local_gtms_glossary_repo,
            initialize_gtms_glossary_repo,
            inspect_tmx_glossary_import,
            import_tmx_to_gtms_glossary_repo,
            rename_gtms_glossary,
            soft_delete_gtms_glossary,
            restore_gtms_glossary,
            purge_local_gtms_glossary_repo,
            load_gtms_glossary_editor_data,
            load_gtms_glossary_term,
            upsert_gtms_glossary_term,
            delete_gtms_glossary_term,
            permanently_delete_gnosis_glossary_repo,
            list_github_app_test_repositories,
            list_organization_members_for_installation,
            search_github_users_for_installation,
            invite_user_to_organization_for_installation,
            setup_organization_for_installation,
            add_organization_admin_for_installation,
            revoke_organization_admin_for_installation,
            remove_organization_member_for_installation,
            update_organization_name_for_installation,
            update_organization_description_for_installation,
            delete_organization_for_installation,
            purge_local_installation_data,
            leave_organization_for_installation
        ])
        .setup(|app| {
            let menu = build_app_menu(&app.handle())?;
            let _ = app.set_menu(menu)?;
            initialize_git_runtime(&app.handle());

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
