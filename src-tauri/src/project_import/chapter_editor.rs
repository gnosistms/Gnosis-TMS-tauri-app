use std::{
  cmp::Ordering,
  collections::BTreeMap,
  fs,
  path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::git_commit::git_commit_as_signed_in_user;

use super::project_git::{
  ensure_repo_exists,
  ensure_valid_git_repo,
  find_chapter_path_by_id,
  git_output,
  local_repo_root,
  read_json_file,
  repo_relative_path,
  write_json_pretty,
  write_text_file,
};

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguageSelectionInput {
  installation_id: i64,
  repo_name: String,
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
  chapter_id: String,
  row_id: String,
  fields: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsResponse {
  row_id: String,
  source_word_counts: BTreeMap<String, usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChapterEditorInput {
  installation_id: i64,
  repo_name: String,
  chapter_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorFieldHistoryInput {
  installation_id: i64,
  repo_name: String,
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
  plain_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreEditorFieldHistoryInput {
  installation_id: i64,
  repo_name: String,
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

#[derive(Deserialize)]
struct StoredFieldValue {
  plain_text: String,
}

struct GitCommitMetadata {
  commit_sha: String,
  author_name: String,
  committed_at: String,
  message: String,
}

pub(super) fn load_gtms_chapter_editor_data_sync(
  app: &AppHandle,
  input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_file: StoredChapterFile = read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
  let rows = load_editor_rows(&chapter_path.join("rows"))?;
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
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
          .into_iter()
          .map(|(code, value)| (code, value.plain_text))
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
    let repo_path = repo_root.join(&project.repo_name);
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

pub(super) fn update_gtms_chapter_language_selection_sync(
  app: &AppHandle,
  input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
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
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
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
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
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

  for (code, plain_text) in input.fields {
    let field_value = fields_object.entry(code).or_insert_with(|| json!({}));
    let field_object = field_value
      .as_object_mut()
      .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
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
  if updated_row_text != original_row_text {
    write_text_file(&row_json_path, &updated_row_text)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user(
      app,
      &repo_path,
      &format!("Update row {}", input.row_id),
      &[&relative_row_json],
    )?;
  }

  let rows = load_editor_rows(&chapter_path.join("rows"))?;
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);

  Ok(UpdateEditorRowFieldsResponse {
    row_id: input.row_id,
    source_word_counts,
  })
}

pub(super) fn load_gtms_editor_field_history_sync(
  app: &AppHandle,
  input: LoadEditorFieldHistoryInput,
) -> Result<LoadEditorFieldHistoryResponse, String> {
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
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
  let mut entries = Vec::new();
  let mut last_recorded_plain_text: Option<String> = None;

  for commit in commits {
    let Some(plain_text) = load_historical_row_field_plain_text(
      &repo_path,
      &relative_row_json,
      &commit.commit_sha,
      &input.language_code,
    )? else {
      continue;
    };

    if last_recorded_plain_text.as_deref() == Some(plain_text.as_str()) {
      continue;
    }

    last_recorded_plain_text = Some(plain_text.clone());
    entries.push(EditorFieldHistoryEntry {
      commit_sha: commit.commit_sha,
      author_name: commit.author_name,
      committed_at: commit.committed_at,
      message: commit.message,
      plain_text,
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
  let repo_path = local_repo_root(app, input.installation_id)?.join(&input.repo_name);
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
  let historical_plain_text = load_historical_row_field_plain_text(
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

  let updated_row_json = serde_json::to_string_pretty(&row_value)
    .map_err(|error| format!("Could not serialize row file '{}': {error}", row_json_path.display()))?;
  let updated_row_text = format!("{updated_row_json}\n");
  if updated_row_text != original_row_text {
    write_text_file(&row_json_path, &updated_row_text)?;

    let short_commit = short_commit_sha(&input.commit_sha);
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user(
      app,
      &repo_path,
      &format!(
        "Restore row {} {} from {}",
        input.row_id, input.language_code, short_commit
      ),
      &[&relative_row_json],
    )?;
  }

  let rows = load_editor_rows(&chapter_path.join("rows"))?;
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);

  Ok(RestoreEditorFieldHistoryResponse {
    row_id: input.row_id,
    language_code: input.language_code,
    plain_text: historical_plain_text,
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
    let rows = load_editor_rows(&path.join("rows"))?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
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

fn load_git_history_for_path(
  repo_path: &Path,
  relative_path: &str,
) -> Result<Vec<GitCommitMetadata>, String> {
  let output = git_output(
    repo_path,
    &["log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--", relative_path],
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
      let message = parts.next().unwrap_or_default().trim();

      Ok(GitCommitMetadata {
        commit_sha: commit_sha.to_string(),
        author_name: author_name.to_string(),
        committed_at: committed_at.to_string(),
        message: message.to_string(),
      })
    })
    .collect()
}

fn load_historical_row_field_plain_text(
  repo_path: &Path,
  relative_row_json: &str,
  commit_sha: &str,
  language_code: &str,
) -> Result<Option<String>, String> {
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
      .map(|field| field.plain_text.clone()),
  )
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
