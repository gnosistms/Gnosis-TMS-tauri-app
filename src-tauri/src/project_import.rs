use std::{
  collections::BTreeMap,
  fs,
  io::Cursor,
  path::{Path, PathBuf},
};

use calamine::{open_workbook_auto_from_rs, Data, Reader};
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
  file_name: String,
  bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxResponse {
  project_path: String,
  chapter_path: String,
  project_title: String,
  chapter_title: String,
  unit_count: usize,
  language_codes: Vec<String>,
  source_file_name: String,
}

#[derive(Clone)]
struct ParsedWorkbook {
  project_title: String,
  chapter_title: String,
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

#[derive(Serialize)]
struct ProjectFile {
  project_id: String,
  title: String,
  chapter_order: Vec<String>,
}

#[derive(Serialize)]
struct ChapterFile {
  format: &'static str,
  format_version: u32,
  #[serde(rename = "appVersion")]
  app_version: String,
  chapter_id: String,
  title: String,
  slug: String,
  source_files: Vec<SourceFile>,
  package_assets: Vec<Value>,
  languages: Vec<ChapterLanguage>,
  settings: ChapterSettings,
}

#[derive(Serialize)]
struct SourceFile {
  file_id: String,
  format: &'static str,
  path_hint: String,
  filename_template: String,
  file_metadata: SourceFileMetadata,
}

#[derive(Serialize)]
struct SourceFileMetadata {
  source_locale: Option<String>,
  target_locales: Vec<String>,
  header_blob: Vec<String>,
  root_language: Option<String>,
  wrapper_name: Option<String>,
  serialization_hints: BTreeMap<String, Value>,
}

#[derive(Serialize)]
struct ChapterLanguage {
  code: String,
  name: String,
  role: String,
}

#[derive(Serialize)]
struct ChapterSettings {
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

#[tauri::command]
pub(crate) async fn import_xlsx_to_gtms(
  app: AppHandle,
  input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
  tauri::async_runtime::spawn_blocking(move || import_xlsx_to_gtms_sync(&app, input))
    .await
    .map_err(|error| format!("The XLSX import worker failed: {error}"))?
}

fn import_xlsx_to_gtms_sync(
  app: &AppHandle,
  input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
  let parsed = parse_xlsx_workbook(input)?;
  let project_id = Uuid::now_v7();
  let chapter_id = Uuid::now_v7();
  let project_slug = slugify(&parsed.project_title);
  let chapter_slug = format!("01-{}", slugify(&parsed.chapter_title));
  let project_dir_name = format!("{project_slug}-{project_id}");
  let base_dir = local_projects_root(app)?;
  let project_path = base_dir.join(project_dir_name);
  let chapter_path = project_path.join("chapters").join(&chapter_slug);
  let rows_path = chapter_path.join("rows");
  let assets_path = chapter_path.join("assets");

  fs::create_dir_all(&rows_path)
    .map_err(|error| format!("Could not create the imported rows folder: {error}"))?;
  fs::create_dir_all(&assets_path)
    .map_err(|error| format!("Could not create the imported assets folder: {error}"))?;

  write_text_file(&project_path.join(".gitattributes"), GTMS_GITATTRIBUTES)?;

  let project_file = ProjectFile {
    project_id: project_id.to_string(),
    title: parsed.project_title.clone(),
    chapter_order: vec![chapter_id.to_string()],
  };
  write_json_pretty(&project_path.join("project.json"), &project_file)?;

  let chapter_file = build_chapter_file(&parsed, &chapter_id, &chapter_slug);
  write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

  let row_order = build_row_order_and_files(&parsed, &rows_path)?;
  write_json_pretty(&chapter_path.join("rowOrder.json"), &row_order)?;

  Ok(ImportXlsxResponse {
    project_path: project_path.display().to_string(),
    chapter_path: chapter_path.display().to_string(),
    project_title: parsed.project_title,
    chapter_title: parsed.chapter_title,
    unit_count: row_order.len(),
    language_codes: parsed.languages.iter().map(|language| language.code.clone()).collect(),
    source_file_name: parsed.source_file_name,
  })
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
    project_title: humanize_file_stem(&input.file_name),
    chapter_title: sheet_name,
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
    Value::String(parsed.chapter_title.clone()),
  );

  ChapterFile {
    format: GTMS_FORMAT,
    format_version: GTMS_FORMAT_VERSION,
    app_version: env!("CARGO_PKG_VERSION").to_string(),
    chapter_id: chapter_id.to_string(),
    title: parsed.chapter_title.clone(),
    slug: chapter_slug.to_string(),
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
  container_path.insert("sheet".to_string(), Value::String(parsed.chapter_title.clone()));
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
      "source_sheet": parsed.chapter_title,
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
      source_sheet: parsed.chapter_title.clone(),
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
    "key" | "id" | "identifier" | "string key" | "string id" | "resource key" => {
      return ColumnBinding::ExternalId;
    }
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

fn local_projects_root(app: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
  let root = app_data_dir.join("local-projects");
  fs::create_dir_all(&root)
    .map_err(|error| format!("Could not create the local projects folder: {error}"))?;
  Ok(root)
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
