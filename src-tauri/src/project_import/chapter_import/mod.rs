use std::{collections::BTreeMap, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

mod docx;
mod languages;
mod txt;
mod write_gtms;
mod xlsx;

#[cfg(test)]
use docx::DOCX_MAX_FILE_BYTES;
use docx::{parse_docx_file, DocxImportSummary, DocxRowMetadata};
#[cfg(test)]
use std::io::Cursor;
#[cfg(test)]
use txt::decode_text_file;
use txt::parse_txt_file;
#[cfg(test)]
use uuid::Uuid;
use write_gtms::import_parsed_workbook_to_gtms_sync;
#[cfg(test)]
use write_gtms::{build_chapter_file, build_row_file, build_source_word_counts_from_import};
use xlsx::parse_xlsx_workbook;
#[cfg(test)]
use xlsx::{classify_header_row, split_xlsx_cell_text_and_footnote, ColumnBinding};

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
