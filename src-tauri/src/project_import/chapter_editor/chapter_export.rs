use super::book_export::{section_document, BookItemInput, BookPart};
use super::row_fields::parse_labeled_footnote_text_for_merge;
use super::*;
use crate::project_import::chapter_import::format_srt_timestamp;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use reqwest::blocking::Client as BlockingClient;
use std::fmt;
use std::io::{Cursor, Read, Write};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;
use zip::{write::SimpleFileOptions, ZipWriter};

// Cap embedded-image downloads so a hostile or accidental URL cannot buffer an unbounded
// body into memory during export.
const MAX_EXPORT_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const EXPORT_IMAGE_USER_AGENT: &str = concat!(
    "Gnosis-TMS/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/gnosistms/Gnosis-TMS-tauri-app)"
);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum PublicImageDownloadError {
    InvalidUrl,
    UnsupportedScheme,
    MissingHost,
    DnsLookupFailed,
    UnsafeHost,
    ClientSetupFailed,
    TimedOut,
    ConnectionFailed,
    RequestFailed,
    HttpStatus(u16),
    ResponseReadFailed,
    TooLarge,
}

impl PublicImageDownloadError {
    fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::TimedOut
                | Self::ConnectionFailed
                | Self::RequestFailed
                | Self::ResponseReadFailed
                | Self::HttpStatus(408 | 429 | 500..=599)
        )
    }
}

impl fmt::Display for PublicImageDownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidUrl => "the image URL is invalid",
            Self::UnsupportedScheme => "only HTTP and HTTPS image URLs are supported",
            Self::MissingHost => "the image URL has no hostname",
            Self::DnsLookupFailed => "the image hostname could not be resolved",
            Self::UnsafeHost => {
                "the image hostname does not resolve exclusively to public addresses"
            }
            Self::ClientSetupFailed => "the secure image download client could not be created",
            Self::TimedOut => "the image download timed out",
            Self::ConnectionFailed => "the image server could not be reached",
            Self::RequestFailed => "the image request failed",
            Self::HttpStatus(status) => {
                return write!(formatter, "the image server returned HTTP {status}")
            }
            Self::ResponseReadFailed => "the image download was interrupted",
            Self::TooLarge => "the image is larger than 25 MB",
        };
        formatter.write_str(message)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportChapterFileResponse {
    // Only set for SRT exports: rows that had no timing anywhere and were left out.
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped_rows_without_timing: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportChapterFileInput {
    #[serde(default)]
    pub(super) job_id: String,
    pub(super) installation_id: i64,
    pub(super) repo_name: String,
    pub(super) project_id: Option<String>,
    #[serde(default)]
    pub(super) project_full_name: Option<String>,
    pub(super) chapter_id: String,
    /// Ordered project export scope; empty preserves the single-chapter API.
    #[serde(default)]
    pub(super) chapter_ids: Vec<String>,
    #[serde(default)]
    pub(super) project_title: String,
    #[serde(default)]
    pub(super) book_items: Vec<BookItemInput>,
    pub(super) language_code: String,
    pub(super) format: String,
    pub(super) output_path: String,
    // PDF-only Typst paper identifier. Other export formats ignore this field.
    #[serde(default)]
    pub(super) paper_size: String,
    // Print-oriented option: append each footnote link's destination as plain text
    // "(url)" after the link, since a clickable hyperlink is useless on paper.
    #[serde(default)]
    pub(super) footnote_links_as_plain_text: bool,
    // Print-oriented option: drop custom-HTML rows from formats that can't carry
    // raw HTML (DOCX/RTF/TXT/MD/XLSX). HTML export always passes them through.
    #[serde(default)]
    pub(super) omit_custom_html: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ExportImage {
    Url(String),
    Upload {
        repo_relative_path: String,
        raw_url: Option<String>,
        absolute_path: PathBuf,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ExportBlock {
    Attribution {
        text: String,
    },
    Text {
        text_style: String,
        text: String,
    },
    Separator,
    Image {
        image: ExportImage,
        caption: String,
    },
    Footnote {
        number: usize,
        marker: usize,
        anchor_block: Option<usize>,
        text: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ExportDocument {
    pub(super) title: String,
    pub(super) language_code: String,
    pub(super) blocks: Vec<ExportBlock>,
    pub(super) book_parts: Vec<BookPart>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct InlineStyleState {
    pub(super) bold: bool,
    pub(super) italic: bool,
    pub(super) underline: bool,
    pub(super) link: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct InlineSegment {
    pub(super) text: String,
    pub(super) style: InlineStyleState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocxImage {
    data: Vec<u8>,
    extension: String,
    width_px: u32,
    height_px: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DocxImageRender {
    Embedded(DocxImage),
    Link(String),
}

pub(crate) fn export_gtms_chapter_file_sync(
    app: &AppHandle,
    input: ExportChapterFileInput,
) -> Result<ExportChapterFileResponse, String> {
    let format = input.format.trim().to_lowercase();
    if !matches!(
        format.as_str(),
        "docx" | "txt" | "html" | "xlsx" | "rtf" | "md" | "srt"
    ) {
        return Err("Unsupported export format.".to_string());
    }
    if input.output_path.trim().is_empty() {
        return Err("Choose a file path for the export.".to_string());
    }

    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapters = load_export_chapters(app, &repo_path, &input)?;
    let languages = export_languages(&chapters);
    if format == "srt"
        && chapters
            .iter()
            .any(|(chapter, _)| !chapter_has_srt_source(chapter))
    {
        return Err("SRT export requires every file to have been imported from SRT.".to_string());
    }
    let rows = if matches!(format.as_str(), "srt" | "xlsx") {
        combined_export_rows(&chapters, format == "srt")
    } else {
        Vec::new()
    };
    let head_sha = current_repo_head_sha(&repo_path);
    let full_name = resolve_project_full_name(&repo_path, input.project_full_name.as_deref());
    let document = build_scoped_export_document(
        app,
        &repo_path,
        &chapters,
        &input,
        full_name.as_deref(),
        head_sha.as_deref().unwrap_or_default(),
    )?;

    let output_path = PathBuf::from(input.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }

    // HTML carries the author's raw custom HTML verbatim; every other format gets
    // the print policy applied (custom-HTML rows dropped or flattened to text).
    let print_document = apply_print_custom_html_policy(&document, input.omit_custom_html);

    let mut skipped_rows_without_timing = None;
    let write_result = match format.as_str() {
        "srt" => {
            let (content, skipped) = render_srt_document(&rows, &input.language_code);
            skipped_rows_without_timing = Some(skipped);
            fs::write(&output_path, content)
                .map_err(|error| format!("Could not write '{}': {error}", output_path.display()))
        }
        "html" => fs::write(&output_path, render_html_document(&document)?)
            .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "txt" => fs::write(&output_path, render_txt_document(&print_document))
            .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "docx" => fs::write(
            &output_path,
            render_docx_document(&print_document, input.footnote_links_as_plain_text)?,
        )
        .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "xlsx" => fs::write(
            &output_path,
            render_xlsx_workbook(&document.title, &languages, &rows, input.omit_custom_html)?,
        )
        .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "rtf" => fs::write(
            &output_path,
            render_rtf_document(&print_document, input.footnote_links_as_plain_text),
        )
        .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "md" => fs::write(
            &output_path,
            render_md_document(&prepare_markdown_book_images(
                &print_document,
                &output_path,
            )?),
        )
        .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        _ => Err("Unsupported export format.".to_string()),
    };
    write_result?;

    Ok(ExportChapterFileResponse {
        skipped_rows_without_timing,
    })
}

/// Load only the requested, ordered scope from the local repo. Never silently
/// skip missing languages/files: that would produce an incomplete book.
pub(super) fn load_export_chapters(
    app: &AppHandle,
    repo_path: &Path,
    input: &ExportChapterFileInput,
) -> Result<Vec<(StoredChapterFile, Vec<StoredRowFile>)>, String> {
    let ids = if input.chapter_ids.is_empty() && input.book_items.is_empty() {
        vec![input.chapter_id.clone()]
    } else {
        input.chapter_ids.clone()
    };
    let mut seen = std::collections::BTreeSet::new();
    ids.iter().map(|id| {
        if id.trim().is_empty() || !seen.insert(id) {
            return Err("The export contains an invalid or duplicate file.".to_string());
        }
        let path = find_chapter_path_by_id(app, &repo_path.join("chapters"), id)?;
        let chapter: StoredChapterFile = read_json_file(&path.join("chapter.json"), "chapter.json")?;
        if chapter.lifecycle.state == "deleted" {
            return Err("A file selected for export has been deleted. Reopen Export to update the file list.".to_string());
        }
        if !sanitize_chapter_languages(&chapter.languages).iter().any(|language| language.code == input.language_code) {
            return Err(format!("The selected export language is not available in '{}'.", chapter.title));
        }
        Ok((chapter, load_editor_rows(&path.join("rows"))?))
    }).collect()
}

fn export_languages(chapters: &[(StoredChapterFile, Vec<StoredRowFile>)]) -> Vec<ChapterLanguage> {
    let mut languages = Vec::new();
    for (chapter, _) in chapters {
        for language in sanitize_chapter_languages(&chapter.languages) {
            if !languages
                .iter()
                .any(|existing: &ChapterLanguage| existing.code == language.code)
            {
                languages.push(language);
            }
        }
    }
    languages
}

fn combined_export_rows(
    chapters: &[(StoredChapterFile, Vec<StoredRowFile>)],
    subtitle_sequence: bool,
) -> Vec<StoredRowFile> {
    let mut rows = Vec::new();
    let mut offset = 0;
    for (_, chapter_rows) in chapters {
        let mut end = offset;
        for row in chapter_rows {
            let mut row = row.clone();
            if subtitle_sequence && row.lifecycle.state != "deleted" {
                for timing in row.format_metadata.srt.iter_mut().chain(
                    row.fields
                        .values_mut()
                        .filter_map(|field| field.timing.as_mut()),
                ) {
                    timing.start_ms += offset;
                    timing.end_ms += offset;
                    end = end.max(timing.end_ms);
                }
            }
            rows.push(row);
        }
        offset = end;
    }
    rows
}

pub(super) fn build_scoped_export_document(
    app: &AppHandle,
    repo_path: &Path,
    chapters: &[(StoredChapterFile, Vec<StoredRowFile>)],
    input: &ExportChapterFileInput,
    full_name: Option<&str>,
    head_sha: &str,
) -> Result<ExportDocument, String> {
    let documents = chapters
        .iter()
        .map(|(chapter, rows)| {
            build_export_document(
                repo_path,
                chapter,
                rows,
                &input.language_code,
                full_name,
                head_sha,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !input.book_items.is_empty() {
        let document_language = documents
            .first()
            .map(|document| document.language_code.as_str())
            .unwrap_or(&input.language_code);
        // Resolve chapter titles from the durable snapshot, even if the UI's
        // background preview reads have not finished when Export is clicked.
        let mut items = input.book_items.clone();
        let mut chapter_documents = BTreeMap::new();
        for item in &mut items {
            if item.kind != "chapter" {
                continue;
            }
            let index = chapters
                .iter()
                .position(|(chapter, _)| chapter.chapter_id == item.chapter_id)
                .ok_or_else(|| "A chapter selected for the book is missing.".to_string())?;
            let document = apply_book_chapter_title(documents[index].clone(), item);
            item.title = document.title.clone();
            chapter_documents.insert(item.id.clone(), document);
        }
        let mut seen = BTreeSet::new();
        let mut parts = Vec::new();
        for item in &items {
            if item.id.is_empty() || !seen.insert(item.id.clone()) {
                return Err("The book contains a duplicate or invalid item.".into());
            }
            let document = if item.kind == "chapter" {
                chapter_documents
                    .remove(&item.id)
                    .ok_or_else(|| "A chapter selected for the book is missing.".to_string())?
            } else {
                section_document(app, item, document_language, &[])?
            };
            parts.push(BookPart {
                item: item.clone(),
                document,
            });
        }
        return Ok(compose_book_document(
            &input.project_title,
            document_language,
            parts,
        ));
    }
    if input.chapter_ids.is_empty() {
        return documents
            .into_iter()
            .next()
            .ok_or_else(|| "There are no files to export.".to_string());
    }
    Ok(combine_export_documents(
        &input.project_title,
        &input.language_code,
        documents,
    ))
}

struct BookContentsEntry {
    title: String,
    part_index: usize,
    block_index: Option<usize>,
}

fn book_chapter_numbers(parts: &[BookPart]) -> Vec<Option<usize>> {
    let mut number = 0;
    parts
        .iter()
        .map(|part| {
            if part.item.kind == "chapter" && part.item.numbered != Some(false) {
                number += 1;
                Some(number)
            } else {
                None
            }
        })
        .collect()
}

fn book_contents_entries(parts: &[BookPart], include_h1: bool) -> Vec<BookContentsEntry> {
    let numbers = book_chapter_numbers(parts);
    let mut entries = Vec::new();
    for (index, part) in parts
        .iter()
        .enumerate()
        .filter(|(_, part)| part.item.kind == "chapter")
    {
        entries.push(BookContentsEntry {
            title: numbers[index]
                .map(|number| format!("{number}. {}", part.document.title))
                .unwrap_or_else(|| part.document.title.clone()),
            part_index: index,
            block_index: None,
        });
        if include_h1 {
            for (block_index, block) in part.document.blocks.iter().enumerate().skip(1) {
                if let ExportBlock::Text { text_style, text } = block {
                    if export_text_style(Some(text_style)) == "heading1" {
                        entries.push(BookContentsEntry {
                            title: inline_visible_text(text),
                            part_index: index,
                            block_index: Some(block_index),
                        });
                    }
                }
            }
        }
    }
    entries
}

// PDF and Vellum keep numbering as structural metadata. Flat document formats
// need the same generated number in their chapter-heading text instead.
fn numbered_book_documents(parts: &[BookPart]) -> Vec<ExportDocument> {
    let mut documents = Vec::with_capacity(parts.len());
    for (part, number) in parts.iter().zip(book_chapter_numbers(parts)) {
        let mut document = part.document.clone();
        if let Some(number) = number {
            document.title = format!("{number}. {}", document.title);
            let leading_heading = matches!(document.blocks.first(), Some(ExportBlock::Text { text_style, .. }) if export_text_style(Some(text_style)) == "heading1");
            if leading_heading {
                if let Some(ExportBlock::Text { text, .. }) = document.blocks.first_mut() {
                    *text = format!("{number}. {text}");
                }
            } else {
                for block in &mut document.blocks {
                    if let ExportBlock::Footnote {
                        anchor_block: Some(index),
                        ..
                    } = block
                    {
                        *index += 1;
                    }
                }
                document.blocks.insert(
                    0,
                    ExportBlock::Text {
                        text_style: "heading1".into(),
                        text: document.title.clone(),
                    },
                );
            }
        }
        documents.push(document);
    }
    documents
}

fn compose_book_document(title: &str, language: &str, mut parts: Vec<BookPart>) -> ExportDocument {
    for index in 0..parts.len() {
        if parts[index].item.kind != "contents" {
            continue;
        }
        let entries = book_contents_entries(&parts, parts[index].item.include_h1_headings);
        let mut blocks = vec![ExportBlock::Text {
            text_style: "heading1".into(),
            text: parts[index].item.title.clone(),
        }];
        blocks.extend(entries.into_iter().map(|entry| {
            ExportBlock::Text {
                text_style: if entry.block_index.is_some() {
                    "indented"
                } else {
                    "paragraph"
                }
                .into(),
                text: entry.title,
            }
        }));
        parts[index].document.blocks = blocks;
    }
    let mut flattened = combine_export_documents(title, language, numbered_book_documents(&parts));
    flattened.book_parts = parts;
    flattened
}

pub(super) fn apply_book_chapter_title(
    mut document: ExportDocument,
    item: &BookItemInput,
) -> ExportDocument {
    let leading_title = match document.blocks.first() {
        Some(ExportBlock::Text { text_style, text })
            if export_text_style(Some(text_style)) == "heading1" =>
        {
            Some(inline_visible_text(text).trim().to_string())
        }
        _ => None,
    };
    let override_title = item
        .title_override
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty());
    document.title = override_title
        .map(str::to_string)
        .or_else(|| leading_title.clone().filter(|title| !title.is_empty()))
        .unwrap_or_else(|| {
            if item.title.is_empty() {
                document.title.clone()
            } else {
                item.title.clone()
            }
        });
    if leading_title.is_some() {
        if let Some(title) = override_title {
            // Keep notes anchored to the opening heading when replacing its text.
            let markers = document
                .blocks
                .iter()
                .filter_map(|block| match block {
                    ExportBlock::Footnote {
                        marker,
                        anchor_block: Some(0),
                        ..
                    } => Some(format!("[{marker}]")),
                    _ => None,
                })
                .collect::<String>();
            if let Some(ExportBlock::Text { text, .. }) = document.blocks.first_mut() {
                *text = format!("{title}{markers}");
            }
        }
    } else {
        for block in &mut document.blocks {
            if let ExportBlock::Footnote {
                anchor_block: Some(index),
                ..
            } = block
            {
                *index += 1;
            }
        }
        document.blocks.insert(
            0,
            ExportBlock::Text {
                text_style: "heading1".into(),
                text: document.title.clone(),
            },
        );
    }
    document
}

fn combine_export_documents(
    title: &str,
    language_code: &str,
    documents: Vec<ExportDocument>,
) -> ExportDocument {
    let mut blocks = Vec::new();
    let mut footnotes = 0;
    let language_code = documents
        .first()
        .map(|document| document.language_code.clone())
        .unwrap_or_else(|| language_code.to_string());
    for mut document in documents {
        renumber_book_footnote_markers(&mut document.blocks, footnotes);
        if !matches!(document.blocks.first(), Some(ExportBlock::Text { text_style, text }) if export_text_style(Some(text_style)) == "heading1" && inline_visible_text(text) == document.title)
        {
            blocks.push(ExportBlock::Text {
                text_style: "chapter_heading".into(),
                text: document.title,
            });
        }
        let offset = blocks.len();
        let mut count = 0;
        for mut block in document.blocks {
            if let ExportBlock::Footnote {
                number,
                anchor_block,
                ..
            } = &mut block
            {
                count += 1;
                *number += footnotes;
                *anchor_block = anchor_block.map(|index| index + offset);
            }
            blocks.push(block);
        }
        footnotes += count;
    }
    ExportDocument {
        book_parts: Vec::new(),
        title: title.to_string(),
        language_code,
        blocks,
    }
}

// Markers are local to their source row, while book footnote numbers are
// global. Rebase the matching visible markers as well as the footnote records.
fn renumber_book_footnote_markers(blocks: &mut [ExportBlock], offset: usize) {
    let mut replacements: BTreeMap<usize, BTreeMap<usize, usize>> = BTreeMap::new();
    for block in blocks.iter_mut() {
        if let ExportBlock::Footnote {
            number,
            marker,
            anchor_block: Some(anchor),
            ..
        } = block
        {
            replacements
                .entry(*anchor)
                .or_default()
                .insert(*marker, *number + offset);
            *marker = *number + offset;
        }
    }
    for (anchor, markers) in replacements {
        if let Some(ExportBlock::Text { text, text_style }) = blocks.get_mut(anchor) {
            if export_text_style(Some(text_style)) != "custom_html" {
                *text = remap_visible_footnote_markers(text, &markers);
            }
        }
    }
}

fn remap_visible_footnote_markers(text: &str, markers: &BTreeMap<usize, usize>) -> String {
    let bytes = text.as_bytes();
    let mut result = String::new();
    let mut last = 0;
    let mut index = 0;
    let mut in_tag = false;
    while index < bytes.len() {
        if bytes[index] == b'<' {
            in_tag = true;
        }
        if bytes[index] == b'>' {
            in_tag = false;
        }
        if !in_tag && bytes[index] == b'[' {
            let slashes = bytes[..index]
                .iter()
                .rev()
                .take_while(|byte| **byte == b'\\')
                .count();
            let mut end = index + 1;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if slashes.is_multiple_of(2) && end < bytes.len() && bytes[end] == b']' {
                if let Some(number) = text[index + 1..end]
                    .parse::<usize>()
                    .ok()
                    .and_then(|marker| markers.get(&marker))
                {
                    result.push_str(&text[last..index]);
                    result.push_str(&format!("[{number}]"));
                    index = end;
                    last = end + 1;
                }
            }
        }
        index += 1;
    }
    result.push_str(&text[last..]);
    result
}

// Chapter boundaries use normal heading formatting in document formats; PDF
// additionally starts each chapter on a new page.
pub(super) fn export_text_style(style: Option<&str>) -> String {
    if style == Some("chapter_heading") {
        "heading1".into()
    } else {
        normalize_editor_text_style_value(style)
    }
}

/// Render an SRT document for one language. Timing comes from the language's
/// per-field override, falling back to the row's imported `format_metadata.srt`
/// base timing. Rows are renumbered sequentially; rows with no timing at all
/// (unexpected — see auto-timing on insert) are skipped and counted.
/// Empty-text rows are emitted with empty text so the timing structure survives
/// partially translated chapters.
fn render_srt_document(rows: &[StoredRowFile], language_code: &str) -> (String, usize) {
    let mut output = String::new();
    let mut sequence = 0usize;
    let mut skipped = 0usize;

    for row in rows {
        if row.lifecycle.state == "deleted" {
            continue;
        }

        let field = row.fields.get(language_code);
        let timing = field
            .and_then(|value| value.timing)
            .or(row.format_metadata.srt);
        let Some(timing) = timing else {
            skipped += 1;
            continue;
        };

        sequence += 1;
        output.push_str(&sequence.to_string());
        output.push('\n');
        output.push_str(&format_srt_timestamp(timing.start_ms));
        output.push_str(" --> ");
        output.push_str(&format_srt_timestamp(timing.end_ms));
        output.push('\n');
        let text = field
            .map(|value| value.plain_text.trim())
            .unwrap_or_default();
        if !text.is_empty() {
            output.push_str(text);
            output.push('\n');
        }
        output.push('\n');
    }

    (output, skipped)
}

pub(super) fn build_export_document(
    repo_path: &Path,
    chapter_file: &StoredChapterFile,
    rows: &[StoredRowFile],
    language_code: &str,
    project_full_name: Option<&str>,
    head_sha: &str,
) -> Result<ExportDocument, String> {
    let mut blocks = Vec::new();
    let mut footnote_count = 0usize;

    for row in rows {
        if row.lifecycle.state == "deleted" {
            continue;
        }

        let field = row.fields.get(language_code);
        let row_footnotes = field
            .map(|value| export_footnote_entries(&value.footnote))
            .unwrap_or_default();
        let row_block_start = blocks.len();
        let style = row_text_style(row);
        if let Some(text) = field
            .map(|value| value.plain_text.trim())
            .filter(|text| !text.is_empty())
        {
            if export_text_style(Some(&style)) == "custom_html" {
                // Custom HTML is opaque — never split it on "<hr>" markers, which
                // may be intentional content rather than separators.
                blocks.push(ExportBlock::Text {
                    text_style: style.clone(),
                    text: text.to_string(),
                });
            } else {
                push_text_blocks_with_separators(&mut blocks, style.clone(), text);
            }
        }

        if style == "quote" {
            if let Some(attribution) = field
                .map(|value| value.attribution.trim())
                .filter(|text| !text.is_empty())
            {
                // A quote with only an attribution still needs an owning block.
                if blocks.len() == row_block_start {
                    blocks.push(ExportBlock::Text {
                        text_style: "quote".into(),
                        text: String::new(),
                    });
                }
                blocks.push(ExportBlock::Attribution {
                    text: attribution.to_string(),
                });
            }
        }

        if let Some(image) = field
            .and_then(|value| export_image(repo_path, &value.image, project_full_name, head_sha))
        {
            blocks.push(ExportBlock::Image {
                image,
                caption: field
                    .map(|value| normalize_editor_image_caption_value(&value.image_caption))
                    .unwrap_or_default(),
            });
        }

        for footnote in row_footnotes {
            footnote_count += 1;
            let anchor_block = (row_block_start..blocks.len())
                .find(|index| {
                    matches!(
                        &blocks[*index],
                        ExportBlock::Text { text, .. }
                            if contains_unescaped_footnote_marker(text, footnote.marker)
                    )
                })
                // No inline marker in the row's text: anchor the reference to the end
                // of the row's last text block, matching the editor preview's
                // append-remaining rule. Without this, a row-level footnote (one whose
                // marker never appears inline) has no anchor and later floats onto the
                // following paragraph in the PDF export.
                .or_else(|| last_visible_text_block_index(&blocks, row_block_start));
            blocks.push(ExportBlock::Footnote {
                number: footnote_count,
                marker: footnote.marker,
                anchor_block,
                text: footnote.text,
            });
        }
    }

    let export_language_code = chapter_file
        .languages
        .iter()
        .find(|language| language.code == language_code)
        .map(|language| {
            language
                .base_code
                .as_deref()
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .unwrap_or(language.code.as_str())
                .to_string()
        })
        .unwrap_or_else(|| language_code.to_string());

    Ok(ExportDocument {
        book_parts: Vec::new(),
        title: chapter_file.title.clone(),
        language_code: export_language_code,
        blocks,
    })
}

/// The last non-empty text block at or after `start`, mirroring the editor preview's
/// `footnoteAppendPartIndex` (which appends unanchored footnotes to the last visible
/// text part of the row). Returns `None` when the row has no rendered text.
fn last_visible_text_block_index(blocks: &[ExportBlock], start: usize) -> Option<usize> {
    (start..blocks.len()).rev().find(|index| {
        matches!(
            &blocks[*index],
            ExportBlock::Text { text, .. } if !text.trim().is_empty()
        )
    })
}

fn export_footnote_entries(value: &str) -> Vec<super::row_fields::ParsedFootnoteEntry> {
    let normalized = normalize_editor_footnote_value(value);
    if normalized.trim().is_empty() {
        return Vec::new();
    }
    let parsed = parse_labeled_footnote_text_for_merge(&normalized);
    if parsed.is_empty() {
        vec![super::row_fields::ParsedFootnoteEntry {
            marker: 1,
            text: normalized.trim().to_string(),
        }]
    } else {
        parsed
    }
}

fn contains_unescaped_footnote_marker(text: &str, marker: usize) -> bool {
    inline_segments(text)
        .iter()
        .any(|segment| plain_text_contains_unescaped_footnote_marker(&segment.text, marker))
}

fn plain_text_contains_unescaped_footnote_marker(text: &str, marker: usize) -> bool {
    let needle = format!("[{marker}]");
    let mut cursor = 0usize;
    while let Some(relative) = text[cursor..].find(&needle) {
        let index = cursor + relative;
        let slash_count = text[..index]
            .chars()
            .rev()
            .take_while(|ch| *ch == '\\')
            .count();
        if slash_count % 2 == 0 {
            return true;
        }
        cursor = index + needle.len();
    }
    false
}

fn push_text_blocks_with_separators(blocks: &mut Vec<ExportBlock>, text_style: String, text: &str) {
    let mut cursor = 0usize;
    while let Some(offset) = text[cursor..].find("<hr>") {
        let start = cursor + offset;
        let segment = &text[cursor..start];
        if !segment.trim().is_empty() {
            blocks.push(ExportBlock::Text {
                text_style: text_style.clone(),
                text: segment.trim().to_string(),
            });
        }
        blocks.push(ExportBlock::Separator);
        cursor = start + "<hr>".len();
    }

    let tail = &text[cursor..];
    if !tail.trim().is_empty() {
        blocks.push(ExportBlock::Text {
            text_style,
            text: tail.trim().to_string(),
        });
    }
}

// Strip tags from custom HTML for print formats that can't render raw markup.
fn custom_html_to_plain_text(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    let decoded = result
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

// For print/electronic-incompatible formats (DOCX/RTF/TXT/MD) custom-HTML blocks
// are dropped when omitting, otherwise flattened to plain paragraphs. HTML export
// keeps the original document and renders the raw HTML verbatim.
pub(super) fn apply_print_custom_html_policy(
    document: &ExportDocument,
    omit: bool,
) -> ExportDocument {
    let mut blocks = Vec::with_capacity(document.blocks.len());
    let mut remapped_indices = BTreeMap::new();
    for (old_index, block) in document.blocks.iter().enumerate() {
        let next_block = match block {
            ExportBlock::Text { text_style, text }
                if export_text_style(Some(text_style)) == "custom_html" =>
            {
                if omit {
                    None
                } else {
                    let plain = custom_html_to_plain_text(text);
                    if plain.is_empty() {
                        None
                    } else {
                        Some(ExportBlock::Text {
                            text_style: "paragraph".to_string(),
                            text: plain,
                        })
                    }
                }
            }
            ExportBlock::Footnote {
                number,
                marker,
                anchor_block,
                text,
            } => Some(ExportBlock::Footnote {
                number: *number,
                marker: *marker,
                anchor_block: anchor_block.and_then(|index| remapped_indices.get(&index).copied()),
                text: text.clone(),
            }),
            other => Some(other.clone()),
        };
        if let Some(next_block) = next_block {
            remapped_indices.insert(old_index, blocks.len());
            blocks.push(next_block);
        }
    }
    ExportDocument {
        book_parts: document
            .book_parts
            .iter()
            .map(|part| BookPart {
                item: part.item.clone(),
                document: apply_print_custom_html_policy(&part.document, omit),
            })
            .collect(),
        title: document.title.clone(),
        language_code: document.language_code.clone(),
        blocks,
    }
}

fn export_image(
    repo_path: &Path,
    value: &Option<StoredFieldImage>,
    project_full_name: Option<&str>,
    head_sha: &str,
) -> Option<ExportImage> {
    let image = value.as_ref()?;
    match image.kind.as_str() {
        "url" => image.url.as_ref().map(|url| ExportImage::Url(url.clone())),
        "upload" => image.path.as_ref().map(|path| ExportImage::Upload {
            repo_relative_path: path.clone(),
            raw_url: project_full_name
                .filter(|full_name| !full_name.trim().is_empty())
                .filter(|_| !head_sha.trim().is_empty())
                .map(|full_name| {
                    format!(
                        "https://raw.githubusercontent.com/{}/{}/{}",
                        full_name.trim().trim_end_matches(".git"),
                        head_sha,
                        path
                    )
                }),
            absolute_path: repo_path.join(path),
        }),
        _ => None,
    }
}

fn resolve_project_full_name(repo_path: &Path, input_full_name: Option<&str>) -> Option<String> {
    let normalized = input_full_name.unwrap_or_default().trim();
    if !normalized.is_empty() {
        return Some(normalized.trim_end_matches(".git").to_string());
    }

    let remote_url = git_output(repo_path, &["config", "--get", "remote.origin.url"]).ok()?;
    parse_github_full_name(&remote_url)
}

fn parse_github_full_name(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches(".git");
    if trimmed.is_empty() {
        return None;
    }

    if let Some(path) = trimmed.strip_prefix("git@github.com:") {
        return normalize_github_full_name(path);
    }
    if let Some(path) = trimmed.strip_prefix("https://github.com/") {
        return normalize_github_full_name(path);
    }
    if let Some(path) = trimmed.strip_prefix("http://github.com/") {
        return normalize_github_full_name(path);
    }
    None
}

fn normalize_github_full_name(path: &str) -> Option<String> {
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
        return None;
    }
    Some(format!("{}/{}", parts[0], parts[1]))
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// A recognized inline link tag in the canonical editor form
/// (`<a href="...">` with an http(s) href, or `</a>`).
enum InlineLinkTag {
    Open { source_len: usize, href: String },
    Close { source_len: usize },
}

fn decode_inline_attribute_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn inline_link_tag(remaining: &str) -> Option<InlineLinkTag> {
    if remaining.starts_with("</a>") {
        return Some(InlineLinkTag::Close { source_len: 4 });
    }

    const OPEN_PREFIX: &str = "<a href=\"";
    let rest = remaining.strip_prefix(OPEN_PREFIX)?;
    let quote_end = rest.find('"')?;
    if !rest[quote_end + 1..].starts_with('>') {
        return None;
    }

    let href = decode_inline_attribute_entities(&rest[..quote_end]);
    let lowered = href.trim().to_ascii_lowercase();
    if !(lowered.starts_with("http://") || lowered.starts_with("https://")) {
        return None;
    }

    Some(InlineLinkTag::Open {
        source_len: OPEN_PREFIX.len() + quote_end + 2,
        href: href.trim().to_string(),
    })
}

fn sanitize_inline_html(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    let mut open_links = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if remaining.starts_with("<hr>") {
            output.push_str("<hr>");
            cursor += "<hr>".len();
            continue;
        }
        let tag = allowed_inline_tag(remaining);
        if let Some((source, replacement)) = tag {
            output.push_str(replacement);
            cursor += source.len();
            continue;
        }
        match inline_link_tag(remaining) {
            Some(InlineLinkTag::Open { source_len, href }) => {
                output.push_str("<a href=\"");
                output.push_str(&escape_html(&href));
                output.push_str("\">");
                open_links += 1;
                cursor += source_len;
                continue;
            }
            // An orphan `</a>` falls through to character escaping below.
            Some(InlineLinkTag::Close { source_len }) if open_links > 0 => {
                output.push_str("</a>");
                open_links -= 1;
                cursor += source_len;
                continue;
            }
            _ => {}
        }

        let Some(ch) = remaining.chars().next() else {
            break;
        };
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&#39;"),
            _ => output.push(ch),
        }
        cursor += ch.len_utf8();
    }
    output
}

fn allowed_inline_tag(source: &str) -> Option<(&'static str, &'static str)> {
    const TAGS: &[(&str, &str)] = &[
        ("<b>", "<strong>"),
        ("</b>", "</strong>"),
        ("<strong>", "<strong>"),
        ("</strong>", "</strong>"),
        ("<i>", "<em>"),
        ("</i>", "</em>"),
        ("<em>", "<em>"),
        ("</em>", "</em>"),
        ("<u>", "<u>"),
        ("</u>", "</u>"),
        ("<ruby>", "<ruby>"),
        ("</ruby>", "</ruby>"),
        ("<rt>", "<rt>"),
        ("</rt>", "</rt>"),
    ];
    TAGS.iter()
        .find(|(tag, _)| source.starts_with(*tag))
        .copied()
}

pub(super) fn inline_visible_text(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if remaining.starts_with("<hr>") {
            cursor += "<hr>".len();
            continue;
        }
        if let Some((source, _)) = allowed_inline_tag(remaining) {
            cursor += source.len();
            continue;
        }
        if let Some(link_tag) = inline_link_tag(remaining) {
            cursor += match link_tag {
                InlineLinkTag::Open { source_len, .. } => source_len,
                InlineLinkTag::Close { source_len } => source_len,
            };
            continue;
        }
        let Some(ch) = remaining.chars().next() else {
            break;
        };
        output.push(ch);
        cursor += ch.len_utf8();
    }
    output
}

/// True when a link's visible text is already a URL, so appending the destination
/// in parentheses would be redundant. Matches a bare http(s) URL with no internal
/// whitespace, or visible text equal to the href (ignoring case and a trailing slash).
fn link_text_is_url(text: &str, href: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lowered = trimmed.to_ascii_lowercase();
    if (lowered.starts_with("http://") || lowered.starts_with("https://"))
        && !trimmed.chars().any(char::is_whitespace)
    {
        return true;
    }
    let normalize = |value: &str| value.trim().trim_end_matches('/').to_ascii_lowercase();
    normalize(trimmed) == normalize(href)
}

/// Rewrites canonical inline markup so each link's destination is appended as plain
/// text " (url)" after its closing tag, unless the link's visible text already is a
/// URL. All tags are copied verbatim, so the appended text re-parses as ordinary,
/// non-link text in the downstream renderers (DOCX/RTF). Used for footnotes in print
/// formats where a hyperlink cannot be clicked.
fn append_link_urls_to_inline(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    let mut open_href: Option<String> = None;
    let mut link_text = String::new();
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if let Some(link_tag) = inline_link_tag(remaining) {
            match link_tag {
                InlineLinkTag::Open { source_len, href } => {
                    output.push_str(&remaining[..source_len]);
                    open_href = Some(href);
                    link_text.clear();
                    cursor += source_len;
                    continue;
                }
                InlineLinkTag::Close { source_len } => {
                    output.push_str(&remaining[..source_len]);
                    if let Some(href) = open_href.take() {
                        if !link_text_is_url(&link_text, &href) {
                            // Angle brackets would re-open tag parsing; URL-encode them.
                            let safe = href.replace('<', "%3C").replace('>', "%3E");
                            let _ = write!(output, " ({safe})");
                        }
                    }
                    link_text.clear();
                    cursor += source_len;
                    continue;
                }
            }
        }
        if remaining.starts_with("<hr>") {
            output.push_str("<hr>");
            cursor += "<hr>".len();
            continue;
        }
        if let Some((source, _)) = allowed_inline_tag(remaining) {
            output.push_str(&remaining[..source.len()]);
            cursor += source.len();
            continue;
        }
        let Some(ch) = remaining.chars().next() else {
            break;
        };
        output.push(ch);
        if open_href.is_some() {
            link_text.push(ch);
        }
        cursor += ch.len_utf8();
    }
    output
}

/// The footnote inline text for a print export: the stored markup, with link
/// destinations appended as plain text when the option is enabled.
fn print_footnote_text(text: &str, footnote_links_as_plain_text: bool) -> String {
    if footnote_links_as_plain_text {
        append_link_urls_to_inline(text)
    } else {
        text.to_string()
    }
}

fn render_html_document(document: &ExportDocument) -> Result<String, String> {
    let mut body = String::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                if export_text_style(Some(text_style)) == "custom_html" {
                    // Custom HTML rows carry the author's raw HTML — emit it verbatim.
                    let _ = writeln!(body, "{text}");
                    continue;
                }
                let text = sanitize_inline_html(text).replace('\n', "<br>");
                match export_text_style(Some(text_style)).as_str() {
                    "heading1" => {
                        let _ = writeln!(body, "<h1>{text}</h1>");
                    }
                    "heading2" => {
                        let _ = writeln!(body, "<h2>{text}</h2>");
                    }
                    "quote" => {
                        let _ = writeln!(body, "<blockquote>{text}</blockquote>");
                    }
                    "indented" => {
                        let _ = writeln!(body, "<p class=\"indented\">{text}</p>");
                    }
                    "centered" => {
                        let _ = writeln!(body, "<p class=\"centered\">{text}</p>");
                    }
                    _ => {
                        let _ = writeln!(body, "<p>{text}</p>");
                    }
                }
            }
            ExportBlock::Attribution { text } => {
                let attribution = sanitize_inline_html(text).replace('\n', "<br>");
                if body.ends_with("</blockquote>\n") {
                    body.truncate(body.len() - "</blockquote>\n".len());
                } else {
                    // A trailing separator leaves no open quote for the citation.
                    body.push_str("<blockquote>");
                }
                let _ = writeln!(
                    body,
                    "<cite class=\"quote-attribution\">{attribution}</cite></blockquote>"
                );
            }
            ExportBlock::Separator => {
                let _ = writeln!(body, "<hr>");
            }
            ExportBlock::Footnote { number, text, .. } => {
                let _ = writeln!(
                    body,
                    "<p class=\"footnote\"><em>[{}] {}</em></p>",
                    number,
                    sanitize_inline_html(text)
                );
            }
            ExportBlock::Image { image, caption } => {
                let src = html_image_src(image)?;
                if let Some(src) = src {
                    let caption_html = if caption.trim().is_empty() {
                        String::new()
                    } else {
                        format!(
                            "<figcaption><em>{}</em></figcaption>",
                            sanitize_inline_html(caption)
                        )
                    };
                    let _ = writeln!(
                        body,
                        "<figure><img src=\"{}\" alt=\"\" />{caption_html}</figure>",
                        escape_html(&src)
                    );
                }
            }
        }
    }

    Ok(format!(
        "<!doctype html>\n<html lang=\"{}\">\n<head>\n<meta charset=\"utf-8\">\n<title>{}</title>\n<style>body{{max-width:760px;margin:40px auto;padding:0 24px;font-family:serif;line-height:1.6;color:#2f2117;}}h1{{font-size:2rem;}}h2{{font-size:1.4rem;}}blockquote{{margin:1em 2em;font-style:italic;}}.quote-attribution{{display:block;font-size:90%;text-align:right;font-style:normal;}}.indented{{padding-left:2em;}}.centered{{text-align:center;}}.footnote{{font-size:.95em;}}figure{{margin:1.5em auto;text-align:center;}}img{{display:block;margin:0 auto;max-width:100%;height:auto;}}figcaption{{margin-top:.6em;text-align:center;}}</style>\n</head>\n<body>\n{}\n</body>\n</html>\n",
        escape_html(&document.language_code),
        escape_html(&document.title),
        body
    ))
}

fn html_image_src(image: &ExportImage) -> Result<Option<String>, String> {
    match image {
        ExportImage::Url(url) => Ok(Some(url.clone())),
        ExportImage::Upload { absolute_path, .. } => {
            let bytes = fs::read(absolute_path).map_err(|error| {
                format!(
                    "Could not read uploaded image '{}': {error}",
                    absolute_path.display()
                )
            })?;
            let mime_type = html_image_mime_type(absolute_path, &bytes).ok_or_else(|| {
                format!(
                    "Could not determine the image type for '{}'.",
                    absolute_path.display()
                )
            })?;
            Ok(Some(format!(
                "data:{mime_type};base64,{}",
                BASE64_STANDARD.encode(bytes)
            )))
        }
    }
}

fn html_image_mime_type(path: &Path, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }
    if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && bytes
            .windows(4)
            .any(|window| window == b"avif" || window == b"avis")
    {
        return Some("image/avif");
    }

    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension
                .trim()
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
        .as_deref()
    {
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("png" | "apng") => Some("image/png"),
        Some("gif") => Some("image/gif"),
        Some("svg") => Some("image/svg+xml"),
        Some("webp") => Some("image/webp"),
        Some("avif") => Some("image/avif"),
        Some("bmp") => Some("image/bmp"),
        Some("ico") => Some("image/x-icon"),
        _ => None,
    }
}

/// Visible text for the TXT export: like `inline_visible_text`, but a link keeps
/// its destination as a trailing " (url)" so the URL survives plain text.
fn txt_inline_text(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    let mut open_href: Option<String> = None;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if remaining.starts_with("<hr>") {
            output.push_str("\n---\n");
            cursor += "<hr>".len();
            continue;
        }
        if let Some((source, _)) = allowed_inline_tag(remaining) {
            cursor += source.len();
            continue;
        }
        match inline_link_tag(remaining) {
            Some(InlineLinkTag::Open { source_len, href }) => {
                open_href = Some(href);
                cursor += source_len;
                continue;
            }
            Some(InlineLinkTag::Close { source_len }) => {
                if let Some(href) = open_href.take() {
                    let _ = write!(output, " ({href})");
                }
                cursor += source_len;
                continue;
            }
            None => {}
        }
        let Some(ch) = remaining.chars().next() else {
            break;
        };
        output.push(ch);
        cursor += ch.len_utf8();
    }
    output
}

fn render_txt_document(document: &ExportDocument) -> String {
    let mut parts = Vec::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                let text = txt_inline_text(text).trim().to_string();
                if text.is_empty() {
                    continue;
                }
                let rendered = match export_text_style(Some(text_style)).as_str() {
                    "heading1" => text.to_uppercase(),
                    "heading2" => format!(">>> {}", text.to_uppercase()),
                    "quote" => format!("<blockquote>\n{text}\n</blockquote>"),
                    _ => text,
                };
                parts.push(rendered);
            }
            ExportBlock::Attribution { text } => {
                parts.push(txt_inline_text(text));
            }
            ExportBlock::Separator => {
                parts.push("---".to_string());
            }
            ExportBlock::Footnote { number, text, .. } => {
                let text = txt_inline_text(text).trim().to_string();
                if !text.is_empty() {
                    parts.push(format!("[{number}] {text}"));
                }
            }
            ExportBlock::Image { .. } => {}
        }
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("{}\n", parts.join("\n\n"))
    }
}

/// The non-embedding link form of an export image: the original URL for url images,
/// the pinned raw.githubusercontent.com URL (or the repo-relative path when no remote
/// is known) for uploads.
fn export_image_link(image: &ExportImage) -> String {
    match image {
        ExportImage::Url(url) => url.clone(),
        ExportImage::Upload {
            raw_url,
            repo_relative_path,
            ..
        } => raw_url
            .clone()
            .unwrap_or_else(|| repo_relative_path.clone()),
    }
}

fn prepare_markdown_book_images(
    document: &ExportDocument,
    output_path: &Path,
) -> Result<ExportDocument, String> {
    let mut document = document.clone();
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Choose a valid file name for the Markdown export.")?;
    let folder = format!("{file_name}.assets");
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    for block in &mut document.blocks {
        let ExportBlock::Image { image, .. } = block else {
            continue;
        };
        let ExportImage::Upload {
            raw_url: None,
            repo_relative_path: id,
            absolute_path,
        } = image
        else {
            continue;
        };
        // Book assets have content-addressed filenames; chapter uploads retain
        // their existing repository/remote link behavior.
        let Some((hash, extension)) = id.split_once('.') else {
            continue;
        };
        if hash.len() != 64
            || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !matches!(extension, "png" | "jpg" | "webp" | "svg")
        {
            continue;
        }
        let directory = parent.join(&folder);
        fs::create_dir_all(&directory)
            .map_err(|_| "Could not create the Markdown image folder.")?;
        fs::copy(&*absolute_path, directory.join(&*id))
            .map_err(|_| "Could not copy a book image for the Markdown export.")?;
        let link_folder = url::form_urlencoded::byte_serialize(folder.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        *image = ExportImage::Url(format!("{link_folder}/{id}"));
    }
    Ok(document)
}

fn render_md_document(document: &ExportDocument) -> String {
    let mut fragments: Vec<String> = Vec::new();
    let mut footnote_definitions: Vec<String> = Vec::new();
    let mut last_text_fragment: Option<usize> = None;

    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                let inline = md_inline_text(text);
                if inline.trim().is_empty() {
                    continue;
                }
                let rendered = match export_text_style(Some(text_style)).as_str() {
                    "heading1" => format!("# {}", md_single_line(&inline)),
                    "heading2" => format!("## {}", md_single_line(&inline)),
                    "quote" => inline
                        .lines()
                        .map(|line| format!("> {line}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    // A lone newline is a soft break in Markdown; keep visual line
                    // breaks with a backslash hard break.
                    _ => inline.replace('\n', "\\\n"),
                };
                fragments.push(rendered);
                last_text_fragment = Some(fragments.len() - 1);
            }
            ExportBlock::Attribution { text } => {
                fragments.push(
                    md_inline_text(text)
                        .lines()
                        .map(|line| format!("> {line}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
            ExportBlock::Separator => {
                fragments.push("---".to_string());
            }
            ExportBlock::Image { image, caption } => {
                fragments.push(format!(
                    "![](<{}>)",
                    md_link_destination(&export_image_link(image))
                ));
                let caption = md_single_line(&md_inline_text(caption));
                if !caption.trim().is_empty() {
                    fragments.push(format!("*{}*", caption.trim()));
                }
            }
            ExportBlock::Footnote { number, text, .. } => {
                let inline = md_single_line(&md_inline_text(text));
                if inline.trim().is_empty() {
                    continue;
                }
                // The stored footnote is attached to a row, not to an inline position,
                // so the reference goes at the end of that row's text paragraph.
                if let Some(index) = last_text_fragment {
                    let _ = write!(fragments[index], "[^{number}]");
                }
                footnote_definitions.push(format!("[^{number}]: {}", inline.trim()));
            }
        }
    }

    fragments.extend(footnote_definitions);
    if fragments.is_empty() {
        String::new()
    } else {
        format!("{}\n", fragments.join("\n\n"))
    }
}

fn md_single_line(value: &str) -> String {
    value.replace('\n', " ")
}

/// Angle-bracket link destinations tolerate spaces but not unescaped angle brackets
/// or newlines.
fn md_link_destination(value: &str) -> String {
    value
        .replace('<', "%3C")
        .replace('>', "%3E")
        .replace('\n', "")
}

/// Groups consecutive segments that share the same link href, so a link whose
/// text mixes styles ("the <strong>bold</strong> page") renders as one link.
fn link_grouped_segments(
    segments: Vec<InlineSegment>,
) -> Vec<(Option<String>, Vec<InlineSegment>)> {
    let mut groups: Vec<(Option<String>, Vec<InlineSegment>)> = Vec::new();
    for segment in segments {
        let href = segment.style.link.clone();
        match groups.last_mut() {
            Some((current, items)) if *current == href => items.push(segment),
            _ => groups.push((href, vec![segment])),
        }
    }
    groups
}

fn md_inline_text(value: &str) -> String {
    link_grouped_segments(inline_segments(value))
        .into_iter()
        .map(|(href, segments)| {
            let inner: String = segments.iter().map(md_segment).collect();
            match href {
                Some(url) if !inner.trim().is_empty() => {
                    format!("[{}](<{}>)", inner, md_link_destination(&url))
                }
                _ => inner,
            }
        })
        .collect()
}

fn md_segment(segment: &InlineSegment) -> String {
    let escaped = escape_md_text(&segment.text);
    if !segment.style.bold && !segment.style.italic && !segment.style.underline {
        return escaped;
    }

    // Emphasis markers do not bind across whitespace, so wrap only the trimmed core
    // and keep the surrounding whitespace outside the markers.
    let leading_len = escaped.len() - escaped.trim_start().len();
    let trimmed_len = escaped.trim_end().len();
    if leading_len >= trimmed_len {
        return escaped;
    }
    let (leading, rest) = escaped.split_at(leading_len);
    let (core, trailing) = rest.split_at(trimmed_len - leading_len);

    let mut wrapped = core.to_string();
    if segment.style.bold {
        wrapped = format!("**{wrapped}**");
    }
    if segment.style.italic {
        wrapped = format!("*{wrapped}*");
    }
    if segment.style.underline {
        wrapped = format!("<u>{wrapped}</u>");
    }
    format!("{leading}{wrapped}{trailing}")
}

fn escape_md_text(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        if matches!(
            ch,
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '#' | '|' | '~'
        ) {
            output.push('\\');
        }
        output.push(ch);
    }
    output
}

pub(super) fn inline_segments(value: &str) -> Vec<InlineSegment> {
    let mut output = Vec::new();
    let mut style = InlineStyleState::default();
    let mut cursor = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if remaining.starts_with("<hr>") {
            output.push(InlineSegment {
                text: "\n---\n".to_string(),
                style: style.clone(),
            });
            cursor += "<hr>".len();
            continue;
        }
        if let Some((source, replacement)) = allowed_inline_tag(remaining) {
            match replacement {
                "<strong>" => style.bold = true,
                "</strong>" => style.bold = false,
                "<em>" => style.italic = true,
                "</em>" => style.italic = false,
                "<u>" => style.underline = true,
                "</u>" => style.underline = false,
                "<rt>" => {
                    output.push(InlineSegment {
                        text: " (".to_string(),
                        style: style.clone(),
                    });
                }
                "</rt>" => {
                    output.push(InlineSegment {
                        text: ")".to_string(),
                        style: style.clone(),
                    });
                }
                _ => {}
            }
            cursor += source.len();
            continue;
        }
        if let Some(link_tag) = inline_link_tag(remaining) {
            cursor += match link_tag {
                InlineLinkTag::Open { source_len, href } => {
                    style.link = Some(href);
                    source_len
                }
                InlineLinkTag::Close { source_len } => {
                    style.link = None;
                    source_len
                }
            };
            continue;
        }
        let Some(ch) = remaining.chars().next() else {
            break;
        };
        output.push(InlineSegment {
            text: ch.to_string(),
            style: style.clone(),
        });
        cursor += ch.len_utf8();
    }

    merge_inline_segments(output)
}

fn merge_inline_segments(segments: Vec<InlineSegment>) -> Vec<InlineSegment> {
    let mut merged: Vec<InlineSegment> = Vec::new();
    for segment in segments {
        if segment.text.is_empty() {
            continue;
        }
        if let Some(last) = merged.last_mut() {
            if last.style == segment.style {
                last.text.push_str(&segment.text);
                continue;
            }
        }
        merged.push(segment);
    }
    merged
}

fn render_docx_document(
    document: &ExportDocument,
    footnote_links_as_plain_text: bool,
) -> Result<Vec<u8>, String> {
    let mut relationships = Vec::<String>::new();
    let mut media = Vec::<(String, Vec<u8>)>::new();
    let mut body = String::new();
    let mut rel_index = 1usize;
    let mut media_index = 1usize;
    let mut bookmark_index = document.book_parts.len();
    let numbered_sections = numbered_book_documents(&document.book_parts);

    let sections: Vec<(Option<&BookPart>, &ExportDocument)> = if document.book_parts.is_empty() {
        vec![(None, document)]
    } else {
        document
            .book_parts
            .iter()
            .zip(&numbered_sections)
            .map(|(part, numbered)| (Some(part), numbered))
            .collect()
    };
    for (section_index, (part, section)) in sections.iter().enumerate() {
        let part_kind = part.map(|part| part.item.kind.as_str()).unwrap_or("");
        if part.is_some() {
            body.push_str(&format!("<w:p><w:bookmarkStart w:id=\"{section_index}\" w:name=\"BookItem{section_index}\"/><w:bookmarkEnd w:id=\"{section_index}\"/></w:p>"));
        }
        if part_kind == "contents" {
            body.push_str(&docx_text_paragraph_xml(
                Some("heading1"),
                &section.title,
                false,
            ));
            for entry in book_contents_entries(
                &document.book_parts,
                part.is_some_and(|part| part.item.include_h1_headings),
            ) {
                let target = entry
                    .block_index
                    .map(|block| format!("BookItem{}Block{block}", entry.part_index))
                    .unwrap_or_else(|| format!("BookItem{}", entry.part_index));
                let indent = if entry.block_index.is_some() {
                    "<w:pPr><w:ind w:left=\"360\"/></w:pPr>"
                } else {
                    ""
                };
                body.push_str(&format!("<w:p>{indent}<w:hyperlink w:anchor=\"{target}\"><w:r>{}</w:r></w:hyperlink><w:r><w:tab/></w:r><w:fldSimple w:instr=\" PAGEREF {target} \\h \" w:dirty=\"true\"><w:r><w:t> </w:t></w:r></w:fldSimple></w:p>", docx_run_text_xml(&entry.title)));
            }
        } else {
            for (block_index, block) in section.blocks.iter().enumerate() {
                let bookmark = if part_kind == "chapter"
                    && block_index > 0
                    && matches!(block, ExportBlock::Text { text_style, .. } if export_text_style(Some(text_style)) == "heading1")
                {
                    let bookmark = format!("<w:bookmarkStart w:id=\"{bookmark_index}\" w:name=\"BookItem{section_index}Block{block_index}\"/><w:bookmarkEnd w:id=\"{bookmark_index}\"/>");
                    bookmark_index += 1;
                    bookmark
                } else {
                    String::new()
                };
                match block {
                    ExportBlock::Text { text_style, text } => {
                        if part_kind == "title" {
                            let size = match export_text_style(Some(text_style)).as_str() {
                                "heading1" => 60,
                                "heading2" => 36,
                                _ => 28,
                            };
                            body.push_str(&format!("<w:p><w:pPr><w:jc w:val=\"center\"/><w:spacing w:before=\"240\" w:after=\"240\"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Alegreya\" w:hAnsi=\"Alegreya\"/><w:sz w:val=\"{size}\"/></w:rPr>{}</w:r></w:p>", docx_run_text_xml(&inline_visible_text(text))));
                        } else {
                            body.push_str(&docx_paragraph_runs_xml(
                                Some(text_style),
                                &format!("{bookmark}{}", docx_runs_xml(text, false)),
                            ));
                        }
                    }
                    ExportBlock::Attribution { text } => {
                        let runs = docx_runs_xml(text, false);
                        body.push_str(&format!(
                    r#"<w:p><w:pPr><w:pStyle w:val="VellumAttribution"/></w:pPr>{runs}</w:p>"#
                ));
                    }
                    ExportBlock::Separator => {
                        if part_kind == "copyright" || part_kind == "dedication" {
                            let rel_id = format!("rId{rel_index}");
                            rel_index += 1;
                            let file_name = format!("flourish{media_index}.svg");
                            media_index += 1;
                            relationships.push(format!("<Relationship Id=\"{rel_id}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/{file_name}\"/>"));
                            let ornament = DocxImage {
                                data: include_bytes!("chapter_flourish.svg").to_vec(),
                                extension: "svg".into(),
                                width_px: 64,
                                height_px: 18,
                            };
                            body.push_str(&docx_image_paragraph_xml(&rel_id, &ornament));
                            media.push((format!("word/media/{file_name}"), ornament.data));
                        } else {
                            body.push_str(&docx_separator_paragraph_xml());
                        }
                    }
                    ExportBlock::Footnote { number, text, .. } => {
                        let text = print_footnote_text(text, footnote_links_as_plain_text);
                        body.push_str(&docx_text_paragraph_xml(
                            None,
                            &format!("[{number}] {text}"),
                            true,
                        ));
                    }
                    ExportBlock::Image { image, caption } => {
                        let image_render = resolve_docx_image_render(image);
                        match image_render {
                            DocxImageRender::Embedded(mut image_data) => {
                                if part_kind == "title" {
                                    let scale = (125.0 / image_data.width_px.max(1) as f64)
                                        .min(67.0 / image_data.height_px.max(1) as f64)
                                        .min(1.0);
                                    image_data.width_px =
                                        (image_data.width_px as f64 * scale).round().max(1.0)
                                            as u32;
                                    image_data.height_px =
                                        (image_data.height_px as f64 * scale).round().max(1.0)
                                            as u32;
                                }
                                let rel_id = format!("rId{rel_index}");
                                rel_index += 1;
                                let file_name =
                                    format!("image{media_index}.{}", image_data.extension);
                                media_index += 1;
                                relationships.push(format!(
                            r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{file_name}"/>"#
                        ));
                                body.push_str(&docx_image_paragraph_xml(&rel_id, &image_data));
                                media.push((format!("word/media/{file_name}"), image_data.data));
                            }
                            DocxImageRender::Link(url) => {
                                let rel_id = format!("rId{rel_index}");
                                rel_index += 1;
                                relationships.push(format!(
                            r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
                            escape_xml(&url)
                        ));
                                body.push_str(&docx_hyperlink_paragraph_xml(&rel_id, &url));
                            }
                        }

                        if !caption.trim().is_empty() {
                            body.push_str(&docx_text_paragraph_xml(
                                Some("centered"),
                                caption,
                                true,
                            ));
                        }
                    }
                }
            }
        }
        if part.is_some() {
            let section_properties = book_docx_section_properties(part_kind);
            if section_index + 1 == sections.len() {
                body.push_str(&section_properties);
            } else {
                body.push_str(&format!("<w:p><w:pPr>{section_properties}</w:pPr></w:p>"));
            }
        }
    }

    if document.book_parts.is_empty() {
        body.push_str(r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#);
    }
    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{body}</w:body></w:document>"#
    );
    {
        relationships.push(r#"<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>"#.into());
    }
    let rels_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{} </Relationships>"#,
        relationships.join("")
    );

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default();
    write_zip_file(&mut writer, "[Content_Types].xml", content_types_xml())?;
    write_zip_file(&mut writer, "_rels/.rels", package_rels_xml())?;
    write_zip_file(&mut writer, "word/document.xml", &document_xml)?;
    write_zip_file(&mut writer, "word/_rels/document.xml.rels", &rels_xml)?;
    write_zip_file(&mut writer, "word/styles.xml", styles_xml())?;
    {
        write_zip_file(
            &mut writer,
            "word/settings.xml",
            r#"<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>"#,
        )?;
    }
    for (path, data) in media {
        writer
            .start_file(path, options)
            .map_err(|error| format!("Could not add DOCX media: {error}"))?;
        writer
            .write_all(&data)
            .map_err(|error| format!("Could not write DOCX media: {error}"))?;
    }

    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| format!("Could not finish DOCX export: {error}"))
}

fn book_docx_section_properties(kind: &str) -> String {
    let start = if kind == "copyright" {
        "evenPage"
    } else {
        "oddPage"
    };
    let align = if kind == "copyright" {
        "bottom"
    } else if matches!(kind, "title" | "image" | "dedication") {
        "center"
    } else {
        "top"
    };
    format!("<w:sectPr><w:type w:val=\"{start}\"/><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1152\" w:right=\"1224\" w:bottom=\"1152\" w:left=\"1224\"/><w:vAlign w:val=\"{align}\"/></w:sectPr>")
}

fn write_zip_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    path: &str,
    contents: &str,
) -> Result<(), String> {
    writer
        .start_file(path, SimpleFileOptions::default())
        .map_err(|error| format!("Could not add '{path}' to the export file: {error}"))?;
    writer
        .write_all(contents.as_bytes())
        .map_err(|error| format!("Could not write '{path}' to the export file: {error}"))
}

fn docx_text_paragraph_xml(text_style: Option<&str>, text: &str, forced_italic: bool) -> String {
    docx_paragraph_runs_xml(text_style, &docx_runs_xml(text, forced_italic))
}

fn docx_paragraph_runs_xml(text_style: Option<&str>, runs: &str) -> String {
    let normalized = export_text_style(text_style);
    let mut properties = String::new();
    match normalized.as_str() {
        "heading1" => properties.push_str(r#"<w:pStyle w:val="Heading1"/>"#),
        "heading2" => properties.push_str(r#"<w:pStyle w:val="Heading2"/>"#),
        "quote" => properties.push_str(r#"<w:pStyle w:val="Quote"/>"#),
        "indented" => properties.push_str(r#"<w:ind w:left="720"/>"#),
        "centered" => properties.push_str(r#"<w:jc w:val="center"/>"#),
        _ => {}
    }
    let ppr = if properties.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{properties}</w:pPr>")
    };
    format!("<w:p>{ppr}{runs}</w:p>")
}

fn docx_separator_paragraph_xml() -> String {
    r#"<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A47029"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>"#.to_string()
}

fn docx_runs_xml(value: &str, forced_italic: bool) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    while let Some(start_offset) = value[cursor..].find("<ruby>") {
        let start = cursor + start_offset;
        output.push_str(&docx_segment_runs_xml(&value[cursor..start], forced_italic));

        let inner_start = start + "<ruby>".len();
        let Some(end_offset) = value[inner_start..].find("</ruby>") else {
            output.push_str(&docx_segment_runs_xml(&value[start..], forced_italic));
            return output;
        };
        let end = inner_start + end_offset;
        let full_end = end + "</ruby>".len();
        let inner = &value[inner_start..end];

        if let Some(ruby_xml) = docx_ruby_from_inner_xml(inner, forced_italic) {
            output.push_str(&ruby_xml);
        } else {
            output.push_str(&docx_segment_runs_xml(
                &value[start..full_end],
                forced_italic,
            ));
        }
        cursor = full_end;
    }
    output.push_str(&docx_segment_runs_xml(&value[cursor..], forced_italic));
    output
}

fn docx_segment_runs_xml(value: &str, forced_italic: bool) -> String {
    link_grouped_segments(inline_segments(value))
        .into_iter()
        .map(|(href, segments)| {
            let runs = segments
                .into_iter()
                .map(|mut segment| {
                    if forced_italic {
                        segment.style.italic = true;
                    }
                    docx_run_xml(&segment)
                })
                .collect::<String>();
            match href {
                // A field-based hyperlink works without a relationship entry,
                // so paragraph rendering stays decoupled from the rels file.
                Some(url) => format!(
                    r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "{}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>{runs}<w:r><w:fldChar w:fldCharType="end"/></w:r>"#,
                    escape_xml(&url)
                ),
                None => runs,
            }
        })
        .collect::<String>()
}

fn docx_ruby_from_inner_xml(inner: &str, forced_italic: bool) -> Option<String> {
    let rt_start = inner.find("<rt>")?;
    let annotation_start = rt_start + "<rt>".len();
    let rt_end = inner[annotation_start..].find("</rt>")? + annotation_start;
    if !inner[rt_end + "</rt>".len()..].trim().is_empty() {
        return None;
    }

    let base_text = inline_visible_text(&inner[..rt_start]);
    let annotation_text = inline_visible_text(&inner[annotation_start..rt_end]);
    if base_text.trim().is_empty() || annotation_text.trim().is_empty() {
        return None;
    }

    let style = InlineStyleState {
        italic: forced_italic,
        ..InlineStyleState::default()
    };
    let base_run = docx_run_xml(&InlineSegment {
        text: base_text,
        style: style.clone(),
    });
    let annotation_run = docx_run_xml(&InlineSegment {
        text: annotation_text,
        style,
    });
    Some(format!(
        r#"<w:ruby><w:rubyPr><w:rubyAlign w:val="center"/><w:hps w:val="14"/><w:hpsRaise w:val="18"/><w:hpsBaseText w:val="22"/></w:rubyPr><w:rt>{annotation_run}</w:rt><w:rubyBase>{base_run}</w:rubyBase></w:ruby>"#
    ))
}

fn docx_run_xml(segment: &InlineSegment) -> String {
    let is_link = segment.style.link.is_some();
    let mut rpr = String::new();
    if segment.style.bold {
        rpr.push_str("<w:b/>");
    }
    if segment.style.italic {
        rpr.push_str("<w:i/>");
    }
    if is_link {
        rpr.push_str(r#"<w:color w:val="0563C1"/>"#);
    }
    if segment.style.underline || is_link {
        rpr.push_str(r#"<w:u w:val="single"/>"#);
    }
    let rpr = if rpr.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{rpr}</w:rPr>")
    };
    format!("<w:r>{rpr}{}</w:r>", docx_run_text_xml(&segment.text))
}

// A within-row newline is an in-paragraph line break. OOXML does not treat a
// literal LF inside <w:t> as a break (Word collapses it), so split the run text
// on newlines and emit <w:br/> between the pieces.
fn docx_run_text_xml(text: &str) -> String {
    text.split('\n')
        .map(|line| format!(r#"<w:t xml:space="preserve">{}</w:t>"#, escape_xml(line)))
        .collect::<Vec<_>>()
        .join("<w:br/>")
}

fn docx_image_paragraph_xml(rel_id: &str, image: &DocxImage) -> String {
    let (width_emu, height_emu) = docx_image_extent(image);
    format!(
        r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="{width_emu}" cy="{height_emu}"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{width_emu}" cy="{height_emu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
    )
}

fn docx_image_extent(image: &DocxImage) -> (u64, u64) {
    const EMU_PER_INCH: f64 = 914_400.0;
    const SOURCE_DPI: f64 = 96.0;
    const MAX_WIDTH_EMU: f64 = EMU_PER_INCH * 5.0;
    const MAX_HEIGHT_EMU: f64 = EMU_PER_INCH * 6.0;

    let natural_width = image.width_px.max(1) as f64 / SOURCE_DPI * EMU_PER_INCH;
    let natural_height = image.height_px.max(1) as f64 / SOURCE_DPI * EMU_PER_INCH;
    let scale = (MAX_WIDTH_EMU / natural_width)
        .min(MAX_HEIGHT_EMU / natural_height)
        .min(1.0);
    (
        (natural_width * scale).round().max(1.0) as u64,
        (natural_height * scale).round().max(1.0) as u64,
    )
}

fn docx_hyperlink_paragraph_xml(rel_id: &str, url: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:hyperlink r:id="{rel_id}"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr><w:t>{}</w:t></w:r></w:hyperlink></w:p>"#,
        escape_xml(url)
    )
}

fn resolve_docx_image_render(image: &ExportImage) -> DocxImageRender {
    match image {
        ExportImage::Url(url) => download_docx_image(url)
            .map(DocxImageRender::Embedded)
            .unwrap_or_else(|| DocxImageRender::Link(url.clone())),
        ExportImage::Upload {
            absolute_path,
            raw_url,
            repo_relative_path,
        } => read_local_docx_image(absolute_path)
            .map(DocxImageRender::Embedded)
            .unwrap_or_else(|| {
                DocxImageRender::Link(
                    raw_url
                        .clone()
                        .unwrap_or_else(|| repo_relative_path.clone()),
                )
            }),
    }
}

fn read_local_docx_image(path: &Path) -> Option<DocxImage> {
    let mut data = fs::read(path).ok()?;
    if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP".as_slice()) {
        let decoded = image::load_from_memory(&data).ok()?;
        let mut output = Cursor::new(Vec::new());
        decoded
            .write_to(&mut output, image::ImageFormat::Png)
            .ok()?;
        data = output.into_inner();
    }
    let (extension, width_px, height_px) =
        if path.extension().and_then(|extension| extension.to_str()) == Some("svg") {
            let (width, height) = super::book_export::svg_dimensions(&data);
            ("svg".into(), width, height)
        } else {
            docx_image_info(&data)?
        };
    Some(DocxImage {
        data,
        extension,
        width_px,
        height_px,
    })
}

fn download_docx_image(url: &str) -> Option<DocxImage> {
    let data = download_public_image_bytes(url)?;
    let (extension, width_px, height_px) = docx_image_info(&data)?;
    Some(DocxImage {
        data,
        extension,
        width_px,
        height_px,
    })
}

pub(super) fn download_public_image_bytes(url: &str) -> Option<Vec<u8>> {
    download_public_image_bytes_detailed(url).ok()
}

pub(super) fn download_public_image_bytes_detailed(
    url: &str,
) -> Result<Vec<u8>, PublicImageDownloadError> {
    let mut last_error = None;
    for attempt in 0..2 {
        match download_public_image_bytes_once(url) {
            Ok(data) => return Ok(data),
            Err(error) if attempt == 0 && error.is_retryable() => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or(PublicImageDownloadError::RequestFailed))
}

fn download_public_image_bytes_once(url: &str) -> Result<Vec<u8>, PublicImageDownloadError> {
    // Image URLs are row content that can arrive over git from other team members, so an
    // export must not let one of them point this fetch at the exporting machine's own
    // network. Reject non-public hosts, refuse redirects (a public URL could otherwise 302
    // into a private range), and cap the body size.
    let client = public_http_client_for_url(url, Duration::from_secs(8), EXPORT_IMAGE_USER_AGENT)?;
    let response = client.get(url).send().map_err(|error| {
        if error.is_timeout() {
            PublicImageDownloadError::TimedOut
        } else if error.is_connect() {
            PublicImageDownloadError::ConnectionFailed
        } else {
            PublicImageDownloadError::RequestFailed
        }
    })?;
    if !response.status().is_success() {
        return Err(PublicImageDownloadError::HttpStatus(
            response.status().as_u16(),
        ));
    }
    let mut limited = response.take(MAX_EXPORT_IMAGE_BYTES + 1);
    let mut data = Vec::new();
    limited
        .read_to_end(&mut data)
        .map_err(|_| PublicImageDownloadError::ResponseReadFailed)?;
    if data.len() as u64 > MAX_EXPORT_IMAGE_BYTES {
        return Err(PublicImageDownloadError::TooLarge);
    }
    Ok(data)
}

/// Builds a redirect-free client for a URL whose host has been checked to resolve
/// only to public addresses. Domain results are pinned into the client to prevent a
/// DNS rebinding between validation and connection.
pub(super) fn public_http_client_for_url(
    url: &str,
    timeout: Duration,
    user_agent: &str,
) -> Result<BlockingClient, PublicImageDownloadError> {
    let request = validated_export_image_request(url)?;
    let mut builder = BlockingClient::builder()
        .timeout(timeout)
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::none());
    if let Some((host, addresses)) = request.pinned_addresses.as_ref() {
        builder = builder.resolve_to_addrs(host, addresses);
    }
    builder
        .build()
        .map_err(|_| PublicImageDownloadError::ClientSetupFailed)
}

/// Fetches a remote image (with the same public-host validation, redirect
/// refusal, and size cap as the DOCX export) and returns its natural pixel
/// dimensions. Unlike the DOCX embed path this also understands WebP, which
/// only needs measuring, never embedding. `None` for unreachable, non-public,
/// oversized, or unsupported images.
pub(crate) fn fetch_public_image_dimensions(url: &str) -> Option<(u32, u32)> {
    let data = download_public_image_bytes(url)?;
    if let Some((_, width_px, height_px)) = docx_image_info(&data) {
        return Some((width_px, height_px));
    }
    webp_dimensions(&data)
}

/// WebP canvas dimensions for the three container layouts: lossy (VP8),
/// lossless (VP8L), and extended (VP8X).
fn webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 30 || &data[0..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return None;
    }

    match &data[12..16] {
        b"VP8 " => {
            // Lossy frame header: 3-byte frame tag, then the 9d 01 2a start
            // code, then 14-bit little-endian width and height.
            if data.get(23..26)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            let width = u16::from_le_bytes(data.get(26..28)?.try_into().ok()?) as u32 & 0x3fff;
            let height = u16::from_le_bytes(data.get(28..30)?.try_into().ok()?) as u32 & 0x3fff;
            nonzero_dimensions(width, height)
        }
        b"VP8L" => {
            // Lossless: signature byte 0x2f, then width-1 and height-1 as
            // consecutive 14-bit little-endian fields.
            if *data.get(20)? != 0x2f {
                return None;
            }
            let bits = u32::from_le_bytes(data.get(21..25)?.try_into().ok()?);
            let width = (bits & 0x3fff) + 1;
            let height = ((bits >> 14) & 0x3fff) + 1;
            nonzero_dimensions(width, height)
        }
        b"VP8X" => {
            // Extended: 4 bytes of flags/reserved, then canvas width-1 and
            // height-1 as 24-bit little-endian values.
            let width = u32::from_le_bytes([data[24], data[25], data[26], 0]) + 1;
            let height = u32::from_le_bytes([data[27], data[28], data[29], 0]) + 1;
            nonzero_dimensions(width, height)
        }
        _ => None,
    }
}

struct ValidatedExportImageRequest {
    // `Some((host, addrs))` for a domain host whose DNS result was validated and must be
    // pinned at connect time; `None` for a literal-IP host (no DNS, nothing to pin).
    pinned_addresses: Option<(String, Vec<SocketAddr>)>,
}

/// Validate that an export image URL targets a public host. For domain hosts the DNS
/// result is resolved once, every address is checked, and the addresses are returned so
/// the caller can pin them — closing the rebinding window between this check and the
/// fetch. Returns a specific failure when the URL cannot be fetched safely.
fn validated_export_image_request(
    url: &str,
) -> Result<ValidatedExportImageRequest, PublicImageDownloadError> {
    let parsed = url::Url::parse(url).map_err(|_| PublicImageDownloadError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(PublicImageDownloadError::UnsupportedScheme);
    }
    let port = parsed.port_or_known_default().unwrap_or(0);
    match parsed.host().ok_or(PublicImageDownloadError::MissingHost)? {
        // Literal IP hosts are classified directly (no DNS, nothing to pin).
        url::Host::Ipv4(addr) => is_public_ip(IpAddr::V4(addr))
            .then_some(ValidatedExportImageRequest {
                pinned_addresses: None,
            })
            .ok_or(PublicImageDownloadError::UnsafeHost),
        url::Host::Ipv6(addr) => is_public_ip(IpAddr::V6(addr))
            .then_some(ValidatedExportImageRequest {
                pinned_addresses: None,
            })
            .ok_or(PublicImageDownloadError::UnsafeHost),
        // Resolve the domain and reject if any address it maps to is non-public, so a
        // hostname that points at a private/loopback/link-local/ULA address is refused.
        url::Host::Domain(host) => {
            if host.eq_ignore_ascii_case("localhost") {
                return Err(PublicImageDownloadError::UnsafeHost);
            }
            let addresses = (host, port)
                .to_socket_addrs()
                .map_err(|_| PublicImageDownloadError::DnsLookupFailed)?
                .collect::<Vec<_>>();
            if addresses.is_empty() {
                return Err(PublicImageDownloadError::DnsLookupFailed);
            }
            if addresses.iter().any(|address| !is_public_ip(address.ip())) {
                return Err(PublicImageDownloadError::UnsafeHost);
            }
            Ok(ValidatedExportImageRequest {
                pinned_addresses: Some((host.to_string(), addresses)),
            })
        }
    }
}

#[cfg(test)]
fn is_public_export_image_url(url: &str) -> bool {
    validated_export_image_request(url).is_ok()
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                // Carrier-grade NAT 100.64.0.0/10.
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 0x40))
        }
        IpAddr::V6(v6) => {
            !(v6.is_loopback()
                || v6.is_unspecified()
                // Unique local addresses fc00::/7.
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local unicast fe80::/10.
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // IPv4-mapped: classify by the embedded v4 address.
                || v6.to_ipv4_mapped().map(|v4| !is_public_ip(IpAddr::V4(v4))).unwrap_or(false))
        }
    }
}

fn docx_image_info(data: &[u8]) -> Option<(String, u32, u32)> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        let (width_px, height_px) = png_dimensions(data)?;
        return Some(("png".to_string(), width_px, height_px));
    }
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        let (width_px, height_px) = jpeg_dimensions(data)?;
        return Some(("jpg".to_string(), width_px, height_px));
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        let (width_px, height_px) = gif_dimensions(data)?;
        return Some(("gif".to_string(), width_px, height_px));
    }
    None
}

fn png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let width = u32::from_be_bytes(data.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(data.get(20..24)?.try_into().ok()?);
    nonzero_dimensions(width, height)
}

fn gif_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let width = u16::from_le_bytes(data.get(6..8)?.try_into().ok()?) as u32;
    let height = u16::from_le_bytes(data.get(8..10)?.try_into().ok()?) as u32;
    nonzero_dimensions(width, height)
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut cursor = 2usize;
    while cursor + 4 <= data.len() {
        if data[cursor] != 0xff {
            cursor += 1;
            continue;
        }
        while cursor < data.len() && data[cursor] == 0xff {
            cursor += 1;
        }
        let marker = *data.get(cursor)?;
        cursor += 1;
        if marker == 0xd8 || marker == 0xd9 {
            continue;
        }
        if marker == 0xda {
            break;
        }
        let segment_len =
            u16::from_be_bytes(data.get(cursor..cursor + 2)?.try_into().ok()?) as usize;
        if segment_len < 2 || cursor + segment_len > data.len() {
            return None;
        }
        if is_jpeg_start_of_frame_marker(marker) {
            if segment_len < 7 {
                return None;
            }
            let height =
                u16::from_be_bytes(data.get(cursor + 3..cursor + 5)?.try_into().ok()?) as u32;
            let width =
                u16::from_be_bytes(data.get(cursor + 5..cursor + 7)?.try_into().ok()?) as u32;
            return nonzero_dimensions(width, height);
        }
        cursor += segment_len;
    }
    None
}

fn is_jpeg_start_of_frame_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn nonzero_dimensions(width: u32, height: u32) -> Option<(u32, u32)> {
    if width == 0 || height == 0 {
        None
    } else {
        Some((width, height))
    }
}

fn render_rtf_document(document: &ExportDocument, footnote_links_as_plain_text: bool) -> String {
    let mut body = String::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                body.push_str(&rtf_text_paragraph(Some(text_style), text, false));
            }
            ExportBlock::Attribution { text } => {
                let paragraph = rtf_text_paragraph(None, text, false);
                body.push_str(&paragraph.replacen("\\fs24", "\\fs22\\qr", 1));
            }
            ExportBlock::Separator => {
                body.push_str(&rtf_separator_paragraph());
            }
            ExportBlock::Footnote { number, text, .. } => {
                let text = print_footnote_text(text, footnote_links_as_plain_text);
                body.push_str(&rtf_text_paragraph(
                    None,
                    &format!("[{number}] {text}"),
                    true,
                ));
            }
            ExportBlock::Image { image, caption } => {
                body.push_str(&rtf_image_paragraph(image));
                if !caption.trim().is_empty() {
                    body.push_str(&rtf_text_paragraph(Some("centered"), caption, true));
                }
            }
        }
    }
    format!("{{\\rtf1\\ansi\\deff0\\uc1{{\\fonttbl{{\\f0\\froman Times New Roman;}}}}\n{body}}}\n")
}

fn rtf_text_paragraph(text_style: Option<&str>, text: &str, forced_italic: bool) -> String {
    let properties = match export_text_style(text_style).as_str() {
        "heading1" => "\\sb240\\b\\fs32",
        "heading2" => "\\sb240\\b\\fs26",
        "quote" => "\\li720\\ri720\\i",
        "indented" => "\\li720",
        "centered" => "\\qc",
        _ => "",
    };
    let runs = link_grouped_segments(inline_segments(text))
        .into_iter()
        .map(|(href, segments)| {
            let inner = segments
                .into_iter()
                .map(|mut segment| {
                    if forced_italic {
                        segment.style.italic = true;
                    }
                    rtf_run(&segment)
                })
                .collect::<String>();
            match href {
                Some(url) => format!(
                    "{{\\field{{\\*\\fldinst HYPERLINK \"{}\"}}{{\\fldrslt {{\\ul {inner}}}}}}}",
                    rtf_escape(&url)
                ),
                None => inner,
            }
        })
        .collect::<String>();
    format!("\\pard\\plain\\f0\\fs24\\sa200{properties} {runs}\\par\n")
}

fn rtf_separator_paragraph() -> String {
    "\\pard\\plain\\f0\\fs24\\sa200\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n".to_string()
}

fn rtf_run(segment: &InlineSegment) -> String {
    let mut controls = String::new();
    if segment.style.bold {
        controls.push_str("\\b");
    }
    if segment.style.italic {
        controls.push_str("\\i");
    }
    if segment.style.underline {
        controls.push_str("\\ul");
    }
    let text = rtf_escape(&segment.text);
    if controls.is_empty() {
        text
    } else {
        format!("{{{controls} {text}}}")
    }
}

fn rtf_escape(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '{' => output.push_str("\\{"),
            '}' => output.push_str("\\}"),
            '\n' => output.push_str("\\line "),
            '\r' => {}
            ch if (ch as u32) < 0x80 => output.push(ch),
            ch => {
                // Non-ASCII goes out as \uN? escapes: N is the signed 16-bit UTF-16
                // code unit (two escapes for a surrogate pair), '?' the ANSI fallback.
                let mut buffer = [0u16; 2];
                for unit in ch.encode_utf16(&mut buffer) {
                    let _ = write!(output, "\\u{}?", *unit as i16);
                }
            }
        }
    }
    output
}

fn rtf_image_paragraph(image: &ExportImage) -> String {
    match resolve_docx_image_render(image) {
        DocxImageRender::Embedded(data) if matches!(data.extension.as_str(), "png" | "jpg") => {
            let blip = if data.extension == "png" {
                "pngblip"
            } else {
                "jpegblip"
            };
            let (width_emu, height_emu) = docx_image_extent(&data);
            // Display size in twips: 914,400 EMU and 1,440 twips per inch, so 635 EMU
            // per twip. Reuses the DOCX max-page scaling.
            let width_twips = (width_emu / 635).max(1);
            let height_twips = (height_emu / 635).max(1);
            let hex = data
                .data
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            format!(
                "\\pard\\qc\\sa200 {{\\pict\\{blip}\\picw{}\\pich{}\\picwgoal{width_twips}\\pichgoal{height_twips} {hex}}}\\par\n",
                data.width_px, data.height_px
            )
        }
        // RTF \pict has no GIF blip type; fall back to the image link.
        DocxImageRender::Embedded(_) => rtf_link_paragraph(&export_image_link(image)),
        DocxImageRender::Link(url) => rtf_link_paragraph(&url),
    }
}

fn rtf_link_paragraph(url: &str) -> String {
    let escaped = rtf_escape(url);
    format!(
        "\\pard\\plain\\f0\\fs24\\sa200\\qc {{\\field{{\\*\\fldinst HYPERLINK \"{escaped}\"}}{{\\fldrslt {{\\ul {escaped}}}}}}}\\par\n"
    )
}

// The XLSX export mirrors the import column layout (`chapter_import/xlsx.rs`): row 1
// holds language-code headers, every chapter row is one sheet row, and a footnote is
// appended to its cell after the `***` separator — so an exported workbook re-imports
// cleanly. Images have no XLSX representation and are skipped, like the TXT export.
fn render_xlsx_workbook(
    title: &str,
    languages: &[ChapterLanguage],
    rows: &[StoredRowFile],
    omit_custom_html: bool,
) -> Result<Vec<u8>, String> {
    if languages.is_empty() {
        return Err("The file does not have any languages to export.".to_string());
    }

    let header = languages
        .iter()
        .map(|language| xlsx_export_header_code(language).to_string())
        .collect::<Vec<_>>();
    let mut sheet_rows = xlsx_row_xml(1, &header);
    for (index, cells) in xlsx_export_rows(languages, rows, omit_custom_html)
        .iter()
        .enumerate()
    {
        sheet_rows.push_str(&xlsx_row_xml(index + 2, cells));
    }

    let sheet_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{sheet_rows}</sheetData></worksheet>"#
    );
    let workbook_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{}" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        escape_xml(&xlsx_sheet_name(title))
    );

    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    write_zip_file(&mut writer, "[Content_Types].xml", xlsx_content_types_xml())?;
    write_zip_file(&mut writer, "_rels/.rels", xlsx_package_rels_xml())?;
    write_zip_file(&mut writer, "xl/workbook.xml", &workbook_xml)?;
    write_zip_file(
        &mut writer,
        "xl/_rels/workbook.xml.rels",
        xlsx_workbook_rels_xml(),
    )?;
    write_zip_file(&mut writer, "xl/worksheets/sheet1.xml", &sheet_xml)?;
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| format!("Could not finish XLSX export: {error}"))
}

/// Header cell for a language column. Duplicate-language columns store a unique code
/// (`zh-Hans-x-2`) with the original in `base_code`; exporting the base code is what
/// lets the import's duplicate-column allocation round-trip the workbook.
fn xlsx_export_header_code(language: &ChapterLanguage) -> &str {
    language
        .base_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .unwrap_or(language.code.as_str())
}

fn xlsx_export_rows(
    languages: &[ChapterLanguage],
    rows: &[StoredRowFile],
    omit_custom_html: bool,
) -> Vec<Vec<String>> {
    rows.iter()
        .filter(|row| row.lifecycle.state != "deleted")
        // Custom-HTML rows carry raw HTML in their cells; when omitting we drop the
        // whole row, otherwise the raw HTML is kept verbatim so an XLSX round-trip
        // back into the editor preserves it.
        .filter(|row| {
            !(omit_custom_html && export_text_style(Some(&row_text_style(row))) == "custom_html")
        })
        .map(|row| {
            languages
                .iter()
                .map(|language| xlsx_cell_value(row.fields.get(&language.code)))
                .collect::<Vec<_>>()
        })
        .filter(|cells| cells.iter().any(|cell| !cell.is_empty()))
        .collect()
}

fn xlsx_cell_value(field: Option<&StoredFieldValue>) -> String {
    let Some(field) = field else {
        return String::new();
    };
    let text = xlsx_separator_text_fallback(field.plain_text.trim());
    let attribution = field.attribution.trim();
    let text = if attribution.is_empty() {
        text
    } else if text.is_empty() {
        attribution.to_string()
    } else {
        format!("{text}\n\n{attribution}")
    };
    let footnote = normalize_editor_footnote_value(&field.footnote);
    let footnote = footnote.trim();
    if footnote.is_empty() {
        text
    } else {
        format!("{text} *** {footnote}")
    }
}

fn xlsx_separator_text_fallback(value: &str) -> String {
    value.split("<hr>").collect::<Vec<_>>().join("\n---\n")
}

fn xlsx_row_xml(row_number: usize, cells: &[String]) -> String {
    let mut xml = format!("<row r=\"{row_number}\">");
    for (column_index, cell) in cells.iter().enumerate() {
        if cell.is_empty() {
            continue;
        }
        let _ = write!(
            xml,
            "<c r=\"{}{row_number}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            xlsx_column_name(column_index),
            escape_xml(cell)
        );
    }
    xml.push_str("</row>");
    xml
}

fn xlsx_column_name(index: usize) -> String {
    let mut name = String::new();
    let mut value = index;
    loop {
        name.insert(0, (b'A' + (value % 26) as u8) as char);
        if value < 26 {
            break;
        }
        value = value / 26 - 1;
    }
    name
}

/// Worksheet names cap at 31 characters and reject `[ ] : * ? / \`.
fn xlsx_sheet_name(title: &str) -> String {
    let cleaned = title
        .chars()
        .filter(|ch| !matches!(ch, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
        .take(31)
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        "Sheet1".to_string()
    } else {
        cleaned
    }
}

fn xlsx_content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#
}

fn xlsx_package_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#
}

fn xlsx_workbook_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>"#
}

fn package_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#
}

fn styles_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="VellumAttribution"><w:name w:val="Vellum Attribution"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style></w:styles>"#
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    fn review_book(include_h1: bool) -> ExportDocument {
        let part = |kind: &str, title: &str, numbered: bool| BookPart {
            item: BookItemInput {
                id: title.into(),
                kind: kind.into(),
                title: title.into(),
                numbered: Some(numbered),
                include_h1_headings: include_h1,
                ..Default::default()
            },
            document: ExportDocument {
                title: title.into(),
                language_code: "en".into(),
                book_parts: vec![],
                blocks: vec![
                    ExportBlock::Text {
                        text_style: "heading1".into(),
                        text: title.into(),
                    },
                    ExportBlock::Text {
                        text_style: "paragraph".into(),
                        text: "Body [1]".into(),
                    },
                    ExportBlock::Footnote {
                        number: 1,
                        marker: 1,
                        anchor_block: Some(1),
                        text: "Preserved note".into(),
                    },
                    ExportBlock::Text {
                        text_style: "heading1".into(),
                        text: format!("Inside {title}"),
                    },
                ],
            },
        };
        compose_book_document(
            "Book",
            "en",
            vec![
                part("contents", "Contents", false),
                part("dedication", "Dedication", false),
                part("chapter", "First", true),
                part("chapter", "Interlude", false),
                part("chapter", "Last", true),
                part("image", "Image page", false),
            ],
        )
    }

    #[test]
    fn composed_documents_share_contents_and_chapter_numbering_without_mutating_pdf_parts() {
        for include_h1 in [false, true] {
            let book = review_book(include_h1);
            let entries: Vec<_> = book.book_parts[0]
                .document
                .blocks
                .iter()
                .filter_map(|block| match block {
                    ExportBlock::Text { text, .. } => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            let expected = if include_h1 {
                vec![
                    "Contents",
                    "1. First",
                    "Inside First",
                    "Interlude",
                    "Inside Interlude",
                    "2. Last",
                    "Inside Last",
                ]
            } else {
                vec!["Contents", "1. First", "Interlude", "2. Last"]
            };
            assert_eq!(entries, expected);
            let html = render_html_document(&book).unwrap();
            assert!(html.contains("<h1>1. First</h1>"));
            assert!(html.contains("<h1>Interlude</h1>"));
            assert!(html.contains("<h1>2. Last</h1>"));
            assert!(render_txt_document(&book).contains("2. LAST"));
            assert!(render_md_document(&book).contains("# 2. Last"));
            assert!(render_rtf_document(&book, false).contains("2. Last"));
            assert_eq!(book.book_parts[2].document.title, "First");
            assert!(
                matches!(&book.book_parts[2].document.blocks[0], ExportBlock::Text { text, .. } if text == "First")
            );

            let bytes = render_docx_document(&book, false).unwrap();
            let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
            let mut xml = String::new();
            zip.by_name("word/document.xml")
                .unwrap()
                .read_to_string(&mut xml)
                .unwrap();
            assert_eq!(xml.matches(">1. First</w:t>").count(), 2);
            assert_eq!(xml.matches(">2. Last</w:t>").count(), 2);
            assert!(xml.contains(" PAGEREF BookItem2 "));
            assert!(!xml.contains(" PAGEREF BookItem1 "));
            assert!(!xml.contains(" PAGEREF BookItem5 "));
            assert_eq!(xml.contains(" PAGEREF BookItem2Block3 "), include_h1);
            assert!(xml.contains("w:name=\"BookItem2Block3\""));
            assert!(xml.contains("Preserved note"));
        }
    }

    #[test]
    fn markdown_bundles_book_images_beside_the_document_and_keeps_remote_links() {
        let root =
            std::env::temp_dir().join(format!("gnosis-markdown-book-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(root.join("cache")).unwrap();
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0L1 1\"/></svg>";
        let id = format!("{:x}.svg", Sha256::digest(svg));
        let source = root.join("cache").join(&id);
        fs::write(&source, svg).unwrap();
        let book = document(vec![
            ExportBlock::Image {
                image: ExportImage::Upload {
                    repo_relative_path: id.clone(),
                    raw_url: None,
                    absolute_path: source.clone(),
                },
                caption: "Logo".into(),
            },
            ExportBlock::Image {
                image: ExportImage::Url("https://example.org/chapter.png".into()),
                caption: "".into(),
            },
        ]);
        let output = root.join("Book vi #1.md");
        let prepared = prepare_markdown_book_images(&book, &output).unwrap();
        let md = render_md_document(&prepared);
        assert!(md.contains(&format!("![](<Book%20vi%20%231.md.assets/{id}>)")));
        assert!(md.contains("![](<https://example.org/chapter.png>)"));
        assert_eq!(
            fs::read(root.join("Book vi #1.md.assets").join(&id)).unwrap(),
            svg
        );
        assert!(matches!(
            &book.blocks[0],
            ExportBlock::Image {
                image: ExportImage::Upload { raw_url: None, .. },
                ..
            }
        ));
        // Repeated exports overwrite the same content-addressed resource safely.
        prepare_markdown_book_images(&book, &output).unwrap();
        fs::remove_file(source).unwrap();
        assert!(prepare_markdown_book_images(&book, &output).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn quote_attribution_survives_document_exports() {
        let document = document(vec![
            ExportBlock::Text {
                text_style: "quote".into(),
                text: "Body".into(),
            },
            ExportBlock::Attribution {
                text: "Author & <b>Work</b>".into(),
            },
        ]);
        let html = render_html_document(&document).unwrap();
        assert!(html.contains("<cite class=\"quote-attribution\">Author &amp; <strong>Work</strong></cite></blockquote>"));
        assert!(html.contains("blockquote{margin:1em 2em;font-style:italic;}"));
        assert!(html.contains(".quote-attribution{display:block;font-size:90%;text-align:right;"));
        assert!(render_txt_document(&document).contains("Author & Work"));
        assert!(render_md_document(&document).contains("> Author & **Work**"));
        let rtf = render_rtf_document(&document, false);
        assert!(rtf.contains("\\li720\\ri720\\i Body"));
        assert!(rtf.contains("\\fs22\\qr"));
        assert!(rtf.contains("Author &"));
        let bytes = render_docx_document(&document, false).unwrap();
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        zip.by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("<w:pStyle w:val=\"VellumAttribution\"/>"));
        assert!(styles_xml().contains("w:val=\"Vellum Attribution\""));
        assert!(styles_xml().contains(r#"<w:name w:val="Quote"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/>"#));
    }

    #[test]
    fn html_quote_attribution_survives_trailing_separators() {
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".into(),
            title: "Chapter".into(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![export_language("en", "target", None)],
            settings: None,
            source_word_count: None,
        };
        for text in ["Body<hr>", "<hr>", "Body<hr><hr>"] {
            let mut quote = row("q", "a", text, "quote");
            quote.fields.get_mut("en").unwrap().attribution = "Author & <b>Work</b>".into();
            let document =
                build_export_document(Path::new("/repo"), &chapter, &[quote], "en", None, "")
                    .unwrap();
            let html = render_html_document(&document).unwrap();
            assert!(html.contains("<hr>\n<blockquote><cite class=\"quote-attribution\">Author &amp; <strong>Work</strong></cite></blockquote>"), "Quote body: {text}");
            assert_eq!(html.matches("<cite ").count(), 1, "Quote body: {text}");
        }
    }

    #[test]
    fn blank_quote_attribution_does_not_create_an_export_block() {
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".into(),
            title: "Chapter".into(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![export_language("en", "target", None)],
            settings: None,
            source_word_count: None,
        };
        for attribution in ["", " \n\t"] {
            let mut quote = row("q", "a", "Body", "quote");
            quote.fields.get_mut("en").unwrap().attribution = attribution.into();
            let document =
                build_export_document(Path::new("/repo"), &chapter, &[quote], "en", None, "")
                    .unwrap();
            assert_eq!(
                document.blocks,
                vec![ExportBlock::Text {
                    text_style: "quote".into(),
                    text: "Body".into()
                }]
            );
            assert!(!render_html_document(&document).unwrap().contains("<cite"));
            let mut zip =
                ZipArchive::new(Cursor::new(render_docx_document(&document, false).unwrap()))
                    .unwrap();
            let mut xml = String::new();
            zip.by_name("word/document.xml")
                .unwrap()
                .read_to_string(&mut xml)
                .unwrap();
            assert!(!xml.contains("VellumAttribution"));
        }
    }

    #[test]
    fn quote_attribution_is_preserved_in_spreadsheet_cells() {
        let field = StoredFieldValue {
            plain_text: "Body".into(),
            attribution: "Author".into(),
            ..Default::default()
        };
        assert_eq!(xlsx_cell_value(Some(&field)), "Body\n\nAuthor");
    }

    #[test]
    fn webp_dimensions_reads_all_three_container_layouts() {
        // Lossy VP8: frame tag, 9d 01 2a start code, 14-bit LE width/height.
        let mut lossy = Vec::new();
        lossy.extend_from_slice(b"RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00");
        lossy.extend_from_slice(&[0, 0, 0]); // frame tag
        lossy.extend_from_slice(&[0x9d, 0x01, 0x2a]);
        lossy.extend_from_slice(&800u16.to_le_bytes());
        lossy.extend_from_slice(&1200u16.to_le_bytes());
        assert_eq!(webp_dimensions(&lossy), Some((800, 1200)));

        // Lossless VP8L: 0x2f signature, then width-1 / height-1 in 14-bit fields.
        let mut lossless = Vec::new();
        lossless.extend_from_slice(b"RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00");
        lossless.push(0x2f);
        let bits: u32 = (799) | ((1199) << 14);
        lossless.extend_from_slice(&bits.to_le_bytes());
        lossless.extend_from_slice(&[0; 8]);
        assert_eq!(webp_dimensions(&lossless), Some((800, 1200)));

        // Extended VP8X: 4 bytes flags/reserved, then 24-bit LE canvas-1 values.
        let mut extended = Vec::new();
        extended.extend_from_slice(b"RIFF\x00\x00\x00\x00WEBPVP8X\x00\x00\x00\x00");
        extended.extend_from_slice(&[0, 0, 0, 0]);
        extended.extend_from_slice(&[0x1f, 0x03, 0x00]); // 799 -> 800
        extended.extend_from_slice(&[0xaf, 0x04, 0x00]); // 1199 -> 1200
        assert_eq!(webp_dimensions(&extended), Some((800, 1200)));

        assert_eq!(webp_dimensions(b"RIFF....WAVEfmt "), None);
        assert_eq!(webp_dimensions(b"not even riff data here ......"), None);
    }

    fn language() -> String {
        "en".to_string()
    }

    #[test]
    fn project_book_export_preserves_order_and_rebases_footnotes_across_formats() {
        let chapter = |title: &str, text: &str| ExportDocument {
            book_parts: Vec::new(),
            title: title.into(),
            language_code: "en".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: text.into(),
                },
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: Some(0),
                    text: format!("Note {title}"),
                },
            ],
        };
        let book = combine_export_documents(
            "Book",
            "en",
            vec![
                chapter("Chapter 2", "Second [1]"),
                chapter("Chapter 10", "Tenth [1]"),
            ],
        );
        assert_eq!(book.title, "Book");
        assert!(matches!(
            book.blocks[2],
            ExportBlock::Footnote {
                number: 1,
                anchor_block: Some(1),
                ..
            }
        ));
        assert!(matches!(
            book.blocks[5],
            ExportBlock::Footnote {
                number: 2,
                anchor_block: Some(4),
                ..
            }
        ));
        let html = render_html_document(&book).unwrap();
        assert!(
            html.find("<h1>Chapter 2</h1>").unwrap() < html.find("<h1>Chapter 10</h1>").unwrap()
        );
        assert!(html.contains("[2] Note Chapter 10"));
        assert!(html.contains("Tenth [2]"));
        assert_eq!(
            remap_visible_footnote_markers(
                r#"字 \[1] <a href="https://example.com/[1]">note [1]</a>"#,
                &BTreeMap::from([(1, 2)])
            ),
            r#"字 \[1] <a href="https://example.com/[1]">note [2]</a>"#
        );
        let md = render_md_document(&book);
        assert!(md.contains("# Chapter 2"));
        assert!(md.contains("# Chapter 10"));
        let bytes = render_docx_document(&book, false).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        zip.by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert_eq!(xml.matches("w:val=\"Heading1\"").count(), 2);
        assert!(xml.find("Second").unwrap() < xml.find("Tenth").unwrap());
    }

    #[test]
    fn project_book_export_keeps_subtitle_files_in_a_continuous_sequence() {
        let chapter = |title: &str| StoredChapterFile {
            chapter_id: title.into(),
            title: title.into(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![export_language("en", "target", None)],
            settings: None,
            source_word_count: None,
        };
        let chapters = vec![
            (
                chapter("One"),
                vec![srt_row("a", "1", "First", Some((0, 2000)), None)],
            ),
            (
                chapter("Two"),
                vec![srt_row(
                    "b",
                    "1",
                    "Next",
                    Some((1000, 3000)),
                    Some((500, 2500)),
                )],
            ),
        ];
        let rows = combined_export_rows(&chapters, true);
        let (srt, skipped) = render_srt_document(&rows, "en");
        assert_eq!(skipped, 0);
        assert!(srt.contains("2\n00:00:02,500 --> 00:00:04,500\nNext"));
        let xlsx_rows = combined_export_rows(&chapters, false);
        assert_eq!(xlsx_rows[1].format_metadata.srt.unwrap().start_ms, 1000);
    }

    #[test]
    fn book_chapter_titles_use_opening_headings_and_export_only_overrides() {
        let source = ExportDocument {
            title: "Source filename".into(),
            language_code: "en".into(),
            book_parts: Vec::new(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "heading1".into(),
                    text: "A <i>leading</i> title".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "The body".into(),
                },
            ],
        };
        let mut item = BookItemInput {
            id: "chapter".into(),
            kind: "chapter".into(),
            title: "Projects name".into(),
            ..Default::default()
        };
        assert_eq!(
            apply_book_chapter_title(source.clone(), &item).title,
            "A leading title"
        );
        item.title_override = Some("Custom export title".into());
        let overridden = apply_book_chapter_title(source.clone(), &item);
        assert_eq!(overridden.title, "Custom export title");
        assert!(
            matches!(&overridden.blocks[0], ExportBlock::Text { text, .. } if text == "Custom export title")
        );
        assert!(
            matches!(&source.blocks[0], ExportBlock::Text { text, .. } if text == "A <i>leading</i> title")
        );
        let bytes = render_docx_document(&overridden, false).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        zip.by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("Custom export title"));
        assert!(!xml.contains("leading"));

        let mut prose_first = source.clone();
        prose_first.blocks.swap(0, 1);
        prose_first.blocks.push(ExportBlock::Footnote {
            number: 1,
            marker: 1,
            anchor_block: Some(0),
            text: "Body note".into(),
        });
        item.title_override = None;
        let fallback = apply_book_chapter_title(prose_first, &item);
        assert_eq!(fallback.title, "Projects name");
        assert!(
            matches!(&fallback.blocks[0], ExportBlock::Text { text, .. } if text == "Projects name")
        );
        assert!(matches!(
            fallback.blocks.last(),
            Some(ExportBlock::Footnote {
                anchor_block: Some(1),
                ..
            })
        ));
        let mut noted = source.clone();
        noted.blocks.push(ExportBlock::Footnote {
            number: 1,
            marker: 2,
            anchor_block: Some(0),
            text: "Title note".into(),
        });
        item.title_override = Some("Renamed".into());
        let noted = apply_book_chapter_title(noted, &item);
        assert!(matches!(&noted.blocks[0], ExportBlock::Text { text, .. } if text == "Renamed[2]"));
    }

    #[test]
    fn composed_docx_keeps_section_order_contents_fields_and_bottom_copyright() {
        let make = |kind: &str, title: &str, text: &str| BookPart {
            item: BookItemInput {
                id: kind.into(),
                kind: kind.into(),
                title: title.into(),
                ..Default::default()
            },
            document: ExportDocument {
                title: title.into(),
                language_code: "en".into(),
                book_parts: Vec::new(),
                blocks: vec![ExportBlock::Text {
                    text_style: if kind == "title" {
                        "heading1".into()
                    } else {
                        "paragraph".into()
                    },
                    text: text.into(),
                }],
            },
        };
        let doc = ExportDocument {
            title: "A Book".into(),
            language_code: "en".into(),
            blocks: Vec::new(),
            book_parts: vec![
                make("title", "A Book", "A Book"),
                make("copyright", "Copyright", "© <i>Example</i>"),
                make("chapter", "One", "Opening one"),
                make("chapter", "Two", "Opening two"),
                make("contents", "Contents", ""),
            ],
        };
        let bytes = render_docx_document(&doc, true).unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        zip.by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(xml.contains("w:vAlign w:val=\"bottom\""));
        assert!(xml.contains("w:type w:val=\"evenPage\""));
        assert!(xml.contains("w:sz w:val=\"60\""));
        assert!(xml.contains(" PAGEREF BookItem2 "));
        assert!(xml.contains(" PAGEREF BookItem3 "));
        assert!(!xml.contains(" PAGEREF BookItem0 "));
        assert!(!xml.contains(" PAGEREF BookItem1 "));
        assert!(xml.find("Opening one").unwrap() < xml.find("Opening two").unwrap());
        let mut reader = quick_xml::Reader::from_str(&xml);
        loop {
            if reader.read_event().expect("well formed DOCX XML") == quick_xml::events::Event::Eof {
                break;
            }
        }
        let mut settings = String::new();
        zip.by_name("word/settings.xml")
            .unwrap()
            .read_to_string(&mut settings)
            .unwrap();
        assert!(settings.contains("w:updateFields w:val=\"true\""));
    }

    fn row(row_id: &str, order_key: &str, text: &str, style: &str) -> StoredRowFile {
        let mut fields = BTreeMap::new();
        fields.insert(
            language(),
            StoredFieldValue {
                plain_text: text.to_string(),
                footnote: String::new(),
                attribution: String::new(),
                image_caption: String::new(),
                image: None,
                editor_flags: StoredFieldEditorFlags::default(),
                timing: None,
            },
        );
        StoredRowFile {
            row_id: row_id.to_string(),
            external_id: None,
            guidance: None,
            lifecycle: active_row_lifecycle_state(),
            structure: StoredRowStructure {
                order_key: order_key.to_string(),
            },
            status: StoredRowStatus {
                review_state: "unreviewed".to_string(),
            },
            origin: StoredRowOrigin {
                source_row_number: 1,
            },
            editor_comments_revision: 0,
            editor_comments: Vec::new(),
            text_style: Some(style.to_string()),
            fields,
            format_metadata: StoredRowFormatMetadata::default(),
        }
    }

    fn srt_row(
        row_id: &str,
        order_key: &str,
        text: &str,
        base_timing: Option<(u64, u64)>,
        override_timing: Option<(u64, u64)>,
    ) -> StoredRowFile {
        let mut stored_row = row(row_id, order_key, text, "normal");
        stored_row.format_metadata.srt =
            base_timing.map(|(start_ms, end_ms)| StoredSrtTiming { start_ms, end_ms });
        if let Some(field) = stored_row.fields.get_mut(&language()) {
            field.timing =
                override_timing.map(|(start_ms, end_ms)| StoredSrtTiming { start_ms, end_ms });
        }
        stored_row
    }

    #[test]
    fn render_srt_document_renumbers_and_formats_cues() {
        let rows = vec![
            srt_row("row-1", "1", "First line.", Some((1000, 2500)), None),
            srt_row("row-2", "2", "Second line.", Some((3000, 4000)), None),
        ];

        let (content, skipped) = render_srt_document(&rows, &language());

        assert_eq!(skipped, 0);
        assert_eq!(
            content,
            "1\n00:00:01,000 --> 00:00:02,500\nFirst line.\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line.\n\n"
        );
    }

    #[test]
    fn partially_translated_srt_round_trips_blank_cues_and_their_timings() {
        let rows = vec![
            srt_row("r1", "1", "", Some((0, 1000)), None),
            srt_row("r2", "2", "", Some((1000, 2000)), None),
            srt_row("r3", "3", "Sentence", Some((2000, 3000)), None),
            srt_row("r4", "4", "", Some((3000, 4000)), None),
        ];
        let (content, skipped) = render_srt_document(&rows, &language());
        assert_eq!(skipped, 0);
        let cues = crate::project_import::chapter_import::parse_translation_srt(
            content.as_bytes(),
            "roundtrip.srt",
        )
        .unwrap();
        assert_eq!(
            cues.iter().map(|cue| cue.text.as_str()).collect::<Vec<_>>(),
            vec!["", "", "Sentence", ""]
        );
        assert_eq!(cues[3].start_ms, 3000);
        assert_eq!(cues[3].end_ms, 4000);
    }

    #[test]
    fn render_srt_document_prefers_language_timing_over_base_timing() {
        let rows = vec![srt_row(
            "row-1",
            "1",
            "Adjusted.",
            Some((1000, 2000)),
            Some((1500, 2600)),
        )];

        let (content, _) = render_srt_document(&rows, &language());

        assert!(content.contains("00:00:01,500 --> 00:00:02,600"));
    }

    #[test]
    fn render_srt_document_keeps_empty_rows_and_skips_untimed_and_deleted_rows() {
        let mut deleted = srt_row("row-3", "3", "Deleted.", Some((9000, 9900)), None);
        deleted.lifecycle = StoredLifecycleState {
            state: "deleted".to_string(),
        };
        let rows = vec![
            srt_row("row-1", "1", "", Some((1000, 2000)), None),
            srt_row("row-2", "2", "No timing anywhere.", None, None),
            deleted,
            srt_row("row-4", "4", "Last.", Some((5000, 6000)), None),
        ];

        let (content, skipped) = render_srt_document(&rows, &language());

        assert_eq!(skipped, 1);
        assert_eq!(
            content,
            "1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:05,000 --> 00:00:06,000\nLast.\n\n"
        );
    }

    fn document(blocks: Vec<ExportBlock>) -> ExportDocument {
        ExportDocument {
            book_parts: Vec::new(),
            title: "Chapter".to_string(),
            language_code: language(),
            blocks,
        }
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut data = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        data.extend_from_slice(&width.to_be_bytes());
        data.extend_from_slice(&height.to_be_bytes());
        data.extend_from_slice(&[8, 6, 0, 0, 0]);
        data
    }

    fn gif_header(width: u16, height: u16) -> Vec<u8> {
        let mut data = b"GIF89a".to_vec();
        data.extend_from_slice(&width.to_le_bytes());
        data.extend_from_slice(&height.to_le_bytes());
        data
    }

    fn jpeg_header(width: u16, height: u16) -> Vec<u8> {
        vec![
            0xff,
            0xd8,
            0xff,
            0xc0,
            0x00,
            0x0b,
            0x08,
            (height >> 8) as u8,
            height as u8,
            (width >> 8) as u8,
            width as u8,
            0x01,
            0x01,
            0x11,
            0x00,
            0xff,
            0xd9,
        ]
    }

    #[test]
    fn export_image_host_check_rejects_non_public_targets() {
        for blocked in [
            "http://localhost/image.png",
            "http://127.0.0.1/image.png",
            "https://127.0.0.1:8443/image.png",
            "http://10.0.0.5/image.png",
            "http://192.168.1.20/image.png",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/image.png",
            "http://[fd00::1]/image.png",
            "http://[fe80::1]/image.png",
            "ftp://example.com/image.png",
            "file:///etc/passwd",
            "not a url",
        ] {
            assert!(
                !is_public_export_image_url(blocked),
                "'{blocked}' should be rejected"
            );
        }
    }

    #[test]
    fn export_image_host_check_allows_public_hosts() {
        // Literal public addresses so the check does not depend on DNS in tests.
        assert!(is_public_export_image_url("http://8.8.8.8/image.png"));
        assert!(is_public_export_image_url(
            "https://[2001:4860:4860::8888]/image.png"
        ));
    }

    #[test]
    fn export_image_literal_ip_request_is_not_pinned() {
        // A literal public IP needs no DNS, so there is nothing to pin.
        let request = validated_export_image_request("http://8.8.8.8/image.png")
            .expect("public literal ip should validate");
        assert!(request.pinned_addresses.is_none());
        // A literal private IP is rejected outright.
        assert!(validated_export_image_request("http://10.0.0.5/image.png").is_err());
    }

    #[test]
    fn image_download_failures_are_specific_and_only_transient_failures_retry() {
        assert!(matches!(
            validated_export_image_request("file:///etc/passwd"),
            Err(PublicImageDownloadError::UnsupportedScheme)
        ));
        assert!(matches!(
            validated_export_image_request("http://127.0.0.1/image.png"),
            Err(PublicImageDownloadError::UnsafeHost)
        ));
        assert!(PublicImageDownloadError::TimedOut.is_retryable());
        assert!(PublicImageDownloadError::HttpStatus(429).is_retryable());
        assert!(PublicImageDownloadError::HttpStatus(503).is_retryable());
        assert!(!PublicImageDownloadError::HttpStatus(404).is_retryable());
        assert!(!PublicImageDownloadError::UnsafeHost.is_retryable());
        assert_eq!(
            PublicImageDownloadError::TooLarge.to_string(),
            "the image is larger than 25 MB"
        );
    }

    #[test]
    fn public_image_download_smoke_when_url_is_configured() {
        let Ok(url) = std::env::var("GNOSIS_IMAGE_DOWNLOAD_SMOKE_URL") else {
            return;
        };
        let data = download_public_image_bytes_detailed(&url)
            .unwrap_or_else(|error| panic!("{url}: {error}"));
        assert!(!data.is_empty(), "{url} returned an empty response");
    }

    #[test]
    fn export_image_ip_classifier_marks_public_and_private_ranges() {
        assert!(is_public_ip("8.8.8.8".parse().expect("ipv4")));
        assert!(is_public_ip("2606:4700:4700::1111".parse().expect("ipv6")));
        assert!(!is_public_ip("10.1.2.3".parse().expect("ipv4")));
        assert!(!is_public_ip("100.64.0.1".parse().expect("ipv4")));
        assert!(!is_public_ip("::ffff:127.0.0.1".parse().expect("ipv6")));
    }

    #[test]
    fn txt_export_applies_text_style_rules_and_ignores_images() {
        let output = render_txt_document(&document(vec![
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "<strong>Plain</strong>".to_string(),
            },
            ExportBlock::Text {
                text_style: "heading1".to_string(),
                text: "Heading".to_string(),
            },
            ExportBlock::Text {
                text_style: "heading2".to_string(),
                text: "Subhead".to_string(),
            },
            ExportBlock::Text {
                text_style: "quote".to_string(),
                text: "Quote".to_string(),
            },
            ExportBlock::Image {
                image: ExportImage::Url("https://example.com/image.png".to_string()),
                caption: "Caption".to_string(),
            },
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: None,
                text: "Note".to_string(),
            },
        ]));

        assert!(output.contains("Plain"));
        assert!(output.contains("HEADING"));
        assert!(output.contains(">>> SUBHEAD"));
        assert!(output.contains("<blockquote>\nQuote\n</blockquote>"));
        assert!(output.contains("[1] Note"));
        assert!(!output.contains("Caption"));
    }

    #[test]
    fn html_export_preserves_styles_inline_markup_footnotes_and_images() {
        let output = render_html_document(&document(vec![
            ExportBlock::Text {
                text_style: "heading1".to_string(),
                text: "<b>Hello</b> <ruby>字<rt>zi</rt></ruby>".to_string(),
            },
            ExportBlock::Image {
                image: ExportImage::Url("https://example.com/image.png".to_string()),
                caption: "<i>Caption</i>".to_string(),
            },
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: None,
                text: "<u>Note</u>".to_string(),
            },
        ]))
        .expect("html should render");

        assert!(output.contains("<h1><strong>Hello</strong> <ruby>字<rt>zi</rt></ruby></h1>"));
        assert!(output.contains("<figure><img src=\"https://example.com/image.png\""));
        assert!(output.contains("<figcaption><em><em>Caption</em></em></figcaption>"));
        assert!(output.contains("<p class=\"footnote\"><em>[1] <u>Note</u></em></p>"));
    }

    #[test]
    fn html_export_emits_custom_html_rows_verbatim() {
        let output = render_html_document(&document(vec![ExportBlock::Text {
            text_style: "custom_html".to_string(),
            text: "<div class=\"callout\"><hr>Raw &amp; <b>bold</b></div>".to_string(),
        }]))
        .expect("html should render");

        // Raw HTML passes through untouched — not escaped, not wrapped in <p>, and
        // its inner "<hr>" is not treated as a separator.
        assert!(output.contains("<div class=\"callout\"><hr>Raw &amp; <b>bold</b></div>"));
        assert!(!output.contains("<p><div"));
    }

    #[test]
    fn print_policy_omits_or_flattens_custom_html_rows() {
        let doc = document(vec![
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Keep".to_string(),
            },
            ExportBlock::Text {
                text_style: "custom_html".to_string(),
                text: "<p>Hello&nbsp;<b>world</b></p>".to_string(),
            },
        ]);

        let omitted = apply_print_custom_html_policy(&doc, true);
        assert_eq!(omitted.blocks.len(), 1);
        let omitted_txt = render_txt_document(&omitted);
        assert!(omitted_txt.contains("Keep"));
        assert!(!omitted_txt.contains("world"));

        let flattened = apply_print_custom_html_policy(&doc, false);
        let flattened_txt = render_txt_document(&flattened);
        assert!(flattened_txt.contains("Keep"));
        assert!(flattened_txt.contains("Hello world"));
        assert!(!flattened_txt.contains("<b>"));
    }

    #[test]
    fn custom_html_to_plain_text_strips_tags_and_decodes_entities() {
        assert_eq!(
            custom_html_to_plain_text("<p>Hi&nbsp;<a href=\"x\">there</a> &amp; more</p>"),
            "Hi there & more"
        );
    }

    #[test]
    fn exports_render_separator_blocks() {
        let doc = document(vec![
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Before".to_string(),
            },
            ExportBlock::Separator,
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "After".to_string(),
            },
        ]);

        let html = render_html_document(&doc).expect("html should render");
        assert!(html.contains("<p>Before</p>\n<hr>\n<p>After</p>"));

        let txt = render_txt_document(&doc);
        assert!(txt.contains("Before\n\n---\n\nAfter"));

        let md = render_md_document(&doc);
        assert!(md.contains("Before\n\n---\n\nAfter"));

        let rtf = render_rtf_document(&doc, false);
        assert!(rtf.contains("\\brdrb\\brdrs\\brdrw10"));

        let bytes = render_docx_document(&doc, false).expect("docx should render");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx should be zip");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");
        assert!(xml.contains("<w:pBdr>"));
        assert!(xml.contains(r#"<w:bottom w:val="single""#));
    }

    #[test]
    fn sanitize_inline_html_preserves_valid_links_and_escapes_unsafe_ones() {
        assert_eq!(
            sanitize_inline_html("see <a href=\"https://example.com/page\">the page</a>"),
            "see <a href=\"https://example.com/page\">the page</a>"
        );
        assert_eq!(
            sanitize_inline_html("see <a href=\"https://example.com/?a=1&amp;b=2\">x</a>"),
            "see <a href=\"https://example.com/?a=1&amp;b=2\">x</a>"
        );
        assert_eq!(
            sanitize_inline_html("<a href=\"javascript:alert(1)\">x</a>"),
            "&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;"
        );
        assert_eq!(
            sanitize_inline_html("<a href=\"https://example.com\" target=\"_blank\">x</a>"),
            "&lt;a href=&quot;https://example.com&quot; target=&quot;_blank&quot;&gt;x&lt;/a&gt;"
        );
    }

    #[test]
    fn inline_visible_text_strips_link_tags_but_keeps_link_text() {
        assert_eq!(
            inline_visible_text("see <a href=\"https://example.com/page\">the page</a> now"),
            "see the page now"
        );
    }

    #[test]
    fn inline_segments_carry_link_hrefs_without_leaking_tag_text() {
        let segments =
            inline_segments("see <a href=\"https://example.com\">the <b>bold</b> page</a>");
        let text: String = segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect();
        assert_eq!(text, "see the bold page");
        assert_eq!(segments[0].style.link, None);
        assert!(segments[1..]
            .iter()
            .all(|segment| segment.style.link.as_deref() == Some("https://example.com")));
    }

    #[test]
    fn txt_export_appends_link_destinations() {
        let output = render_txt_document(&document(vec![
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "see <a href=\"https://example.com/page\">the page</a> now".to_string(),
            },
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: None,
                text: "<a href=\"https://example.com/note\">note</a>".to_string(),
            },
        ]));

        assert!(output.contains("see the page (https://example.com/page) now"));
        assert!(output.contains("[1] note (https://example.com/note)"));
    }

    #[test]
    fn md_export_renders_links_with_grouped_styles() {
        let output = render_md_document(&document(vec![ExportBlock::Text {
            text_style: "paragraph".to_string(),
            text: "see <a href=\"https://example.com/page\">the <b>bold</b> page</a>".to_string(),
        }]));

        assert!(output.contains("see [the **bold** page](<https://example.com/page>)"));
    }

    #[test]
    fn append_link_urls_to_inline_appends_destination_for_named_links() {
        let output = append_link_urls_to_inline(
            "read <a href=\"https://example.com/page\">the page</a> now",
        );
        assert_eq!(
            output,
            "read <a href=\"https://example.com/page\">the page</a> (https://example.com/page) now"
        );
    }

    #[test]
    fn append_link_urls_to_inline_skips_links_whose_text_is_a_url() {
        let output =
            append_link_urls_to_inline("<a href=\"https://example.com/\">https://example.com</a>");
        assert_eq!(
            output,
            "<a href=\"https://example.com/\">https://example.com</a>"
        );
    }

    #[test]
    fn docx_footnote_links_render_as_plain_text_when_option_enabled() {
        let blocks = vec![ExportBlock::Footnote {
            number: 1,
            marker: 1,
            anchor_block: None,
            text: "see <a href=\"https://example.com/page\">the page</a>".to_string(),
        }];
        let bytes = render_docx_document(&document(blocks.clone()), true).expect("docx renders");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx zip");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");
        // The hyperlink field is still present, followed by the URL as plain text.
        assert!(xml.contains("HYPERLINK \"https://example.com/page\""));
        assert!(xml.contains(r#"<w:t xml:space="preserve"> (https://example.com/page)</w:t>"#));

        // Off by default: no plain-text URL.
        let bytes = render_docx_document(&document(blocks), false).expect("docx renders");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx zip");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");
        assert!(!xml.contains("(https://example.com/page)"));
    }

    #[test]
    fn rtf_footnote_links_render_as_plain_text_when_option_enabled() {
        let blocks = vec![ExportBlock::Footnote {
            number: 1,
            marker: 1,
            anchor_block: None,
            text: "see <a href=\"https://example.com/page\">the page</a>".to_string(),
        }];
        let output = render_rtf_document(&document(blocks.clone()), true);
        assert!(output.contains("HYPERLINK \"https://example.com/page\""));
        assert!(output.contains("(https://example.com/page)"));

        let output = render_rtf_document(&document(blocks), false);
        assert!(!output.contains("(https://example.com/page)"));
    }

    #[test]
    fn rtf_export_renders_links_as_hyperlink_fields() {
        let output = render_rtf_document(
            &document(vec![ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "see <a href=\"https://example.com/page\">the page</a>".to_string(),
            }]),
            false,
        );

        assert!(output.contains(
            "{\\field{\\*\\fldinst HYPERLINK \"https://example.com/page\"}{\\fldrslt {\\ul the page}}}"
        ));
    }

    #[test]
    fn docx_paragraphs_render_links_as_hyperlink_fields() {
        let xml = docx_text_paragraph_xml(
            Some("paragraph"),
            "see <a href=\"https://example.com/page?a=1&amp;b=2\">the page</a>",
            false,
        );

        assert!(xml.contains(
            r#"<w:instrText xml:space="preserve"> HYPERLINK "https://example.com/page?a=1&amp;b=2" </w:instrText>"#
        ));
        assert!(xml.contains(r#"<w:fldChar w:fldCharType="begin"/>"#));
        assert!(xml.contains(r#"<w:fldChar w:fldCharType="end"/>"#));
        assert!(xml.contains(
            r#"<w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">the page</w:t></w:r>"#
        ));
    }

    #[test]
    fn xlsx_cells_keep_raw_link_markup_for_round_trip() {
        let field = StoredFieldValue {
            plain_text: "see <a href=\"https://example.com\">the page</a>".to_string(),
            ..Default::default()
        };
        assert_eq!(
            xlsx_cell_value(Some(&field)),
            "see <a href=\"https://example.com\">the page</a>"
        );
    }

    #[test]
    fn xlsx_cells_render_separator_token_as_text_fallback() {
        let field = StoredFieldValue {
            plain_text: "Before<hr>After".to_string(),
            ..Default::default()
        };
        assert_eq!(xlsx_cell_value(Some(&field)), "Before\n---\nAfter");
    }

    #[test]
    fn html_export_embeds_uploaded_images_as_data_urls() {
        let image_bytes = png_header(12, 8);
        let image_path = std::env::temp_dir().join(format!(
            "gnosis-tms-html-export-image-{}-{}.png",
            std::process::id(),
            "upload"
        ));
        fs::write(&image_path, &image_bytes).expect("image should be written");

        let output = render_html_document(&document(vec![ExportBlock::Image {
            image: ExportImage::Upload {
                repo_relative_path: "chapters/ch-1/images/row/image.png".to_string(),
                raw_url: Some(
                    "https://raw.githubusercontent.com/org/repo/abc123/chapters/ch-1/images/row/image.png"
                        .to_string(),
                ),
                absolute_path: image_path.clone(),
            },
            caption: String::new(),
        }]))
        .expect("html should render");

        let _ = fs::remove_file(&image_path);
        assert!(output.contains(&format!(
            "src=\"data:image/png;base64,{}\"",
            BASE64_STANDARD.encode(image_bytes)
        )));
        assert!(!output.contains("raw.githubusercontent.com"));
    }

    #[test]
    fn docx_export_contains_required_parts_and_inline_markers() {
        let bytes = render_docx_document(
            &document(vec![ExportBlock::Text {
                text_style: "heading2".to_string(),
                text: "<strong>Bold</strong> <em>Italic</em> <u>Under</u>".to_string(),
            }]),
            false,
        )
        .expect("docx should render");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx should be zip");
        assert!(archive.by_name("[Content_Types].xml").is_ok());
        assert!(archive.by_name("word/document.xml").is_ok());
        assert!(archive.by_name("word/styles.xml").is_ok());

        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");
        assert!(xml.contains(r#"<w:pStyle w:val="Heading2"/>"#));
        assert!(xml.contains("<w:b/>"));
        assert!(xml.contains("<w:i/>"));
        assert!(xml.contains(r#"<w:u w:val="single"/>"#));
    }

    #[test]
    fn docx_export_renders_within_row_newline_as_line_break() {
        let bytes = render_docx_document(
            &document(vec![ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Line one\nLine two".to_string(),
            }]),
            false,
        )
        .expect("docx should render");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx should be zip");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");

        // The newline becomes an in-paragraph <w:br/>, not a raw LF that Word
        // would collapse, and both halves stay in the same paragraph.
        assert!(xml.contains(
            r#"<w:t xml:space="preserve">Line one</w:t><w:br/><w:t xml:space="preserve">Line two</w:t>"#
        ));
        assert!(!xml.contains("Line one\nLine two"));
    }

    #[test]
    fn docx_export_renders_well_formed_ruby_markup() {
        let bytes = render_docx_document(
            &document(vec![ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "<ruby>字<rt>zi</rt></ruby>".to_string(),
            }]),
            false,
        )
        .expect("docx should render");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("docx should be zip");
        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut xml)
            .expect("document xml reads");

        assert!(xml.contains("<w:ruby>"));
        assert!(xml.contains("<w:rt>"));
        assert!(xml.contains("<w:rubyBase>"));
        assert!(xml.contains(">字<"));
        assert!(xml.contains(">zi<"));
    }

    #[test]
    fn docx_image_metadata_reads_dimensions_for_supported_formats() {
        assert_eq!(
            docx_image_info(&png_header(320, 160)),
            Some(("png".to_string(), 320, 160))
        );
        assert_eq!(
            docx_image_info(&gif_header(240, 120)),
            Some(("gif".to_string(), 240, 120))
        );
        assert_eq!(
            docx_image_info(&jpeg_header(640, 320)),
            Some(("jpg".to_string(), 640, 320))
        );
    }

    #[test]
    fn docx_image_xml_preserves_aspect_ratio() {
        let image = DocxImage {
            data: png_header(2000, 1000),
            extension: "png".to_string(),
            width_px: 2000,
            height_px: 1000,
        };
        let xml = docx_image_paragraph_xml("rId1", &image);

        assert!(xml.contains(r#"cx="4572000""#));
        assert!(xml.contains(r#"cy="2286000""#));
        assert!(xml.contains(r#"<a:ext cx="4572000" cy="2286000"/>"#));
    }

    #[test]
    fn uploaded_image_keeps_raw_github_url_for_docx_fallbacks() {
        let image = export_image(
            Path::new("/repo"),
            &Some(StoredFieldImage {
                kind: "upload".to_string(),
                url: None,
                path: Some("chapters/ch-1/images/row/image.png".to_string()),
            }),
            Some("org/repo"),
            "abc123",
        )
        .expect("image should export");
        assert_eq!(
            image,
            ExportImage::Upload {
                repo_relative_path: "chapters/ch-1/images/row/image.png".to_string(),
                raw_url: Some(
                    "https://raw.githubusercontent.com/org/repo/abc123/chapters/ch-1/images/row/image.png"
                        .to_string()
                ),
                absolute_path: Path::new("/repo")
                    .join("chapters/ch-1/images/row/image.png"),
            }
        );
    }

    #[test]
    fn block_builder_skips_deleted_rows_and_numbers_footnotes() {
        let mut active = row("row-1", "a", "Text", "paragraph");
        {
            let field = active.fields.get_mut("en").expect("field exists");
            field.footnote = "Note".to_string();
            field.image_caption = "Active caption".to_string();
            field.image = Some(StoredFieldImage {
                kind: "url".to_string(),
                url: Some("https://example.com/active.png".to_string()),
                path: None,
            });
        }
        let mut deleted = row("row-2", "b", "Deleted", "paragraph");
        deleted.lifecycle.state = "deleted".to_string();
        {
            let field = deleted.fields.get_mut("en").expect("field exists");
            field.footnote = "Deleted note".to_string();
            field.image_caption = "Deleted caption".to_string();
            field.image = Some(StoredFieldImage {
                kind: "url".to_string(),
                url: Some("https://example.com/deleted.png".to_string()),
                path: None,
            });
        }
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![ChapterLanguage {
                code: "en".to_string(),
                name: "English".to_string(),
                role: "target".to_string(),
                base_code: None,
            }],
            settings: None,
            source_word_count: None,
        };
        let document = build_export_document(
            Path::new("/repo"),
            &chapter,
            &[active, deleted],
            "en",
            Some("org/repo"),
            "abc123",
        )
        .expect("document should build");
        assert_eq!(document.blocks.len(), 3);
        assert_eq!(
            document.blocks[0],
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Text".to_string(),
            }
        );
        assert_eq!(
            document.blocks[1],
            ExportBlock::Image {
                image: ExportImage::Url("https://example.com/active.png".to_string()),
                caption: "Active caption".to_string(),
            }
        );
        assert_eq!(
            document.blocks[2],
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                // The unmarked note anchors to the row's text block (0), not the image
                // (1), so the PDF export attaches it to the end of that paragraph.
                anchor_block: Some(0),
                text: "Note".to_string(),
            }
        );

        let txt = render_txt_document(&document);
        assert!(txt.contains("Text"));
        assert!(txt.contains("[1] Note"));
        assert!(!txt.contains("Deleted"));
        assert!(!txt.contains("Deleted note"));

        let html = render_html_document(&document).expect("html should render");
        assert!(html.contains("Text"));
        assert!(html.contains("https://example.com/active.png"));
        assert!(html.contains("Active caption"));
        assert!(html.contains("[1] Note"));
        assert!(!html.contains("Deleted"));
        assert!(!html.contains("Deleted note"));
        assert!(!html.contains("Deleted caption"));
        assert!(!html.contains("https://example.com/deleted.png"));

        let docx = render_docx_document(&document, false).expect("docx should render");
        let mut archive = ZipArchive::new(Cursor::new(docx)).expect("docx should be zip");
        let mut docx_text = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document exists")
            .read_to_string(&mut docx_text)
            .expect("document xml reads");
        assert!(docx_text.contains(">Text<"));
        assert!(docx_text.contains(">Active caption<"));
        assert!(docx_text.contains("Note"));
        assert!(!docx_text.contains("Deleted"));
        assert!(!docx_text.contains("Deleted note"));
        assert!(!docx_text.contains("Deleted caption"));
    }

    #[test]
    fn block_builder_binds_numbered_notes_to_mid_paragraph_markers() {
        let mut active = row("row-1", "a", "Before [2] after.", "paragraph");
        active.fields.get_mut("en").expect("field exists").footnote =
            "[2] A note in the middle".to_string();
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![export_language("en", "target", None)],
            settings: None,
            source_word_count: None,
        };

        let document =
            build_export_document(Path::new("/repo"), &chapter, &[active], "en", None, "")
                .expect("document should build");

        assert_eq!(
            document.blocks[1],
            ExportBlock::Footnote {
                number: 1,
                marker: 2,
                anchor_block: Some(0),
                text: "A note in the middle".to_string(),
            }
        );
    }

    #[test]
    fn block_builder_anchors_row_level_footnotes_to_the_last_text_block() {
        // A footnote whose marker never appears inline (an unlabeled `[]` row footnote)
        // must anchor to the row's text block so the PDF export attaches it to the end
        // of that paragraph instead of floating it onto the next one.
        let mut active = row("row-1", "a", "The Tarot of the Bohemians.", "paragraph");
        active.fields.get_mut("en").expect("field exists").footnote =
            "[] Astral Light is Lumière Astrale.".to_string();
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![export_language("en", "target", None)],
            settings: None,
            source_word_count: None,
        };

        let document =
            build_export_document(Path::new("/repo"), &chapter, &[active], "en", None, "")
                .expect("document should build");

        assert!(matches!(
            document.blocks[1],
            ExportBlock::Footnote {
                anchor_block: Some(0),
                ..
            }
        ));
    }

    #[test]
    fn block_builder_splits_text_rows_on_separator_tokens() {
        let active = row("row-1", "a", "Before<hr>After", "paragraph");
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![ChapterLanguage {
                code: "en".to_string(),
                name: "English".to_string(),
                role: "target".to_string(),
                base_code: None,
            }],
            settings: None,
            source_word_count: None,
        };

        let document = build_export_document(
            Path::new("/repo"),
            &chapter,
            &[active],
            "en",
            Some("org/repo"),
            "abc123",
        )
        .expect("document should build");

        assert_eq!(
            document.blocks,
            vec![
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    text: "Before".to_string(),
                },
                ExportBlock::Separator,
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    text: "After".to_string(),
                },
            ]
        );
    }

    fn export_language(code: &str, role: &str, base_code: Option<&str>) -> ChapterLanguage {
        ChapterLanguage {
            code: code.to_string(),
            name: code.to_string(),
            role: role.to_string(),
            base_code: base_code.map(|value| value.to_string()),
        }
    }

    fn field_value(text: &str, footnote: &str) -> StoredFieldValue {
        StoredFieldValue {
            plain_text: text.to_string(),
            footnote: footnote.to_string(),
            attribution: String::new(),
            image_caption: String::new(),
            image: None,
            editor_flags: StoredFieldEditorFlags::default(),
            timing: None,
        }
    }

    #[test]
    fn xlsx_export_mirrors_import_layout_and_round_trips() {
        use calamine::{open_workbook_auto_from_rs, Reader};

        let languages = vec![
            export_language("es", "source", None),
            export_language("en", "target", None),
            export_language("en-x-2", "target", Some("en")),
        ];

        let mut first = row("row-1", "a", "", "paragraph");
        first.fields.clear();
        first
            .fields
            .insert("es".to_string(), field_value("Hola", ""));
        first
            .fields
            .insert("en".to_string(), field_value("Hello", "First note"));
        first
            .fields
            .insert("en-x-2".to_string(), field_value("Hullo", ""));

        let mut deleted = row("row-2", "b", "Gone", "paragraph");
        deleted.lifecycle.state = "deleted".to_string();

        let mut blank = row("row-3", "c", "", "paragraph");
        blank.fields.clear();

        let bytes =
            render_xlsx_workbook("Chapter: One?", &languages, &[first, deleted, blank], false)
                .expect("xlsx should render");
        let mut workbook =
            open_workbook_auto_from_rs(Cursor::new(bytes)).expect("workbook should open");
        assert_eq!(workbook.sheet_names(), vec!["Chapter One".to_string()]);
        let range = workbook
            .worksheet_range_at(0)
            .expect("worksheet exists")
            .expect("worksheet reads");
        let rows = range
            .rows()
            .map(|cells| {
                cells
                    .iter()
                    .map(|cell| cell.to_string())
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        // Duplicate-language columns export their base code so the import's
        // duplicate-column allocation reproduces the same chapter languages.
        assert_eq!(rows[0], vec!["es", "en", "en"]);
        assert_eq!(rows[1], vec!["Hola", "Hello *** First note", "Hullo"]);
        // The deleted row and the wholly empty row are not exported.
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn xlsx_column_names_extend_past_single_letters() {
        assert_eq!(xlsx_column_name(0), "A");
        assert_eq!(xlsx_column_name(25), "Z");
        assert_eq!(xlsx_column_name(26), "AA");
        assert_eq!(xlsx_column_name(51), "AZ");
        assert_eq!(xlsx_column_name(52), "BA");
        assert_eq!(xlsx_column_name(701), "ZZ");
        assert_eq!(xlsx_column_name(702), "AAA");
    }

    #[test]
    fn md_export_maps_styles_images_and_footnotes() {
        let output = render_md_document(&document(vec![
            ExportBlock::Text {
                text_style: "heading1".to_string(),
                text: "Title".to_string(),
            },
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "<b>Bold</b> and <i>italic</i> and <u>under</u>".to_string(),
            },
            ExportBlock::Image {
                image: ExportImage::Url("https://example.com/image.png".to_string()),
                caption: "Caption".to_string(),
            },
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: None,
                text: "Note".to_string(),
            },
            ExportBlock::Text {
                text_style: "quote".to_string(),
                text: "Line one\nLine two".to_string(),
            },
            ExportBlock::Text {
                text_style: "heading2".to_string(),
                text: "Sub".to_string(),
            },
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Stars * and [brackets]".to_string(),
            },
        ]));

        assert!(output.contains("# Title"));
        // The footnote reference lands at the end of its row's paragraph.
        assert!(output.contains("**Bold** and *italic* and <u>under</u>[^1]"));
        assert!(output.contains("![](<https://example.com/image.png>)"));
        assert!(output.contains("*Caption*"));
        assert!(output.contains("> Line one\n> Line two"));
        assert!(output.contains("## Sub"));
        assert!(output.contains("Stars \\* and \\[brackets\\]"));
        // Footnote definitions collect at the end of the document.
        assert!(output.trim_end().ends_with("[^1]: Note"));
    }

    #[test]
    fn md_export_links_uploaded_images_at_their_raw_url() {
        let output = render_md_document(&document(vec![ExportBlock::Image {
            image: ExportImage::Upload {
                repo_relative_path: "chapters/ch-1/images/row/image.png".to_string(),
                raw_url: Some(
                    "https://raw.githubusercontent.com/org/repo/abc123/chapters/ch-1/images/row/image.png"
                        .to_string(),
                ),
                absolute_path: PathBuf::from("/repo/chapters/ch-1/images/row/image.png"),
            },
            caption: String::new(),
        }]));

        assert!(output.contains(
            "![](<https://raw.githubusercontent.com/org/repo/abc123/chapters/ch-1/images/row/image.png>)"
        ));
    }

    #[test]
    fn rtf_export_renders_styles_inline_marks_and_unicode() {
        let output = render_rtf_document(
            &document(vec![
                ExportBlock::Text {
                    text_style: "heading2".to_string(),
                    text: "<b>Bold</b> <u>Under</u>".to_string(),
                },
                ExportBlock::Text {
                    text_style: "quote".to_string(),
                    text: "Quote".to_string(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    text: "字 {braces} \\slash".to_string(),
                },
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: None,
                    text: "Note".to_string(),
                },
            ]),
            false,
        );

        assert!(output.starts_with("{\\rtf1\\ansi"));
        assert!(output.contains("\\sb240\\b\\fs26"));
        assert!(output.contains("{\\b Bold}"));
        assert!(output.contains("{\\ul Under}"));
        assert!(output.contains("\\li720\\ri720\\i Quote"));
        assert!(output.contains("\\u23383?"));
        assert!(output.contains("\\{braces\\}"));
        assert!(output.contains("\\\\slash"));
        assert!(output.contains("{\\i [1] Note}"));
        assert!(output.ends_with("}\n"));
    }

    #[test]
    fn rtf_export_embeds_local_png_images_with_scaled_goals() {
        let image_bytes = png_header(12, 8);
        let image_path = std::env::temp_dir().join(format!(
            "gnosis-tms-rtf-export-image-{}.png",
            std::process::id()
        ));
        fs::write(&image_path, &image_bytes).expect("image should be written");

        let output = render_rtf_document(
            &document(vec![ExportBlock::Image {
                image: ExportImage::Upload {
                    repo_relative_path: "chapters/ch-1/images/row/image.png".to_string(),
                    raw_url: None,
                    absolute_path: image_path.clone(),
                },
                caption: "Caption".to_string(),
            }]),
            false,
        );
        let _ = fs::remove_file(&image_path);

        assert!(output.contains("\\pict\\pngblip\\picw12\\pich8\\picwgoal180\\pichgoal120"));
        assert!(output.contains(
            &image_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        assert!(output.contains("{\\i Caption}"));
    }

    #[test]
    fn rtf_export_falls_back_to_a_link_for_unfetchable_image_urls() {
        // A non-public host fails URL validation before any network request, which
        // exercises the link fallback without fetching anything in tests.
        let output = render_rtf_document(
            &document(vec![ExportBlock::Image {
                image: ExportImage::Url("http://127.0.0.1/image.png".to_string()),
                caption: String::new(),
            }]),
            false,
        );

        assert!(output.contains("HYPERLINK \"http://127.0.0.1/image.png\""));
        assert!(!output.contains("\\pict"));
    }
}
