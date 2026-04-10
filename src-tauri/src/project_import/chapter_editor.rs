use std::{
  cmp::Ordering,
  collections::BTreeMap,
  fs,
  path::Path,
  str,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::git_commit::{
  git_commit_as_signed_in_user,
  git_commit_as_signed_in_user_with_metadata,
  GitCommitMetadata as CommitMetadata,
};
use crate::project_repo_paths::{find_project_repo_path, resolve_project_git_repo_path};

use super::project_git::{
  ensure_gitattributes,
  ensure_repo_exists,
  ensure_valid_git_repo,
  find_chapter_path_by_id,
  git_output,
  git_output_with_stdin,
  local_repo_root,
  read_json_file,
  repo_relative_path,
  write_json_pretty,
  write_text_file,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeProjectRepoInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalProjectFilesInput {
  installation_id: i64,
  projects: Vec<LocalProjectFilesDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalProjectFilesDescriptor {
  project_id: String,
  repo_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProjectFilesResponse {
  project_id: String,
  repo_name: String,
  chapters: Vec<ProjectChapterSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeProjectRepoResponse {
  project_id: String,
  repo_name: String,
  title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurgeLocalProjectRepoInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguageSelectionInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  source_language_code: String,
  target_language_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguageSelectionResponse {
  chapter_id: String,
  source_language_code: String,
  target_language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterGlossaryLinksInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  glossary_1: Option<GlossaryLinkSelectionInput>,
  glossary_2: Option<GlossaryLinkSelectionInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryLinkSelectionInput {
  glossary_id: String,
  repo_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterGlossaryLinksResponse {
  chapter_id: String,
  glossary_1: Option<ProjectChapterGlossaryLink>,
  glossary_2: Option<ProjectChapterGlossaryLink>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  row_id: String,
  fields: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldFlagInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  row_id: String,
  language_code: String,
  flag: String,
  enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsResponse {
  row_id: String,
  source_word_counts: BTreeMap<String, usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldFlagResponse {
  row_id: String,
  language_code: String,
  reviewed: bool,
  please_check: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChapterEditorInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorFieldHistoryInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  row_id: String,
  language_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorFieldHistoryResponse {
  row_id: String,
  language_code: String,
  entries: Vec<EditorFieldHistoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorFieldHistoryEntry {
  commit_sha: String,
  author_name: String,
  committed_at: String,
  message: String,
  operation_type: Option<String>,
  status_note: Option<String>,
  plain_text: String,
  reviewed: bool,
  please_check: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreEditorFieldHistoryInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  row_id: String,
  language_code: String,
  commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreEditorFieldHistoryResponse {
  row_id: String,
  language_code: String,
  plain_text: String,
  reviewed: bool,
  please_check: bool,
  source_word_counts: BTreeMap<String, usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChapterEditorResponse {
  chapter_id: String,
  file_title: String,
  languages: Vec<ChapterLanguage>,
  source_word_counts: BTreeMap<String, usize>,
  selected_source_language_code: Option<String>,
  selected_target_language_code: Option<String>,
  rows: Vec<EditorRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorRow {
  row_id: String,
  external_id: Option<String>,
  description: Option<String>,
  context: Option<String>,
  source_row_number: usize,
  review_state: String,
  fields: BTreeMap<String, String>,
  field_states: BTreeMap<String, EditorFieldState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorFieldState {
  reviewed: bool,
  please_check: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectChapterSummary {
  id: String,
  name: String,
  status: String,
  languages: Vec<ChapterLanguage>,
  source_word_counts: BTreeMap<String, usize>,
  selected_source_language_code: Option<String>,
  selected_target_language_code: Option<String>,
  linked_glossary_1: Option<ProjectChapterGlossaryLink>,
  linked_glossary_2: Option<ProjectChapterGlossaryLink>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectChapterGlossaryLink {
  glossary_id: String,
  repo_name: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterLanguage {
  code: String,
  name: String,
  role: String,
}

#[derive(Deserialize)]
struct StoredChapterFile {
  chapter_id: String,
  title: String,
  #[serde(default = "active_lifecycle_state")]
  lifecycle: StoredLifecycleState,
  #[serde(default)]
  source_files: Vec<StoredSourceFile>,
  #[serde(default)]
  languages: Vec<ChapterLanguage>,
  #[serde(default)]
  source_word_counts: BTreeMap<String, usize>,
  #[serde(default)]
  settings: Option<StoredChapterSettings>,
}

#[derive(Deserialize)]
struct StoredLifecycleState {
  state: String,
}

fn active_lifecycle_state() -> StoredLifecycleState {
  StoredLifecycleState {
    state: "active".to_string(),
  }
}

#[derive(Deserialize)]
struct StoredSourceFile {
  file_metadata: StoredSourceFileMetadata,
}

#[derive(Deserialize, Default)]
struct StoredSourceFileMetadata {
  source_locale: Option<String>,
}

#[derive(Deserialize, Default)]
struct StoredChapterSettings {
  linked_glossaries: Option<StoredChapterLinkedGlossaries>,
  default_source_language: Option<String>,
  default_target_language: Option<String>,
  default_preview_language: Option<String>,
}

#[derive(Clone, Deserialize, Default)]
struct StoredChapterLinkedGlossaries {
  glossary_1: Option<StoredChapterGlossaryLink>,
  glossary_2: Option<StoredChapterGlossaryLink>,
}

#[derive(Clone, Deserialize)]
struct StoredChapterGlossaryLink {
  glossary_id: String,
  repo_name: String,
}

#[derive(Deserialize)]
struct StoredRowFile {
  row_id: String,
  #[serde(default)]
  external_id: Option<String>,
  #[serde(default)]
  guidance: Option<StoredGuidance>,
  structure: StoredRowStructure,
  status: StoredRowStatus,
  origin: StoredRowOrigin,
  fields: BTreeMap<String, StoredFieldValue>,
}

#[derive(Deserialize)]
struct StoredRowStructure {
  order_key: String,
}

#[derive(Deserialize, Default)]
struct StoredGuidance {
  description: Option<String>,
  context: Option<String>,
}

#[derive(Deserialize)]
struct StoredRowStatus {
  review_state: String,
}

#[derive(Deserialize)]
struct StoredRowOrigin {
  source_row_number: usize,
}

#[derive(Clone, Deserialize)]
struct StoredFieldValue {
  #[serde(default)]
  plain_text: String,
  #[serde(default)]
  editor_flags: StoredFieldEditorFlags,
}

#[derive(Clone, Deserialize, Default)]
struct StoredFieldEditorFlags {
  #[serde(default)]
  reviewed: bool,
  #[serde(default)]
  please_check: bool,
}

struct GitCommitMetadata {
  commit_sha: String,
  author_name: String,
  committed_at: String,
  message: String,
  operation_type: Option<String>,
  status_note: Option<String>,
}

pub(super) fn load_gtms_chapter_editor_data_sync(
  app: &AppHandle,
  input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_file: StoredChapterFile = read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
  let rows = load_editor_rows(&chapter_path.join("rows"))?;
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let source_word_counts = resolve_source_word_counts(&chapter_file, Some(&rows), &languages);
  let selected_source_language_code = preferred_source_language_code(&chapter_file, &languages);
  let selected_target_language_code = preferred_target_language_code(
    &chapter_file,
    &languages,
    selected_source_language_code.as_deref(),
  );

  Ok(LoadChapterEditorResponse {
    chapter_id: chapter_file.chapter_id,
    file_title: chapter_file.title,
    languages,
    source_word_counts,
    selected_source_language_code,
    selected_target_language_code,
    rows: rows
      .into_iter()
      .map(|row| EditorRow {
        row_id: row.row_id,
        external_id: row.external_id,
        description: row.guidance.as_ref().and_then(|guidance| guidance.description.clone()),
        context: row.guidance.as_ref().and_then(|guidance| guidance.context.clone()),
        source_row_number: row.origin.source_row_number,
        review_state: row.status.review_state,
        fields: row
          .fields
          .iter()
          .map(|(code, value)| (code.clone(), value.plain_text.clone()))
          .collect(),
        field_states: row
          .fields
          .into_iter()
          .map(|(code, value)| {
            (
              code,
              EditorFieldState {
                reviewed: value.editor_flags.reviewed,
                please_check: value.editor_flags.please_check,
              },
            )
          })
          .collect(),
      })
      .collect(),
  })
}

pub(super) fn list_local_gtms_project_files_sync(
  app: &AppHandle,
  input: ListLocalProjectFilesInput,
) -> Result<Vec<LocalProjectFilesResponse>, String> {
  let repo_root = local_repo_root(app, input.installation_id)?;
  let mut results = Vec::with_capacity(input.projects.len());

  for project in input.projects {
    let repo_path = find_project_repo_path(
      app,
      input.installation_id,
      Some(&project.project_id),
      Some(&project.repo_name),
    )?
    .unwrap_or_else(|| repo_root.join(&project.repo_name));
    let chapters = if repo_path.exists() && git_output(&repo_path, &["rev-parse", "--git-dir"]).is_ok() {
      load_project_chapter_summaries(&repo_path)?
    } else {
      Vec::new()
    };

    results.push(LocalProjectFilesResponse {
      project_id: project.project_id,
      repo_name: project.repo_name,
      chapters,
    });
  }

  Ok(results)
}

pub(super) fn initialize_gtms_project_repo_sync(
  app: &AppHandle,
  input: InitializeProjectRepoInput,
) -> Result<InitializeProjectRepoResponse, String> {
  let repo_name = input.repo_name.trim();
  if repo_name.is_empty() {
    return Err("Could not determine which project repo to initialize.".to_string());
  }

  let title = input.title.trim();
  if title.is_empty() {
    return Err("Enter a project name.".to_string());
  }

  let project_id = input
    .project_id
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .ok_or_else(|| "Could not determine which project to initialize.".to_string())?;
  let repo_root = local_repo_root(app, input.installation_id)?;
  let repo_path = find_project_repo_path(
    app,
    input.installation_id,
    Some(&project_id),
    Some(repo_name),
  )?
  .unwrap_or_else(|| repo_root.join(repo_name));

  fs::create_dir_all(&repo_path).map_err(|error| {
    format!(
      "Could not create the local project repo '{}': {error}",
      repo_path.display()
    )
  })?;

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    git_output(&repo_path, &["init", "--initial-branch", "main"])?;
  }

  if repo_path.join("project.json").exists() {
    return Err("This project repo is already initialized.".to_string());
  }

  ensure_gitattributes(&repo_path.join(".gitattributes"))?;
  write_json_pretty(
    &repo_path.join("project.json"),
    &json!({
      "title": title,
    }),
  )?;
  git_output(&repo_path, &["add", ".gitattributes", "project.json"])?;
  git_commit_as_signed_in_user(
    app,
    &repo_path,
    "Initialize project",
    &[".gitattributes", "project.json"],
  )?;

  let _ = crate::local_repo_sync_state::upsert_local_repo_sync_state(
    &repo_path,
    crate::local_repo_sync_state::LocalRepoSyncStateUpdate {
      resource_id: Some(project_id.clone()),
      current_repo_name: Some(repo_name.to_string()),
      kind: Some("project".to_string()),
      has_ever_synced: Some(false),
      ..Default::default()
    },
  );

  Ok(InitializeProjectRepoResponse {
    project_id,
    repo_name: repo_name.to_string(),
    title: title.to_string(),
  })
}

pub(super) fn purge_local_gtms_project_repo_sync(
  app: &AppHandle,
  input: PurgeLocalProjectRepoInput,
) -> Result<(), String> {
  let repo_name = input.repo_name.trim().to_string();
  if repo_name.is_empty() {
    return Err("Could not determine which project repo to remove.".to_string());
  }

  let Some(repo_path) = find_project_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&repo_name),
  )? else {
    return Ok(());
  };
  if !repo_path.exists() {
    return Ok(());
  }

  fs::remove_dir_all(&repo_path).map_err(|error| {
    format!(
      "Could not remove the local project repo '{}': {error}",
      repo_path.display()
    )
  })
}

pub(super) fn update_gtms_chapter_language_selection_sync(
  app: &AppHandle,
  input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_title = chapter_value
    .get("title")
    .and_then(Value::as_str)
    .unwrap_or("file")
    .to_string();
  let known_language_codes = chapter_value
    .get("languages")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(|language| language.get("code").and_then(Value::as_str))
    .collect::<Vec<_>>();

  if !known_language_codes.contains(&input.source_language_code.as_str()) {
    return Err(format!(
      "The source language '{}' is not available in this file.",
      input.source_language_code
    ));
  }

  if !known_language_codes.contains(&input.target_language_code.as_str()) {
    return Err(format!(
      "The target language '{}' is not available in this file.",
      input.target_language_code
    ));
  }

  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let settings_value = chapter_object
    .entry("settings".to_string())
    .or_insert_with(|| json!({}));
  let settings_object = settings_value
    .as_object_mut()
    .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())?;

  let source_changed = settings_object
    .get("default_source_language")
    .and_then(Value::as_str)
    != Some(input.source_language_code.as_str());
  let target_changed = settings_object
    .get("default_target_language")
    .and_then(Value::as_str)
    != Some(input.target_language_code.as_str())
    || settings_object
      .get("default_preview_language")
      .and_then(Value::as_str)
      != Some(input.target_language_code.as_str());

  if source_changed || target_changed {
    settings_object.insert(
      "default_source_language".to_string(),
      Value::String(input.source_language_code.clone()),
    );
    settings_object.insert(
      "default_target_language".to_string(),
      Value::String(input.target_language_code.clone()),
    );
    settings_object.insert(
      "default_preview_language".to_string(),
      Value::String(input.target_language_code.clone()),
    );
    write_json_pretty(&chapter_json_path, &chapter_value)?;

    let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
    git_output(&repo_path, &["add", &relative_chapter_json])?;
    git_commit_as_signed_in_user(
      app,
      &repo_path,
      &format!("Update language selection for {}", chapter_title),
      &[&relative_chapter_json],
    )?;
  }

  Ok(UpdateChapterLanguageSelectionResponse {
    chapter_id: input.chapter_id,
    source_language_code: input.source_language_code,
    target_language_code: input.target_language_code,
  })
}

pub(super) fn update_gtms_chapter_glossary_links_sync(
  app: &AppHandle,
  input: UpdateChapterGlossaryLinksInput,
) -> Result<UpdateChapterGlossaryLinksResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_title = chapter_value
    .get("title")
    .and_then(Value::as_str)
    .unwrap_or("file")
    .to_string();

  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let settings_value = chapter_object
    .entry("settings".to_string())
    .or_insert_with(|| json!({}));
  let settings_object = settings_value
    .as_object_mut()
    .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())?;
  let linked_glossaries_value = settings_object
    .entry("linked_glossaries".to_string())
    .or_insert_with(|| json!({}));
  let linked_glossaries_object = linked_glossaries_value
    .as_object_mut()
    .ok_or_else(|| "The chapter linked glossaries are not a JSON object.".to_string())?;

  let glossary_1_value = glossary_link_value_from_input(input.glossary_1.as_ref());
  let glossary_2_value = glossary_link_value_from_input(input.glossary_2.as_ref());
  let glossary_1_changed = linked_glossaries_object.get("glossary_1") != Some(&glossary_1_value);
  let glossary_2_changed = linked_glossaries_object.get("glossary_2") != Some(&glossary_2_value);

  if glossary_1_changed || glossary_2_changed {
    linked_glossaries_object.insert("glossary_1".to_string(), glossary_1_value);
    linked_glossaries_object.insert("glossary_2".to_string(), glossary_2_value);
    write_json_pretty(&chapter_json_path, &chapter_value)?;

    let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
    git_output(&repo_path, &["add", &relative_chapter_json])?;
    git_commit_as_signed_in_user(
      app,
      &repo_path,
      &format!("Update glossary links for {}", chapter_title),
      &[&relative_chapter_json],
    )?;
  }

  Ok(UpdateChapterGlossaryLinksResponse {
    chapter_id: input.chapter_id,
    glossary_1: input.glossary_1.map(project_chapter_glossary_link_from_input),
    glossary_2: input.glossary_2.map(project_chapter_glossary_link_from_input),
  })
}

pub(super) fn update_gtms_editor_row_fields_sync(
  app: &AppHandle,
  input: UpdateEditorRowFieldsInput,
) -> Result<UpdateEditorRowFieldsResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
  let row_json_path = chapter_path.join("rows").join(format!("{}.json", input.row_id));
  let original_row_text = fs::read_to_string(&row_json_path)
    .map_err(|error| format!("Could not read row file '{}': {error}", row_json_path.display()))?;
  let original_row_file: StoredRowFile = serde_json::from_str(&original_row_text)
    .map_err(|error| format!("Could not parse row file '{}': {error}", row_json_path.display()))?;
  let mut row_value: Value = serde_json::from_str(&original_row_text)
    .map_err(|error| format!("Could not parse row file '{}': {error}", row_json_path.display()))?;
  let row_object = row_value
    .as_object_mut()
    .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
  let fields_value = row_object
    .entry("fields".to_string())
    .or_insert_with(|| json!({}));
  let fields_object = fields_value
    .as_object_mut()
    .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;

  for (code, plain_text) in input.fields {
    let field_value = fields_object.entry(code).or_insert_with(|| json!({}));
    let field_object = field_value
      .as_object_mut()
      .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
    field_object.insert("plain_text".to_string(), Value::String(plain_text.clone()));
    field_object.insert(
      "html_preview".to_string(),
      html_preview(&plain_text).map(Value::String).unwrap_or(Value::Null),
    );
  }

  let updated_row_json = serde_json::to_string_pretty(&row_value)
    .map_err(|error| format!("Could not serialize row file '{}': {error}", row_json_path.display()))?;
  let updated_row_text = format!("{updated_row_json}\n");
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let mut source_word_counts = if chapter_file.source_word_counts.is_empty() {
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    resolve_source_word_counts(&chapter_file, Some(&rows), &languages)
  } else {
    resolve_source_word_counts(&chapter_file, None, &languages)
  };
  if updated_row_text != original_row_text {
    let updated_row_file: StoredRowFile = serde_json::from_value(row_value.clone())
      .map_err(|error| format!("Could not decode updated row '{}': {error}", row_json_path.display()))?;
    source_word_counts = apply_source_word_count_delta(
      &source_word_counts,
      &original_row_file,
      &updated_row_file,
      &languages,
    );
    write_text_file(&row_json_path, &updated_row_text)?;
    write_chapter_source_word_counts(&chapter_json_path, &source_word_counts)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
    git_output(&repo_path, &["add", &relative_row_json, &relative_chapter_json])?;
    git_commit_as_signed_in_user_with_metadata(
      app,
      &repo_path,
      &format!("Update row {}", input.row_id),
      &[&relative_row_json, &relative_chapter_json],
      CommitMetadata {
        operation: Some("editor-update"),
        status_note: None,
      },
    )?;
  }

  Ok(UpdateEditorRowFieldsResponse {
    row_id: input.row_id,
    source_word_counts,
  })
}

pub(super) fn load_gtms_editor_field_history_sync(
  app: &AppHandle,
  input: LoadEditorFieldHistoryInput,
) -> Result<LoadEditorFieldHistoryResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let row_json_path = chapter_path.join("rows").join(format!("{}.json", input.row_id));
  if !row_json_path.exists() {
    return Err(format!(
      "Could not find row '{}' in the local project repo.",
      input.row_id
    ));
  }

  let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
  let commits = load_git_history_for_path(&repo_path, &relative_row_json)?;
  let historical_field_values =
    load_historical_row_field_values_batch(&repo_path, &relative_row_json, &commits, &input.language_code)?;
  let mut entries = Vec::new();
  let mut last_recorded_field_signature: Option<HistoricalFieldSignature> = None;

  for (commit, historical_field_value) in commits.into_iter().zip(historical_field_values.into_iter()) {
    let Some(field_value) = historical_field_value else {
      continue;
    };
    let plain_text = field_value.plain_text.clone();
    let field_signature = HistoricalFieldSignature::from_field_value(&field_value);

    if last_recorded_field_signature.as_ref() == Some(&field_signature) {
      continue;
    }

    last_recorded_field_signature = Some(field_signature);
    entries.push(EditorFieldHistoryEntry {
      commit_sha: commit.commit_sha,
      author_name: commit.author_name,
      committed_at: commit.committed_at,
      message: commit.message,
      operation_type: commit.operation_type,
      status_note: commit.status_note,
      plain_text,
      reviewed: field_value.editor_flags.reviewed,
      please_check: field_value.editor_flags.please_check,
    });
  }

  Ok(LoadEditorFieldHistoryResponse {
    row_id: input.row_id,
    language_code: input.language_code,
    entries,
  })
}

pub(super) fn restore_gtms_editor_field_from_history_sync(
  app: &AppHandle,
  input: RestoreEditorFieldHistoryInput,
) -> Result<RestoreEditorFieldHistoryResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
  let row_json_path = chapter_path.join("rows").join(format!("{}.json", input.row_id));
  if !row_json_path.exists() {
    return Err(format!(
      "Could not find row '{}' in the local project repo.",
      input.row_id
    ));
  }

  let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
  let historical_field_value = load_historical_row_field_value(
    &repo_path,
    &relative_row_json,
    &input.commit_sha,
    &input.language_code,
  )?
  .ok_or_else(|| {
    format!(
      "The selected history entry does not contain the '{}' field.",
      input.language_code
    )
  })?;
  let historical_plain_text = historical_field_value.plain_text.clone();

  let original_row_text = fs::read_to_string(&row_json_path)
    .map_err(|error| format!("Could not read row file '{}': {error}", row_json_path.display()))?;
  let original_row_file: StoredRowFile = serde_json::from_str(&original_row_text)
    .map_err(|error| format!("Could not parse row file '{}': {error}", row_json_path.display()))?;
  let mut row_value: Value = serde_json::from_str(&original_row_text)
    .map_err(|error| format!("Could not parse row file '{}': {error}", row_json_path.display()))?;
  let row_object = row_value
    .as_object_mut()
    .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
  let fields_value = row_object
    .entry("fields".to_string())
    .or_insert_with(|| json!({}));
  let fields_object = fields_value
    .as_object_mut()
    .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
  let field_value = fields_object
    .entry(input.language_code.clone())
    .or_insert_with(|| json!({}));
  let field_object = field_value
    .as_object_mut()
    .ok_or_else(|| "The row field is not a JSON object.".to_string())?;

  ensure_editor_field_object_defaults(field_object)?;
  field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
  field_object.insert(
    "plain_text".to_string(),
    Value::String(historical_plain_text.clone()),
  );
  field_object.insert(
    "html_preview".to_string(),
    html_preview(&historical_plain_text)
      .map(Value::String)
      .unwrap_or(Value::Null),
  );
  set_editor_field_flags(field_object, &historical_field_value.editor_flags);

  let updated_row_json = serde_json::to_string_pretty(&row_value)
    .map_err(|error| format!("Could not serialize row file '{}': {error}", row_json_path.display()))?;
  let updated_row_text = format!("{updated_row_json}\n");
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let mut source_word_counts = if chapter_file.source_word_counts.is_empty() {
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    resolve_source_word_counts(&chapter_file, Some(&rows), &languages)
  } else {
    resolve_source_word_counts(&chapter_file, None, &languages)
  };
  if updated_row_text != original_row_text {
    let updated_row_file: StoredRowFile = serde_json::from_value(row_value.clone())
      .map_err(|error| format!("Could not decode restored row '{}': {error}", row_json_path.display()))?;
    source_word_counts = apply_source_word_count_delta(
      &source_word_counts,
      &original_row_file,
      &updated_row_file,
      &languages,
    );
    write_text_file(&row_json_path, &updated_row_text)?;
    write_chapter_source_word_counts(&chapter_json_path, &source_word_counts)?;

    let short_commit = short_commit_sha(&input.commit_sha);
    let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
    git_output(&repo_path, &["add", &relative_row_json, &relative_chapter_json])?;
    git_commit_as_signed_in_user_with_metadata(
      app,
      &repo_path,
      &format!(
        "Restore row {} {} from {}",
        input.row_id, input.language_code, short_commit
      ),
      &[&relative_row_json, &relative_chapter_json],
      CommitMetadata {
        operation: Some("restore"),
        status_note: None,
      },
    )?;
  }

  Ok(RestoreEditorFieldHistoryResponse {
    row_id: input.row_id,
    language_code: input.language_code,
    plain_text: historical_plain_text,
    reviewed: historical_field_value.editor_flags.reviewed,
    please_check: historical_field_value.editor_flags.please_check,
    source_word_counts,
  })
}

fn compare_stored_rows(left: &StoredRowFile, right: &StoredRowFile) -> Ordering {
  left
    .structure
    .order_key
    .cmp(&right.structure.order_key)
    .then_with(|| left.row_id.cmp(&right.row_id))
}

fn load_editor_rows(rows_path: &Path) -> Result<Vec<StoredRowFile>, String> {
  if !rows_path.exists() {
    return Ok(Vec::new());
  }

  let mut rows = Vec::new();
  for entry in fs::read_dir(rows_path)
    .map_err(|error| format!("Could not read rows folder '{}': {error}", rows_path.display()))?
  {
    let entry = entry.map_err(|error| format!("Could not read a row file entry: {error}"))?;
    let path = entry.path();
    if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
      continue;
    }

    rows.push(read_json_file(&path, "row file")?);
  }

  rows.sort_by(compare_stored_rows);
  Ok(rows)
}

fn load_project_chapter_summaries(repo_path: &Path) -> Result<Vec<ProjectChapterSummary>, String> {
  let chapters_root = repo_path.join("chapters");
  if !chapters_root.exists() {
    return Ok(Vec::new());
  }

  let entries = fs::read_dir(&chapters_root).map_err(|error| {
    format!(
      "Could not read chapters folder '{}': {error}",
      chapters_root.display()
    )
  })?;

  let mut chapters = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }

    let chapter_json_path = path.join("chapter.json");
    if !chapter_json_path.exists() {
      continue;
    }

    let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let source_word_counts = if chapter_file.source_word_counts.is_empty() {
      let rows = load_editor_rows(&path.join("rows"))?;
      resolve_source_word_counts(&chapter_file, Some(&rows), &languages)
    } else {
      resolve_source_word_counts(&chapter_file, None, &languages)
    };
    let selected_source_language_code = preferred_source_language_code(&chapter_file, &languages);
    let selected_target_language_code = preferred_target_language_code(
      &chapter_file,
      &languages,
      selected_source_language_code.as_deref(),
    );
    let linked_glossary_1 = linked_chapter_glossary(&chapter_file, 1);
    let linked_glossary_2 = linked_chapter_glossary(&chapter_file, 2);

    chapters.push(ProjectChapterSummary {
      id: chapter_file.chapter_id,
      name: chapter_file.title,
      status: if chapter_file.lifecycle.state == "deleted" {
        "deleted".to_string()
      } else {
        "active".to_string()
      },
      languages,
      source_word_counts,
      selected_source_language_code,
      selected_target_language_code,
      linked_glossary_1,
      linked_glossary_2,
    });
  }

  Ok(chapters)
}

pub(super) fn update_gtms_editor_row_field_flag_sync(
  app: &AppHandle,
  input: UpdateEditorRowFieldFlagInput,
) -> Result<UpdateEditorRowFieldFlagResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let row_json_path = chapter_path.join("rows").join(format!("{}.json", input.row_id));
  let original_row_text = fs::read_to_string(&row_json_path)
    .map_err(|error| format!("Could not read row file '{}': {error}", row_json_path.display()))?;
  let mut row_value: Value = serde_json::from_str(&original_row_text)
    .map_err(|error| format!("Could not parse row file '{}': {error}", row_json_path.display()))?;
  let row_object = row_value
    .as_object_mut()
    .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
  let fields_value = row_object
    .entry("fields".to_string())
    .or_insert_with(|| json!({}));
  let fields_object = fields_value
    .as_object_mut()
    .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
  let field_value = fields_object
    .entry(input.language_code.clone())
    .or_insert_with(|| json!({}));
  let field_object = field_value
    .as_object_mut()
    .ok_or_else(|| "The row field is not a JSON object.".to_string())?;
  ensure_editor_field_object_defaults(field_object)?;
  let flag_key = match input.flag.trim() {
    "reviewed" => "reviewed",
    "please-check" => "please_check",
    _ => return Err("Unknown row field flag.".to_string()),
  };
  let (reviewed, please_check, changed) = {
    let editor_flags_object = field_object
      .get_mut("editor_flags")
      .and_then(Value::as_object_mut)
      .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
    let previous_value = editor_flags_object
      .get(flag_key)
      .and_then(Value::as_bool)
      .unwrap_or(false);
    let changed = previous_value != input.enabled;
    if changed {
      editor_flags_object.insert(flag_key.to_string(), Value::Bool(input.enabled));
    }
    let reviewed = editor_flags_object
      .get("reviewed")
      .and_then(Value::as_bool)
      .unwrap_or(false);
    let please_check = editor_flags_object
      .get("please_check")
      .and_then(Value::as_bool)
      .unwrap_or(false);
    (reviewed, please_check, changed)
  };

  if changed {
    let updated_row_json = serde_json::to_string_pretty(&row_value)
      .map_err(|error| format!("Could not serialize row file '{}': {error}", row_json_path.display()))?;
    let updated_row_text = format!("{updated_row_json}\n");
    write_text_file(&row_json_path, &updated_row_text)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let status_note = status_note_for_field_flag(flag_key, input.enabled);
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
      app,
      &repo_path,
      &format!("Update row {} {} markers", input.row_id, input.language_code),
      &[&relative_row_json],
      CommitMetadata {
        operation: Some("field-status"),
        status_note: Some(status_note),
      },
    )?;
  }

  Ok(UpdateEditorRowFieldFlagResponse {
    row_id: input.row_id,
    language_code: input.language_code,
    reviewed,
    please_check,
  })
}

fn load_git_history_for_path(
  repo_path: &Path,
  relative_path: &str,
) -> Result<Vec<GitCommitMetadata>, String> {
  let output = git_output(
    repo_path,
    &["log", "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", relative_path],
  )?;
  if output.is_empty() {
    return Ok(Vec::new());
  }

  output
    .split('\u{1e}')
    .filter(|record| !record.trim().is_empty())
    .map(|record| {
      let mut parts = record.split('\u{1f}');
      let commit_sha = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Could not parse git history for '{}'.", relative_path))?;
      let author_name = parts.next().unwrap_or_default().trim();
      let committed_at = parts.next().unwrap_or_default().trim();
      let full_message = parts.next().unwrap_or_default();
      let (message, operation_type, status_note) = parse_git_commit_message(full_message);

      Ok(GitCommitMetadata {
        commit_sha: commit_sha.to_string(),
        author_name: author_name.to_string(),
        committed_at: committed_at.to_string(),
        message,
        operation_type,
        status_note,
      })
    })
    .collect()
}

fn parse_git_commit_message(message: &str) -> (String, Option<String>, Option<String>) {
  let trimmed_message = message.trim();
  if trimmed_message.is_empty() {
    return (String::new(), None, None);
  }

  let subject = trimmed_message
    .lines()
    .map(str::trim)
    .find(|line| !line.is_empty())
    .unwrap_or_default()
    .to_string();
  let operation_type = trimmed_message
    .lines()
    .find_map(parse_gtms_operation_trailer)
    .or_else(|| infer_commit_operation_from_subject(&subject));
  let status_note = trimmed_message.lines().find_map(parse_gtms_status_note_trailer);
  (subject, operation_type, status_note)
}

fn parse_gtms_operation_trailer(line: &str) -> Option<String> {
  let (name, value) = line.split_once(':')?;
  if !name.trim().eq_ignore_ascii_case("GTMS-Operation") {
    return None;
  }

  let operation = value.trim();
  if operation.is_empty() {
    None
  } else {
    Some(operation.to_string())
  }
}

fn parse_gtms_status_note_trailer(line: &str) -> Option<String> {
  let (name, value) = line.split_once(':')?;
  if !name.trim().eq_ignore_ascii_case("GTMS-Status-Note") {
    return None;
  }

  let note = value.trim();
  if note.is_empty() {
    None
  } else {
    Some(note.to_string())
  }
}

fn infer_commit_operation_from_subject(subject: &str) -> Option<String> {
  let trimmed_subject = subject.trim();
  if trimmed_subject.starts_with("Import ") {
    Some("import".to_string())
  } else {
    None
  }
}

fn status_note_for_field_flag(flag: &str, enabled: bool) -> &'static str {
  match (flag, enabled) {
    ("reviewed", true) => "Marked reviewed",
    ("reviewed", false) => "Marked unreviewed",
    ("please_check", true) => "Marked \"Please check\"",
    ("please_check", false) => "Removed \"Please check\"",
    _ => "Updated markers",
  }
}

fn ensure_editor_field_object_defaults(
  field_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
  let plain_text = field_object
    .get("plain_text")
    .and_then(Value::as_str)
    .unwrap_or_default()
    .to_string();
  field_object
    .entry("value_kind".to_string())
    .or_insert_with(|| Value::String("text".to_string()));
  field_object
    .entry("plain_text".to_string())
    .or_insert_with(|| Value::String(plain_text.clone()));
  field_object
    .entry("html_preview".to_string())
    .or_insert_with(|| html_preview(&plain_text).map(Value::String).unwrap_or(Value::Null));

  let editor_flags_value = field_object
    .entry("editor_flags".to_string())
    .or_insert_with(|| json!({}));
  let editor_flags_object = editor_flags_value
    .as_object_mut()
    .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
  editor_flags_object
    .entry("reviewed".to_string())
    .or_insert(Value::Bool(false));
  editor_flags_object
    .entry("please_check".to_string())
    .or_insert(Value::Bool(false));

  Ok(())
}

fn set_editor_field_flags(field_object: &mut serde_json::Map<String, Value>, flags: &StoredFieldEditorFlags) {
  if let Some(editor_flags_object) = field_object
    .get_mut("editor_flags")
    .and_then(Value::as_object_mut)
  {
    editor_flags_object.insert("reviewed".to_string(), Value::Bool(flags.reviewed));
    editor_flags_object.insert("please_check".to_string(), Value::Bool(flags.please_check));
  }
}

#[derive(Clone, PartialEq, Eq)]
struct HistoricalFieldSignature {
  plain_text: String,
  reviewed: bool,
  please_check: bool,
}

impl HistoricalFieldSignature {
  fn from_field_value(field: &StoredFieldValue) -> Self {
    Self {
      plain_text: field.plain_text.clone(),
      reviewed: field.editor_flags.reviewed,
      please_check: field.editor_flags.please_check,
    }
  }
}

fn load_historical_row_field_value(
  repo_path: &Path,
  relative_row_json: &str,
  commit_sha: &str,
  language_code: &str,
) -> Result<Option<StoredFieldValue>, String> {
  let row_text = git_output(repo_path, &["show", &format!("{commit_sha}:{relative_row_json}")])?;
  let row_file: StoredRowFile = serde_json::from_str(&row_text).map_err(|error| {
    format!(
      "Could not parse historical row file '{}' at commit '{}': {error}",
      relative_row_json, commit_sha
    )
  })?;

  Ok(
    row_file
      .fields
      .get(language_code)
      .cloned(),
  )
}

fn load_historical_row_field_values_batch(
  repo_path: &Path,
  relative_row_json: &str,
  commits: &[GitCommitMetadata],
  language_code: &str,
) -> Result<Vec<Option<StoredFieldValue>>, String> {
  if commits.is_empty() {
    return Ok(Vec::new());
  }

  let request = commits
    .iter()
    .map(|commit| format!("{}:{}\n", commit.commit_sha, relative_row_json))
    .collect::<String>();
  let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
  let mut cursor = 0usize;
  let mut values = Vec::with_capacity(commits.len());

  for commit in commits {
    let header_start = cursor;
    let header_end = output[header_start..]
      .iter()
      .position(|byte| *byte == b'\n')
      .map(|offset| header_start + offset)
      .ok_or_else(|| {
        format!(
          "Could not parse historical row header for '{}' at commit '{}'.",
          relative_row_json, commit.commit_sha
        )
      })?;
    let header = str::from_utf8(&output[header_start..header_end]).map_err(|error| {
      format!(
        "Could not decode historical row header for '{}' at commit '{}': {error}",
        relative_row_json, commit.commit_sha
      )
    })?;
    cursor = header_end + 1;

    if header.ends_with(" missing") {
      values.push(None);
      continue;
    }

    let mut header_parts = header.split_whitespace();
    let _object_name = header_parts.next().unwrap_or_default();
    let object_type = header_parts.next().unwrap_or_default();
    let object_size = header_parts
      .next()
      .ok_or_else(|| {
        format!(
          "Could not parse historical row size for '{}' at commit '{}'.",
          relative_row_json, commit.commit_sha
        )
      })?
      .parse::<usize>()
      .map_err(|error| {
        format!(
          "Could not decode historical row size for '{}' at commit '{}': {error}",
          relative_row_json, commit.commit_sha
        )
      })?;

    if object_type != "blob" {
      return Err(format!(
        "Expected a blob for historical row '{}' at commit '{}', found '{}'.",
        relative_row_json, commit.commit_sha, object_type
      ));
    }

    let body_end = cursor
      .checked_add(object_size)
      .ok_or_else(|| {
        format!(
          "Historical row size overflow for '{}' at commit '{}'.",
          relative_row_json, commit.commit_sha
        )
      })?;
    if body_end > output.len() {
      return Err(format!(
        "Historical row output was truncated for '{}' at commit '{}'.",
        relative_row_json, commit.commit_sha
      ));
    }

    let row_text = str::from_utf8(&output[cursor..body_end]).map_err(|error| {
      format!(
        "Could not decode historical row file '{}' at commit '{}': {error}",
        relative_row_json, commit.commit_sha
      )
    })?;
    cursor = body_end;
    if output.get(cursor) == Some(&b'\n') {
      cursor += 1;
    }

    let row_file: StoredRowFile = serde_json::from_str(row_text).map_err(|error| {
      format!(
        "Could not parse historical row file '{}' at commit '{}': {error}",
        relative_row_json, commit.commit_sha
      )
    })?;
    values.push(row_file.fields.get(language_code).cloned());
  }

  Ok(values)
}

fn short_commit_sha(commit_sha: &str) -> String {
  commit_sha.chars().take(8).collect()
}

fn glossary_link_value_from_input(input: Option<&GlossaryLinkSelectionInput>) -> Value {
  match input {
    Some(selection) => json!({
      "glossary_id": selection.glossary_id,
      "repo_name": selection.repo_name,
    }),
    None => Value::Null,
  }
}

fn project_chapter_glossary_link_from_input(
  input: GlossaryLinkSelectionInput,
) -> ProjectChapterGlossaryLink {
  ProjectChapterGlossaryLink {
    glossary_id: input.glossary_id,
    repo_name: input.repo_name,
  }
}

fn sanitize_chapter_languages(languages: &[ChapterLanguage]) -> Vec<ChapterLanguage> {
  let mut seen = BTreeMap::<String, ()>::new();
  let mut sanitized = Vec::new();

  for language in languages {
    if is_reserved_non_language_header(&language.code)
      || is_reserved_non_language_header(&language.name)
    {
      continue;
    }

    if seen.contains_key(&language.code) {
      continue;
    }

    seen.insert(language.code.clone(), ());
    sanitized.push(language.clone());
  }

  sanitized
}

fn is_reserved_non_language_header(value: &str) -> bool {
  matches!(
    normalize_header(value).as_str(),
    "" | "row" | "row number" | "row id" | "source label" | "source title"
      | "description" | "desc" | "context" | "comment" | "comments" | "note" | "notes"
      | "developer comment" | "developer note" | "translator comment" | "translator note"
      | "key" | "id" | "identifier" | "string key" | "string id" | "resource key"
  )
}

fn normalize_header(value: &str) -> String {
  value
    .trim()
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() {
        character.to_ascii_lowercase()
      } else {
        ' '
      }
    })
    .collect::<String>()
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

fn build_source_word_counts_from_stored_rows(
  rows: &[StoredRowFile],
  languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
  let mut counts = languages
    .iter()
    .map(|language| (language.code.clone(), 0usize))
    .collect::<BTreeMap<_, _>>();

  for row in rows {
    for language in languages {
      let value = row
        .fields
        .get(&language.code)
        .map(|field| field.plain_text.as_str())
        .unwrap_or("");
      *counts.entry(language.code.clone()).or_default() += count_words(value);
    }
  }

  counts
}

fn resolve_source_word_counts(
  chapter_file: &StoredChapterFile,
  rows: Option<&[StoredRowFile]>,
  languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
  if !chapter_file.source_word_counts.is_empty() {
    return languages
      .iter()
      .map(|language| {
        (
          language.code.clone(),
          chapter_file
            .source_word_counts
            .get(&language.code)
            .copied()
            .unwrap_or(0),
        )
      })
      .collect();
  }

  rows
    .map(|stored_rows| build_source_word_counts_from_stored_rows(stored_rows, languages))
    .unwrap_or_else(|| {
      languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect()
    })
}

fn apply_source_word_count_delta(
  existing_counts: &BTreeMap<String, usize>,
  original_row: &StoredRowFile,
  updated_row: &StoredRowFile,
  languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
  let mut next_counts = existing_counts.clone();

  for language in languages {
    let original_words = original_row
      .fields
      .get(&language.code)
      .map(|field| count_words(&field.plain_text))
      .unwrap_or(0);
    let updated_words = updated_row
      .fields
      .get(&language.code)
      .map(|field| count_words(&field.plain_text))
      .unwrap_or(0);
    let previous_total = next_counts.get(&language.code).copied().unwrap_or(0);
    let adjusted_total = previous_total.saturating_sub(original_words) + updated_words;
    next_counts.insert(language.code.clone(), adjusted_total);
  }

  next_counts
}

fn write_chapter_source_word_counts(
  chapter_json_path: &Path,
  source_word_counts: &BTreeMap<String, usize>,
) -> Result<(), String> {
  let mut chapter_value: Value = read_json_file(chapter_json_path, "chapter.json")?;
  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  chapter_object.insert(
    "source_word_counts".to_string(),
    serde_json::to_value(source_word_counts)
      .map_err(|error| format!("Could not serialize chapter source word counts: {error}"))?,
  );
  write_json_pretty(chapter_json_path, &chapter_value)
}

fn preferred_source_language_code(
  chapter_file: &StoredChapterFile,
  languages: &[ChapterLanguage],
) -> Option<String> {
  chapter_file
    .settings
    .as_ref()
    .and_then(|settings| settings.default_source_language.clone())
    .filter(|code| languages.iter().any(|language| language.code == *code))
    .or_else(|| languages.first().map(|language| language.code.clone()))
    .or_else(|| {
      chapter_file
        .source_files
        .iter()
        .find_map(|source_file| source_file.file_metadata.source_locale.clone())
    })
}

fn linked_chapter_glossary(
  chapter_file: &StoredChapterFile,
  slot: usize,
) -> Option<ProjectChapterGlossaryLink> {
  let link = match slot {
    1 => chapter_file
      .settings
      .as_ref()
      .and_then(|settings| settings.linked_glossaries.as_ref())
      .and_then(|linked| linked.glossary_1.as_ref()),
    2 => chapter_file
      .settings
      .as_ref()
      .and_then(|settings| settings.linked_glossaries.as_ref())
      .and_then(|linked| linked.glossary_2.as_ref()),
    _ => None,
  }?;

  Some(ProjectChapterGlossaryLink {
    glossary_id: link.glossary_id.clone(),
    repo_name: link.repo_name.clone(),
  })
}

fn preferred_target_language_code(
  chapter_file: &StoredChapterFile,
  languages: &[ChapterLanguage],
  selected_source_language_code: Option<&str>,
) -> Option<String> {
  chapter_file
    .settings
    .as_ref()
    .and_then(|settings| {
      settings
        .default_target_language
        .clone()
        .or_else(|| settings.default_preview_language.clone())
    })
    .filter(|code| languages.iter().any(|language| language.code == *code))
    .or_else(|| {
      languages
        .iter()
        .find(|language| language.role == "target")
        .map(|language| language.code.clone())
    })
    .or_else(|| {
      languages
        .iter()
        .find(|language| Some(language.code.as_str()) != selected_source_language_code)
        .map(|language| language.code.clone())
    })
    .or_else(|| languages.first().map(|language| language.code.clone()))
}

fn count_words(value: &str) -> usize {
  value
    .split_whitespace()
    .filter(|segment| !segment.is_empty())
    .count()
}

fn html_preview(plain_text: &str) -> Option<String> {
  if plain_text.is_empty() {
    return None;
  }

  Some(format!("<p>{}</p>", escape_html(plain_text)))
}

fn escape_html(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&#39;")
}
