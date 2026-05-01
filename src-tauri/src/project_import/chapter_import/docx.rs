use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};

use quick_xml::{events::Event, Reader as XmlReader};
use serde::Serialize;
use zip::ZipArchive;

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    ImportDocxInput, ImportedField, ImportedLanguage, ImportedRow, ParsedWorkbook,
};

pub(super) const DOCX_MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
const DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;
const DOCX_MAX_XML_PART_BYTES: u64 = 20 * 1024 * 1024;
const DOCX_MAX_IMPORTED_ROWS: usize = 20_000;
const DOCX_MAX_ROW_TEXT_CHARS: usize = 20_000;
const DOCX_XML_EVENT_BUDGET: usize = 1_000_000;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DocxImportSummary {
    pub(super) imported_rows: usize,
    pub(super) skipped_blank_paragraphs: usize,
    pub(super) heading_count: usize,
    pub(super) imported_footnotes: usize,
    pub(super) flattened_list_items: usize,
    pub(super) flattened_table_rows: usize,
    pub(super) unsupported_content_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Default)]
pub(super) struct DocxRowMetadata {
    pub(super) block_kind: &'static str,
    pub(super) paragraph_number: usize,
    pub(super) table_row_number: Option<usize>,
    pub(super) list_item: bool,
    pub(super) original_style: Option<String>,
    pub(super) warning_counts: BTreeMap<String, usize>,
}

pub(super) fn parse_docx_file(input: ImportDocxInput) -> Result<ParsedWorkbook, String> {
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
