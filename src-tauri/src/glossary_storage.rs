use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use quick_xml::{events::Event, Reader};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    git_commit::git_commit_as_signed_in_user,
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_sync_shared::{format_git_spawn_error, git_command},
    storage_paths::local_glossary_repo_root,
};

const GLOSSARY_GITATTRIBUTES: &str = "* text=auto eol=lf\n";
const ISO_LANGUAGE_OPTIONS_SOURCE: &str = include_str!("../../src-ui/lib/language-options.js");
const SOURCE_TERM_DUPLICATE_WARNING: &str =
  "The terms highlighted in red below are redundant with other parts of this glossary. Please remove them before saving.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLifecycle {
    state: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryLanguage {
    code: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryLanguages {
    source: StoredGlossaryLanguage,
    target: StoredGlossaryLanguage,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryFile {
    glossary_id: String,
    title: String,
    lifecycle: StoredLifecycle,
    languages: StoredGlossaryLanguages,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredGlossaryTermFile {
    term_id: String,
    source_terms: Vec<String>,
    target_terms: Vec<String>,
    #[serde(default)]
    notes_to_translators: String,
    #[serde(default)]
    footnote: String,
    #[serde(default)]
    untranslated: bool,
    lifecycle: StoredLifecycle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalGlossariesInput {
    installation_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryEditorDataInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryTermInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    term_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeGlossaryRepoInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    title: String,
    source_language_code: String,
    source_language_name: String,
    target_language_code: String,
    target_language_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportTmxToGlossaryRepoInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectTmxGlossaryImportInput {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareLocalGlossaryRepoInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    remote_url: Option<String>,
    default_branch_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameGlossaryInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateGlossaryLifecycleInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameLocalGlossaryRepoInput {
    installation_id: i64,
    glossary_id: Option<String>,
    from_repo_name: String,
    to_repo_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGlossaryTermInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    term_id: Option<String>,
    source_terms: Vec<String>,
    target_terms: Vec<String>,
    notes_to_translators: String,
    footnote: String,
    untranslated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGlossaryTermInput {
    installation_id: i64,
    repo_name: String,
    glossary_id: Option<String>,
    term_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryLanguageInfo {
    code: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalGlossarySummary {
    glossary_id: String,
    repo_name: String,
    title: String,
    source_language: GlossaryLanguageInfo,
    target_language: GlossaryLanguageInfo,
    lifecycle_state: String,
    term_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryImportPreview {
    title: String,
    source_language: GlossaryLanguageInfo,
    target_language: GlossaryLanguageInfo,
    term_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryTermEditorRecord {
    term_id: String,
    source_terms: Vec<String>,
    target_terms: Vec<String>,
    notes_to_translators: String,
    footnote: String,
    untranslated: bool,
    lifecycle_state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryEditorDataResponse {
    glossary_id: String,
    title: String,
    source_language: GlossaryLanguageInfo,
    target_language: GlossaryLanguageInfo,
    lifecycle_state: String,
    term_count: usize,
    terms: Vec<GlossaryTermEditorRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryTermResponse {
    term_id: String,
    term: Option<GlossaryTermEditorRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGlossaryTermResponse {
    glossary_id: String,
    term_count: usize,
    term: GlossaryTermEditorRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGlossaryTermResponse {
    glossary_id: String,
    term_id: String,
    term_count: usize,
}

#[tauri::command]
pub(crate) async fn list_local_gtms_glossaries(
    app: AppHandle,
    input: ListLocalGlossariesInput,
) -> Result<Vec<LocalGlossarySummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_local_gtms_glossaries_sync(&app, input))
        .await
        .map_err(|error| format!("The local glossary worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_glossary_editor_data(
    app: AppHandle,
    input: LoadGlossaryEditorDataInput,
) -> Result<LoadGlossaryEditorDataResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_glossary_editor_data_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_glossary_term(
    app: AppHandle,
    input: LoadGlossaryTermInput,
) -> Result<LoadGlossaryTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_glossary_term_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary term load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn initialize_gtms_glossary_repo(
    app: AppHandle,
    input: InitializeGlossaryRepoInput,
) -> Result<LocalGlossarySummary, String> {
    tauri::async_runtime::spawn_blocking(move || initialize_gtms_glossary_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary initialization worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_tmx_to_gtms_glossary_repo(
    app: AppHandle,
    input: ImportTmxToGlossaryRepoInput,
) -> Result<LocalGlossarySummary, String> {
    tauri::async_runtime::spawn_blocking(move || import_tmx_to_gtms_glossary_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_tmx_glossary_import(
    input: InspectTmxGlossaryImportInput,
) -> Result<GlossaryImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_tmx_glossary_import_sync(input))
        .await
        .map_err(|error| format!("The glossary import inspection worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn prepare_local_gtms_glossary_repo(
    app: AppHandle,
    input: PrepareLocalGlossaryRepoInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || prepare_local_gtms_glossary_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The local glossary repo worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_local_gtms_glossary_repo(
    app: AppHandle,
    input: RenameLocalGlossaryRepoInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || rename_local_gtms_glossary_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The local glossary repo rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_gtms_glossary(
    app: AppHandle,
    input: RenameGlossaryInput,
) -> Result<LocalGlossarySummary, String> {
    tauri::async_runtime::spawn_blocking(move || rename_gtms_glossary_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_glossary(
    app: AppHandle,
    input: UpdateGlossaryLifecycleInput,
) -> Result<LocalGlossarySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_glossary_lifecycle_sync(&app, input, "deleted")
    })
    .await
    .map_err(|error| format!("The glossary delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_glossary(
    app: AppHandle,
    input: UpdateGlossaryLifecycleInput,
) -> Result<LocalGlossarySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_glossary_lifecycle_sync(&app, input, "active")
    })
    .await
    .map_err(|error| format!("The glossary restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_local_gtms_glossary_repo(
    app: AppHandle,
    input: UpdateGlossaryLifecycleInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || purge_local_gtms_glossary_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary cleanup worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_gtms_glossary_term(
    app: AppHandle,
    input: UpsertGlossaryTermInput,
) -> Result<UpsertGlossaryTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || upsert_gtms_glossary_term_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary term worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gtms_glossary_term(
    app: AppHandle,
    input: DeleteGlossaryTermInput,
) -> Result<DeleteGlossaryTermResponse, String> {
    tauri::async_runtime::spawn_blocking(move || delete_gtms_glossary_term_sync(&app, input))
        .await
        .map_err(|error| format!("The glossary term delete worker failed: {error}"))?
}

fn list_local_gtms_glossaries_sync(
    app: &AppHandle,
    input: ListLocalGlossariesInput,
) -> Result<Vec<LocalGlossarySummary>, String> {
    let repo_root = local_glossary_repo_root(app, input.installation_id)?;
    let mut summaries = Vec::new();

    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local glossary repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a glossary repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }

        if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
            continue;
        }

        let glossary_json_path = repo_path.join("glossary.json");
        if !glossary_json_path.exists() {
            continue;
        }

        summaries.push(build_local_glossary_summary(&repo_path)?);
    }

    summaries.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.repo_name.cmp(&right.repo_name))
    });

    Ok(summaries)
}

fn load_gtms_glossary_editor_data_sync(
    app: &AppHandle,
    input: LoadGlossaryEditorDataInput,
) -> Result<LoadGlossaryEditorDataResponse, String> {
    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let glossary_file = read_glossary_file(&repo_path)?;
    let terms = load_glossary_terms(&repo_path.join("terms"))?;

    let active_terms = terms
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .map(map_term_record)
        .collect::<Vec<_>>();

    Ok(LoadGlossaryEditorDataResponse {
        glossary_id: glossary_file.glossary_id,
        title: glossary_file.title,
        source_language: GlossaryLanguageInfo {
            code: glossary_file.languages.source.code,
            name: glossary_file.languages.source.name,
        },
        target_language: GlossaryLanguageInfo {
            code: glossary_file.languages.target.code,
            name: glossary_file.languages.target.name,
        },
        lifecycle_state: glossary_file.lifecycle.state,
        term_count: active_terms.len(),
        terms: active_terms,
    })
}

fn load_gtms_glossary_term_sync(
    app: &AppHandle,
    input: LoadGlossaryTermInput,
) -> Result<LoadGlossaryTermResponse, String> {
    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let term_path = repo_path
        .join("terms")
        .join(format!("{}.json", input.term_id));
    let term = if term_path.exists() {
        let term_file: StoredGlossaryTermFile = read_json_file(&term_path, "glossary term")?;
        if term_file.lifecycle.state == "active" {
            Some(map_term_record(term_file))
        } else {
            None
        }
    } else {
        None
    };

    Ok(LoadGlossaryTermResponse {
        term_id: input.term_id,
        term,
    })
}

fn initialize_gtms_glossary_repo_sync(
    app: &AppHandle,
    input: InitializeGlossaryRepoInput,
) -> Result<LocalGlossarySummary, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Enter a glossary name.".to_string());
    }

    let source_language_code = input.source_language_code.trim().to_lowercase();
    if source_language_code.is_empty() {
        return Err("Enter a source language code.".to_string());
    }

    let source_language_name = input.source_language_name.trim();
    if source_language_name.is_empty() {
        return Err("Enter a source language name.".to_string());
    }

    let target_language_code = input.target_language_code.trim().to_lowercase();
    if target_language_code.is_empty() {
        return Err("Enter a target language code.".to_string());
    }

    let target_language_name = input.target_language_name.trim();
    if target_language_name.is_empty() {
        return Err("Enter a target language name.".to_string());
    }

    let repo_name = input.repo_name.trim().to_string();
    if repo_name.is_empty() {
        return Err("Could not determine which glossary repo to initialize.".to_string());
    }

    let repo_path = glossary_git_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&repo_name),
    )?;
    if repo_path.join("glossary.json").exists() {
        return Err("This glossary repo is already initialized.".to_string());
    }
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let glossary_id = input
        .glossary_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let glossary_file = StoredGlossaryFile {
        glossary_id,
        title: title.to_string(),
        lifecycle: StoredLifecycle {
            state: "active".to_string(),
        },
        languages: StoredGlossaryLanguages {
            source: StoredGlossaryLanguage {
                code: source_language_code.clone(),
                name: source_language_name.to_string(),
            },
            target: StoredGlossaryLanguage {
                code: target_language_code.clone(),
                name: target_language_name.to_string(),
            },
        },
    };

    write_json_pretty(&repo_path.join("glossary.json"), &glossary_file)?;
    git_output(&repo_path, &["add", ".gitattributes", "glossary.json"])?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        "Initialize glossary",
        &[".gitattributes", "glossary.json"],
    )?;
    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(glossary_file.glossary_id.clone()),
            current_repo_name: Some(repo_name.clone()),
            kind: Some("glossary".to_string()),
            has_ever_synced: Some(false),
            ..Default::default()
        },
    );

    Ok(LocalGlossarySummary {
        glossary_id: glossary_file.glossary_id,
        repo_name: repo_name.clone(),
        title: glossary_file.title,
        source_language: GlossaryLanguageInfo {
            code: source_language_code,
            name: source_language_name.to_string(),
        },
        target_language: GlossaryLanguageInfo {
            code: target_language_code,
            name: target_language_name.to_string(),
        },
        lifecycle_state: "active".to_string(),
        term_count: 0,
    })
}

fn import_tmx_to_gtms_glossary_repo_sync(
    app: &AppHandle,
    input: ImportTmxToGlossaryRepoInput,
) -> Result<LocalGlossarySummary, String> {
    let parsed = parse_tmx_glossary(&input.file_name, &input.bytes)?;
    let repo_name = input.repo_name.trim().to_string();
    if repo_name.is_empty() {
        return Err("Could not determine which glossary repo to import into.".to_string());
    }

    let repo_path = glossary_git_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&repo_name),
    )?;
    if repo_path.join("glossary.json").exists() {
        return Err("This glossary repo is already initialized.".to_string());
    }
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    let glossary_id = input
        .glossary_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::now_v7().to_string());

    let glossary_file = StoredGlossaryFile {
        glossary_id,
        title: parsed.title.clone(),
        lifecycle: StoredLifecycle {
            state: "active".to_string(),
        },
        languages: StoredGlossaryLanguages {
            source: StoredGlossaryLanguage {
                code: parsed.source_language.code.clone(),
                name: parsed.source_language.name.clone(),
            },
            target: StoredGlossaryLanguage {
                code: parsed.target_language.code.clone(),
                name: parsed.target_language.name.clone(),
            },
        },
    };

    write_json_pretty(&repo_path.join("glossary.json"), &glossary_file)?;

    for term in &parsed.terms {
        let term_path = repo_path
            .join("terms")
            .join(format!("{}.json", term.term_id));
        write_json_pretty(&term_path, term)?;
    }

    git_output(
        &repo_path,
        &["add", ".gitattributes", "glossary.json", "terms"],
    )?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        &format!("Import glossary from {}", input.file_name),
        &[".gitattributes", "glossary.json", "terms"],
    )?;
    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(glossary_file.glossary_id.clone()),
            current_repo_name: Some(repo_name.clone()),
            kind: Some("glossary".to_string()),
            has_ever_synced: Some(false),
            ..Default::default()
        },
    );

    Ok(LocalGlossarySummary {
        glossary_id: glossary_file.glossary_id,
        repo_name: repo_name.clone(),
        title: glossary_file.title,
        source_language: parsed.source_language,
        target_language: parsed.target_language,
        lifecycle_state: "active".to_string(),
        term_count: parsed.terms.len(),
    })
}

fn inspect_tmx_glossary_import_sync(
    input: InspectTmxGlossaryImportInput,
) -> Result<GlossaryImportPreview, String> {
    let parsed = parse_tmx_glossary(&input.file_name, &input.bytes)?;
    Ok(GlossaryImportPreview {
        title: parsed.title,
        source_language: parsed.source_language,
        target_language: parsed.target_language,
        term_count: parsed.terms.len(),
    })
}

fn rename_gtms_glossary_sync(
    app: &AppHandle,
    input: RenameGlossaryInput,
) -> Result<LocalGlossarySummary, String> {
    let next_title = input.title.trim();
    if next_title.is_empty() {
        return Err("Enter a glossary name.".to_string());
    }

    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let mut glossary_value = read_glossary_value(&repo_path)?;
    let glossary_object = glossary_value
        .as_object_mut()
        .ok_or_else(|| "glossary.json is not a JSON object.".to_string())?;
    let current_title = glossary_object
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if current_title == next_title {
        return build_local_glossary_summary(&repo_path);
    }

    glossary_object.insert("title".to_string(), Value::String(next_title.to_string()));
    let glossary_json_path = repo_path.join("glossary.json");
    write_json_pretty(&glossary_json_path, &glossary_value)?;
    git_output(&repo_path, &["add", "glossary.json"])?;
    git_commit_as_signed_in_user(app, &repo_path, "Rename glossary", &["glossary.json"])?;
    build_local_glossary_summary(&repo_path)
}

fn update_gtms_glossary_lifecycle_sync(
    app: &AppHandle,
    input: UpdateGlossaryLifecycleInput,
    next_state: &str,
) -> Result<LocalGlossarySummary, String> {
    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let mut glossary_value = read_glossary_value(&repo_path)?;
    let glossary_object = glossary_value
        .as_object_mut()
        .ok_or_else(|| "glossary.json is not a JSON object.".to_string())?;
    let lifecycle_value = glossary_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The glossary lifecycle is not a JSON object.".to_string())?;
    let current_state = lifecycle_object
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("active");

    if current_state == next_state {
        return build_local_glossary_summary(&repo_path);
    }

    lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
    let glossary_json_path = repo_path.join("glossary.json");
    write_json_pretty(&glossary_json_path, &glossary_value)?;
    git_output(&repo_path, &["add", "glossary.json"])?;
    let commit_message = if next_state == "deleted" {
        "Mark glossary deleted"
    } else {
        "Restore glossary"
    };
    git_commit_as_signed_in_user(app, &repo_path, commit_message, &["glossary.json"])?;
    build_local_glossary_summary(&repo_path)
}

fn purge_local_gtms_glossary_repo_sync(
    app: &AppHandle,
    input: UpdateGlossaryLifecycleInput,
) -> Result<(), String> {
    let repo_path = glossary_git_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    if !repo_path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not remove the local glossary repo '{}': {error}",
            repo_path.display()
        )
    })
}

fn prepare_local_gtms_glossary_repo_sync(
    app: &AppHandle,
    input: PrepareLocalGlossaryRepoInput,
) -> Result<(), String> {
    let repo_name = input.repo_name.trim();
    if repo_name.is_empty() {
        return Err("Could not determine which glossary repo to prepare.".to_string());
    }

    let repo_path = desired_glossary_git_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        repo_name,
    )?;
    fs::create_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not create the local glossary repo '{}': {error}",
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
                .glossary_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            current_repo_name: Some(repo_name.to_string()),
            kind: Some("glossary".to_string()),
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

fn rename_local_gtms_glossary_repo_sync(
    app: &AppHandle,
    input: RenameLocalGlossaryRepoInput,
) -> Result<(), String> {
    let from_repo_name = input.from_repo_name.trim();
    let to_repo_name = input.to_repo_name.trim();
    if from_repo_name.is_empty() || to_repo_name.is_empty() {
        return Err("Could not determine which glossary repo to rename.".to_string());
    }

    if from_repo_name == to_repo_name {
        return Ok(());
    }

    let repo_root = local_glossary_repo_root(app, input.installation_id)?;
    let from_path = find_glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(from_repo_name),
    )?
    .unwrap_or_else(|| repo_root.join(from_repo_name));
    let to_path = repo_root.join(to_repo_name);

    if !from_path.exists() {
        return Err("The local glossary repo is not available yet.".to_string());
    }
    if to_path.exists() {
        return Err("The destination glossary repo folder already exists.".to_string());
    }

    fs::rename(&from_path, &to_path).map_err(|error| {
        format!(
            "Could not rename the local glossary repo '{}' to '{}': {error}",
            from_path.display(),
            to_path.display()
        )
    })?;

    let _ = upsert_local_repo_sync_state(
        &to_path,
        LocalRepoSyncStateUpdate {
            current_repo_name: Some(to_repo_name.to_string()),
            kind: Some("glossary".to_string()),
            ..Default::default()
        },
    );

    Ok(())
}

fn upsert_gtms_glossary_term_sync(
    app: &AppHandle,
    input: UpsertGlossaryTermInput,
) -> Result<UpsertGlossaryTermResponse, String> {
    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let glossary_file = read_glossary_file(&repo_path)?;
    ensure_gitattributes(&repo_path.join(".gitattributes"))?;

    let trimmed_source_terms = trim_non_empty_term_values(&input.source_terms);
    if trimmed_source_terms.is_empty() {
        return Err("Enter at least one source term.".to_string());
    }
    if has_duplicate_term_values(&trimmed_source_terms) {
        return Err(SOURCE_TERM_DUPLICATE_WARNING.to_string());
    }
    let existing_terms = load_glossary_terms(&repo_path.join("terms"))?;
    if has_conflicting_source_terms(
        &existing_terms,
        &trimmed_source_terms,
        input.term_id.as_deref(),
    ) {
        return Err(SOURCE_TERM_DUPLICATE_WARNING.to_string());
    }
    let sanitized_source_terms = trimmed_source_terms;

    let mut sanitized_target_terms = sanitize_target_term_values(&input.target_terms);
    if input.untranslated && sanitized_target_terms.is_empty() {
        sanitized_target_terms = sanitized_source_terms.clone();
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
        .ok_or_else(|| "The term file is not a JSON object.".to_string())?;
    term_object.insert("term_id".to_string(), Value::String(term_id.clone()));
    term_object.insert(
        "source_terms".to_string(),
        Value::Array(
            sanitized_source_terms
                .iter()
                .cloned()
                .map(Value::String)
                .collect(),
        ),
    );
    term_object.insert(
        "target_terms".to_string(),
        Value::Array(
            sanitized_target_terms
                .iter()
                .cloned()
                .map(Value::String)
                .collect(),
        ),
    );
    term_object.insert(
        "notes_to_translators".to_string(),
        Value::String(input.notes_to_translators.trim().to_string()),
    );
    term_object.insert(
        "footnote".to_string(),
        Value::String(input.footnote.trim().to_string()),
    );
    term_object.insert("untranslated".to_string(), Value::Bool(input.untranslated));
    let lifecycle_value = term_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The term lifecycle is not a JSON object.".to_string())?;
    lifecycle_object.insert("state".to_string(), Value::String("active".to_string()));

    write_json_pretty(&term_path, &term_value)?;

    let relative_term_path = term_path
        .strip_prefix(&repo_path)
        .map_err(|error| format!("Could not resolve the term path for git: {error}"))?
        .to_string_lossy()
        .to_string();
    git_output(&repo_path, &["add", ".gitattributes", &relative_term_path])?;
    let commit_message = if input.term_id.is_some() {
        format!("Update glossary term {}", term_id)
    } else {
        format!("Add glossary term {}", term_id)
    };
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        &commit_message,
        &[".gitattributes", &relative_term_path],
    )?;

    let term_count = load_glossary_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .count();

    Ok(UpsertGlossaryTermResponse {
        glossary_id: glossary_file.glossary_id,
        term_count,
        term: GlossaryTermEditorRecord {
            term_id,
            source_terms: sanitized_source_terms,
            target_terms: sanitized_target_terms,
            notes_to_translators: input.notes_to_translators.trim().to_string(),
            footnote: input.footnote.trim().to_string(),
            untranslated: input.untranslated,
            lifecycle_state: "active".to_string(),
        },
    })
}

fn delete_gtms_glossary_term_sync(
    app: &AppHandle,
    input: DeleteGlossaryTermInput,
) -> Result<DeleteGlossaryTermResponse, String> {
    let repo_path = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let glossary_file = read_glossary_file(&repo_path)?;
    let term_path = repo_path
        .join("terms")
        .join(format!("{}.json", input.term_id));
    if !term_path.exists() {
        return Err("The glossary term could not be found.".to_string());
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
        &format!("Delete glossary term {}", input.term_id),
        &[&relative_term_path],
    )?;

    let term_count = load_glossary_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .count();

    Ok(DeleteGlossaryTermResponse {
        glossary_id: glossary_file.glossary_id,
        term_id: input.term_id,
        term_count,
    })
}

fn normalized_optional_identifier(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn glossary_repo_matches_identifier(
    repo_path: &Path,
    glossary_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_glossary_id = normalized_optional_identifier(glossary_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(glossary_id) = normalized_glossary_id.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(glossary_id)
        {
            return true;
        }

        if let Ok(glossary_file) = read_glossary_file(repo_path) {
            return glossary_file.glossary_id.trim() == glossary_id;
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

fn find_glossary_repo_path(
    app: &AppHandle,
    installation_id: i64,
    glossary_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let repo_root = local_glossary_repo_root(app, installation_id)?;
    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local glossary repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a glossary repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() || !repo_path.join("glossary.json").exists() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
            continue;
        }
        if glossary_repo_matches_identifier(&repo_path, glossary_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

fn glossary_repo_path(
    app: &AppHandle,
    installation_id: i64,
    glossary_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    let repo_path = glossary_git_repo_path(app, installation_id, glossary_id, repo_name)?;
    if !repo_path.join("glossary.json").exists() {
        return Err("The local glossary repo is missing glossary.json.".to_string());
    }
    Ok(repo_path)
}

fn glossary_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    glossary_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(repo_name) = normalized_optional_identifier(repo_name) {
        let repo_root = local_glossary_repo_root(app, installation_id)?;
        let repo_path = repo_root.join(&repo_name);
        if repo_path.exists() {
            if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
                return Err("The local glossary repo is missing or invalid.".to_string());
            }
            if glossary_repo_matches_identifier(&repo_path, glossary_id, Some(&repo_name)) {
                return Ok(repo_path);
            }
        }
    }

    if let Some(repo_path) = find_glossary_repo_path(app, installation_id, glossary_id, repo_name)?
    {
        return Ok(repo_path);
    }

    Err("The local glossary repo is not available yet.".to_string())
}

fn desired_glossary_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    _glossary_id: Option<&str>,
    repo_name: &str,
) -> Result<PathBuf, String> {
    let normalized_repo_name = repo_name.trim();
    if normalized_repo_name.is_empty() {
        return Err("Could not determine which glossary repo to use.".to_string());
    }

    let repo_root = local_glossary_repo_root(app, installation_id)?;
    Ok(repo_root.join(normalized_repo_name))
}

fn read_glossary_value(repo_path: &Path) -> Result<Value, String> {
    read_json_file(&repo_path.join("glossary.json"), "glossary.json")
}

fn build_local_glossary_summary(repo_path: &Path) -> Result<LocalGlossarySummary, String> {
    let glossary_file = read_glossary_file(repo_path)?;
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
    let term_count = load_glossary_terms(&repo_path.join("terms"))?
        .into_iter()
        .filter(|term| term.lifecycle.state == "active")
        .count();

    Ok(LocalGlossarySummary {
        glossary_id: glossary_file.glossary_id,
        repo_name,
        title: glossary_file.title,
        source_language: GlossaryLanguageInfo {
            code: glossary_file.languages.source.code,
            name: glossary_file.languages.source.name,
        },
        target_language: GlossaryLanguageInfo {
            code: glossary_file.languages.target.code,
            name: glossary_file.languages.target.name,
        },
        lifecycle_state: glossary_file.lifecycle.state,
        term_count,
    })
}

fn read_glossary_file(repo_path: &Path) -> Result<StoredGlossaryFile, String> {
    read_json_file(&repo_path.join("glossary.json"), "glossary.json")
}

fn load_glossary_terms(terms_path: &Path) -> Result<Vec<StoredGlossaryTermFile>, String> {
    if !terms_path.exists() {
        return Ok(Vec::new());
    }

    let mut terms = Vec::new();
    for entry in fs::read_dir(terms_path)
        .map_err(|error| format!("Could not read the glossary terms folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a glossary term entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        terms.push(read_json_file(&path, "glossary term")?);
    }

    terms.sort_by(|left, right| {
        first_term_label(left)
            .cmp(&first_term_label(right))
            .then_with(|| left.term_id.cmp(&right.term_id))
    });
    Ok(terms)
}

fn first_term_label(term: &StoredGlossaryTermFile) -> String {
    term.source_terms
        .first()
        .cloned()
        .unwrap_or_else(|| term.term_id.clone())
        .to_lowercase()
}

fn map_term_record(term: StoredGlossaryTermFile) -> GlossaryTermEditorRecord {
    GlossaryTermEditorRecord {
        term_id: term.term_id,
        source_terms: term.source_terms,
        target_terms: term.target_terms,
        notes_to_translators: term.notes_to_translators,
        footnote: term.footnote,
        untranslated: term.untranslated,
        lifecycle_state: term.lifecycle.state,
    }
}

fn sanitize_term_values(values: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut sanitized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            sanitized.push(trimmed.to_string());
        }
    }
    sanitized
}

fn trim_non_empty_term_values(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn has_duplicate_term_values(values: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value.clone()) {
            return true;
        }
    }
    false
}

fn has_conflicting_source_terms(
    existing_terms: &[StoredGlossaryTermFile],
    source_terms: &[String],
    current_term_id: Option<&str>,
) -> bool {
    let mut existing_source_terms = BTreeSet::new();
    for term in existing_terms {
        if term.lifecycle.state != "active" || current_term_id == Some(term.term_id.as_str()) {
            continue;
        }

        for source_term in &term.source_terms {
            let normalized = source_term.trim();
            if !normalized.is_empty() {
                existing_source_terms.insert(normalized.to_string());
            }
        }
    }

    source_terms
        .iter()
        .any(|source_term| existing_source_terms.contains(source_term))
}

fn sanitize_target_term_values(values: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut sanitized = Vec::new();
    let mut included_empty_variant = false;

    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            if !included_empty_variant {
                sanitized.push(String::new());
                included_empty_variant = true;
            }
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            sanitized.push(trimmed.to_string());
        }
    }

    sanitized
}

struct ParsedTmxGlossary {
    title: String,
    source_language: GlossaryLanguageInfo,
    target_language: GlossaryLanguageInfo,
    terms: Vec<StoredGlossaryTermFile>,
}

#[derive(Default)]
struct ParsedTmxUnit {
    entries_by_language: BTreeMap<String, Vec<String>>,
    note: String,
}

#[derive(Default)]
struct WorkingTmxUnit {
    entries_by_language: BTreeMap<String, Vec<String>>,
    note_fragments: Vec<String>,
    current_language: Option<String>,
    current_note: String,
    current_segment: String,
    inside_note: bool,
    inside_segment: bool,
}

fn parse_tmx_glossary(file_name: &str, bytes: &[u8]) -> Result<ParsedTmxGlossary, String> {
    if !String::from(file_name)
        .trim()
        .to_lowercase()
        .ends_with(".tmx")
    {
        return Err("TMX is the only supported glossary import format right now.".to_string());
    }

    let mut xml = String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("The TMX file is not valid UTF-8: {error}"))?;
    if xml.starts_with('\u{feff}') {
        xml = xml.trim_start_matches('\u{feff}').to_string();
    }

    let mut reader = Reader::from_str(&xml);
    reader.trim_text(false);

    let mut buffer = Vec::new();
    let mut source_language_code = None::<String>;
    let mut units = Vec::<ParsedTmxUnit>::new();
    let mut current_unit = None::<WorkingTmxUnit>;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| format!("Could not parse the TMX file: {error}"))?
        {
            Event::Eof => break,
            Event::Start(event) => match event.name().as_ref() {
                b"header" | b"headers" => {
                    if source_language_code.is_none() {
                        source_language_code = read_tmx_language_attr(&reader, &event, b"srclang")?;
                    }
                }
                b"tu" => {
                    current_unit = Some(WorkingTmxUnit::default());
                }
                b"tuv" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.current_language = read_tuv_language(&reader, &event)?;
                    }
                }
                b"note" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_note = true;
                        unit.current_note.clear();
                    }
                }
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = true;
                        unit.current_segment.clear();
                    }
                }
                _ => {}
            },
            Event::Empty(event) => match event.name().as_ref() {
                b"header" | b"headers" => {
                    if source_language_code.is_none() {
                        source_language_code = read_tmx_language_attr(&reader, &event, b"srclang")?;
                    }
                }
                b"note" => {}
                _ => {}
            },
            Event::Text(text) => {
                if let Some(unit) = current_unit.as_mut() {
                    let value = text
                        .unescape()
                        .map_err(|error| format!("Could not decode TMX text: {error}"))?
                        .into_owned();
                    if unit.inside_note {
                        unit.current_note.push_str(&value);
                    } else if unit.inside_segment {
                        unit.current_segment.push_str(&value);
                    }
                }
            }
            Event::CData(text) => {
                if let Some(unit) = current_unit.as_mut() {
                    let value = String::from_utf8_lossy(text.as_ref()).into_owned();
                    if unit.inside_note {
                        unit.current_note.push_str(&value);
                    } else if unit.inside_segment {
                        unit.current_segment.push_str(&value);
                    }
                }
            }
            Event::End(event) => match event.name().as_ref() {
                b"tuv" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.current_language = None;
                    }
                }
                b"note" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_note = false;
                        let note = clean_tmx_text(&unit.current_note);
                        if !note.is_empty() {
                            unit.note_fragments.push(note);
                        }
                        unit.current_note.clear();
                    }
                }
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = false;
                        let segment = clean_tmx_text(&unit.current_segment);
                        if !segment.is_empty() {
                            if let Some(language) = unit.current_language.clone() {
                                unit.entries_by_language
                                    .entry(language)
                                    .or_default()
                                    .push(segment);
                            }
                        }
                        unit.current_segment.clear();
                    }
                }
                b"tu" => {
                    if let Some(unit) = current_unit.take() {
                        units.push(ParsedTmxUnit {
                            entries_by_language: unit.entries_by_language,
                            note: unit.note_fragments.join("\n\n"),
                        });
                    }
                }
                _ => {}
            },
            _ => {}
        }

        buffer.clear();
    }

    let source_language_code = normalize_tmx_language_code(
        source_language_code
            .ok_or_else(|| "The TMX file is missing srclang in the header.".to_string())?
            .as_str(),
    );
    if source_language_code.is_empty() {
        return Err("The TMX file source language is empty or invalid.".to_string());
    }

    let mut target_language_codes = BTreeSet::new();
    for unit in &units {
        for language_code in unit.entries_by_language.keys() {
            if language_code != &source_language_code {
                target_language_codes.insert(language_code.clone());
            }
        }
    }

    let target_language_code = if target_language_codes.len() == 1 {
        target_language_codes.into_iter().next().unwrap_or_default()
    } else if target_language_codes.is_empty() {
        return Err("The TMX file does not contain any target-language segments.".to_string());
    } else {
        return Err(format!(
      "The TMX file contains multiple target languages ({}). Import supports exactly one target language per glossary.",
      target_language_codes.into_iter().collect::<Vec<_>>().join(", "),
    ));
    };

    if target_language_code == source_language_code {
        return Err(
            "The TMX file source and target languages resolve to the same code.".to_string(),
        );
    }

    let mut terms = Vec::new();
    for unit in units {
        let source_values = unit
            .entries_by_language
            .get(&source_language_code)
            .cloned()
            .unwrap_or_default();
        let source_terms = sanitize_term_values(&source_values);
        if source_terms.is_empty() {
            continue;
        }

        let target_values = unit
            .entries_by_language
            .get(&target_language_code)
            .cloned()
            .unwrap_or_default();
        let target_terms = if target_values.is_empty() {
            vec![String::new()]
        } else {
            sanitize_target_term_values(&target_values)
        };

        terms.push(StoredGlossaryTermFile {
            term_id: Uuid::now_v7().to_string(),
            source_terms,
            target_terms,
            notes_to_translators: clean_tmx_text(&unit.note),
            footnote: String::new(),
            untranslated: false,
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
        });
    }

    if terms.is_empty() {
        return Err("The TMX file did not contain any importable translation units.".to_string());
    }

    let title = title_from_import_file_name(file_name);
    let source_language_name = language_name_for_iso_code(&source_language_code)
        .unwrap_or_else(|| source_language_code.to_uppercase());
    let target_language_name = language_name_for_iso_code(&target_language_code)
        .unwrap_or_else(|| target_language_code.to_uppercase());

    Ok(ParsedTmxGlossary {
        title,
        source_language: GlossaryLanguageInfo {
            code: source_language_code,
            name: source_language_name,
        },
        target_language: GlossaryLanguageInfo {
            code: target_language_code,
            name: target_language_name,
        },
        terms,
    })
}

fn title_from_import_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported glossary")
        .to_string()
}

fn clean_tmx_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_tmx_language_code(value: &str) -> String {
    value
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
}

fn read_tmx_language_attr(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    attribute_name: &[u8],
) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| format!("Could not read a TMX attribute: {error}"))?;
        if attribute.key.as_ref() != attribute_name {
            continue;
        }

        let value = attribute
            .decode_and_unescape_value(reader)
            .map_err(|error| format!("Could not decode a TMX attribute: {error}"))?
            .into_owned();
        return Ok(Some(value));
    }

    Ok(None)
}

fn read_tuv_language(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| format!("Could not read a TMX attribute: {error}"))?;
        let key = attribute.key.as_ref();
        if key != b"xml:lang" && key != b"lang" {
            continue;
        }

        let value = attribute
            .decode_and_unescape_value(reader)
            .map_err(|error| format!("Could not decode a TMX language value: {error}"))?
            .into_owned();
        let normalized = normalize_tmx_language_code(&value);
        if normalized.is_empty() {
            return Ok(None);
        }
        return Ok(Some(normalized));
    }

    Ok(None)
}

fn language_name_for_iso_code(code: &str) -> Option<String> {
    static ISO_LANGUAGE_NAMES: OnceLock<BTreeMap<String, String>> = OnceLock::new();

    ISO_LANGUAGE_NAMES
        .get_or_init(|| {
            let mut names = BTreeMap::new();
            for line in ISO_LANGUAGE_OPTIONS_SOURCE.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("[\"") {
                    continue;
                }
                let parts = trimmed.split('"').collect::<Vec<_>>();
                if parts.len() < 4 {
                    continue;
                }
                let iso_code = parts[1].trim().to_lowercase();
                let iso_name = parts[3].trim().to_string();
                if !iso_code.is_empty() && !iso_name.is_empty() {
                    names.insert(iso_code, iso_name);
                }
            }
            names
        })
        .get(&code.trim().to_lowercase())
        .cloned()
}

fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

fn ensure_gitattributes(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    write_text_file(path, GLOSSARY_GITATTRIBUTES)
}

fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command()
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format_git_spawn_error(args, &error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        return Err(format!("git {} failed: {detail}", args.join(" ")));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize '{}': {error}", path.display()))?;
    write_text_file(path, &format!("{json}\n"))
}

fn write_text_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

    use uuid::Uuid;

    use crate::local_repo_sync_state::{upsert_local_repo_sync_state, LocalRepoSyncStateUpdate};

    use super::*;

    const GNOSIS_ES_VI_TMX: &str = include_str!("../tests/fixtures/gnosis-es-vi.tmx");

    #[test]
    fn parses_real_gnosis_es_vi_tmx_fixture() {
        let parsed = parse_tmx_glossary("Gnosis ES-VI.tmx", GNOSIS_ES_VI_TMX.as_bytes())
            .expect("fixture TMX should parse");

        assert_eq!(parsed.title, "Gnosis ES-VI");
        assert_eq!(parsed.source_language.code, "es");
        assert_eq!(parsed.source_language.name, "Spanish");
        assert_eq!(parsed.target_language.code, "vi");
        assert_eq!(parsed.target_language.name, "Vietnamese");
        assert!(parsed.terms.len() > 500);

        let alquimia = parsed
            .terms
            .iter()
            .find(|term| term.source_terms.iter().any(|value| value == "Alquimia"))
            .expect("Alquimia term should be present");
        assert!(alquimia
            .target_terms
            .iter()
            .any(|value| value == "thuật luyện kim đan"));
        assert!(alquimia
            .notes_to_translators
            .contains("không dịch là \"giả kim\""));

        let antitesis = parsed
            .terms
            .iter()
            .find(|term| term.source_terms.iter().any(|value| value == "antítesis"))
            .expect("antítesis term should be present");
        assert!(antitesis
            .target_terms
            .iter()
            .any(|value| value == "phản đề"));
        assert!(antitesis
            .notes_to_translators
            .contains("Hãy tham khảo khái niệm"));
    }

    #[test]
    fn glossary_matcher_prefers_glossary_id_over_folder_name_match() {
        let repo_root =
            std::env::temp_dir().join(format!("gnosis-glossary-storage-{}", Uuid::now_v7()));
        let stray_repo_path = repo_root.join("shared-name");
        fs::create_dir_all(&stray_repo_path).expect("create repo dir");
        let output = Command::new("git")
            .args(["init", "--initial-branch", "main"])
            .current_dir(&stray_repo_path)
            .output()
            .expect("run git init");
        assert!(output.status.success(), "git init failed");

        write_json_pretty(
            &stray_repo_path.join("glossary.json"),
            &StoredGlossaryFile {
                glossary_id: "glossary-stray".to_string(),
                title: "Glossary".to_string(),
                lifecycle: StoredLifecycle {
                    state: "active".to_string(),
                },
                languages: StoredGlossaryLanguages {
                    source: StoredGlossaryLanguage {
                        code: "en".to_string(),
                        name: "English".to_string(),
                    },
                    target: StoredGlossaryLanguage {
                        code: "es".to_string(),
                        name: "Spanish".to_string(),
                    },
                },
            },
        )
        .expect("write glossary");
        upsert_local_repo_sync_state(
            &stray_repo_path,
            LocalRepoSyncStateUpdate {
                resource_id: Some("glossary-stray".to_string()),
                current_repo_name: Some("shared-name".to_string()),
                kind: Some("glossary".to_string()),
                ..Default::default()
            },
        )
        .expect("write sync state");

        assert!(!glossary_repo_matches_identifier(
            &stray_repo_path,
            Some("glossary-live"),
            Some("shared-name"),
        ));

        let _ = fs::remove_dir_all(&repo_root);
    }
}
