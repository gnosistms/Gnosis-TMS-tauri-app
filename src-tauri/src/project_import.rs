use std::{
  collections::BTreeMap,
  fs,
  io::Cursor,
  path::{Path, PathBuf},
  process::Command,
};

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const GTMS_GITATTRIBUTES: &str = "*.json text eol=lf\nassets/** binary\n";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxInput {
  installation_id: i64,
  repo_name: String,
  file_name: String,
  bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxResponse {
  chapter_id: String,
  repo_path: String,
  chapter_path: String,
  project_title: String,
  file_title: String,
  worksheet_name: String,
  unit_count: usize,
  languages: Vec<ChapterLanguage>,
  source_word_counts: BTreeMap<String, usize>,
  selected_source_language_code: Option<String>,
  selected_target_language_code: Option<String>,
  language_codes: Vec<String>,
  source_file_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalProjectFilesInput {
  installation_id: i64,
  projects: Vec<LocalProjectFilesDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProjectFilesDescriptor {
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameChapterInput {
  installation_id: i64,
  repo_name: String,
  chapter_id: String,
  title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameChapterResponse {
  chapter_id: String,
  title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLifecycleInput {
  installation_id: i64,
  repo_name: String,
  chapter_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLifecycleResponse {
  chapter_id: String,
  lifecycle_state: String,
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
pub(crate) struct LoadChapterEditorInput {
  installation_id: i64,
  repo_name: String,
  chapter_id: String,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectChapterSummary {
  id: String,
  name: String,
  status: String,
  languages: Vec<ChapterLanguage>,
  source_word_counts: BTreeMap<String, usize>,
  selected_source_language_code: Option<String>,
  selected_target_language_code: Option<String>,
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

#[derive(Clone)]
struct ParsedWorkbook {
  installation_id: i64,
  repo_name: String,
  file_title: String,
  worksheet_name: String,
  source_file_name: String,
  header_blob: Vec<String>,
  languages: Vec<ImportedLanguage>,
  rows: Vec<ImportedRow>,
}

#[derive(Clone)]
struct ImportedLanguage {
  code: String,
  name: String,
  role: &'static str,
}

#[derive(Clone)]
struct ImportedRow {
  external_id: Option<String>,
  description: Option<String>,
  context: Option<String>,
  comments: Vec<GuidanceComment>,
  source_row_number: usize,
  fields: BTreeMap<String, String>,
}

#[derive(Clone)]
enum ColumnBinding {
  ExternalId,
  Description,
  Context,
  Comment { kind: String },
  Language { code: String, name: String },
  Ignored,
}

#[derive(Deserialize, Serialize)]
struct ProjectFile {
  project_id: String,
  title: String,
  #[serde(default = "active_lifecycle_state")]
  lifecycle: LifecycleState,
  #[serde(flatten, default)]
  extra: BTreeMap<String, Value>,
}

#[derive(Deserialize, Serialize)]
struct LifecycleState {
  state: String,
}

fn active_lifecycle_state() -> LifecycleState {
  LifecycleState {
    state: "active".to_string(),
  }
}

#[derive(Serialize, Deserialize)]
struct ChapterFile {
  format: &'static str,
  format_version: u32,
  #[serde(rename = "appVersion")]
  app_version: String,
  chapter_id: String,
  title: String,
  slug: String,
  #[serde(default = "active_lifecycle_state")]
  lifecycle: LifecycleState,
  source_files: Vec<SourceFile>,
  package_assets: Vec<Value>,
  languages: Vec<ChapterLanguage>,
  #[serde(default)]
  settings: ChapterSettings,
}

#[derive(Serialize, Deserialize)]
struct SourceFile {
  file_id: String,
  format: &'static str,
  path_hint: String,
  filename_template: String,
  file_metadata: SourceFileMetadata,
}

#[derive(Serialize, Deserialize)]
struct SourceFileMetadata {
  source_locale: Option<String>,
  target_locales: Vec<String>,
  header_blob: Vec<String>,
  root_language: Option<String>,
  wrapper_name: Option<String>,
  serialization_hints: BTreeMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterLanguage {
  code: String,
  name: String,
  role: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ChapterSettings {
  #[serde(default)]
  default_source_language: Option<String>,
  #[serde(default)]
  default_target_language: Option<String>,
  #[serde(default)]
  default_preview_language: Option<String>,
}

#[derive(Serialize)]
struct RowFile {
  row_id: String,
  unit_type: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  external_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  guidance: Option<Guidance>,
  status: RowStatus,
  structure: RowStructure,
  origin: RowOrigin,
  format_state: FormatState,
  placeholders: Vec<Value>,
  variants: Vec<Value>,
  fields: BTreeMap<String, FieldValue>,
  format_metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Serialize)]
struct Guidance {
  description: Option<String>,
  context: Option<String>,
  comments: Vec<GuidanceComment>,
  source_references: Vec<String>,
}

#[derive(Clone, Serialize)]
struct GuidanceComment {
  kind: String,
  text: String,
}

#[derive(Serialize)]
struct RowStatus {
  review_state: &'static str,
  reviewed_at: Option<String>,
  reviewed_by: Option<String>,
  flags: Vec<String>,
}

#[derive(Serialize)]
struct RowStructure {
  source_file: String,
  container_path: BTreeMap<String, Value>,
  order_index: usize,
  group_context: Option<String>,
}

#[derive(Serialize)]
struct RowOrigin {
  source_format: &'static str,
  source_sheet: String,
  source_row_number: usize,
}

#[derive(Serialize)]
struct FormatState {
  translatable: bool,
  character_limit: Option<u32>,
  tags: Vec<String>,
  source_state: Option<String>,
  custom_attributes: BTreeMap<String, Value>,
}

#[derive(Serialize)]
struct FieldValue {
  value_kind: &'static str,
  plain_text: String,
  rich_text: Option<Value>,
  html_preview: Option<String>,
  notes_html: String,
  attachments: Vec<Value>,
  passthrough_value: Option<Value>,
}

#[derive(Deserialize)]
struct StoredChapterFile {
  chapter_id: String,
  title: String,
  #[serde(default = "active_lifecycle_state")]
  lifecycle: LifecycleState,
  #[serde(default)]
  source_files: Vec<StoredSourceFile>,
  #[serde(default)]
  languages: Vec<ChapterLanguage>,
  #[serde(default)]
  settings: Option<StoredChapterSettings>,
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
  default_source_language: Option<String>,
  default_target_language: Option<String>,
  default_preview_language: Option<String>,
}

#[derive(Deserialize)]
struct StoredRowFile {
  row_id: String,
  #[serde(default)]
  external_id: Option<String>,
  #[serde(default)]
  guidance: Option<StoredGuidance>,
  status: StoredRowStatus,
  origin: StoredRowOrigin,
  fields: BTreeMap<String, StoredFieldValue>,
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

#[tauri::command]
pub(crate) async fn import_xlsx_to_gtms(
  app: AppHandle,
  input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
  tauri::async_runtime::spawn_blocking(move || import_xlsx_to_gtms_sync(&app, input))
    .await
    .map_err(|error| format!("The XLSX import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_chapter_editor_data(
  app: AppHandle,
  input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
  tauri::async_runtime::spawn_blocking(move || load_gtms_chapter_editor_data_sync(&app, input))
    .await
    .map_err(|error| format!("The chapter load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gtms_project_files(
  app: AppHandle,
  input: ListLocalProjectFilesInput,
) -> Result<Vec<LocalProjectFilesResponse>, String> {
  tauri::async_runtime::spawn_blocking(move || list_local_gtms_project_files_sync(&app, input))
    .await
    .map_err(|error| format!("The local project file listing worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_language_selection(
  app: AppHandle,
  input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
  tauri::async_runtime::spawn_blocking(move || {
    update_gtms_chapter_language_selection_sync(&app, input)
  })
  .await
  .map_err(|error| format!("The chapter settings worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_gtms_chapter(
  app: AppHandle,
  input: RenameChapterInput,
) -> Result<RenameChapterResponse, String> {
  tauri::async_runtime::spawn_blocking(move || rename_gtms_chapter_sync(&app, input))
    .await
    .map_err(|error| format!("The chapter rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_chapter(
  app: AppHandle,
  input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
  tauri::async_runtime::spawn_blocking(move || {
    update_gtms_chapter_lifecycle_sync(&app, input, "deleted")
  })
  .await
  .map_err(|error| format!("The chapter delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_chapter(
  app: AppHandle,
  input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
  tauri::async_runtime::spawn_blocking(move || {
    update_gtms_chapter_lifecycle_sync(&app, input, "active")
  })
  .await
  .map_err(|error| format!("The chapter restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn permanently_delete_gtms_chapter(
  app: AppHandle,
  input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
  tauri::async_runtime::spawn_blocking(move || permanently_delete_gtms_chapter_sync(&app, input))
    .await
    .map_err(|error| format!("The chapter permanent delete worker failed: {error}"))?
}

fn import_xlsx_to_gtms_sync(
  app: &AppHandle,
  input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
  let parsed = parse_xlsx_workbook(input)?;
  let chapter_id = Uuid::now_v7();
  let repo_root = local_project_repo_root(app, parsed.installation_id)?;
  let repo_path = repo_root.join(&parsed.repo_name);
  if !repo_path.exists() {
    return Err(
      "The local project repo is not available yet. Refresh the Projects page first so the repo can be cloned."
        .to_string(),
    );
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

  if !git_output(&repo_path, &["status", "--porcelain"])?.trim().is_empty() {
    return Err(
      "The local project repo has uncommitted changes. Sync it before adding files."
        .to_string(),
    );
  }

  let project_json_path = repo_path.join("project.json");
  let project_file = read_project_file(&project_json_path)?;
  let project_title = project_file.title.clone();
  let chapter_slug = unique_chapter_slug(&repo_path.join("chapters"), &slugify(&parsed.file_title));
  let chapter_path = repo_path.join("chapters").join(&chapter_slug);
  let rows_path = chapter_path.join("rows");
  let assets_path = chapter_path.join("assets");

  fs::create_dir_all(&rows_path)
    .map_err(|error| format!("Could not create the imported rows folder: {error}"))?;
  fs::create_dir_all(&assets_path)
    .map_err(|error| format!("Could not create the imported assets folder: {error}"))?;

  ensure_gitattributes(&repo_path.join(".gitattributes"))?;

  let chapter_file = build_chapter_file(&parsed, &chapter_id, &chapter_slug);
  write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

  let row_order = build_row_order_and_files(&parsed, &rows_path)?;
  write_json_pretty(&chapter_path.join("rowOrder.json"), &row_order)?;

  git_output(&repo_path, &["add", ".gitattributes", "chapters"])?;
  git_output(
    &repo_path,
    &["commit", "-m", &format!("Import {}", parsed.source_file_name)],
  )?;

  let source_word_counts = build_source_word_counts_from_import(&parsed);
  let selected_source_language_code = parsed.languages.first().map(|language| language.code.clone());
  let selected_target_language_code = chapter_file.settings.default_preview_language.clone();

  Ok(ImportXlsxResponse {
    chapter_id: chapter_id.to_string(),
    repo_path: repo_path.display().to_string(),
    chapter_path: chapter_path.display().to_string(),
    project_title,
    file_title: parsed.file_title,
    worksheet_name: parsed.worksheet_name,
    unit_count: row_order.len(),
    languages: chapter_file.languages.clone(),
    source_word_counts,
    selected_source_language_code,
    selected_target_language_code,
    language_codes: parsed.languages.iter().map(|language| language.code.clone()).collect(),
    source_file_name: parsed.source_file_name,
  })
}

fn load_gtms_chapter_editor_data_sync(
  app: &AppHandle,
  input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let repo_path = repo_root.join(&input.repo_name);
  if !repo_path.exists() {
    return Err("The local project repo is not available yet.".to_string());
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_file: StoredChapterFile = read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
  let row_order: Vec<String> = read_json_file(&chapter_path.join("rowOrder.json"), "rowOrder.json")?;
  let rows = load_editor_rows(&chapter_path.join("rows"), &row_order)?;
  let languages = sanitize_chapter_languages(&chapter_file.languages);
  let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
  let selected_source_language_code = preferred_source_language_code(&chapter_file, &languages);
  let selected_target_language_code =
    preferred_target_language_code(&chapter_file, &languages, selected_source_language_code.as_deref());

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

fn list_local_gtms_project_files_sync(
  app: &AppHandle,
  input: ListLocalProjectFilesInput,
) -> Result<Vec<LocalProjectFilesResponse>, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let mut results = Vec::with_capacity(input.projects.len());

  for project in input.projects {
    let repo_path = repo_root.join(&project.repo_name);
    let chapters =
      if repo_path.exists() && git_output(&repo_path, &["rev-parse", "--git-dir"]).is_ok() {
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

fn parse_xlsx_workbook(input: ImportXlsxInput) -> Result<ParsedWorkbook, String> {
  if input.bytes.is_empty() {
    return Err("The selected file is empty.".to_string());
  }

  let mut workbook = open_workbook_auto_from_rs(Cursor::new(input.bytes))
    .map_err(|error| format!("Could not open the workbook: {error}"))?;
  let sheet_name = workbook
    .sheet_names()
    .first()
    .cloned()
    .ok_or_else(|| "The workbook does not contain any worksheets.".to_string())?;
  let range = workbook
    .worksheet_range_at(0)
    .ok_or_else(|| "The workbook does not contain any worksheets.".to_string())?
    .map_err(|error| format!("Could not read the first worksheet: {error}"))?;
  let header_row = range
    .rows()
    .next()
    .ok_or_else(|| "The workbook is missing a header row.".to_string())?;

  let header_blob = header_row
    .iter()
    .map(cell_to_trimmed_string)
    .collect::<Vec<_>>();
  let bindings = classify_header_row(&header_blob);
  let languages = bindings
    .iter()
    .filter_map(|binding| match binding {
      ColumnBinding::Language { code, name } => Some((code.clone(), name.clone())),
      _ => None,
    })
    .collect::<Vec<_>>();

  if languages.is_empty() {
    return Err(
      "Could not detect any language columns. Add headers like 'es', 'en', 'English', or 'Vietnamese'."
        .to_string(),
    );
  }

  let languages = languages
    .into_iter()
    .enumerate()
    .map(|(index, (code, name))| ImportedLanguage {
      code,
      name,
      role: if index == 0 { "source" } else { "target" },
    })
    .collect::<Vec<_>>();

  let mut rows = Vec::new();
  for (row_index, row) in range.rows().enumerate().skip(1) {
    let mut external_id = None;
    let mut description = None;
    let mut context = None;
    let mut comments = Vec::new();
    let mut fields = BTreeMap::new();

    for (column_index, binding) in bindings.iter().enumerate() {
      let value = row
        .get(column_index)
        .map(cell_to_trimmed_string)
        .unwrap_or_default();
      match binding {
        ColumnBinding::ExternalId if !value.is_empty() => external_id = Some(value),
        ColumnBinding::Description if !value.is_empty() => description = Some(value),
        ColumnBinding::Context if !value.is_empty() => context = Some(value),
        ColumnBinding::Comment { kind } if !value.is_empty() => comments.push(GuidanceComment {
          kind: kind.clone(),
          text: value,
        }),
        ColumnBinding::Language { code, .. } => {
          fields.insert(code.clone(), value);
        }
        ColumnBinding::Ignored
        | ColumnBinding::ExternalId
        | ColumnBinding::Description
        | ColumnBinding::Context
        | ColumnBinding::Comment { .. } => {}
      }
    }

    if row_is_empty(&external_id, &description, &context, &comments, &fields) {
      continue;
    }

    rows.push(ImportedRow {
      external_id,
      description,
      context,
      comments,
      source_row_number: row_index + 1,
      fields,
    });
  }

  Ok(ParsedWorkbook {
    installation_id: input.installation_id,
    repo_name: input.repo_name,
    file_title: humanize_file_stem(&input.file_name),
    worksheet_name: sheet_name,
    source_file_name: input.file_name,
    header_blob,
    languages,
    rows,
  })
}

fn build_chapter_file(
  parsed: &ParsedWorkbook,
  chapter_id: &Uuid,
  chapter_slug: &str,
) -> ChapterFile {
  let source_locale = parsed.languages.first().map(|language| language.code.clone());
  let target_locales = parsed
    .languages
    .iter()
    .skip(1)
    .map(|language| language.code.clone())
    .collect::<Vec<_>>();
  let mut serialization_hints = BTreeMap::new();
  serialization_hints.insert(
    "worksheet".to_string(),
    Value::String(parsed.worksheet_name.clone()),
  );

  ChapterFile {
    format: GTMS_FORMAT,
    format_version: GTMS_FORMAT_VERSION,
    app_version: env!("CARGO_PKG_VERSION").to_string(),
    chapter_id: chapter_id.to_string(),
    title: parsed.file_title.clone(),
    slug: chapter_slug.to_string(),
    lifecycle: active_lifecycle_state(),
    source_files: vec![SourceFile {
      file_id: "source-001".to_string(),
      format: "xlsx",
      path_hint: parsed.source_file_name.clone(),
      filename_template: parsed.source_file_name.clone(),
      file_metadata: SourceFileMetadata {
        source_locale,
        target_locales,
        header_blob: parsed.header_blob.clone(),
        root_language: None,
        wrapper_name: None,
        serialization_hints,
      },
    }],
    package_assets: Vec::new(),
    languages: parsed
      .languages
      .iter()
      .map(|language| ChapterLanguage {
        code: language.code.clone(),
        name: language.name.clone(),
        role: language.role.to_string(),
      })
      .collect(),
    settings: ChapterSettings {
      default_source_language: parsed.languages.first().map(|language| language.code.clone()),
      default_target_language: parsed.languages.last().map(|language| language.code.clone()),
      default_preview_language: parsed.languages.last().map(|language| language.code.clone()),
    },
  }
}

fn build_row_order_and_files(
  parsed: &ParsedWorkbook,
  rows_path: &Path,
) -> Result<Vec<String>, String> {
  let mut row_order = Vec::with_capacity(parsed.rows.len());

  for (index, imported_row) in parsed.rows.iter().enumerate() {
    let row_id = Uuid::now_v7().to_string();
    let row_file = build_row_file(parsed, imported_row, index, &row_id);
    write_json_pretty(&rows_path.join(format!("{row_id}.json")), &row_file)?;
    row_order.push(row_id);
  }

  Ok(row_order)
}

fn build_row_file(
  parsed: &ParsedWorkbook,
  imported_row: &ImportedRow,
  index: usize,
  row_id: &str,
) -> RowFile {
  let guidance = if imported_row.description.is_some()
    || imported_row.context.is_some()
    || !imported_row.comments.is_empty()
  {
    Some(Guidance {
      description: imported_row.description.clone(),
      context: imported_row.context.clone(),
      comments: imported_row.comments.clone(),
      source_references: Vec::new(),
    })
  } else {
    None
  };

  let mut container_path = BTreeMap::new();
  container_path.insert("sheet".to_string(), Value::String(parsed.worksheet_name.clone()));
  container_path.insert(
    "row".to_string(),
    Value::Number((imported_row.source_row_number as u64).into()),
  );

  let mut fields = BTreeMap::new();
  for language in &parsed.languages {
    let plain_text = imported_row
      .fields
      .get(&language.code)
      .cloned()
      .unwrap_or_default();
    fields.insert(
      language.code.clone(),
      FieldValue {
        value_kind: "text",
        plain_text: plain_text.clone(),
        rich_text: None,
        html_preview: html_preview(&plain_text),
        notes_html: String::new(),
        attachments: Vec::new(),
        passthrough_value: None,
      },
    );
  }

  let mut format_metadata = BTreeMap::new();
  format_metadata.insert(
    "xlsx".to_string(),
    json!({
      "source_sheet": parsed.worksheet_name,
      "source_row_number": imported_row.source_row_number,
    }),
  );

  RowFile {
    row_id: row_id.to_string(),
    unit_type: "string",
    external_id: imported_row.external_id.clone(),
    guidance,
    status: RowStatus {
      review_state: "unreviewed",
      reviewed_at: None,
      reviewed_by: None,
      flags: Vec::new(),
    },
    structure: RowStructure {
      source_file: parsed.source_file_name.clone(),
      container_path,
      order_index: index + 1,
      group_context: imported_row.context.clone(),
    },
    origin: RowOrigin {
      source_format: "xlsx",
      source_sheet: parsed.worksheet_name.clone(),
      source_row_number: imported_row.source_row_number,
    },
    format_state: FormatState {
      translatable: true,
      character_limit: None,
      tags: Vec::new(),
      source_state: None,
      custom_attributes: BTreeMap::new(),
    },
    placeholders: Vec::new(),
    variants: Vec::new(),
    fields,
    format_metadata,
  }
}

fn classify_header_row(headers: &[String]) -> Vec<ColumnBinding> {
  headers
    .iter()
    .map(|header| classify_header(header))
    .collect::<Vec<_>>()
}

fn classify_header(header: &str) -> ColumnBinding {
  let normalized = normalize_header(header);
  if normalized.is_empty() {
    return ColumnBinding::Ignored;
  }

  match normalized.as_str() {
    "row" | "row number" | "row id" => return ColumnBinding::Ignored,
    "key" | "id" | "identifier" | "string key" | "string id" | "resource key" => {
      return ColumnBinding::ExternalId;
    }
    "source label" | "source title" => return ColumnBinding::Description,
    "description" | "desc" => return ColumnBinding::Description,
    "context" => return ColumnBinding::Context,
    "comment" | "comments" | "note" | "notes" => {
      return ColumnBinding::Comment {
        kind: "imported".to_string(),
      };
    }
    "developer comment" | "developer note" => {
      return ColumnBinding::Comment {
        kind: "developer".to_string(),
      };
    }
    "translator comment" | "translator note" => {
      return ColumnBinding::Comment {
        kind: "translator".to_string(),
      };
    }
    _ => {}
  }

  let code = normalize_language_code(header);
  let name = language_display_name(header, &code);
  ColumnBinding::Language { code, name }
}

fn normalize_language_code(header: &str) -> String {
  let trimmed = header.trim();
  let lowercase = trimmed.to_lowercase();
  if looks_like_language_code(&lowercase) {
    return lowercase.replace('_', "-");
  }

  match normalize_header(trimmed).as_str() {
    "english" => "en".to_string(),
    "spanish" => "es".to_string(),
    "vietnamese" => "vi".to_string(),
    "french" => "fr".to_string(),
    "german" => "de".to_string(),
    "italian" => "it".to_string(),
    "portuguese" => "pt".to_string(),
    "brazilian portuguese" => "pt-br".to_string(),
    "japanese" => "ja".to_string(),
    "korean" => "ko".to_string(),
    "chinese" => "zh".to_string(),
    "traditional chinese" => "zh-hant".to_string(),
    "simplified chinese" => "zh-hans".to_string(),
    "thai" => "th".to_string(),
    "indonesian" => "id".to_string(),
    "russian" => "ru".to_string(),
    "arabic" => "ar".to_string(),
    "hindi" => "hi".to_string(),
    "turkish" => "tr".to_string(),
    "polish" => "pl".to_string(),
    "dutch" => "nl".to_string(),
    "ukrainian" => "uk".to_string(),
    _ => slugify(trimmed),
  }
}

fn language_display_name(header: &str, code: &str) -> String {
  let trimmed = header.trim();
  if !trimmed.is_empty() && !looks_like_language_code(trimmed) {
    return trimmed.to_string();
  }

  match code {
    "en" => "English".to_string(),
    "es" => "Spanish".to_string(),
    "vi" => "Vietnamese".to_string(),
    "fr" => "French".to_string(),
    "de" => "German".to_string(),
    "it" => "Italian".to_string(),
    "pt" => "Portuguese".to_string(),
    "pt-br" => "Brazilian Portuguese".to_string(),
    "ja" => "Japanese".to_string(),
    "ko" => "Korean".to_string(),
    "zh" => "Chinese".to_string(),
    "zh-hant" => "Traditional Chinese".to_string(),
    "zh-hans" => "Simplified Chinese".to_string(),
    "th" => "Thai".to_string(),
    "id" => "Indonesian".to_string(),
    "ru" => "Russian".to_string(),
    "ar" => "Arabic".to_string(),
    "hi" => "Hindi".to_string(),
    "tr" => "Turkish".to_string(),
    "pl" => "Polish".to_string(),
    "nl" => "Dutch".to_string(),
    "uk" => "Ukrainian".to_string(),
    _ => header.trim().to_string(),
  }
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

fn sanitize_chapter_languages(languages: &[ChapterLanguage]) -> Vec<ChapterLanguage> {
  let mut seen = BTreeMap::<String, ()>::new();
  let mut sanitized = Vec::new();

  for language in languages {
    if is_reserved_non_language_header(&language.code) || is_reserved_non_language_header(&language.name) {
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

fn looks_like_language_code(value: &str) -> bool {
  let bytes = value.as_bytes();
  if bytes.len() == 2 {
    return bytes.iter().all(|byte| byte.is_ascii_alphabetic());
  }

  if bytes.len() == 5 && bytes[2] == b'-' {
    return bytes[0..2].iter().all(|byte| byte.is_ascii_alphabetic())
      && bytes[3..5].iter().all(|byte| byte.is_ascii_alphabetic());
  }

  false
}

fn row_is_empty(
  external_id: &Option<String>,
  description: &Option<String>,
  context: &Option<String>,
  comments: &[GuidanceComment],
  fields: &BTreeMap<String, String>,
) -> bool {
  external_id.is_none()
    && description.is_none()
    && context.is_none()
    && comments.is_empty()
    && fields.values().all(|value| value.is_empty())
}

fn find_chapter_path_by_id(chapters_root: &Path, chapter_id: &str) -> Result<PathBuf, String> {
  let entries = fs::read_dir(chapters_root)
    .map_err(|error| format!("Could not read chapters folder '{}': {error}", chapters_root.display()))?;

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
    if chapter_file.chapter_id == chapter_id {
      return Ok(path);
    }
  }

  Err(format!("Could not find chapter '{chapter_id}' in the local project repo."))
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
    let row_order: Vec<String> = read_json_file(&path.join("rowOrder.json"), "rowOrder.json")?;
    let rows = load_editor_rows(&path.join("rows"), &row_order)?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
    let selected_source_language_code = preferred_source_language_code(&chapter_file, &languages);
    let selected_target_language_code =
      preferred_target_language_code(&chapter_file, &languages, selected_source_language_code.as_deref());

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
    });
  }

  Ok(chapters)
}

fn local_project_repo_root(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
  let root = app_data_dir
    .join("project-repos")
    .join(format!("installation-{installation_id}"));
  fs::create_dir_all(&root)
    .map_err(|error| format!("Could not create the local project repo folder: {error}"))?;
  Ok(root)
}

fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
  let text = fs::read_to_string(path)
    .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
  serde_json::from_str(&text)
    .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

fn read_project_file(project_json_path: &Path) -> Result<ProjectFile, String> {
  read_json_file(project_json_path, "project.json")
}

fn ensure_gitattributes(path: &Path) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }

  write_text_file(path, GTMS_GITATTRIBUTES)
}

fn load_editor_rows(rows_path: &Path, row_order: &[String]) -> Result<Vec<StoredRowFile>, String> {
  row_order
    .iter()
    .map(|row_id| read_json_file(&rows_path.join(format!("{row_id}.json")), "row file"))
    .collect()
}

fn update_gtms_chapter_language_selection_sync(
  app: &AppHandle,
  input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let repo_path = repo_root.join(&input.repo_name);
  if !repo_path.exists() {
    return Err("The local project repo is not available yet.".to_string());
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

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

  let source_changed =
    settings_object
      .get("default_source_language")
      .and_then(Value::as_str)
      != Some(input.source_language_code.as_str());
  let target_changed =
    settings_object
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

    let relative_chapter_json = chapter_json_path
      .strip_prefix(&repo_path)
      .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))?
      .to_string_lossy()
      .to_string();
    git_output(&repo_path, &["add", &relative_chapter_json])?;
    git_output(
      &repo_path,
      &[
        "commit",
        "-m",
        &format!("Update language selection for {}", chapter_title),
        "--",
        &relative_chapter_json,
      ],
    )?;
  }

  Ok(UpdateChapterLanguageSelectionResponse {
    chapter_id: input.chapter_id,
    source_language_code: input.source_language_code,
    target_language_code: input.target_language_code,
  })
}

fn rename_gtms_chapter_sync(
  app: &AppHandle,
  input: RenameChapterInput,
) -> Result<RenameChapterResponse, String> {
  let next_title = input.title.trim();
  if next_title.is_empty() {
    return Err("Enter a file name.".to_string());
  }

  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let repo_path = repo_root.join(&input.repo_name);
  if !repo_path.exists() {
    return Err("The local project repo is not available yet.".to_string());
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let current_title = chapter_object
    .get("title")
    .and_then(Value::as_str)
    .unwrap_or("")
    .trim()
    .to_string();

  if current_title == next_title {
    return Ok(RenameChapterResponse {
      chapter_id: input.chapter_id,
      title: next_title.to_string(),
    });
  }

  chapter_object.insert("title".to_string(), Value::String(next_title.to_string()));
  write_json_pretty(&chapter_json_path, &chapter_value)?;

  let relative_chapter_json = chapter_json_path
    .strip_prefix(&repo_path)
    .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))?
    .to_string_lossy()
    .to_string();
  git_output(&repo_path, &["add", &relative_chapter_json])?;
  git_output(
    &repo_path,
    &[
      "commit",
      "-m",
      &format!("Rename file to {}", next_title),
      "--",
      &relative_chapter_json,
    ],
  )?;

  Ok(RenameChapterResponse {
    chapter_id: input.chapter_id,
    title: next_title.to_string(),
  })
}

fn update_gtms_chapter_lifecycle_sync(
  app: &AppHandle,
  input: UpdateChapterLifecycleInput,
  next_state: &str,
) -> Result<UpdateChapterLifecycleResponse, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let repo_path = repo_root.join(&input.repo_name);
  if !repo_path.exists() {
    return Err("The local project repo is not available yet.".to_string());
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");

  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let lifecycle_value = chapter_object
    .entry("lifecycle".to_string())
    .or_insert_with(|| json!({ "state": "active" }));
  let lifecycle_object = lifecycle_value
    .as_object_mut()
    .ok_or_else(|| "The chapter lifecycle is not a JSON object.".to_string())?;
  let current_state = lifecycle_object
    .get("state")
    .and_then(Value::as_str)
    .unwrap_or("active")
    .to_string();

  if current_state == next_state {
    return Ok(UpdateChapterLifecycleResponse {
      chapter_id: input.chapter_id,
      lifecycle_state: next_state.to_string(),
    });
  }

  lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
  write_json_pretty(&chapter_json_path, &chapter_value)?;

  let relative_chapter_json = chapter_json_path
    .strip_prefix(&repo_path)
    .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))?
    .to_string_lossy()
    .to_string();
  git_output(&repo_path, &["add", &relative_chapter_json])?;
  let commit_action = if next_state == "deleted" {
    "Delete file"
  } else {
    "Restore file"
  };
  git_output(
    &repo_path,
    &["commit", "-m", commit_action, "--", &relative_chapter_json],
  )?;

  Ok(UpdateChapterLifecycleResponse {
    chapter_id: input.chapter_id,
    lifecycle_state: next_state.to_string(),
  })
}

fn permanently_delete_gtms_chapter_sync(
  app: &AppHandle,
  input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let repo_path = repo_root.join(&input.repo_name);
  if !repo_path.exists() {
    return Err("The local project repo is not available yet.".to_string());
  }

  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local project repo is missing or invalid.".to_string());
  }

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_lifecycle_state = chapter_value
    .get("lifecycle")
    .and_then(Value::as_object)
    .and_then(|lifecycle| lifecycle.get("state"))
    .and_then(Value::as_str)
    .unwrap_or("active");

  if chapter_lifecycle_state != "deleted" {
    return Err("Only soft-deleted files can be permanently deleted.".to_string());
  }
  let relative_chapter_path = chapter_path
    .strip_prefix(&repo_path)
    .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))?
    .to_string_lossy()
    .to_string();

  git_output(&repo_path, &["rm", "-r", &relative_chapter_path])?;
  git_output(
    &repo_path,
    &["commit", "-m", "Delete file permanently", "--", &relative_chapter_path],
  )?;

  Ok(UpdateChapterLifecycleResponse {
    chapter_id: input.chapter_id,
    lifecycle_state: "deleted".to_string(),
  })
}

fn unique_chapter_slug(chapters_root: &Path, base_slug: &str) -> String {
  let slug = if base_slug.trim().is_empty() {
    "untitled".to_string()
  } else {
    base_slug.trim().to_string()
  };

  if !chapters_root.join(&slug).exists() {
    return slug;
  }

  let mut index = 2usize;
  loop {
    let candidate = format!("{slug}-{index}");
    if !chapters_root.join(&candidate).exists() {
      return candidate;
    }
    index += 1;
  }
}

fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_path)
    .output()
    .map_err(|error| format!("Could not run git {}: {error}", args.join(" ")))?;

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

fn cell_to_trimmed_string(cell: &Data) -> String {
  let text = match cell {
    Data::Empty => String::new(),
    Data::Float(value) if value.fract().abs() < f64::EPSILON => format!("{value:.0}"),
    _ => cell.to_string(),
  };
  text.trim().to_string()
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

fn humanize_file_stem(file_name: &str) -> String {
  Path::new(file_name)
    .file_stem()
    .and_then(|stem| stem.to_str())
    .map(|stem| stem.trim())
    .filter(|stem| !stem.is_empty())
    .unwrap_or("Imported workbook")
    .to_string()
}

fn slugify(value: &str) -> String {
  let slug = value
    .trim()
    .to_lowercase()
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() {
        character
      } else {
        '-'
      }
    })
    .collect::<String>()
    .split('-')
    .filter(|segment| !segment.is_empty())
    .collect::<Vec<_>>()
    .join("-");

  if slug.is_empty() {
    "untitled".to_string()
  } else {
    slug
  }
}

fn html_preview(plain_text: &str) -> Option<String> {
  if plain_text.is_empty() {
    return None;
  }

  Some(format!("<p>{}</p>", escape_html(plain_text)))
}

fn build_source_word_counts_from_import(parsed: &ParsedWorkbook) -> BTreeMap<String, usize> {
  let mut counts = parsed
    .languages
    .iter()
    .map(|language| (language.code.clone(), 0usize))
    .collect::<BTreeMap<_, _>>();

  for row in &parsed.rows {
    for language in &parsed.languages {
      let value = row.fields.get(&language.code).map(String::as_str).unwrap_or("");
      *counts.entry(language.code.clone()).or_default() += count_words(value);
    }
  }

  counts
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

fn escape_html(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&#39;")
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
