use std::{collections::BTreeMap, fs, io::Cursor, path::Path};

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata};
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
    ensure_clean_git_repo, ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo,
    git_output, read_json_file, write_json_pretty,
};

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const ORDER_KEY_SPACING: u128 = 1u128 << 104;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
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

#[derive(Clone)]
struct ParsedWorkbook {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
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

#[derive(Deserialize)]
struct ProjectFile {
    title: String,
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
    lifecycle: LifecycleState,
    source_files: Vec<SourceFile>,
    package_assets: Vec<Value>,
    languages: Vec<ChapterLanguage>,
    source_word_counts: BTreeMap<String, usize>,
    #[serde(default)]
    settings: ChapterSettings,
}

#[derive(Serialize, Deserialize)]
struct LifecycleState {
    state: String,
}

fn active_lifecycle_state() -> LifecycleState {
    LifecycleState {
        state: "active".to_string(),
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    linked_glossaries: Option<ChapterLinkedGlossaries>,
    #[serde(default)]
    default_source_language: Option<String>,
    #[serde(default)]
    default_target_language: Option<String>,
    #[serde(default)]
    default_preview_language: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ChapterLinkedGlossaries {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    glossary: Option<ChapterGlossaryLink>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterGlossaryLink {
    glossary_id: String,
    repo_name: String,
}

#[derive(Serialize)]
struct RowFile {
    row_id: String,
    unit_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    guidance: Option<Guidance>,
    lifecycle: LifecycleState,
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
    order_key: String,
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
    editor_flags: FieldEditorFlags,
}

#[derive(Serialize, Default)]
struct FieldEditorFlags {
    reviewed: bool,
    please_check: bool,
}

pub(super) fn import_xlsx_to_gtms_sync(
    app: &AppHandle,
    input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
    let parsed = parse_xlsx_workbook(input)?;
    let chapter_id = Uuid::now_v7();
    let repo_path = resolve_project_git_repo_path(
        app,
        parsed.installation_id,
        parsed.project_id.as_deref(),
        Some(&parsed.repo_name),
    )?;
    ensure_repo_exists(
    &repo_path,
    "The local project repo is not available yet. Refresh the Projects page first so the repo can be cloned.",
  )?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    ensure_clean_git_repo(
        &repo_path,
        "The local project repo has uncommitted changes. Sync it before adding files.",
    )?;

    let project_title = read_project_title(&repo_path.join("project.json"))?;
    let chapter_slug =
        unique_chapter_slug(&repo_path.join("chapters"), &slugify(&parsed.file_title));
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

    let unit_count = write_row_files(&parsed, &rows_path)?;

    git_output(&repo_path, &["add", ".gitattributes", "chapters"])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Import {}", parsed.source_file_name),
        &[],
        GitCommitMetadata {
            operation: Some("import"),
            status_note: None,
        },
    )?;

    let source_word_counts = build_source_word_counts_from_import(&parsed);
    let selected_source_language_code = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
    let selected_target_language_code = chapter_file.settings.default_preview_language.clone();

    Ok(ImportXlsxResponse {
        chapter_id: chapter_id.to_string(),
        repo_path: repo_path.display().to_string(),
        chapter_path: chapter_path.display().to_string(),
        project_title,
        file_title: parsed.file_title,
        worksheet_name: parsed.worksheet_name,
        unit_count,
        languages: chapter_file.languages.clone(),
        source_word_counts,
        selected_source_language_code,
        selected_target_language_code,
        language_codes: parsed
            .languages
            .iter()
            .map(|language| language.code.clone())
            .collect(),
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
                ColumnBinding::Comment { kind } if !value.is_empty() => {
                    comments.push(GuidanceComment {
                        kind: kind.clone(),
                        text: value,
                    })
                }
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
        project_id: input.project_id,
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
    let source_locale = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
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
        source_word_counts: build_source_word_counts_from_import(parsed),
        settings: ChapterSettings {
            linked_glossaries: None,
            default_source_language: parsed
                .languages
                .first()
                .map(|language| language.code.clone()),
            default_target_language: parsed
                .languages
                .last()
                .map(|language| language.code.clone()),
            default_preview_language: parsed
                .languages
                .last()
                .map(|language| language.code.clone()),
        },
    }
}

fn write_row_files(parsed: &ParsedWorkbook, rows_path: &Path) -> Result<usize, String> {
    let total_rows = parsed.rows.len();

    for (index, imported_row) in parsed.rows.iter().enumerate() {
        let row_id = Uuid::now_v7().to_string();
        let row_file = build_row_file(parsed, imported_row, index, total_rows, &row_id)?;
        write_json_pretty(&rows_path.join(format!("{row_id}.json")), &row_file)?;
    }

    Ok(total_rows)
}

fn build_row_file(
    parsed: &ParsedWorkbook,
    imported_row: &ImportedRow,
    index: usize,
    total_rows: usize,
    row_id: &str,
) -> Result<RowFile, String> {
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
    container_path.insert(
        "sheet".to_string(),
        Value::String(parsed.worksheet_name.clone()),
    );
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
                editor_flags: FieldEditorFlags::default(),
            },
        );
    }

    let mut format_metadata = BTreeMap::new();
    format_metadata.insert(
        "xlsx".to_string(),
        json!({
          "source_sheet": parsed.worksheet_name.clone(),
          "source_row_number": imported_row.source_row_number,
        }),
    );

    Ok(RowFile {
        row_id: row_id.to_string(),
        unit_type: "string",
        external_id: imported_row.external_id.clone(),
        guidance,
        lifecycle: active_lifecycle_state(),
        status: RowStatus {
            review_state: "unreviewed",
            reviewed_at: None,
            reviewed_by: None,
            flags: Vec::new(),
        },
        structure: RowStructure {
            source_file: parsed.source_file_name.clone(),
            container_path,
            order_key: order_key_for_position(index, total_rows)?,
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
    })
}

fn order_key_for_position(index: usize, total_rows: usize) -> Result<String, String> {
    if index >= total_rows {
        return Err("Could not assign an order key outside the row set.".to_string());
    }

    let position = u128::try_from(index)
        .map_err(|error| format!("Could not convert the row position to an order key: {error}"))?
        + 1;
    let value = position
        .checked_mul(ORDER_KEY_SPACING)
        .ok_or_else(|| "Could not allocate a sparse order key for this row.".to_string())?;

    Ok(format!("{value:032x}"))
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

fn cell_to_trimmed_string(cell: &Data) -> String {
    let text = match cell {
        Data::Empty => String::new(),
        Data::Float(value) if value.fract().abs() < f64::EPSILON => format!("{value:.0}"),
        _ => cell.to_string(),
    };
    text.trim().to_string()
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

fn build_source_word_counts_from_import(parsed: &ParsedWorkbook) -> BTreeMap<String, usize> {
    let mut counts = parsed
        .languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();

    for row in &parsed.rows {
        for language in &parsed.languages {
            let value = row
                .fields
                .get(&language.code)
                .map(String::as_str)
                .unwrap_or("");
            *counts.entry(language.code.clone()).or_default() += count_words(value);
        }
    }

    counts
}

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .count()
}

fn read_project_title(project_json_path: &Path) -> Result<String, String> {
    let project_file: ProjectFile = read_json_file(project_json_path, "project.json")?;
    Ok(project_file.title)
}
