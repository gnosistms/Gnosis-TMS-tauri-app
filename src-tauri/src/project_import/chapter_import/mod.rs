use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::constants::ensure_within_import_size_limit;

mod docx;
mod html;
pub(crate) mod languages;
mod txt;
mod write_gtms;
mod xlsx;

use docx::{parse_docx_file, DocxImportSummary, DocxRowMetadata};
use html::{parse_html_file, HtmlRowMetadata};
#[cfg(test)]
use std::io::Cursor;
#[cfg(test)]
use txt::decode_text_file;
use txt::parse_txt_file;
use uuid::Uuid;
#[cfg(test)]
use write_gtms::{build_chapter_file, build_row_file, build_word_counts_from_import};
use write_gtms::{
    commit_written_imports, import_parsed_workbook_to_gtms_sync, prepare_project_import_repo,
    write_parsed_workbook_chapter, ProjectImportRepoContext, WrittenImport,
};
use xlsx::parse_xlsx_workbook;
#[cfg(test)]
use xlsx::{classify_header_row, split_xlsx_cell_text_and_footnote, ColumnBinding};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxInput {
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportTxtInput {
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
    source_language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportDocxInput {
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
    source_language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportHtmlInput {
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
    source_language_code: String,
    source_url: String,
    source_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFilesInput {
    batch_id: String,
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    files: Vec<ImportProjectFileInput>,
    default_glossary: Option<ImportProjectDefaultGlossaryInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportProjectFileInput {
    file_name: String,
    file_type: String,
    bytes: Option<Vec<u8>>,
    source_path: Option<String>,
    source_language_code: Option<String>,
    source_url: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectDefaultGlossaryInput {
    glossary_id: String,
    repo_name: String,
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
    word_counts: BTreeMap<String, usize>,
    selected_source_language_code: Option<String>,
    selected_target_language_code: Option<String>,
    language_codes: Vec<String>,
    source_file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    import_summary: Option<DocxImportSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFilesResponse {
    imported: Vec<ImportXlsxResponse>,
    failed_files: Vec<ImportProjectFileFailure>,
    failed_file_names: Vec<String>,
    canceled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFileFailure {
    file_name: String,
    error: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProjectBatchProgress {
    batch_id: String,
    current: usize,
    total: usize,
    file_name: String,
}

const PROJECT_IMPORT_BATCH_PROGRESS_EVENT: &str = "project-import-batch-progress";

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
    base_code: Option<String>,
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
    html_metadata: Option<HtmlRowMetadata>,
}

#[derive(Clone, Default)]
struct ImportedField {
    plain_text: String,
    footnote: String,
    image_caption: String,
    image: Option<ImportedFieldImage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFieldImage {
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip)]
    pending_upload: Option<ImportedImageUpload>,
}

#[derive(Clone)]
struct ImportedImageUpload {
    filename: String,
    bytes: Vec<u8>,
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
    #[serde(default, rename = "baseCode", skip_serializing_if = "Option::is_none")]
    base_code: Option<String>,
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
    image_caption: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<ImportedFieldImage>,
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
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
    let parsed = parse_xlsx_workbook(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_txt_to_gtms_sync(
    app: &AppHandle,
    input: ImportTxtInput,
) -> Result<ImportXlsxResponse, String> {
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
    let parsed = parse_txt_file(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_docx_to_gtms_sync(
    app: &AppHandle,
    input: ImportDocxInput,
) -> Result<ImportXlsxResponse, String> {
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
    let parsed = parse_docx_file(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_html_to_gtms_sync(
    app: &AppHandle,
    input: ImportHtmlInput,
) -> Result<ImportXlsxResponse, String> {
    ensure_within_import_size_limit(input.bytes.len() as u64, &input.file_name)?;
    let parsed = parse_html_file(input)?;
    import_parsed_workbook_to_gtms_sync(app, parsed)
}

pub(super) fn import_project_files_to_gtms_sync(
    app: &AppHandle,
    canceled_batch_ids: Arc<Mutex<BTreeSet<String>>>,
    input: ImportProjectFilesInput,
) -> Result<ImportProjectFilesResponse, String> {
    let batch_id = normalized_batch_id(&input.batch_id);

    let installation_id = input.installation_id;
    let repo_name = input.repo_name.clone();
    let project_id = input.project_id.clone();
    let default_glossary = input.default_glossary.clone();
    let files = input.files;
    let context =
        prepare_project_import_repo(app, installation_id, project_id.as_deref(), &repo_name)?;
    let total = files.len();
    let mut failed_files = Vec::new();
    let mut parsed_workbooks = Vec::new();
    let mut canceled = false;

    for (index, file) in files.into_iter().enumerate() {
        if batch_import_canceled(&canceled_batch_ids, &batch_id)? {
            canceled = true;
            break;
        }

        emit_batch_progress(app, &batch_id, index + 1, total, &file.file_name);
        match parse_project_import_file(installation_id, &repo_name, project_id.clone(), file) {
            Ok(parsed) => parsed_workbooks.push(parsed),
            Err(error) => failed_files.push(ImportProjectFileFailure {
                file_name: error_file_name(&error),
                error,
            }),
        }
    }

    let mut written = Vec::new();
    for parsed in parsed_workbooks {
        if batch_import_canceled(&canceled_batch_ids, &batch_id)? {
            canceled = true;
            break;
        }

        match write_parsed_workbook_chapter(&context, parsed, default_glossary.as_ref()) {
            Ok(entry) => written.push(entry),
            Err(error) => {
                cleanup_written_imports(&context, &written, true)?;
                clear_batch_cancellation(&canceled_batch_ids, &batch_id)?;
                return Err(error);
            }
        }
    }

    if !written.is_empty() {
        let relative_paths = written
            .iter()
            .map(|entry| entry.relative_chapter_path.clone())
            .collect::<Vec<_>>();
        if let Err(error) = commit_written_imports(
            app,
            &context,
            &relative_paths,
            &batch_import_commit_message(written.len()),
        ) {
            cleanup_written_imports(&context, &written, true)?;
            clear_batch_cancellation(&canceled_batch_ids, &batch_id)?;
            return Err(error);
        }
    }

    clear_batch_cancellation(&canceled_batch_ids, &batch_id)?;

    let failed_file_names = failed_files
        .iter()
        .map(|failure| failure.file_name.clone())
        .collect();
    Ok(ImportProjectFilesResponse {
        imported: written.into_iter().map(|entry| entry.response).collect(),
        failed_files,
        failed_file_names,
        canceled,
    })
}

fn normalized_batch_id(batch_id: &str) -> String {
    let trimmed = batch_id.trim();
    if trimmed.is_empty() {
        Uuid::now_v7().to_string()
    } else {
        trimmed.to_string()
    }
}

fn emit_batch_progress(
    app: &AppHandle,
    batch_id: &str,
    current: usize,
    total: usize,
    file_name: &str,
) {
    let _ = app.emit(
        PROJECT_IMPORT_BATCH_PROGRESS_EVENT,
        ImportProjectBatchProgress {
            batch_id: batch_id.to_string(),
            current,
            total,
            file_name: file_name.to_string(),
        },
    );
}

fn batch_import_canceled(
    canceled_batch_ids: &Arc<Mutex<BTreeSet<String>>>,
    batch_id: &str,
) -> Result<bool, String> {
    Ok(canceled_batch_ids
        .lock()
        .map_err(|_| "The project import cancellation state is unavailable.".to_string())?
        .contains(batch_id))
}

fn clear_batch_cancellation(
    canceled_batch_ids: &Arc<Mutex<BTreeSet<String>>>,
    batch_id: &str,
) -> Result<(), String> {
    canceled_batch_ids
        .lock()
        .map_err(|_| "The project import cancellation state is unavailable.".to_string())?
        .remove(batch_id);
    Ok(())
}

fn batch_import_commit_message(imported_count: usize) -> String {
    if imported_count == 1 {
        "Import 1 file".to_string()
    } else {
        format!("Import {imported_count} files")
    }
}

fn parse_project_import_file(
    installation_id: i64,
    repo_name: &str,
    project_id: Option<String>,
    file: ImportProjectFileInput,
) -> Result<ParsedWorkbook, String> {
    let file_name = file.file_name.trim().to_string();
    if file_name.is_empty() {
        return Err("Import file is missing a file name.".to_string());
    }
    let bytes = import_project_file_bytes(&file)?;
    match file.file_type.trim().to_ascii_lowercase().as_str() {
        "xlsx" => parse_xlsx_workbook(ImportXlsxInput {
            installation_id,
            repo_name: repo_name.to_string(),
            project_id: project_id.clone(),
            file_name: file_name.clone(),
            bytes,
        }),
        "txt" => parse_txt_file(ImportTxtInput {
            installation_id,
            repo_name: repo_name.to_string(),
            project_id: project_id.clone(),
            file_name: file_name.clone(),
            bytes,
            source_language_code: required_source_language_code(&file)?,
        }),
        "docx" => parse_docx_file(ImportDocxInput {
            installation_id,
            repo_name: repo_name.to_string(),
            project_id: project_id.clone(),
            file_name: file_name.clone(),
            bytes,
            source_language_code: required_source_language_code(&file)?,
        }),
        "html" => parse_html_file(ImportHtmlInput {
            installation_id,
            repo_name: repo_name.to_string(),
            project_id,
            file_name: file_name.clone(),
            bytes,
            source_language_code: required_source_language_code(&file)?,
            source_url: file.source_url.unwrap_or_default(),
            source_path: file.source_path,
        }),
        _ => Err(format!("Unsupported file type for {file_name}.")),
    }
    .map_err(|error| format!("{file_name}: {error}"))
}

fn required_source_language_code(file: &ImportProjectFileInput) -> Result<String, String> {
    file.source_language_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Select a source language before importing this file.".to_string())
}

fn import_project_file_bytes(file: &ImportProjectFileInput) -> Result<Vec<u8>, String> {
    let file_name = file.file_name.trim();
    let file_label = if file_name.is_empty() {
        "file"
    } else {
        file_name
    };
    if let Some(path) = file
        .source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let metadata =
            fs::metadata(path).map_err(|error| format!("Could not inspect '{}': {error}", path))?;
        if !metadata.is_file() {
            return Err(format!("'{}' is not a file.", path));
        }
        ensure_within_import_size_limit(metadata.len(), file_label)?;
        return fs::read(path).map_err(|error| format!("Could not read '{}': {error}", path));
    }

    let bytes = file
        .bytes
        .clone()
        .filter(|bytes| !bytes.is_empty())
        .ok_or_else(|| "The file could not be read.".to_string())?;
    ensure_within_import_size_limit(bytes.len() as u64, file_label)?;
    Ok(bytes)
}

fn error_file_name(error: &str) -> String {
    error
        .split_once(':')
        .map(|(file_name, _)| file_name.trim())
        .filter(|file_name| !file_name.is_empty())
        .unwrap_or("file")
        .to_string()
}

fn cleanup_written_imports(
    context: &ProjectImportRepoContext,
    written: &[WrittenImport],
    unstage: bool,
) -> Result<(), String> {
    let mut cleanup_errors = Vec::new();
    if unstage {
        let mut paths = vec![".gitattributes".to_string()];
        paths.extend(
            written
                .iter()
                .map(|entry| entry.relative_chapter_path.clone()),
        );
        for path in &paths {
            let _ = super::project_git::git_output(&context.repo_path, &["reset", "--", path]);
        }
    }

    for entry in written.iter().rev() {
        if let Err(error) = fs::remove_dir_all(&entry.absolute_chapter_path) {
            if entry.absolute_chapter_path.exists() {
                cleanup_errors.push(format!(
                    "Could not remove '{}': {error}",
                    entry.absolute_chapter_path.display()
                ));
            }
        }
    }

    let gitattributes_path = context.repo_path.join(".gitattributes");
    if !context.gitattributes_existed && gitattributes_path.exists() {
        if let Err(error) = fs::remove_file(&gitattributes_path) {
            cleanup_errors.push(format!(
                "Could not remove '{}': {error}",
                gitattributes_path.display()
            ));
        }
    }

    if cleanup_errors.is_empty() {
        Ok(())
    } else {
        Err(cleanup_errors.join(" "))
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
    fn classify_header_row_accepts_supported_language_codes() {
        let bindings = classify_header_row(&[
            "es".to_string(),
            "EN".to_string(),
            "vi".to_string(),
            "zh-hans".to_string(),
            "ZH-HANT".to_string(),
        ])
        .expect("valid language codes should be accepted");

        let codes = bindings
            .into_iter()
            .map(|binding| match binding {
                ColumnBinding::Language { code, .. } => code,
            })
            .collect::<Vec<_>>();

        assert_eq!(codes, vec!["es", "en", "vi", "zh-Hans", "zh-Hant"]);
    }

    #[test]
    fn classify_header_row_rejects_language_names() {
        let error = classify_header_row(&["Spanish".to_string(), "English".to_string()])
            .expect_err("language names should not pass XLSX import validation");

        assert!(error.contains("Column 1"));
        assert!(error.contains("supported language code"));
    }

    #[test]
    fn classify_header_row_rejects_unknown_two_letter_codes() {
        let error = classify_header_row(&["es".to_string(), "zz".to_string()])
            .expect_err("unknown two-letter codes should not pass XLSX import validation");

        assert!(error.contains("Column 2"));
        assert!(error.contains("supported language code"));
    }

    #[test]
    fn classify_header_row_rejects_bare_chinese_language_code() {
        let error = classify_header_row(&["zh".to_string()])
            .expect_err("bare Chinese should not pass XLSX import validation");

        assert!(error.contains("Column 1"));
        assert!(error.contains("supported language code"));
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
    fn parse_txt_file_canonicalizes_chinese_script_source_language() {
        let parsed = parse_txt_file(txt_input(b"first line".to_vec(), "zh_hant"))
            .expect("TXT import should parse Chinese Traditional source language");

        assert_eq!(parsed.languages[0].code, "zh-Hant");
        assert_eq!(parsed.languages[0].name, "Chinese (Traditional)");
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("zh-Hant")
                .map(|field| field.plain_text.as_str()),
            Some("first line")
        );
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
                image_caption: String::new(),
                image: None,
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
                base_code: None,
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
                html_metadata: None,
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
        assert_eq!(field.image_caption, "");
        assert!(field.image.is_none());
    }

    #[test]
    fn build_row_file_writes_imported_url_images_and_captions() {
        let mut fields = BTreeMap::new();
        fields.insert(
            "en".to_string(),
            ImportedField {
                plain_text: String::new(),
                footnote: String::new(),
                image_caption: "Plate 12. Temple entrance.".to_string(),
                image: Some(ImportedFieldImage {
                    kind: "url".to_string(),
                    url: Some("https://example.com/images/plate.jpg".to_string()),
                    path: None,
                    pending_upload: None,
                }),
            },
        );
        let parsed = ParsedWorkbook {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_title: "Article".to_string(),
            worksheet_name: "HTML".to_string(),
            source_file_name: "article.html".to_string(),
            source_format: "html",
            header_blob: Vec::new(),
            languages: vec![ImportedLanguage {
                code: "en".to_string(),
                name: "English".to_string(),
                role: "source",
                base_code: None,
            }],
            rows: vec![ImportedRow {
                external_id: None,
                description: None,
                context: None,
                comments: Vec::new(),
                source_row_number: 1,
                fields,
                text_style: None,
                docx_metadata: None,
                html_metadata: Some(HtmlRowMetadata {
                    source_url: "https://example.com/article".to_string(),
                    block_kind: "image".to_string(),
                    block_index: 1,
                    original_tag: "figure".to_string(),
                    image_url: Some("https://example.com/images/plate.jpg".to_string()),
                }),
            }],
            import_summary: None,
        };

        let row = build_row_file(&parsed, &parsed.rows[0], 0, parsed.rows.len(), "row-1")
            .expect("row should build");
        let field = row.fields.get("en").expect("English field should exist");

        assert_eq!(field.plain_text, "");
        assert_eq!(field.image_caption, "Plate 12. Temple entrance.");
        assert_eq!(
            field.image.as_ref().and_then(|image| image.url.as_deref()),
            Some("https://example.com/images/plate.jpg")
        );
        assert_eq!(
            row.format_metadata
                .get("html")
                .and_then(|value| value.get("image_url"))
                .and_then(Value::as_str),
            Some("https://example.com/images/plate.jpg")
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
        let error = match parse_docx_file(docx_input(
            vec![0; (crate::constants::MAX_IMPORT_FILE_BYTES + 1) as usize],
            "en",
        )) {
            Ok(_) => panic!("oversized DOCX should be rejected"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "'chapter.docx' is too large to import. The maximum file size is 25 MB."
        );
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
        let chapter = build_chapter_file(&parsed, &chapter_id, "chapter", None);
        let row = build_row_file(&parsed, &parsed.rows[0], 0, parsed.rows.len(), "row-1")
            .expect("row should build");
        let counts = build_word_counts_from_import(&parsed);

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

    #[test]
    fn build_chapter_file_writes_default_glossary_link() {
        let parsed = parse_txt_file(txt_input(b"one two\nthree".to_vec(), "en"))
            .expect("TXT import should parse");
        let chapter_id = Uuid::now_v7();
        let glossary = ImportProjectDefaultGlossaryInput {
            glossary_id: "glossary-1".to_string(),
            repo_name: "glossary-repo".to_string(),
        };
        let chapter = build_chapter_file(&parsed, &chapter_id, "chapter", Some(&glossary));

        let linked_glossary = chapter
            .settings
            .linked_glossaries
            .and_then(|links| links.glossary)
            .expect("default glossary should be written");
        assert_eq!(linked_glossary.glossary_id, "glossary-1");
        assert_eq!(linked_glossary.repo_name, "glossary-repo");
    }
}
