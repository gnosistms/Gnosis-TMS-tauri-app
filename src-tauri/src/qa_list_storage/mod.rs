use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    constants::ensure_within_import_size_limit,
    git_commit::git_commit_as_signed_in_user,
    installation_access::{
        ensure_installation_allows_qa_list_management, ensure_installation_allows_qa_list_writes,
    },
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_layout_metadata::{
        new_v2_repo_layout_metadata, write_repo_layout_metadata, RepoKind,
        REPO_METADATA_RELATIVE_PATH, STORAGE_LAYOUT_VERSION_V2,
    },
    repo_sync_shared::{acquire_repo_sync_lock, repo_sync_lock},
    storage_paths::local_qa_list_repo_root,
};

mod tmx;

use crate::repo_resource_storage::{
    ensure_gitattributes, git_output, prepare_repo, purge_repo, read_json_file,
    resolve_git_repo_path, resolve_initialized_repo_path, rollback_term_upsert, write_json_pretty,
    write_resource_lifecycle, write_resource_title, write_text_file, RepoResourceStorageDomain,
};
use tmx::{parse_tmx_qa_list, serialize_tmx_qa_list};

const QA_LIST_FILE_NAME: &str = "qa-list.json";
const MAX_QA_MATCHES_PER_ROW: usize = 100;
const NON_SPACE_DELIMITED_LANGUAGE_CODES: &[&str] =
    &["zh", "ja", "th", "lo", "km", "my", "bo", "dz"];

struct CompiledQaTerm {
    term: String,
    notes: String,
    is_case_sensitive: bool,
    is_regular_expression: bool,
    regex: Regex,
    literal_capture: bool,
}

struct CachedQaMatcher {
    revision: String,
    terms: Arc<Vec<CompiledQaTerm>>,
}

static QA_MATCHER_CACHE: OnceLock<Mutex<HashMap<String, CachedQaMatcher>>> = OnceLock::new();

/// QA-list-specific values for the shared repo-resource storage scaffolding.
struct QaListStorageDomain;

impl RepoResourceStorageDomain for QaListStorageDomain {
    fn resource_file_name(&self) -> &'static str {
        QA_LIST_FILE_NAME
    }
    fn state_kind(&self) -> &'static str {
        "qa_list"
    }
    fn display_noun(&self) -> &'static str {
        "QA list"
    }
    fn local_repo_root(&self, app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
        local_qa_list_repo_root(app, installation_id)
    }
    fn read_resource_id(&self, repo_path: &Path) -> Option<String> {
        read_qa_list_file(repo_path)
            .ok()
            .map(|file| file.qa_list_id)
    }
}

/// Resolve an initialized local QA-list repo (errors if missing or not initialized).
fn qa_list_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    resolve_initialized_repo_path(
        &QaListStorageDomain,
        app,
        installation_id,
        qa_list_id,
        repo_name,
    )
}

/// Resolve the local QA-list git checkout (may be uninitialized).
fn qa_list_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    resolve_git_repo_path(
        &QaListStorageDomain,
        app,
        installation_id,
        qa_list_id,
        repo_name,
    )
}

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
    #[serde(default)]
    is_case_sensitive: bool,
    #[serde(default)]
    is_regular_expression: bool,
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
    #[serde(default)]
    is_case_sensitive: bool,
    #[serde(default)]
    is_regular_expression: bool,
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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaReviewRowTextInput {
    row_id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    footnote: String,
    #[serde(default)]
    image_caption: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MatchQaListTermsInput {
    installation_id: i64,
    qa_list_id: Option<String>,
    #[serde(default)]
    repo_name: String,
    #[serde(default)]
    language_code: String,
    #[serde(default)]
    rows: Vec<QaReviewRowTextInput>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaMatchedText {
    section: String,
    text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaReviewHint {
    term: String,
    notes: String,
    is_case_sensitive: bool,
    is_regular_expression: bool,
    matches: Vec<QaMatchedText>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaReviewRowMatches {
    row_id: String,
    hints: Vec<QaReviewHint>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MatchQaListTermsResponse {
    rows: Vec<QaReviewRowMatches>,
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
    is_case_sensitive: bool,
    is_regular_expression: bool,
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
pub(crate) async fn match_gtms_qa_list_terms(
    app: AppHandle,
    input: MatchQaListTermsInput,
) -> Result<MatchQaListTermsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || match_gtms_qa_list_terms_sync(&app, input))
        .await
        .map_err(|error| format!("The QA term matching worker failed: {error}"))?
}

#[tauri::command]
pub(crate) fn validate_gtms_qa_regular_expression(
    pattern: String,
    is_case_sensitive: bool,
) -> Result<(), String> {
    validate_qa_regular_expression(&pattern, is_case_sensitive)
}

#[tauri::command]
pub(crate) async fn initialize_gtms_qa_list_repo(
    app: AppHandle,
    input: InitializeQaListRepoInput,
) -> Result<LocalQaListSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_qa_list_management(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_management(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_management(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_management(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_management(&app, input.installation_id)?;
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
    tauri::async_runtime::spawn_blocking(move || purge_local_gtms_qa_list_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The QA list cleanup worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_gtms_qa_list_term(
    app: AppHandle,
    input: UpsertQaListTermInput,
) -> Result<UpsertQaListTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_qa_list_writes(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_writes(&app, input.installation_id)?;
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
        ensure_installation_allows_qa_list_writes(&app, input.installation_id)?;
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

fn primary_language_subtag(language_code: &str) -> String {
    language_code
        .trim()
        .to_lowercase()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_string()
}

fn is_non_space_delimited_language(language_code: &str) -> bool {
    let primary = primary_language_subtag(language_code);
    NON_SPACE_DELIMITED_LANGUAGE_CODES.contains(&primary.as_str())
}

fn regex_contains_inline_case_flag(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut index = 0;
    let mut escaped = false;
    let mut in_character_class = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if escaped {
            escaped = false;
            index += 1;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            index += 1;
            continue;
        }
        if byte == b'[' {
            in_character_class = true;
            index += 1;
            continue;
        }
        if byte == b']' && in_character_class {
            in_character_class = false;
            index += 1;
            continue;
        }
        if !in_character_class && byte == b'(' && bytes.get(index + 1) == Some(&b'?') {
            let mut flag_index = index + 2;
            while let Some(flag) = bytes.get(flag_index) {
                if *flag == b':' || *flag == b')' {
                    break;
                }
                if !matches!(*flag, b'i' | b'm' | b's' | b'R' | b'U' | b'u' | b'x' | b'-') {
                    break;
                }
                if *flag == b'i' {
                    return true;
                }
                flag_index += 1;
            }
        }
        index += 1;
    }
    false
}

fn validate_qa_regular_expression(pattern: &str, is_case_sensitive: bool) -> Result<(), String> {
    if regex_contains_inline_case_flag(pattern) {
        return Err(
            "The regular expression cannot contain an inline case-sensitivity flag. Use the case sensitive checkbox instead."
                .to_string(),
        );
    }
    RegexBuilder::new(pattern)
        .case_insensitive(!is_case_sensitive)
        .unicode(true)
        .build()
        .map(|_| ())
        .map_err(|error| format!("The regular expression is invalid: {error}"))
}

fn compile_qa_term(
    term: StoredQaListTermFile,
    language_code: &str,
) -> Result<CompiledQaTerm, String> {
    let (pattern, literal_capture) = if term.is_regular_expression {
        (term.text.clone(), false)
    } else if is_non_space_delimited_language(language_code) {
        (format!("(?P<qa>{})", regex::escape(&term.text)), true)
    } else {
        (
            format!(
                r"(?:^|[^\p{{L}}\p{{M}}\p{{N}}])(?P<qa>{})(?:$|[^\p{{L}}\p{{M}}\p{{N}}])",
                regex::escape(&term.text)
            ),
            true,
        )
    };
    let regex = RegexBuilder::new(&pattern)
        .case_insensitive(!term.is_case_sensitive)
        .unicode(true)
        .build()
        .map_err(|error| {
            format!(
                "QA term '{}' contains an invalid regular expression: {error}",
                term.term_id
            )
        })?;
    Ok(CompiledQaTerm {
        term: term.text,
        notes: term.notes,
        is_case_sensitive: term.is_case_sensitive,
        is_regular_expression: term.is_regular_expression,
        regex,
        literal_capture,
    })
}

fn qa_matcher_for_repo(
    repo_path: &Path,
    language_code: &str,
) -> Result<Arc<Vec<CompiledQaTerm>>, String> {
    let revision =
        git_output(repo_path, &["rev-parse", "HEAD"]).unwrap_or_else(|_| "uncommitted".to_string());
    let cache_key = repo_path.to_string_lossy().to_string();
    let cache = QA_MATCHER_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let guard = cache
            .lock()
            .map_err(|_| "The QA matcher cache is unavailable.".to_string())?;
        if let Some(cached) = guard.get(&cache_key) {
            if cached.revision == revision {
                return Ok(Arc::clone(&cached.terms));
            }
        }
    }

    let terms = load_qa_list_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .map(|term| compile_qa_term(term, language_code))
        .collect::<Result<Vec<_>, _>>()?;
    let terms = Arc::new(terms);
    let mut guard = cache
        .lock()
        .map_err(|_| "The QA matcher cache is unavailable.".to_string())?;
    guard.insert(
        cache_key,
        CachedQaMatcher {
            revision,
            terms: Arc::clone(&terms),
        },
    );
    Ok(terms)
}

fn first_qa_match(term: &CompiledQaTerm, text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    if term.literal_capture {
        term.regex
            .captures(text)
            .and_then(|captures| captures.name("qa"))
            .map(|matched| matched.as_str().to_string())
    } else {
        term.regex
            .find(text)
            .map(|matched| matched.as_str().to_string())
    }
}

fn match_qa_row(
    row: QaReviewRowTextInput,
    terms: &[CompiledQaTerm],
) -> Result<QaReviewRowMatches, String> {
    let sections = [
        ("text", row.text.as_str()),
        ("footnote", row.footnote.as_str()),
        ("imageCaption", row.image_caption.as_str()),
    ];
    let mut hints = Vec::new();
    for term in terms {
        let matches = sections
            .iter()
            .filter_map(|(section, text)| {
                first_qa_match(term, text).map(|matched| QaMatchedText {
                    section: (*section).to_string(),
                    text: matched,
                })
            })
            .collect::<Vec<_>>();
        if matches.is_empty() {
            continue;
        }
        hints.push(QaReviewHint {
            term: term.term.clone(),
            notes: term.notes.clone(),
            is_case_sensitive: term.is_case_sensitive,
            is_regular_expression: term.is_regular_expression,
            matches,
        });
        if hints.len() > MAX_QA_MATCHES_PER_ROW {
            return Err(format!(
                "More than {MAX_QA_MATCHES_PER_ROW} QA terms match row '{}'. Narrow the QA regular expressions before running AI Review.",
                row.row_id
            ));
        }
    }
    Ok(QaReviewRowMatches {
        row_id: row.row_id,
        hints,
    })
}

fn match_gtms_qa_list_terms_sync(
    app: &AppHandle,
    input: MatchQaListTermsInput,
) -> Result<MatchQaListTermsResponse, String> {
    let repo_name = input.repo_name.trim();
    let repo_path = qa_list_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        if repo_name.is_empty() {
            None
        } else {
            Some(repo_name)
        },
    )?;
    let qa_list = read_qa_list_file(&repo_path)?;
    if qa_list.lifecycle.state != "active" {
        return Err("The selected QA list is not active.".to_string());
    }
    if qa_list.language.code != input.language_code {
        return Err("The selected QA list does not match the review language.".to_string());
    }
    let terms = qa_matcher_for_repo(&repo_path, &input.language_code)?;
    let rows = input
        .rows
        .into_iter()
        .map(|row| match_qa_row(row, &terms))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(MatchQaListTermsResponse { rows })
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
    let repo_lock = repo_sync_lock(&repo_path);
    let _repo_lock_guard = acquire_repo_sync_lock(&repo_lock);
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
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
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
    let repo_lock = repo_sync_lock(&repo_path);
    let _repo_lock_guard = acquire_repo_sync_lock(&repo_lock);
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
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
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
    write_resource_title(&QaListStorageDomain, app, &repo_path, next_title)?;
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
    write_resource_lifecycle(&QaListStorageDomain, app, &repo_path, next_state)?;
    build_local_qa_list_summary(&repo_path)
}

fn purge_local_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: UpdateQaListLifecycleInput,
) -> Result<(), String> {
    purge_repo(
        &QaListStorageDomain,
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
    )
}

fn prepare_local_gtms_qa_list_repo_sync(
    app: &AppHandle,
    input: PrepareLocalQaListRepoInput,
) -> Result<(), String> {
    let repo_name = input.repo_name.trim();
    if repo_name.is_empty() {
        return Err("Could not determine which QA list repo to prepare.".to_string());
    }

    prepare_repo(
        &QaListStorageDomain,
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        repo_name,
        input.remote_url.as_deref(),
        input.default_branch_name.as_deref(),
    )
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
    let repo_lock = repo_sync_lock(&repo_path);
    let _repo_lock_guard = acquire_repo_sync_lock(&repo_lock);
    let qa_list_file = read_qa_list_file(&repo_path)?;
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let previous_head_sha = git_output(&repo_path, &["rev-parse", "HEAD"]).ok();

    let text = input.text.trim();
    if text.is_empty() {
        return Err("Enter QA term text.".to_string());
    }
    if input.is_regular_expression {
        validate_qa_regular_expression(text, input.is_case_sensitive)?;
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
    term_object.insert(
        "isCaseSensitive".to_string(),
        Value::Bool(input.is_case_sensitive),
    );
    term_object.insert(
        "isRegularExpression".to_string(),
        Value::Bool(input.is_regular_expression),
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
            is_case_sensitive: input.is_case_sensitive,
            is_regular_expression: input.is_regular_expression,
            lifecycle_state: "active".to_string(),
        },
    })
}

fn rollback_gtms_qa_list_term_upsert_sync(
    app: &AppHandle,
    input: RollbackQaListTermUpsertInput,
) -> Result<(), String> {
    rollback_term_upsert(
        &QaListStorageDomain,
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        Some(&input.repo_name),
        &input.previous_head_sha,
    )
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
    let repo_lock = repo_sync_lock(&repo_path);
    let _repo_lock_guard = acquire_repo_sync_lock(&repo_lock);
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

fn build_local_qa_list_summary(repo_path: &Path) -> Result<LocalQaListSummary, String> {
    let qa_list_file = read_qa_list_file(repo_path)?;
    let repo_name = read_local_repo_sync_state(repo_path)?
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
        is_case_sensitive: term.is_case_sensitive,
        is_regular_expression: term.is_regular_expression,
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
            text: "foo\n  bar".to_string(),
            notes: "Use in review checks.".to_string(),
            is_case_sensitive: true,
            is_regular_expression: true,
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
        };

        let xml = serialize_tmx_qa_list(&qa_list, &[term]);
        assert!(xml.contains("<tu tuid=\"term-123\">"));
        assert!(xml.contains("<note>Use in review checks.</note>"));
        assert!(xml.contains("<prop type=\"x-gnosis-qa-case-sensitive\">true</prop>"));
        assert!(xml.contains("<prop type=\"x-gnosis-qa-regular-expression\">true</prop>"));
        assert!(xml.contains("<seg>foo\n  bar</seg>"));

        let parsed =
            parse_tmx_qa_list("round-trip.tmx", xml.as_bytes()).expect("export should reimport");
        assert_eq!(parsed.language.code, "vi");
        assert_eq!(parsed.terms.len(), 1);
        assert_eq!(parsed.terms[0].term_id, "term-123");
        assert_eq!(parsed.terms[0].text, "foo\n  bar");
        assert_eq!(parsed.terms[0].notes, "Use in review checks.");
        assert!(parsed.terms[0].is_case_sensitive);
        assert!(parsed.terms[0].is_regular_expression);
    }

    fn matcher_term(
        text: &str,
        is_case_sensitive: bool,
        is_regular_expression: bool,
    ) -> StoredQaListTermFile {
        StoredQaListTermFile {
            term_id: format!("term-{text}"),
            text: text.to_string(),
            notes: "Follow this note.".to_string(),
            is_case_sensitive,
            is_regular_expression,
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
        }
    }

    #[test]
    fn qa_literal_matching_uses_word_boundaries_and_case_setting() {
        let insensitive =
            compile_qa_term(matcher_term("text", false, false), "en").expect("compile insensitive");
        assert_eq!(
            first_qa_match(&insensitive, "Some Text here.").as_deref(),
            Some("Text")
        );
        assert_eq!(first_qa_match(&insensitive, "textual"), None);

        let sensitive =
            compile_qa_term(matcher_term("text", true, false), "en").expect("compile sensitive");
        assert_eq!(first_qa_match(&sensitive, "Some Text here."), None);
        assert_eq!(
            first_qa_match(&sensitive, "Some text here.").as_deref(),
            Some("text")
        );
    }

    #[test]
    fn qa_literal_matching_uses_substrings_for_non_space_delimited_languages() {
        let term =
            compile_qa_term(matcher_term("東京", false, false), "ja").expect("compile Japanese");
        assert_eq!(first_qa_match(&term, "東京都").as_deref(), Some("東京"));
    }

    #[test]
    fn qa_regex_matching_returns_the_concrete_match_and_rejects_invalid_patterns() {
        let term =
            compile_qa_term(matcher_term(r"\d{3}", false, true), "en").expect("compile regex");
        assert_eq!(first_qa_match(&term, "Code 123.").as_deref(), Some("123"));
        assert!(validate_qa_regular_expression("(", false).is_err());
        assert!(validate_qa_regular_expression("(?i)text", true).is_err());
        assert!(validate_qa_regular_expression("(?-i:text)", false).is_err());
        assert!(validate_qa_regular_expression(r"\(\?i\)", true).is_ok());
        assert!(validate_qa_regular_expression(r"[(?i)]", true).is_ok());
    }

    #[test]
    fn qa_row_matching_rejects_more_than_one_hundred_terms() {
        let terms = (0..=MAX_QA_MATCHES_PER_ROW)
            .map(|index| {
                compile_qa_term(matcher_term(&format!("term{index}"), false, false), "en")
                    .expect("compile term")
            })
            .collect::<Vec<_>>();
        let text = (0..=MAX_QA_MATCHES_PER_ROW)
            .map(|index| format!("term{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let result = match_qa_row(
            QaReviewRowTextInput {
                row_id: "row-1".to_string(),
                text,
                footnote: String::new(),
                image_caption: String::new(),
            },
            &terms,
        );
        assert!(result
            .expect_err("too many matches should fail")
            .contains("More than 100 QA terms"));
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

        assert!(!crate::repo_resource_storage::repo_matches_identifier(
            &QaListStorageDomain,
            &stray_repo_path,
            Some("qa-list-live"),
            Some("current-name"),
        )
        .expect("match QA list repo"));

        fs::remove_dir_all(temp_dir).expect("cleanup");
    }
}
