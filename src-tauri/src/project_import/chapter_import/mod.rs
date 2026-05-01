use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::Path,
};

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use quick_xml::{events::Event, Reader as XmlReader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;
use zip::ZipArchive;

use crate::git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata};
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
    ensure_clean_git_repo, ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo,
    git_output, read_json_file, write_json_pretty,
};

mod languages;

use languages::{language_display_name, normalize_language_code};

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const ORDER_KEY_SPACING: u128 = 1u128 << 104;
const DOCX_MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;
const DOCX_MAX_XML_PART_BYTES: u64 = 20 * 1024 * 1024;
const DOCX_MAX_IMPORTED_ROWS: usize = 20_000;
const DOCX_MAX_ROW_TEXT_CHARS: usize = 20_000;
const DOCX_XML_EVENT_BUDGET: usize = 1_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportTxtInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
    source_language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportDocxInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
    source_language_code: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    import_summary: Option<DocxImportSummary>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocxImportSummary {
    imported_rows: usize,
    skipped_blank_paragraphs: usize,
    heading_count: usize,
    imported_footnotes: usize,
    flattened_list_items: usize,
    flattened_table_rows: usize,
    unsupported_content_counts: BTreeMap<String, usize>,
}

#[derive(Clone)]
struct ParsedWorkbook {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_title: String,
    worksheet_name: String,
    source_file_name: String,
    source_format: &'static str,
    header_blob: Vec<String>,
    languages: Vec<ImportedLanguage>,
    rows: Vec<ImportedRow>,
    import_summary: Option<DocxImportSummary>,
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
    fields: BTreeMap<String, ImportedField>,
    text_style: Option<String>,
    docx_metadata: Option<DocxRowMetadata>,
}

#[derive(Clone, Default)]
struct ImportedField {
    plain_text: String,
    footnote: String,
}

#[derive(Clone, Default)]
struct DocxRowMetadata {
    block_kind: &'static str,
    paragraph_number: usize,
    table_row_number: Option<usize>,
    list_item: bool,
    original_style: Option<String>,
    warning_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Debug)]
enum ColumnBinding {
    Language { code: String, name: String },
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
    text_style: Option<String>,
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
    footnote: String,
    rich_text: Option<Value>,
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
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_txt_to_gtms_sync(
    app: &AppHandle,
    input: ImportTxtInput,
) -> Result<ImportXlsxResponse, String> {
    let parsed = parse_txt_file(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_docx_to_gtms_sync(
    app: &AppHandle,
    input: ImportDocxInput,
) -> Result<ImportXlsxResponse, String> {
    let parsed = parse_docx_file(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

fn import_parsed_workbook_to_gtms_sync(
    app: &AppHandle,
    parsed: ParsedWorkbook,
) -> Result<ImportXlsxResponse, String> {
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
            ai_model: None,
        },
    )?;

    let source_word_counts = build_source_word_counts_from_import(&parsed);
    let selected_source_language_code = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
    let selected_target_language_code = chapter_file.settings.default_target_language.clone();

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
        import_summary: parsed.import_summary,
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
    let bindings = classify_header_row(&header_blob)?;
    let languages = bindings
        .iter()
        .map(|binding| match binding {
            ColumnBinding::Language { code, name } => (code.clone(), name.clone()),
        })
        .collect::<Vec<_>>();

    if languages.is_empty() {
        return Err(
      "Could not detect any language columns. Add ISO 639-1 two-letter language codes like 'es', 'en', or 'vi' to the first row."
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
        let external_id = None;
        let description = None;
        let context = None;
        let comments: Vec<GuidanceComment> = Vec::new();
        let mut fields = BTreeMap::new();

        for (column_index, binding) in bindings.iter().enumerate() {
            let value = row
                .get(column_index)
                .map(cell_to_trimmed_string)
                .unwrap_or_default();
            match binding {
                ColumnBinding::Language { code, .. } => {
                    fields.insert(code.clone(), split_xlsx_cell_text_and_footnote(&value));
                }
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
            text_style: None,
            docx_metadata: None,
        });
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: sheet_name,
        source_file_name: input.file_name,
        source_format: "xlsx",
        header_blob,
        languages,
        rows,
        import_summary: None,
    })
}

fn parse_txt_file(input: ImportTxtInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    let code = normalize_language_code(&input.source_language_code)
        .ok_or_else(|| "Select a valid ISO 639-1 source language.".to_string())?;
    let name = language_display_name(&code);
    let decoded = decode_text_file(&input.bytes)?;
    let mut rows = Vec::new();

    for (line_index, line) in decoded.lines().enumerate() {
        let plain_text = line.trim().to_string();
        if plain_text.is_empty() {
            continue;
        }

        let mut fields = BTreeMap::new();
        fields.insert(
            code.clone(),
            ImportedField {
                plain_text,
                footnote: String::new(),
            },
        );
        rows.push(ImportedRow {
            external_id: None,
            description: None,
            context: None,
            comments: Vec::new(),
            source_row_number: line_index + 1,
            fields,
            text_style: None,
            docx_metadata: None,
        });
    }

    if rows.is_empty() {
        return Err("The selected text file does not contain any non-blank lines.".to_string());
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: "Plain text".to_string(),
        source_file_name: input.file_name,
        source_format: "txt",
        header_blob: Vec::new(),
        languages: vec![ImportedLanguage {
            code,
            name,
            role: "source",
        }],
        rows,
        import_summary: None,
    })
}

fn parse_docx_file(input: ImportDocxInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }
    if input.bytes.len() > DOCX_MAX_FILE_BYTES {
        return Err("The selected DOCX file is too large to import.".to_string());
    }

    let code = normalize_language_code(&input.source_language_code)
        .ok_or_else(|| "Select a valid ISO 639-1 source language.".to_string())?;
    let name = language_display_name(&code);
    let mut archive = open_docx_archive(input.bytes)?;
    let footnotes = read_docx_footnotes(&mut archive)?;
    let document_xml = read_docx_xml_part(&mut archive, "word/document.xml", true)?
        .ok_or_else(|| "The DOCX file is missing word/document.xml.".to_string())?;
    let parsed_document = parse_docx_document_xml(&document_xml, &footnotes)?;

    if parsed_document.rows.is_empty() {
        return Err("The selected DOCX file does not contain any importable text.".to_string());
    }

    let mut rows = Vec::new();
    for parsed_row in parsed_document.rows {
        let mut fields = BTreeMap::new();
        fields.insert(
            code.clone(),
            ImportedField {
                plain_text: parsed_row.plain_text,
                footnote: parsed_row.footnote,
            },
        );
        rows.push(ImportedRow {
            external_id: None,
            description: None,
            context: None,
            comments: Vec::new(),
            source_row_number: parsed_row.source_position,
            fields,
            text_style: parsed_row.text_style,
            docx_metadata: Some(parsed_row.metadata),
        });
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: "DOCX".to_string(),
        source_file_name: input.file_name,
        source_format: "docx",
        header_blob: Vec::new(),
        languages: vec![ImportedLanguage {
            code,
            name,
            role: "source",
        }],
        rows,
        import_summary: Some(parsed_document.summary),
    })
}

#[derive(Default)]
struct ParsedDocxDocument {
    rows: Vec<ParsedDocxRow>,
    summary: DocxImportSummary,
}

struct ParsedDocxRow {
    plain_text: String,
    footnote: String,
    source_position: usize,
    text_style: Option<String>,
    metadata: DocxRowMetadata,
}

fn open_docx_archive(bytes: Vec<u8>) -> Result<ZipArchive<Cursor<Vec<u8>>>, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Could not open the DOCX file: {error}"))?;
    let mut total_uncompressed = 0u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| format!("Could not inspect the DOCX archive: {error}"))?;
        if file.encrypted() {
            return Err("Password-protected DOCX files are not supported.".to_string());
        }
        if file.enclosed_name().is_none() {
            return Err("The DOCX archive contains an unsafe file path.".to_string());
        }
        total_uncompressed = total_uncompressed.saturating_add(file.size());
        if total_uncompressed > DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err("The selected DOCX file expands to too much data.".to_string());
        }
        if file.name().ends_with(".xml") && file.size() > DOCX_MAX_XML_PART_BYTES {
            return Err(
                "The selected DOCX file contains an XML part that is too large.".to_string(),
            );
        }
    }
    Ok(archive)
}

fn read_docx_xml_part(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    part_name: &str,
    required: bool,
) -> Result<Option<String>, String> {
    let mut file = match archive.by_name(part_name) {
        Ok(file) => file,
        Err(_) if !required => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read '{part_name}' from the DOCX file: {error}"
            ))
        }
    };
    if file.size() > DOCX_MAX_XML_PART_BYTES {
        return Err(format!("The DOCX XML part '{part_name}' is too large."));
    }
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| format!("Could not decode '{part_name}' as XML text: {error}"))?;
    Ok(Some(text))
}

fn read_docx_footnotes(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
) -> Result<BTreeMap<String, String>, String> {
    let Some(xml) = read_docx_xml_part(archive, "word/footnotes.xml", false)? else {
        return Ok(BTreeMap::new());
    };
    parse_docx_notes_xml(&xml, "footnote")
}

fn parse_docx_notes_xml(
    xml: &str,
    note_element_name: &str,
) -> Result<BTreeMap<String, String>, String> {
    let mut reader = XmlReader::from_str(xml);
    reader.trim_text(false);
    let mut notes = BTreeMap::new();
    let mut current_id: Option<String> = None;
    let mut current_text = String::new();
    let mut in_text = false;
    let mut event_count = 0usize;

    loop {
        event_count += 1;
        if event_count > DOCX_XML_EVENT_BUDGET {
            return Err("The DOCX notes XML is too complex to import.".to_string());
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = local_xml_name(event.name().as_ref());
                if name == note_element_name {
                    current_id = xml_attribute_value(&event, "id")?;
                    current_text.clear();
                } else if current_id.is_some() && name == "t" {
                    in_text = true;
                } else if current_id.is_some() && name == "tab" {
                    current_text.push('\t');
                } else if current_id.is_some() && name == "br" {
                    current_text.push('\n');
                }
            }
            Ok(Event::Empty(event)) => {
                let name = local_xml_name(event.name().as_ref());
                if current_id.is_some() && name == "tab" {
                    current_text.push('\t');
                } else if current_id.is_some() && name == "br" {
                    current_text.push('\n');
                }
            }
            Ok(Event::Text(event)) if in_text => {
                current_text.push_str(
                    &event
                        .unescape()
                        .map_err(|error| format!("Could not decode DOCX note text: {error}"))?,
                );
            }
            Ok(Event::End(event)) => {
                let name = local_xml_name(event.name().as_ref());
                if name == "t" {
                    in_text = false;
                } else if name == note_element_name {
                    if let Some(id) = current_id.take() {
                        if !id.starts_with('-') {
                            let note_text = normalize_docx_text(&current_text);
                            if !note_text.is_empty() {
                                notes.insert(id, note_text);
                            }
                        }
                    }
                    current_text.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Could not parse DOCX notes XML: {error}")),
            _ => {}
        }
    }

    Ok(notes)
}

#[derive(Default)]
struct DocxParagraphState {
    text: String,
    footnotes: Vec<String>,
    original_style: Option<String>,
    text_style: Option<String>,
    is_list_item: bool,
    warning_counts: BTreeMap<String, usize>,
}

fn parse_docx_document_xml(
    xml: &str,
    footnotes: &BTreeMap<String, String>,
) -> Result<ParsedDocxDocument, String> {
    let mut reader = XmlReader::from_str(xml);
    reader.trim_text(false);
    let mut parsed = ParsedDocxDocument::default();
    let mut paragraph: Option<DocxParagraphState> = None;
    let mut in_text = false;
    let mut table_depth = 0usize;
    let mut table_cell_depth = 0usize;
    let mut current_cell_parts: Vec<String> = Vec::new();
    let mut current_row_cells: Vec<String> = Vec::new();
    let mut current_table_footnotes: Vec<String> = Vec::new();
    let mut paragraph_position = 0usize;
    let mut table_row_position = 0usize;
    let mut event_count = 0usize;

    loop {
        event_count += 1;
        if event_count > DOCX_XML_EVENT_BUDGET {
            return Err("The DOCX document XML is too complex to import.".to_string());
        }
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = local_xml_name(event.name().as_ref());
                match name.as_str() {
                    "p" => {
                        paragraph_position += 1;
                        paragraph = Some(DocxParagraphState::default());
                    }
                    "t" => {
                        if paragraph.is_some() {
                            in_text = true;
                        }
                    }
                    "tab" => append_to_docx_paragraph(&mut paragraph, "\t"),
                    "br" => append_to_docx_paragraph(&mut paragraph, "\n"),
                    "tbl" => table_depth += 1,
                    "tr" if table_depth > 0 => {
                        table_row_position += 1;
                        current_row_cells.clear();
                        current_table_footnotes.clear();
                    }
                    "tc" if table_depth > 0 => {
                        table_cell_depth += 1;
                        current_cell_parts.clear();
                    }
                    "pStyle" => apply_docx_paragraph_style(&mut paragraph, &event)?,
                    "numPr" => {
                        if let Some(paragraph) = paragraph.as_mut() {
                            paragraph.is_list_item = true;
                        }
                    }
                    "footnoteReference" => append_docx_footnote_reference(
                        &mut paragraph,
                        &mut current_table_footnotes,
                        &mut parsed.summary,
                        footnotes,
                        &event,
                        table_depth > 0,
                    )?,
                    "endnoteReference" => {
                        increment_docx_unsupported(&mut parsed.summary, "endnotes")
                    }
                    "commentReference" => {
                        increment_docx_unsupported(&mut parsed.summary, "comments")
                    }
                    "ins" | "del" => {
                        increment_docx_unsupported(&mut parsed.summary, "tracked_changes")
                    }
                    "drawing" | "pict" => {
                        increment_docx_unsupported(&mut parsed.summary, "embedded_images")
                    }
                    "txbxContent" => increment_docx_unsupported(&mut parsed.summary, "text_boxes"),
                    _ => {}
                }
            }
            Ok(Event::Empty(event)) => {
                let name = local_xml_name(event.name().as_ref());
                match name.as_str() {
                    "tab" => append_to_docx_paragraph(&mut paragraph, "\t"),
                    "br" => append_to_docx_paragraph(&mut paragraph, "\n"),
                    "pStyle" => apply_docx_paragraph_style(&mut paragraph, &event)?,
                    "footnoteReference" => append_docx_footnote_reference(
                        &mut paragraph,
                        &mut current_table_footnotes,
                        &mut parsed.summary,
                        footnotes,
                        &event,
                        table_depth > 0,
                    )?,
                    "endnoteReference" => {
                        increment_docx_unsupported(&mut parsed.summary, "endnotes")
                    }
                    "commentReference" => {
                        increment_docx_unsupported(&mut parsed.summary, "comments")
                    }
                    "drawing" | "pict" => {
                        increment_docx_unsupported(&mut parsed.summary, "embedded_images")
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(event)) if in_text => {
                append_to_docx_paragraph(
                    &mut paragraph,
                    &event
                        .unescape()
                        .map_err(|error| format!("Could not decode DOCX text: {error}"))?,
                );
            }
            Ok(Event::End(event)) => {
                let name = local_xml_name(event.name().as_ref());
                match name.as_str() {
                    "t" => in_text = false,
                    "p" => {
                        if let Some(paragraph) = paragraph.take() {
                            finish_docx_paragraph(
                                &mut parsed,
                                paragraph,
                                paragraph_position,
                                table_depth > 0,
                                &mut current_cell_parts,
                                &mut current_table_footnotes,
                            )?;
                        }
                    }
                    "tc" if table_depth > 0 => {
                        table_cell_depth = table_cell_depth.saturating_sub(1);
                        let cell_text = normalize_docx_text(&current_cell_parts.join("\n"));
                        current_row_cells.push(cell_text);
                        current_cell_parts.clear();
                    }
                    "tr" if table_depth > 0 => {
                        finish_docx_table_row(
                            &mut parsed,
                            table_row_position,
                            &current_row_cells,
                            &current_table_footnotes,
                        )?;
                        current_row_cells.clear();
                        current_table_footnotes.clear();
                    }
                    "tbl" => {
                        table_depth = table_depth.saturating_sub(1);
                        if table_depth == 0 {
                            table_cell_depth = 0;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Could not parse DOCX document XML: {error}")),
            _ => {}
        }
    }

    parsed.summary.imported_rows = parsed.rows.len();
    Ok(parsed)
}

fn local_xml_name(name: &[u8]) -> String {
    let local = name
        .iter()
        .rposition(|byte| *byte == b':')
        .map(|index| &name[index + 1..])
        .unwrap_or(name);
    String::from_utf8_lossy(local).to_string()
}

fn xml_attribute_value(
    event: &quick_xml::events::BytesStart<'_>,
    local_name: &str,
) -> Result<Option<String>, String> {
    for attribute in event.attributes() {
        let attribute =
            attribute.map_err(|error| format!("Could not read a DOCX XML attribute: {error}"))?;
        if local_xml_name(attribute.key.as_ref()) == local_name {
            return Ok(Some(
                String::from_utf8_lossy(attribute.value.as_ref()).to_string(),
            ));
        }
    }
    Ok(None)
}

fn append_to_docx_paragraph(paragraph: &mut Option<DocxParagraphState>, text: &str) {
    if let Some(paragraph) = paragraph.as_mut() {
        paragraph.text.push_str(text);
    }
}

fn apply_docx_paragraph_style(
    paragraph: &mut Option<DocxParagraphState>,
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<(), String> {
    let Some(paragraph) = paragraph.as_mut() else {
        return Ok(());
    };
    let Some(style) = xml_attribute_value(event, "val")? else {
        return Ok(());
    };
    paragraph.original_style = Some(style.clone());
    let normalized = style.to_ascii_lowercase();
    if normalized.starts_with("heading") || normalized == "title" {
        paragraph.text_style = Some("heading1".to_string());
    }
    if normalized.contains("list") {
        paragraph.is_list_item = true;
    }
    Ok(())
}

fn append_docx_footnote_reference(
    paragraph: &mut Option<DocxParagraphState>,
    _table_footnotes: &mut Vec<String>,
    summary: &mut DocxImportSummary,
    footnotes: &BTreeMap<String, String>,
    event: &quick_xml::events::BytesStart<'_>,
    in_table: bool,
) -> Result<(), String> {
    let Some(id) = xml_attribute_value(event, "id")? else {
        increment_docx_unsupported(summary, "footnotes");
        return Ok(());
    };
    let Some(text) = footnotes.get(&id).cloned() else {
        increment_docx_unsupported(summary, "footnotes");
        return Ok(());
    };
    summary.imported_footnotes += 1;
    let _ = in_table;
    if let Some(paragraph) = paragraph.as_mut() {
        paragraph.footnotes.push(text);
    }
    Ok(())
}

fn finish_docx_paragraph(
    parsed: &mut ParsedDocxDocument,
    paragraph: DocxParagraphState,
    paragraph_position: usize,
    in_table: bool,
    current_cell_parts: &mut Vec<String>,
    current_table_footnotes: &mut Vec<String>,
) -> Result<(), String> {
    let mut text = normalize_docx_text(&paragraph.text);
    if paragraph.is_list_item && !text.is_empty() && !text.starts_with("- ") {
        text = format!("- {text}");
    }
    let footnote = paragraph.footnotes.join("\n\n");
    if in_table {
        if !text.is_empty() {
            current_cell_parts.push(text);
        } else {
            parsed.summary.skipped_blank_paragraphs += 1;
        }
        if !footnote.is_empty() {
            current_table_footnotes.push(footnote);
        }
        return Ok(());
    }
    if text.is_empty() {
        parsed.summary.skipped_blank_paragraphs += 1;
        return Ok(());
    }
    ensure_docx_row_budget(parsed.rows.len(), &text)?;
    if paragraph.text_style.as_deref() == Some("heading1") {
        parsed.summary.heading_count += 1;
    }
    if paragraph.is_list_item {
        parsed.summary.flattened_list_items += 1;
    }
    parsed.rows.push(ParsedDocxRow {
        plain_text: text,
        footnote,
        source_position: paragraph_position,
        text_style: paragraph.text_style,
        metadata: DocxRowMetadata {
            block_kind: "paragraph",
            paragraph_number: paragraph_position,
            table_row_number: None,
            list_item: paragraph.is_list_item,
            original_style: paragraph.original_style,
            warning_counts: paragraph.warning_counts,
        },
    });
    Ok(())
}

fn finish_docx_table_row(
    parsed: &mut ParsedDocxDocument,
    table_row_position: usize,
    cells: &[String],
    footnotes: &[String],
) -> Result<(), String> {
    let text = cells
        .iter()
        .map(|cell| normalize_docx_text(cell))
        .filter(|cell| !cell.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    if text.is_empty() {
        parsed.summary.skipped_blank_paragraphs += 1;
        return Ok(());
    }
    ensure_docx_row_budget(parsed.rows.len(), &text)?;
    parsed.summary.flattened_table_rows += 1;
    parsed.rows.push(ParsedDocxRow {
        plain_text: text,
        footnote: footnotes.join("\n\n"),
        source_position: table_row_position,
        text_style: None,
        metadata: DocxRowMetadata {
            block_kind: "table_row",
            paragraph_number: table_row_position,
            table_row_number: Some(table_row_position),
            list_item: false,
            original_style: None,
            warning_counts: BTreeMap::new(),
        },
    });
    Ok(())
}

fn ensure_docx_row_budget(existing_rows: usize, text: &str) -> Result<(), String> {
    if existing_rows + 1 > DOCX_MAX_IMPORTED_ROWS {
        return Err("The DOCX file contains too many rows to import.".to_string());
    }
    if text.chars().count() > DOCX_MAX_ROW_TEXT_CHARS {
        return Err("The DOCX file contains a paragraph that is too long to import.".to_string());
    }
    Ok(())
}

fn normalize_docx_text(value: &str) -> String {
    value
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn increment_docx_unsupported(summary: &mut DocxImportSummary, key: &str) {
    *summary
        .unsupported_content_counts
        .entry(key.to_string())
        .or_insert(0) += 1;
}

fn decode_text_file(bytes: &[u8]) -> Result<String, String> {
    const ENCODING_ERROR: &str =
        "The text file encoding is not supported. Save it as UTF-8 or UTF-16 and try again.";

    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(&bytes[3..])
            .map(|value| value.to_string())
            .map_err(|_| ENCODING_ERROR.to_string());
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16_bytes(&bytes[2..], true).map_err(|_| ENCODING_ERROR.to_string());
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16_bytes(&bytes[2..], false).map_err(|_| ENCODING_ERROR.to_string());
    }

    std::str::from_utf8(bytes)
        .map(|value| value.to_string())
        .map_err(|_| ENCODING_ERROR.to_string())
}

fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> Result<String, ()> {
    if bytes.len() % 2 != 0 {
        return Err(());
    }

    let units = bytes.chunks_exact(2).map(|chunk| {
        if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        }
    });

    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|_| ())
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
    if parsed.source_format == "xlsx" {
        serialization_hints.insert(
            "worksheet".to_string(),
            Value::String(parsed.worksheet_name.clone()),
        );
    }
    if parsed.source_format == "docx" {
        if let Some(summary) = parsed.import_summary.as_ref() {
            serialization_hints.insert(
                "docx".to_string(),
                serde_json::to_value(summary).unwrap_or_else(|_| json!({})),
            );
        }
    }

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
            format: parsed.source_format,
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
            linked_glossaries: None,
            default_source_language: parsed
                .languages
                .first()
                .map(|language| language.code.clone()),
            default_target_language: if parsed.languages.len() > 1 {
                parsed
                    .languages
                    .last()
                    .map(|language| language.code.clone())
            } else {
                None
            },
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
                plain_text: plain_text.plain_text,
                footnote: plain_text.footnote,
                rich_text: None,
                notes_html: String::new(),
                attachments: Vec::new(),
                passthrough_value: None,
                editor_flags: FieldEditorFlags::default(),
            },
        );
    }

    let mut format_metadata = BTreeMap::new();
    if parsed.source_format == "xlsx" {
        format_metadata.insert(
            "xlsx".to_string(),
            json!({
              "source_sheet": parsed.worksheet_name.clone(),
              "source_row_number": imported_row.source_row_number,
            }),
        );
    } else if parsed.source_format == "txt" {
        format_metadata.insert(
            "txt".to_string(),
            json!({
              "source_line_number": imported_row.source_row_number,
            }),
        );
    } else if parsed.source_format == "docx" {
        if let Some(metadata) = imported_row.docx_metadata.as_ref() {
            format_metadata.insert(
                "docx".to_string(),
                json!({
                  "block_kind": metadata.block_kind,
                  "paragraph_number": metadata.paragraph_number,
                  "table_row_number": metadata.table_row_number,
                  "list_item": metadata.list_item,
                  "original_style": metadata.original_style,
                  "warning_counts": metadata.warning_counts,
                }),
            );
        }
    }

    Ok(RowFile {
        row_id: row_id.to_string(),
        unit_type: "string",
        text_style: imported_row.text_style.clone(),
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
            source_format: parsed.source_format,
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

fn classify_header_row(headers: &[String]) -> Result<Vec<ColumnBinding>, String> {
    if headers.is_empty() {
        return Err("The workbook is missing a header row.".to_string());
    }

    headers
        .iter()
        .enumerate()
        .map(|(index, header)| classify_header(header, index))
        .collect::<Result<Vec<_>, _>>()
}

fn classify_header(header: &str, column_index: usize) -> Result<ColumnBinding, String> {
    let code = normalize_language_code(header).ok_or_else(|| {
        format!(
            "Column {} must start with a valid ISO 639-1 two-letter language code.",
            column_index + 1
        )
    })?;
    let name = language_display_name(&code);
    Ok(ColumnBinding::Language { code, name })
}


fn row_is_empty(
    external_id: &Option<String>,
    description: &Option<String>,
    context: &Option<String>,
    comments: &[GuidanceComment],
    fields: &BTreeMap<String, ImportedField>,
) -> bool {
    external_id.is_none()
        && description.is_none()
        && context.is_none()
        && comments.is_empty()
        && fields
            .values()
            .all(|value| value.plain_text.is_empty() && value.footnote.is_empty())
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

fn split_xlsx_cell_text_and_footnote(value: &str) -> ImportedField {
    match value.split_once("***") {
        Some((plain_text, footnote)) => ImportedField {
            plain_text: plain_text.trim().to_string(),
            footnote: footnote.trim().to_string(),
        },
        None => ImportedField {
            plain_text: value.to_string(),
            footnote: String::new(),
        },
    }
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
                .map(|field| field.plain_text.as_str())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn txt_input(bytes: Vec<u8>, source_language_code: &str) -> ImportTxtInput {
        ImportTxtInput {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_name: "chapter.txt".to_string(),
            bytes,
            source_language_code: source_language_code.to_string(),
        }
    }

    fn docx_input(bytes: Vec<u8>, source_language_code: &str) -> ImportDocxInput {
        ImportDocxInput {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_name: "chapter.docx".to_string(),
            bytes,
            source_language_code: source_language_code.to_string(),
        }
    }

    fn minimal_docx(document_xml: &str, footnotes_xml: Option<&str>) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        writer
            .start_file("[Content_Types].xml", options)
            .expect("content types file should start");
        writer
            .write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#)
            .expect("content types should write");
        writer
            .start_file("word/document.xml", options)
            .expect("document file should start");
        writer
            .write_all(document_xml.as_bytes())
            .expect("document should write");
        if let Some(footnotes_xml) = footnotes_xml {
            writer
                .start_file("word/footnotes.xml", options)
                .expect("footnotes file should start");
            writer
                .write_all(footnotes_xml.as_bytes())
                .expect("footnotes should write");
        }
        writer
            .finish()
            .expect("docx zip should finish")
            .into_inner()
    }

    #[test]
    fn classify_header_row_accepts_iso_639_1_language_codes() {
        let bindings = classify_header_row(&["es".to_string(), "EN".to_string(), "vi".to_string()])
            .expect("valid ISO codes should be accepted");

        let codes = bindings
            .into_iter()
            .map(|binding| match binding {
                ColumnBinding::Language { code, .. } => code,
            })
            .collect::<Vec<_>>();

        assert_eq!(codes, vec!["es", "en", "vi"]);
    }

    #[test]
    fn classify_header_row_rejects_language_names() {
        let error = classify_header_row(&["Spanish".to_string(), "English".to_string()])
            .expect_err("language names should not pass XLSX import validation");

        assert!(error.contains("Column 1"));
        assert!(error.contains("ISO 639-1"));
    }

    #[test]
    fn classify_header_row_rejects_unknown_two_letter_codes() {
        let error = classify_header_row(&["es".to_string(), "zz".to_string()])
            .expect_err("unknown two-letter codes should not pass XLSX import validation");

        assert!(error.contains("Column 2"));
        assert!(error.contains("ISO 639-1"));
    }

    #[test]
    fn parse_txt_file_creates_one_row_per_non_blank_line() {
        let parsed = parse_txt_file(txt_input(
            b" first line \n\nsecond line\r\n   \nthird".to_vec(),
            "en",
        ))
        .expect("TXT import should parse non-blank lines");

        assert_eq!(parsed.source_format, "txt");
        assert_eq!(parsed.languages.len(), 1);
        assert_eq!(parsed.languages[0].code, "en");
        assert_eq!(parsed.languages[0].role, "source");
        assert_eq!(parsed.rows.len(), 3);
        assert_eq!(parsed.rows[0].source_row_number, 1);
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("en")
                .map(|field| field.plain_text.as_str()),
            Some("first line")
        );
        assert_eq!(parsed.rows[1].source_row_number, 3);
        assert_eq!(
            parsed.rows[1]
                .fields
                .get("en")
                .map(|field| field.plain_text.as_str()),
            Some("second line")
        );
        assert_eq!(parsed.rows[2].source_row_number, 5);
    }

    #[test]
    fn split_xlsx_cell_text_and_footnote_extracts_three_star_footnotes() {
        let field = split_xlsx_cell_text_and_footnote(
            "主の祈りShu no inori***This is the English version used to translate into Japanese.",
        );

        assert_eq!(field.plain_text, "主の祈りShu no inori");
        assert_eq!(
            field.footnote,
            "This is the English version used to translate into Japanese."
        );
    }

    #[test]
    fn build_row_file_writes_imported_footnotes() {
        let mut fields = BTreeMap::new();
        fields.insert(
            "ja".to_string(),
            ImportedField {
                plain_text: "主の祈りShu no inori".to_string(),
                footnote: "This is the English version used to translate into Japanese."
                    .to_string(),
            },
        );
        let parsed = ParsedWorkbook {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_title: "Chapter".to_string(),
            worksheet_name: "Sheet1".to_string(),
            source_file_name: "chapter.xlsx".to_string(),
            source_format: "xlsx",
            header_blob: vec!["ja".to_string()],
            languages: vec![ImportedLanguage {
                code: "ja".to_string(),
                name: "Japanese".to_string(),
                role: "source",
            }],
            rows: vec![ImportedRow {
                external_id: None,
                description: None,
                context: None,
                comments: Vec::new(),
                source_row_number: 2,
                fields,
                text_style: None,
                docx_metadata: None,
            }],
            import_summary: None,
        };

        let row = build_row_file(&parsed, &parsed.rows[0], 0, parsed.rows.len(), "row-1")
            .expect("row should build");
        let field = row.fields.get("ja").expect("Japanese field should exist");

        assert_eq!(field.plain_text, "主の祈りShu no inori");
        assert_eq!(
            field.footnote,
            "This is the English version used to translate into Japanese."
        );
    }

    #[test]
    fn parse_txt_file_rejects_blank_only_files() {
        let error = match parse_txt_file(txt_input(b"\n \r\n\t\n".to_vec(), "en")) {
            Ok(_) => panic!("blank-only TXT should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("non-blank lines"));
    }

    #[test]
    fn parse_txt_file_rejects_invalid_source_language() {
        let error = match parse_txt_file(txt_input(b"hello".to_vec(), "zz")) {
            Ok(_) => panic!("unknown source language should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("source language"));
    }

    #[test]
    fn parse_docx_file_normalizes_supported_structure() {
        let document_xml = r#"
          <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
              <w:p>
                <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
                <w:r><w:t>Chapter title</w:t></w:r>
              </w:p>
              <w:p>
                <w:r><w:t>Body text</w:t></w:r>
                <w:r><w:footnoteReference w:id="2"/></w:r>
              </w:p>
              <w:p>
                <w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>
                <w:r><w:t>List item</w:t></w:r>
              </w:p>
              <w:tbl>
                <w:tr>
                  <w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>
                  <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>
                </w:tr>
              </w:tbl>
            </w:body>
          </w:document>
        "#;
        let footnotes_xml = r#"
          <w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:footnote w:id="2"><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote>
          </w:footnotes>
        "#;
        let parsed = parse_docx_file(docx_input(
            minimal_docx(document_xml, Some(footnotes_xml)),
            "en",
        ))
        .expect("DOCX should parse");

        assert_eq!(parsed.source_format, "docx");
        assert_eq!(parsed.languages[0].code, "en");
        assert_eq!(parsed.rows.len(), 4);
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("en")
                .map(|field| field.plain_text.as_str()),
            Some("Chapter title")
        );
        assert_eq!(parsed.rows[0].text_style.as_deref(), Some("heading1"));
        assert_eq!(
            parsed.rows[1]
                .fields
                .get("en")
                .map(|field| field.footnote.as_str()),
            Some("Footnote text")
        );
        assert_eq!(
            parsed.rows[2]
                .fields
                .get("en")
                .map(|field| field.plain_text.as_str()),
            Some("- List item")
        );
        assert_eq!(
            parsed.rows[3]
                .fields
                .get("en")
                .map(|field| field.plain_text.as_str()),
            Some("A | B")
        );

        let summary = parsed.import_summary.expect("DOCX summary should exist");
        assert_eq!(summary.imported_rows, 4);
        assert_eq!(summary.heading_count, 1);
        assert_eq!(summary.imported_footnotes, 1);
        assert_eq!(summary.flattened_list_items, 1);
        assert_eq!(summary.flattened_table_rows, 1);
    }

    #[test]
    fn parse_docx_file_rejects_oversized_uploads_before_unzipping() {
        let error = match parse_docx_file(docx_input(vec![0; DOCX_MAX_FILE_BYTES + 1], "en")) {
            Ok(_) => panic!("oversized DOCX should be rejected"),
            Err(error) => error,
        };

        assert!(error.contains("too large"));
    }

    #[test]
    fn decode_text_file_accepts_utf8_with_and_without_bom() {
        assert_eq!(
            decode_text_file("hola\n世界".as_bytes()).unwrap(),
            "hola\n世界"
        );

        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("hola".as_bytes());
        assert_eq!(decode_text_file(&bytes).unwrap(), "hola");
    }

    #[test]
    fn decode_text_file_accepts_utf16_bom() {
        let text = "hola\n世界";
        let mut little_endian = vec![0xFF, 0xFE];
        for unit in text.encode_utf16() {
            little_endian.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_text_file(&little_endian).unwrap(), text);

        let mut big_endian = vec![0xFE, 0xFF];
        for unit in text.encode_utf16() {
            big_endian.extend_from_slice(&unit.to_be_bytes());
        }
        assert_eq!(decode_text_file(&big_endian).unwrap(), text);
    }

    #[test]
    fn decode_text_file_rejects_unsupported_or_invalid_encoding() {
        let error = decode_text_file(&[0xFF, 0xFE, 0x00])
            .expect_err("odd-length UTF-16 should be rejected");
        assert!(error.contains("UTF-8 or UTF-16"));

        let error = decode_text_file(&[0xFF, 0xFF, 0xFF])
            .expect_err("invalid UTF-8 without a supported BOM should be rejected");
        assert!(error.contains("UTF-8 or UTF-16"));
    }

    #[test]
    fn build_txt_chapter_metadata_has_source_language_without_target() {
        let parsed = parse_txt_file(txt_input(b"one two\nthree".to_vec(), "en"))
            .expect("TXT import should parse");
        let chapter_id = Uuid::now_v7();
        let chapter = build_chapter_file(&parsed, &chapter_id, "chapter");
        let row = build_row_file(&parsed, &parsed.rows[0], 0, parsed.rows.len(), "row-1")
            .expect("row should build");
        let counts = build_source_word_counts_from_import(&parsed);

        assert_eq!(chapter.source_files[0].format, "txt");
        assert_eq!(chapter.languages.len(), 1);
        assert_eq!(
            chapter.settings.default_source_language.as_deref(),
            Some("en")
        );
        assert_eq!(chapter.settings.default_target_language, None);
        assert_eq!(row.origin.source_format, "txt");
        assert!(row.format_metadata.contains_key("txt"));
        assert_eq!(counts.get("en"), Some(&3));
    }
}
