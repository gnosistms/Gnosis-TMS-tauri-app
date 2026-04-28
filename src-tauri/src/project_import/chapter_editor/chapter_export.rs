use super::*;
use reqwest::blocking::Client as BlockingClient;
use std::io::{Cursor, Write};
use std::time::Duration;
use zip::{write::SimpleFileOptions, ZipWriter};

const UNSUPPORTED_FUNCTION_MESSAGE: &str =
    "Contact the developers if you need this feature and ask them to implement it.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportChapterFileInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    #[serde(default)]
    project_full_name: Option<String>,
    chapter_id: String,
    language_code: String,
    format: String,
    output_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ExportImage {
    Url(String),
    Upload {
        repo_relative_path: String,
        raw_url: Option<String>,
        absolute_path: PathBuf,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ExportBlock {
    Text { text_style: String, text: String },
    Image { image: ExportImage, caption: String },
    Footnote { number: usize, text: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ExportDocument {
    title: String,
    language_code: String,
    blocks: Vec<ExportBlock>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct InlineStyleState {
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct InlineSegment {
    text: String,
    style: InlineStyleState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DocxImage {
    data: Vec<u8>,
    extension: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DocxImageRender {
    Embedded(DocxImage),
    Link(String),
}

pub(crate) fn export_gtms_chapter_file_sync(
    app: &AppHandle,
    input: ExportChapterFileInput,
) -> Result<(), String> {
    let format = input.format.trim().to_lowercase();
    if matches!(format.as_str(), "xlsx" | "srt") {
        return Err(UNSUPPORTED_FUNCTION_MESSAGE.to_string());
    }
    if !matches!(format.as_str(), "docx" | "txt" | "html") {
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    if !languages
        .iter()
        .any(|language| language.code == input.language_code)
    {
        return Err("The selected export language is not available in this file.".to_string());
    }

    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let head_sha = current_repo_head_sha(&repo_path);
    let full_name = resolve_project_full_name(&repo_path, input.project_full_name.as_deref());
    let document = build_export_document(
        &repo_path,
        &chapter_file,
        &rows,
        &input.language_code,
        full_name.as_deref(),
        head_sha.as_deref().unwrap_or_default(),
    )?;

    let output_path = PathBuf::from(input.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }

    match format.as_str() {
        "html" => {
            ensure_html_uploaded_image_urls(&document)?;
            fs::write(&output_path, render_html_document(&document))
                .map_err(|error| format!("Could not write '{}': {error}", output_path.display()))
        }
        "txt" => fs::write(&output_path, render_txt_document(&document))
            .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        "docx" => fs::write(&output_path, render_docx_document(&document)?)
            .map_err(|error| format!("Could not write '{}': {error}", output_path.display())),
        _ => Err("Unsupported export format.".to_string()),
    }
}

fn ensure_html_uploaded_image_urls(document: &ExportDocument) -> Result<(), String> {
    for block in &document.blocks {
        if let ExportBlock::Image {
            image: ExportImage::Upload { raw_url: None, .. },
            ..
        } = block
        {
            return Err(
                "Could not build a GitHub URL for an uploaded image in this chapter.".to_string(),
            );
        }
    }
    Ok(())
}

fn build_export_document(
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
        if let Some(text) = field
            .map(|value| value.plain_text.trim())
            .filter(|text| !text.is_empty())
        {
            blocks.push(ExportBlock::Text {
                text_style: row_text_style(row),
                text: text.to_string(),
            });
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

        if let Some(footnote) = field
            .map(|value| normalize_editor_footnote_value(&value.footnote))
            .filter(|text| !text.trim().is_empty())
        {
            footnote_count += 1;
            blocks.push(ExportBlock::Footnote {
                number: footnote_count,
                text: footnote,
            });
        }
    }

    Ok(ExportDocument {
        title: chapter_file.title.clone(),
        language_code: language_code.to_string(),
        blocks,
    })
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

fn sanitize_inline_html(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        let tag = allowed_inline_tag(remaining);
        if let Some((source, replacement)) = tag {
            output.push_str(replacement);
            cursor += source.len();
            continue;
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

fn inline_visible_text(value: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        if let Some((source, _)) = allowed_inline_tag(remaining) {
            cursor += source.len();
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

fn render_html_document(document: &ExportDocument) -> String {
    let mut body = String::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                let text = sanitize_inline_html(text).replace('\n', "<br>");
                match normalize_editor_text_style_value(Some(text_style)).as_str() {
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
            ExportBlock::Footnote { number, text } => {
                let _ = writeln!(
                    body,
                    "<p class=\"footnote\"><em>[{}] {}</em></p>",
                    number,
                    sanitize_inline_html(text)
                );
            }
            ExportBlock::Image { image, caption } => {
                let src = match image {
                    ExportImage::Url(url) => Some(url.as_str()),
                    ExportImage::Upload { raw_url, .. } => raw_url.as_deref(),
                };
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
                        escape_html(src)
                    );
                }
            }
        }
    }

    format!(
        "<!doctype html>\n<html lang=\"{}\">\n<head>\n<meta charset=\"utf-8\">\n<title>{}</title>\n<style>body{{max-width:760px;margin:40px auto;padding:0 24px;font-family:serif;line-height:1.6;color:#2f2117;}}h1{{font-size:2rem;}}h2{{font-size:1.4rem;}}blockquote{{margin:1em 2em;font-style:italic;}}.indented{{padding-left:2em;}}.centered{{text-align:center;}}.footnote{{font-size:.95em;}}figure{{margin:1.5em auto;text-align:center;}}img{{display:block;margin:0 auto;max-width:100%;height:auto;}}figcaption{{margin-top:.6em;text-align:center;}}</style>\n</head>\n<body>\n{}\n</body>\n</html>\n",
        escape_html(&document.language_code),
        escape_html(&document.title),
        body
    )
}

fn render_txt_document(document: &ExportDocument) -> String {
    let mut parts = Vec::new();
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                let text = inline_visible_text(text).trim().to_string();
                if text.is_empty() {
                    continue;
                }
                let rendered = match normalize_editor_text_style_value(Some(text_style)).as_str() {
                    "heading1" => text.to_uppercase(),
                    "heading2" => format!(">>> {}", text.to_uppercase()),
                    "quote" => format!("<blockquote>\n{text}\n</blockquote>"),
                    _ => text,
                };
                parts.push(rendered);
            }
            ExportBlock::Footnote { number, text } => {
                let text = inline_visible_text(text).trim().to_string();
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

fn inline_segments(value: &str) -> Vec<InlineSegment> {
    let mut output = Vec::new();
    let mut style = InlineStyleState::default();
    let mut cursor = 0usize;
    while cursor < value.len() {
        let remaining = &value[cursor..];
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

fn render_docx_document(document: &ExportDocument) -> Result<Vec<u8>, String> {
    let mut relationships = Vec::<String>::new();
    let mut media = Vec::<(String, Vec<u8>)>::new();
    let mut body = String::new();
    let mut rel_index = 1usize;
    let mut media_index = 1usize;

    for block in &document.blocks {
        match block {
            ExportBlock::Text { text_style, text } => {
                body.push_str(&docx_text_paragraph_xml(Some(text_style), text, false));
            }
            ExportBlock::Footnote { number, text } => {
                body.push_str(&docx_text_paragraph_xml(
                    None,
                    &format!("[{number}] {text}"),
                    true,
                ));
            }
            ExportBlock::Image { image, caption } => {
                let image_render = resolve_docx_image_render(image);
                match image_render {
                    DocxImageRender::Embedded(image_data) => {
                        let rel_id = format!("rId{rel_index}");
                        rel_index += 1;
                        let file_name = format!("image{media_index}.{}", image_data.extension);
                        media_index += 1;
                        relationships.push(format!(
                            r#"<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{file_name}"/>"#
                        ));
                        media.push((format!("word/media/{file_name}"), image_data.data));
                        body.push_str(&docx_image_paragraph_xml(&rel_id));
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
                    body.push_str(&docx_text_paragraph_xml(Some("centered"), caption, true));
                }
            }
        }
    }

    body.push_str(r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>"#);
    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{body}</w:body></w:document>"#
    );
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

fn write_zip_file(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    path: &str,
    contents: &str,
) -> Result<(), String> {
    writer
        .start_file(path, SimpleFileOptions::default())
        .map_err(|error| format!("Could not add '{path}' to DOCX: {error}"))?;
    writer
        .write_all(contents.as_bytes())
        .map_err(|error| format!("Could not write '{path}' to DOCX: {error}"))
}

fn docx_text_paragraph_xml(text_style: Option<&str>, text: &str, forced_italic: bool) -> String {
    docx_paragraph_runs_xml(text_style, &docx_runs_xml(text, forced_italic))
}

fn docx_paragraph_runs_xml(text_style: Option<&str>, runs: &str) -> String {
    let normalized = normalize_editor_text_style_value(text_style);
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
    inline_segments(value)
        .into_iter()
        .map(|mut segment| {
            if forced_italic {
                segment.style.italic = true;
            }
            docx_run_xml(&segment)
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
    let mut rpr = String::new();
    if segment.style.bold {
        rpr.push_str("<w:b/>");
    }
    if segment.style.italic {
        rpr.push_str("<w:i/>");
    }
    if segment.style.underline {
        rpr.push_str(r#"<w:u w:val="single"/>"#);
    }
    let rpr = if rpr.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{rpr}</w:rPr>")
    };
    format!(
        r#"<w:r>{rpr}<w:t xml:space="preserve">{}</w:t></w:r>"#,
        escape_xml(&segment.text)
    )
}

fn docx_image_paragraph_xml(rel_id: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="4572000" cy="3429000"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
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
    let data = fs::read(path).ok()?;
    let extension = docx_image_extension(&data)?;
    Some(DocxImage { data, extension })
}

fn download_docx_image(url: &str) -> Option<DocxImage> {
    let client = BlockingClient::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let response = client.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let data = response.bytes().ok()?.to_vec();
    let extension = docx_image_extension(&data)?;
    Some(DocxImage { data, extension })
}

fn docx_image_extension(data: &[u8]) -> Option<String> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png".to_string());
    }
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg".to_string());
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return Some("gif".to_string());
    }
    None
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#
}

fn package_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#
}

fn styles_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>"#
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    fn language() -> String {
        "en".to_string()
    }

    fn row(row_id: &str, order_key: &str, text: &str, style: &str) -> StoredRowFile {
        let mut fields = BTreeMap::new();
        fields.insert(
            language(),
            StoredFieldValue {
                plain_text: text.to_string(),
                footnote: String::new(),
                image_caption: String::new(),
                image: None,
                editor_flags: StoredFieldEditorFlags::default(),
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
        }
    }

    fn document(blocks: Vec<ExportBlock>) -> ExportDocument {
        ExportDocument {
            title: "Chapter".to_string(),
            language_code: language(),
            blocks,
        }
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
                text: "<u>Note</u>".to_string(),
            },
        ]));

        assert!(output.contains("<h1><strong>Hello</strong> <ruby>字<rt>zi</rt></ruby></h1>"));
        assert!(output.contains("<figure><img src=\"https://example.com/image.png\""));
        assert!(output.contains("<figcaption><em><em>Caption</em></em></figcaption>"));
        assert!(output.contains("<p class=\"footnote\"><em>[1] <u>Note</u></em></p>"));
    }

    #[test]
    fn docx_export_contains_required_parts_and_inline_markers() {
        let bytes = render_docx_document(&document(vec![ExportBlock::Text {
            text_style: "heading2".to_string(),
            text: "<strong>Bold</strong> <em>Italic</em> <u>Under</u>".to_string(),
        }]))
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
    fn docx_export_renders_well_formed_ruby_markup() {
        let bytes = render_docx_document(&document(vec![ExportBlock::Text {
            text_style: "paragraph".to_string(),
            text: "<ruby>字<rt>zi</rt></ruby>".to_string(),
        }]))
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
    fn uploaded_image_html_uses_raw_github_url() {
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
        active.fields.get_mut("en").expect("field exists").footnote = "Note".to_string();
        let mut deleted = row("row-2", "b", "Deleted", "paragraph");
        deleted.lifecycle.state = "deleted".to_string();
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![ChapterLanguage {
                code: "en".to_string(),
                name: "English".to_string(),
                role: "target".to_string(),
            }],
            settings: None,
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
        assert_eq!(document.blocks.len(), 2);
        assert_eq!(
            document.blocks[1],
            ExportBlock::Footnote {
                number: 1,
                text: "Note".to_string(),
            }
        );
    }
}
