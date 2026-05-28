use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    git_commit::git_commit_as_signed_in_user,
    installation_access::ensure_installation_allows_writes,
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_layout_metadata::{
        new_v2_repo_layout_metadata, write_repo_layout_metadata, RepoKind,
        REPO_METADATA_RELATIVE_PATH, STORAGE_LAYOUT_VERSION_V2,
    },
    short_path_names::allocate_short_folder_name,
    storage_paths::local_qa_list_repo_root,
};

mod io;
mod tmx;

use io::{ensure_gitattributes, git_output, read_json_file, write_json_pretty, write_text_file};
use tmx::{parse_tmx_qa_list, serialize_tmx_qa_list};

const QA_LIST_FILE_NAME: &str = "qa-list.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLifecycle {
    state: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredQaListLanguage {
    code: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredQaListFile {
    qa_list_id: String,
    title: String,
    lifecycle: StoredLifecycle,
    language: StoredQaListLanguage,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredQaListTermFile {
    term_id: String,
    text: String,
    #[serde(default)]
    notes: String,
    lifecycle: StoredLifecycle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalQaListsInput {
    installation_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadQaListEditorDataInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadQaListTermInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    term_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeQaListRepoInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    title: String,
    language_code: String,
    language_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportTmxToQaListRepoInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectTmxQaListImportInput {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportTmxQaListInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    output_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareLocalQaListRepoInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    remote_url: Option<String>,
    default_branch_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameQaListInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateQaListLifecycleInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertQaListTermInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    term_id: Option<String>,
    text: String,
    #[serde(default)]
    notes: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RollbackQaListTermUpsertInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    previous_head_sha: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteQaListTermInput {
    installation_id: i64,
    repo_name: String,
    qa_list_id: Option<String>,
    term_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListLanguageInfo {
    code: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalQaListSummary {
    qa_list_id: String,
    repo_name: String,
    title: String,
    language: QaListLanguageInfo,
    lifecycle_state: String,
    term_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListImportPreview {
    title: String,
    language: QaListLanguageInfo,
    term_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListTermEditorRecord {
    term_id: String,
    text: String,
    notes: String,
    lifecycle_state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadQaListEditorDataResponse {
    qa_list_id: String,
    title: String,
    language: QaListLanguageInfo,
    lifecycle_state: String,
    term_count: usize,
    terms: Vec<QaListTermEditorRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadQaListTermResponse {
    term_id: String,
    term: Option<QaListTermEditorRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertQaListTermResponse {
    qa_list_id: String,
    term_count: usize,
    previous_head_sha: Option<String>,
    term: QaListTermEditorRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteQaListTermResponse {
    qa_list_id: String,
    term_id: String,
    term_count: usize,
    previous_head_sha: Option<String>,
}

#[tauri::command]
pub(crate) async fn list_local_gtms_qa_lists(
    app: AppHandle,
    input: ListLocalQaListsInput,
) -> Result<Vec<LocalQaListSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_local_gtms_qa_lists_sync(&app, input))
        .await
        .map_err(|error| format!("The local QA list worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_qa_list_editor_data(
    app: AppHandle,
    input: LoadQaListEditorDataInput,
) -> Result<LoadQaListEditorDataResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_qa_list_editor_data_sync(&app, input))
        .await
        .map_err(|error| format!("The QA list load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_qa_list_term(
    app: AppHandle,
    input: LoadQaListTermInput,
) -> Result<LoadQaListTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_qa_list_term_sync(&app, input))
        .await
        .map_err(|error| format!("The QA term load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn initialize_gtms_qa_list_repo(
    app: AppHandle,
    input: InitializeQaListRepoInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        initialize_gtms_qa_list_repo_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA list initialization worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_tmx_to_gtms_qa_list_repo(
    app: AppHandle,
    input: ImportTmxToQaListRepoInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        import_tmx_to_gtms_qa_list_repo_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA list import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_tmx_qa_list_import(
    input: InspectTmxQaListImportInput,
) -> Result<QaListImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_tmx_qa_list_import_sync(input))
        .await
        .map_err(|error| format!("The QA list import inspection worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn export_gtms_qa_list_to_tmx(
    app: AppHandle,
    input: ExportTmxQaListInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_gtms_qa_list_to_tmx_sync(&app, input))
        .await
        .map_err(|error| format!("The QA list export worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn prepare_local_gtms_qa_list_repo(
    app: AppHandle,
    input: PrepareLocalQaListRepoInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || prepare_local_gtms_qa_list_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The local QA list repo worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_gtms_qa_list(
    app: AppHandle,
    input: RenameQaListInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        rename_gtms_qa_list_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA list rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_qa_list(
    app: AppHandle,
    input: UpdateQaListLifecycleInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        update_gtms_qa_list_lifecycle_sync(&app, input, "deleted")
    })
    .await
    .map_err(|error| format!("The QA list delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_qa_list(
    app: AppHandle,
    input: UpdateQaListLifecycleInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        update_gtms_qa_list_lifecycle_sync(&app, input, "active")
    })
    .await
    .map_err(|error| format!("The QA list restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_local_gtms_qa_list_repo(
    app: AppHandle,
    input: UpdateQaListLifecycleInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        purge_local_gtms_qa_list_repo_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA list cleanup worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_gtms_qa_list_term(
    app: AppHandle,
    input: UpsertQaListTermInput,
) -> Result<UpsertQaListTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        upsert_gtms_qa_list_term_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA term worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rollback_gtms_qa_list_term_upsert(
    app: AppHandle,
    input: RollbackQaListTermUpsertInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        rollback_gtms_qa_list_term_upsert_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA term rollback worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gtms_qa_list_term(
    app: AppHandle,
    input: DeleteQaListTermInput,
) -> Result<DeleteQaListTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_writes(&app, input.installation_id)?;
        delete_gtms_qa_list_term_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The QA term delete worker failed: {error}"))?
}

fn list_local_gtms_qa_lists_sync(
    app: &AppHandle,
    input: ListLocalQaListsInput,
) -> Result<Vec<LocalQaListSummary>, String> {
    let repo_root = local_qa_list_repo_root(app, input.installation_id)?;
    if !repo_root.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();
    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local QA list repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a QA list repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() || !repo_path.join(QA_LIST_FILE_NAME).exists() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
            continue;
        }
        summaries.push(build_local_qa_list_summary(&repo_path)?);
    }

    summaries.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.repo_name.cmp(&right.repo_name))
    });

    Ok(summaries)
}

fn load_gtms_qa_list_editor_data_sync(
    app: &AppHandle,
    input: LoadQaListEditorDataInput,
) -> Result<LoadQaListEditorDataResponse, String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let qa_list_file = read_qa_list_file(&repo_path)?;
    let terms = load_qa_list_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .map(map_term_record)
        .collect::<Vec<_>>();

    Ok(LoadQaListEditorDataResponse {
        qa_list_id: qa_list_file.qa_list_id,
        title: qa_list_file.title,
        language: QaListLanguageInfo {
            code: qa_list_file.language.code,
            name: qa_list_file.language.name,
        },
        lifecycle_state: qa_list_file.lifecycle.state,
        term_count: terms.len(),
        terms,
    })
}

fn load_gtms_qa_list_term_sync(
    app: &AppHandle,
    input: LoadQaListTermInput,
) -> Result<LoadQaListTermResponse, String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let term_path = repo_path
        .join("terms")
        .join(format!("{}.json", input.term_id));
    let term = if term_path.exists() {
        let term_file: StoredQaListTermFile = read_json_file(&term_path, "QA term")?;
        if term_file.lifecycle.state == "active" {
            Some(map_term_record(term_file))
        } else {
            None
        }
    } else {
        None
    };

    Ok(LoadQaListTermResponse {
        term_id: input.term_id,
        term,
    })
}

fn initialize_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: InitializeQaListRepoInput,
) -> Result<LocalQaListSummary, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Enter a QA list name.".to_string());
    }

    let language_code = input.language_code.trim().to_lowercase();
    if language_code.is_empty() {
        return Err("Choose a QA list language.".to_string());
    }

    let language_name = input.language_name.trim();
    if language_name.is_empty() {
        return Err("Choose a QA list language.".to_string());
    }

    let repo_name = input.repo_name.trim().to_string();
    if repo_name.is_empty() {
        return Err("Could not determine which QA list repo to initialize.".to_string());
    }

    let repo_path = qa_list_git_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&repo_name),
    )?;
    if repo_path.join(QA_LIST_FILE_NAME).exists() {
        return Err("This QA list repo is already initialized.".to_string());
    }
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let qa_list_id = input
        .qa_list_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let qa_list_file = StoredQaListFile {
        qa_list_id,
        title: title.to_string(),
        lifecycle: StoredLifecycle {
            state: "active".to_string(),
        },
        language: StoredQaListLanguage {
            code: language_code.clone(),
            name: language_name.to_string(),
        },
    };

    write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::QaList))?;
    write_json_pretty(&repo_path.join(QA_LIST_FILE_NAME), &qa_list_file)?;
    git_output(
        &repo_path,
        &[
            "add",
            ".gitattributes",
            REPO_METADATA_RELATIVE_PATH,
            QA_LIST_FILE_NAME,
        ],
    )?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        "Initialize QA list",
        &[
            ".gitattributes",
            REPO_METADATA_RELATIVE_PATH,
            QA_LIST_FILE_NAME,
        ],
    )?;
    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(qa_list_file.qa_list_id.clone()),
            current_repo_name: Some(repo_name.clone()),
            kind: Some("qa_list".to_string()),
            has_ever_synced: Some(false),
            storage_layout_version: Some(STORAGE_LAYOUT_VERSION_V2),
            ..Default::default()
        },
    );

    Ok(LocalQaListSummary {
        qa_list_id: qa_list_file.qa_list_id,
        repo_name,
        title: qa_list_file.title,
        language: QaListLanguageInfo {
            code: language_code,
            name: language_name.to_string(),
        },
        lifecycle_state: "active".to_string(),
        term_count: 0,
    })
}

fn import_tmx_to_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: ImportTmxToQaListRepoInput,
) -> Result<LocalQaListSummary, String> {
    let parsed = parse_tmx_qa_list(&input.file_name, &input.bytes)?;
    let repo_name = input.repo_name.trim().to_string();
    if repo_name.is_empty() {
        return Err("Could not determine which QA list repo to import into.".to_string());
    }

    let repo_path = qa_list_git_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&repo_name),
    )?;
    if repo_path.join(QA_LIST_FILE_NAME).exists() {
        return Err("This QA list repo is already initialized.".to_string());
    }
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let qa_list_id = input
        .qa_list_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let qa_list_file = StoredQaListFile {
        qa_list_id,
        title: parsed.title.clone(),
        lifecycle: StoredLifecycle {
            state: "active".to_string(),
        },
        language: StoredQaListLanguage {
            code: parsed.language.code.clone(),
            name: parsed.language.name.clone(),
        },
    };

    write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::QaList))?;
    write_json_pretty(&repo_path.join(QA_LIST_FILE_NAME), &qa_list_file)?;
    fs::create_dir_all(repo_path.join("terms")).map_err(|error| {
        format!(
            "Could not create the QA terms folder '{}': {error}",
            repo_path.join("terms").display()
        )
    })?;
    for term in &parsed.terms {
        let term_path = repo_path
            .join("terms")
            .join(format!("{}.json", term.term_id));
        write_json_pretty(&term_path, term)?;
    }

    git_output(
        &repo_path,
        &[
            "add",
            ".gitattributes",
            REPO_METADATA_RELATIVE_PATH,
            QA_LIST_FILE_NAME,
            "terms",
        ],
    )?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        &format!("Import QA list from {}", input.file_name),
        &[
            ".gitattributes",
            REPO_METADATA_RELATIVE_PATH,
            QA_LIST_FILE_NAME,
            "terms",
        ],
    )?;
    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(qa_list_file.qa_list_id.clone()),
            current_repo_name: Some(repo_name.clone()),
            kind: Some("qa_list".to_string()),
            has_ever_synced: Some(false),
            storage_layout_version: Some(STORAGE_LAYOUT_VERSION_V2),
            ..Default::default()
        },
    );

    Ok(LocalQaListSummary {
        qa_list_id: qa_list_file.qa_list_id,
        repo_name,
        title: qa_list_file.title,
        language: parsed.language,
        lifecycle_state: "active".to_string(),
        term_count: parsed.terms.len(),
    })
}

fn inspect_tmx_qa_list_import_sync(
    input: InspectTmxQaListImportInput,
) -> Result<QaListImportPreview, String> {
    let parsed = parse_tmx_qa_list(&input.file_name, &input.bytes)?;
    Ok(QaListImportPreview {
        title: parsed.title,
        language: parsed.language,
        term_count: parsed.terms.len(),
    })
}

fn export_gtms_qa_list_to_tmx_sync(
    app: &AppHandle,
    input: ExportTmxQaListInput,
) -> Result<(), String> {
    let output_path = PathBuf::from(input.output_path.trim());
    if output_path.as_os_str().is_empty() {
        return Err("Choose a file path for the TMX export.".to_string());
    }

    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let qa_list_file = read_qa_list_file(&repo_path)?;
    let terms = load_qa_list_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Err("This QA list does not contain any active terms to export.".to_string());
    }

    let contents = serialize_tmx_qa_list(&qa_list_file, &terms);
    write_text_file(&output_path, &contents)
}

fn rename_gtms_qa_list_sync(
    app: &AppHandle,
    input: RenameQaListInput,
) -> Result<LocalQaListSummary, String> {
    let next_title = input.title.trim();
    if next_title.is_empty() {
        return Err("Enter a QA list name.".to_string());
    }

    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let mut qa_list_value = read_qa_list_value(&repo_path)?;
    let qa_list_object = qa_list_value
        .as_object_mut()
        .ok_or_else(|| "qa-list.json is not a JSON object.".to_string())?;
    let current_title = qa_list_object
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if current_title == next_title {
        return build_local_qa_list_summary(&repo_path);
    }

    qa_list_object.insert("title".to_string(), Value::String(next_title.to_string()));
    write_json_pretty(&repo_path.join(QA_LIST_FILE_NAME), &qa_list_value)?;
    git_output(&repo_path, &["add", QA_LIST_FILE_NAME])?;
    git_commit_as_signed_in_user(app, &repo_path, "Rename QA list", &[QA_LIST_FILE_NAME])?;
    build_local_qa_list_summary(&repo_path)
}

fn update_gtms_qa_list_lifecycle_sync(
    app: &AppHandle,
    input: UpdateQaListLifecycleInput,
    next_state: &str,
) -> Result<LocalQaListSummary, String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let mut qa_list_value = read_qa_list_value(&repo_path)?;
    let qa_list_object = qa_list_value
        .as_object_mut()
        .ok_or_else(|| "qa-list.json is not a JSON object.".to_string())?;
    let lifecycle_value = qa_list_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The QA list lifecycle is not a JSON object.".to_string())?;
    let current_state = lifecycle_object
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("active");

    if current_state == next_state {
        return build_local_qa_list_summary(&repo_path);
    }

    lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
    write_json_pretty(&repo_path.join(QA_LIST_FILE_NAME), &qa_list_value)?;
    git_output(&repo_path, &["add", QA_LIST_FILE_NAME])?;
    let commit_message = if next_state == "deleted" {
        "Mark QA list deleted"
    } else {
        "Restore QA list"
    };
    git_commit_as_signed_in_user(app, &repo_path, commit_message, &[QA_LIST_FILE_NAME])?;
    build_local_qa_list_summary(&repo_path)
}

fn purge_local_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: UpdateQaListLifecycleInput,
) -> Result<(), String> {
    let repo_path = qa_list_git_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    if !repo_path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not remove the local QA list repo '{}': {error}",
            repo_path.display()
        )
    })
}

fn prepare_local_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: PrepareLocalQaListRepoInput,
) -> Result<(), String> {
    let repo_name = input.repo_name.trim();
    if repo_name.is_empty() {
        return Err("Could not determine which QA list repo to prepare.".to_string());
    }

    let repo_path = desired_qa_list_git_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        repo_name,
    )?;
    fs::create_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not create the local QA list repo '{}': {error}",
            repo_path.display()
        )
    })?;

    if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
        let branch_name = input
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("main");
        git_output(&repo_path, &["init", "--initial-branch", branch_name])?;
    }

    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: input
                .qa_list_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            current_repo_name: Some(repo_name.to_string()),
            kind: Some("qa_list".to_string()),
            ..Default::default()
        },
    );

    let branch_name = input
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    let _ = git_output(&repo_path, &["checkout", "-B", branch_name]);

    if let Some(remote_url) = input
        .remote_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match git_output(&repo_path, &["remote", "get-url", "origin"]) {
            Ok(existing_url) => {
                if existing_url.trim() != remote_url {
                    git_output(&repo_path, &["remote", "set-url", "origin", remote_url])?;
                }
            }
            Err(_) => {
                git_output(&repo_path, &["remote", "add", "origin", remote_url])?;
            }
        }
    }

    Ok(())
}

fn upsert_gtms_qa_list_term_sync(
    app: &AppHandle,
    input: UpsertQaListTermInput,
) -> Result<UpsertQaListTermResponse, String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let qa_list_file = read_qa_list_file(&repo_path)?;
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let previous_head_sha = git_output(&repo_path, &["rev-parse", "HEAD"]).ok();

    let text = input.text.trim();
    if text.is_empty() {
        return Err("Enter QA term text.".to_string());
    }

    let term_id = input
        .term_id
        .clone()
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    let term_path = repo_path.join("terms").join(format!("{term_id}.json"));
    let mut term_value = if term_path.exists() {
        let original_text = fs::read_to_string(&term_path).map_err(|error| {
            format!(
                "Could not read term file '{}': {error}",
                term_path.display()
            )
        })?;
        serde_json::from_str::<Value>(&original_text).map_err(|error| {
            format!(
                "Could not parse term file '{}': {error}",
                term_path.display()
            )
        })?
    } else {
        json!({})
    };

    let term_object = term_value
        .as_object_mut()
        .ok_or_else(|| "The QA term file is not a JSON object.".to_string())?;
    term_object.insert("termId".to_string(), Value::String(term_id.clone()));
    term_object.insert("text".to_string(), Value::String(text.to_string()));
    term_object.insert(
        "notes".to_string(),
        Value::String(input.notes.trim().to_string()),
    );
    let lifecycle_value = term_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The QA term lifecycle is not a JSON object.".to_string())?;
    lifecycle_object.insert("state".to_string(), Value::String("active".to_string()));

    write_json_pretty(&term_path, &term_value)?;

    let relative_term_path = term_path
        .strip_prefix(&repo_path)
        .map_err(|error| format!("Could not resolve the term path for git: {error}"))?
        .to_string_lossy()
        .to_string();
    git_output(&repo_path, &["add", ".gitattributes", &relative_term_path])?;
    let commit_message = if input.term_id.is_some() {
        format!("Update QA term {}", term_id)
    } else {
        format!("Add QA term {}", term_id)
    };
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        &commit_message,
        &[".gitattributes", &relative_term_path],
    )?;

    let term_count = count_qa_list_term_files(&repo_path.join("terms"))?;

    Ok(UpsertQaListTermResponse {
        qa_list_id: qa_list_file.qa_list_id,
        term_count,
        previous_head_sha,
        term: QaListTermEditorRecord {
            term_id,
            text: text.to_string(),
            notes: input.notes.trim().to_string(),
            lifecycle_state: "active".to_string(),
        },
    })
}

fn rollback_gtms_qa_list_term_upsert_sync(
    app: &AppHandle,
    input: RollbackQaListTermUpsertInput,
) -> Result<(), String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let previous_head_sha = input.previous_head_sha.trim();
    if previous_head_sha.is_empty() {
        return Err("The previous QA list repo head is missing.".to_string());
    }

    git_output(&repo_path, &["reset", "--hard", previous_head_sha])?;
    Ok(())
}

fn delete_gtms_qa_list_term_sync(
    app: &AppHandle,
    input: DeleteQaListTermInput,
) -> Result<DeleteQaListTermResponse, String> {
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let qa_list_file = read_qa_list_file(&repo_path)?;
    let previous_head_sha = git_output(&repo_path, &["rev-parse", "HEAD"]).ok();
    let term_path = repo_path
        .join("terms")
        .join(format!("{}.json", input.term_id));
    if !term_path.exists() {
        return Err("The QA term could not be found.".to_string());
    }

    let relative_term_path = term_path
        .strip_prefix(&repo_path)
        .map_err(|error| format!("Could not resolve the term path for git: {error}"))?
        .to_string_lossy()
        .to_string();
    git_output(&repo_path, &["rm", &relative_term_path])?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        &format!("Delete QA term {}", input.term_id),
        &[&relative_term_path],
    )?;

    let term_count = count_qa_list_term_files(&repo_path.join("terms"))?;

    Ok(DeleteQaListTermResponse {
        qa_list_id: qa_list_file.qa_list_id,
        term_id: input.term_id,
        term_count,
        previous_head_sha,
    })
}

fn normalized_optional_identifier(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn qa_list_repo_matches_identifier(
    repo_path: &Path,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_qa_list_id = normalized_optional_identifier(qa_list_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(qa_list_id) = normalized_qa_list_id.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(qa_list_id)
        {
            return true;
        }

        if let Ok(qa_list_file) = read_qa_list_file(repo_path) {
            return qa_list_file.qa_list_id.trim() == qa_list_id;
        }
        return false;
    }

    if let Some(repo_name) = normalized_repo_name.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.current_repo_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(repo_name)
        {
            return true;
        }

        let folder_name = repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .unwrap_or_default();
        return folder_name == repo_name;
    }

    false
}

fn find_qa_list_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let repo_root = local_qa_list_repo_root(app, installation_id)?;
    if !repo_root.exists() {
        return Ok(None);
    }

    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local QA list repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a QA list repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() || !repo_path.join(QA_LIST_FILE_NAME).exists() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
            continue;
        }
        if qa_list_repo_matches_identifier(&repo_path, qa_list_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

fn qa_list_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    let repo_path = qa_list_git_repo_path(app, installation_id, qa_list_id, repo_name)?;
    if !repo_path.join(QA_LIST_FILE_NAME).exists() {
        return Err("The local QA list repo is missing qa-list.json.".to_string());
    }
    Ok(repo_path)
}

fn qa_list_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(repo_path) = find_qa_list_repo_path(app, installation_id, qa_list_id, repo_name)? {
        return Ok(repo_path);
    }

    if let Some(repo_name) = normalized_optional_identifier(repo_name) {
        let repo_root = local_qa_list_repo_root(app, installation_id)?;
        let repo_path = repo_root.join(&repo_name);
        if repo_path.exists() {
            if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
                return Err("The local QA list repo is missing or invalid.".to_string());
            }
            if qa_list_repo_matches_identifier(&repo_path, qa_list_id, Some(&repo_name)) {
                return Ok(repo_path);
            }
        }
    }

    Err("The local QA list repo is not available yet.".to_string())
}

fn desired_qa_list_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    _qa_list_id: Option<&str>,
    repo_name: &str,
) -> Result<PathBuf, String> {
    let normalized_repo_name = repo_name.trim();
    if normalized_repo_name.is_empty() {
        return Err("Could not determine which QA list repo to use.".to_string());
    }

    let repo_root = local_qa_list_repo_root(app, installation_id)?;
    Ok(repo_root.join(allocate_short_folder_name(
        normalized_repo_name,
        local_folder_names(&repo_root)?,
    )))
}

fn local_folder_names(repo_root: &Path) -> Result<Vec<String>, String> {
    if !repo_root.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(repo_root)
        .map_err(|error| format!("Could not read local QA list repo folders: {error}"))?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

fn read_qa_list_value(repo_path: &Path) -> Result<Value, String> {
    read_json_file(&repo_path.join(QA_LIST_FILE_NAME), "qa-list.json")
}

fn build_local_qa_list_summary(repo_path: &Path) -> Result<LocalQaListSummary, String> {
    let qa_list_file = read_qa_list_file(repo_path)?;
    let repo_name = read_local_repo_sync_state(repo_path)
        .ok()
        .flatten()
        .and_then(|state| state.current_repo_name)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            repo_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string()
        });
    let term_count = count_qa_list_term_files(&repo_path.join("terms"))?;

    Ok(LocalQaListSummary {
        qa_list_id: qa_list_file.qa_list_id,
        repo_name,
        title: qa_list_file.title,
        language: QaListLanguageInfo {
            code: qa_list_file.language.code,
            name: qa_list_file.language.name,
        },
        lifecycle_state: qa_list_file.lifecycle.state,
        term_count,
    })
}

fn read_qa_list_file(repo_path: &Path) -> Result<StoredQaListFile, String> {
    read_json_file(&repo_path.join(QA_LIST_FILE_NAME), "qa-list.json")
}

fn count_qa_list_term_files(terms_path: &Path) -> Result<usize, String> {
    if !terms_path.exists() {
        return Ok(0);
    }

    let mut count = 0;
    for entry in fs::read_dir(terms_path)
        .map_err(|error| format!("Could not read the QA terms folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read a QA term entry: {error}"))?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|value| value.to_str()) == Some("json") {
            count += 1;
        }
    }

    Ok(count)
}

fn load_qa_list_terms(terms_path: &Path) -> Result<Vec<StoredQaListTermFile>, String> {
    if !terms_path.exists() {
        return Ok(Vec::new());
    }

    let mut terms: Vec<StoredQaListTermFile> = Vec::new();
    for entry in fs::read_dir(terms_path)
        .map_err(|error| format!("Could not read the QA terms folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read a QA term entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        terms.push(read_json_file(&path, "QA term")?);
    }

    terms.sort_by(|left, right| {
        left.text
            .to_lowercase()
            .cmp(&right.text.to_lowercase())
            .then_with(|| left.term_id.cmp(&right.term_id))
    });
    Ok(terms)
}

fn map_term_record(term: StoredQaListTermFile) -> QaListTermEditorRecord {
    QaListTermEditorRecord {
        term_id: term.term_id,
        text: term.text,
        notes: term.notes,
        lifecycle_state: term.lifecycle.state,
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use uuid::Uuid;

    use crate::local_repo_sync_state::{upsert_local_repo_sync_state, LocalRepoSyncStateUpdate};

    use super::*;

    #[test]
    fn serializes_and_parses_tmx_qa_list() {
        let qa_list = StoredQaListFile {
            qa_list_id: "qa-list-1".to_string(),
            title: "Round Trip <QA>".to_string(),
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
            language: StoredQaListLanguage {
                code: "vi".to_string(),
                name: "Vietnamese".to_string(),
            },
        };
        let term = StoredQaListTermFile {
            term_id: "term-123".to_string(),
            text: "không dịch".to_string(),
            notes: "Use in review checks.".to_string(),
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
        };

        let xml = serialize_tmx_qa_list(&qa_list, &[term]);
        assert!(xml.contains("<tu tuid=\"term-123\">"));
        assert!(xml.contains("<note>Use in review checks.</note>"));
        assert!(xml.contains("<seg>không dịch</seg>"));

        let parsed =
            parse_tmx_qa_list("round-trip.tmx", xml.as_bytes()).expect("export should reimport");
        assert_eq!(parsed.language.code, "vi");
        assert_eq!(parsed.terms.len(), 1);
        assert_eq!(parsed.terms[0].term_id, "term-123");
        assert_eq!(parsed.terms[0].text, "không dịch");
        assert_eq!(parsed.terms[0].notes, "Use in review checks.");
    }

    #[test]
    fn rejects_multi_language_tmx_qa_list_imports() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Gnosis TMS" datatype="plaintext" segtype="phrase" adminlang="en" srclang="es"/>
  <body>
    <tu>
      <tuv xml:lang="es"><seg>no traducir</seg></tuv>
      <tuv xml:lang="vi"><seg>không dịch</seg></tuv>
    </tu>
  </body>
</tmx>
"#;

        let result = parse_tmx_qa_list("multi-language.tmx", xml.as_bytes());
        assert!(result.is_err(), "multi-language QA TMX should be rejected");
        let error = result.err().unwrap();

        assert!(error.contains("single-language"));
    }

    #[test]
    fn counts_qa_list_term_json_files_without_parsing_them() {
        let temp_dir =
            std::env::temp_dir().join(format!("gnosis-qa-list-terms-{}", Uuid::now_v7()));
        let terms_path = temp_dir.join("terms");
        fs::create_dir_all(&terms_path).expect("create terms dir");
        fs::write(terms_path.join("one.json"), "{").expect("write invalid json");
        fs::write(terms_path.join("two.json"), "{").expect("write invalid json");
        fs::write(terms_path.join("notes.txt"), "ignore").expect("write text");

        assert_eq!(
            count_qa_list_term_files(&terms_path).expect("count term files"),
            2
        );

        fs::remove_dir_all(temp_dir).expect("cleanup");
    }

    #[test]
    fn qa_list_matcher_prefers_qa_list_id_over_folder_name_match() {
        let temp_dir =
            std::env::temp_dir().join(format!("gnosis-qa-list-storage-{}", Uuid::now_v7()));
        let stray_repo_path = temp_dir.join("current-name");
        fs::create_dir_all(&stray_repo_path).expect("create repo");
        Command::new("git")
            .args(["init", "--initial-branch", "main"])
            .current_dir(&stray_repo_path)
            .output()
            .expect("git init");
        write_json_pretty(
            &stray_repo_path.join(QA_LIST_FILE_NAME),
            &StoredQaListFile {
                qa_list_id: "qa-list-stray".to_string(),
                title: "Stray".to_string(),
                lifecycle: StoredLifecycle {
                    state: "active".to_string(),
                },
                language: StoredQaListLanguage {
                    code: "vi".to_string(),
                    name: "Vietnamese".to_string(),
                },
            },
        )
        .expect("write qa list");
        upsert_local_repo_sync_state(
            &stray_repo_path,
            LocalRepoSyncStateUpdate {
                resource_id: Some("qa-list-stray".to_string()),
                current_repo_name: Some("current-name".to_string()),
                kind: Some("qa_list".to_string()),
                ..Default::default()
            },
        )
        .expect("write sync state");

        assert!(!qa_list_repo_matches_identifier(
            &stray_repo_path,
            Some("qa-list-live"),
            Some("current-name"),
        ));

        fs::remove_dir_all(temp_dir).expect("cleanup");
    }
}
