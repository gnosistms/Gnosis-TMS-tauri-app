//! Reflowable EPUB 3 export. All resources are packaged locally for offline reading.
//! Container/package requirements: https://www.w3.org/TR/epub-33/
use super::book_export::{book_title, single_line_title};
use super::chapter_export::{
    download_public_image_bytes_detailed, export_text_style, inline_visible_text,
    numbered_book_documents, sanitize_inline_html, ExportBlock, ExportDocument, ExportImage,
};
use super::list_style::{list_items, list_kind, render_list_html};
use scraper::{ElementRef, Html, Node};
use std::{
    collections::BTreeSet,
    fmt::Write as _,
    fs,
    io::{Cursor, Read, Write},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
// Reader screens never need more; full-size web photos made 300 MB chapters.
const MAX_IMAGE_PIXELS: u64 = 4_000_000;
const JPEG_QUALITY: u8 = 90;
const IMAGE_WORKERS: usize = 6;
const STYLES: &str = "body{font-family:serif;line-height:1.5;margin:1em;}h1,h2{line-height:1.2;break-after:avoid;}blockquote{margin:1em 2em;}.quote-attribution{display:block;text-align:right;font-style:normal;}.indented{margin-inline-start:2em;}.centered,.title{text-align:center;}figure{text-align:center;break-inside:avoid;}img{max-width:100%;height:auto;}figcaption{margin-top:.5em;}.missing-image{border:1px solid;padding:.5em;font-size:.9em;}.footnote{font-size:.9em;}hr{width:30%;margin:1.5em auto;}.noteref{vertical-align:super;font-size:.75em;}";

struct Section {
    document: ExportDocument,
    kind: String,
    include_h1: bool,
}

struct ImageAsset {
    path: String,
    media_type: &'static str,
    data: Vec<u8>,
}

struct Note<'a> {
    index: usize,
    number: usize,
    marker: usize,
    anchor: Option<usize>,
    text: &'a str,
}

/// XML 1.0 has a smaller character repertoire than Rust strings (notably controls).
fn xml(value: &str) -> String {
    let mut output = String::new();
    for ch in value.chars() {
        match ch {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&apos;"),
            '\t'
            | '\n'
            | '\r'
            | '\u{20}'..='\u{d7ff}'
            | '\u{e000}'..='\u{fffd}'
            | '\u{10000}'..='\u{10ffff}' => output.push(ch),
            _ => {}
        }
    }
    output
}

fn title(value: &str) -> String {
    let value = single_line_title(&inline_visible_text(value));
    if value.is_empty() {
        "Untitled".into()
    } else {
        value
    }
}

fn rtl(language: &str) -> bool {
    matches!(
        language
            .split('-')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "ar" | "fa" | "he" | "ur" | "ps" | "yi" | "dv" | "ug"
    )
}

fn xhtml(title: &str, language: &str, body: &str) -> String {
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"{lang}\" xml:lang=\"{lang}\" dir=\"{direction}\"><head><title>{}</title><meta charset=\"utf-8\"/><link rel=\"stylesheet\" type=\"text/css\" href=\"styles.css\"/></head><body>{body}</body></html>", xml(title), lang = xml(language), direction = if rtl(language) { "rtl" } else { "ltr" })
}

fn noteref(note: &Note<'_>, referenced: &mut BTreeSet<usize>) -> String {
    let id = if referenced.insert(note.index) {
        format!(" id=\"ref-{}\"", note.index)
    } else {
        String::new()
    };
    format!(
        "<a{id} class=\"noteref\" epub:type=\"noteref\" role=\"doc-noteref\" href=\"#note-{}\">[{}]</a>",
        note.index, note.number
    )
}

fn text_with_notes(value: &str, notes: &[&Note<'_>], referenced: &mut BTreeSet<usize>) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    while cursor < value.len() {
        let remaining = &value[cursor..];
        // Odd backslash runs escape a marker; even runs leave it active.
        let slashes = remaining.bytes().take_while(|byte| *byte == b'\\').count();
        if slashes > 0 && remaining[slashes..].starts_with('[') {
            output.push_str(&"\\".repeat(slashes / 2));
            cursor += slashes;
            if slashes % 2 == 1 {
                output.push('[');
                cursor += 1;
            }
            continue;
        }
        if remaining.starts_with('[') {
            if let Some(close) = remaining.find(']') {
                if let Ok(marker) = remaining[1..close].parse::<usize>() {
                    if let Some(note) = notes.iter().find(|note| note.marker == marker) {
                        output.push_str(&noteref(note, referenced));
                        cursor += close + 1;
                        continue;
                    }
                }
            }
        }
        let Some(ch) = remaining.chars().next() else {
            break;
        };
        output.push_str(&xml(&ch.to_string()));
        cursor += ch.len_utf8();
    }
    output
}

// Parse the editor's limited inline HTML before serializing as XML. The HTML
// parser repairs incomplete/crossed tags; only known elements/attributes survive.
fn inline(value: &str, notes: &[&Note<'_>], referenced: &mut BTreeSet<usize>) -> String {
    let fragment = Html::parse_fragment(&sanitize_inline_html(value).replace('\n', "<br>"));
    inline_children(fragment.root_element(), notes, referenced, false)
}

fn inline_children(
    element: ElementRef<'_>,
    notes: &[&Note<'_>],
    referenced: &mut BTreeSet<usize>,
    in_link: bool,
) -> String {
    let mut output = String::new();
    for child in element.children() {
        match child.value() {
            Node::Text(text) => output.push_str(&text_with_notes(
                text,
                if in_link { &[] } else { notes },
                referenced,
            )),
            Node::Element(_) => {
                let Some(element) = ElementRef::wrap(child) else {
                    continue;
                };
                let name = element.value().name();
                if name == "br" || name == "hr" {
                    // Separators have their own block representation, including
                    // caption/footnote inline separators as a line break.
                    output.push_str("<br/>");
                    continue;
                }
                let allowed = matches!(name, "strong" | "em" | "u" | "ruby" | "rt" | "rp" | "a");
                if allowed {
                    if name == "a" {
                        let _ = write!(
                            output,
                            "<a href=\"{}\">",
                            xml(element.value().attr("href").unwrap_or(""))
                        );
                    } else {
                        let _ = write!(output, "<{name}>");
                    }
                }
                output.push_str(&inline_children(
                    element,
                    notes,
                    referenced,
                    in_link || name == "a" || name == "rt",
                ));
                if allowed {
                    let _ = write!(output, "</{name}>");
                }
            }
            _ => {}
        }
    }
    output
}

enum LoadedImage {
    /// Extension, media type, and bytes to package.
    Ready(&'static str, &'static str, Vec<u8>),
    /// Reader-facing notice for a remote image that could not be included.
    Unavailable(String),
}

enum EmbeddedImage {
    Path(String),
    Unavailable(String),
}

fn upload_bytes(absolute_path: &std::path::Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(absolute_path).map_err(|_| {
        "Could not read an image for EPUB export. Upload it again and retry.".to_string()
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read an image for EPUB export.".to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("An EPUB image is larger than 25 MB. Choose a smaller image and retry.".into());
    }
    Ok(bytes)
}

/// The largest size within the pixel budget, or None if the image already fits.
fn fitted_size(width: u32, height: u32) -> Option<(u32, u32)> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels <= MAX_IMAGE_PIXELS {
        return None;
    }
    let scale = (MAX_IMAGE_PIXELS as f64 / pixels as f64).sqrt();
    Some((
        ((f64::from(width) * scale) as u32).max(1),
        ((f64::from(height) * scale) as u32).max(1),
    ))
}

fn decode_image(bytes: &[u8], format: image::ImageFormat) -> Option<image::DynamicImage> {
    use image::ImageDecoder as _;
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().ok()?;
    // Re-encoding drops EXIF, so bake its rotation into the pixels.
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut decoded = image::DynamicImage::from_decoder(decoder).ok()?;
    decoded.apply_orientation(orientation);
    Some(decoded)
}

/// Re-encodes WebP (not universally supported by readers) and downscales any
/// raster over the pixel budget. Other images keep their original bytes. Opaque
/// WebP becomes JPEG; transparent images stay PNG so they still sit on the
/// reader's own page color, such as a dark theme.
fn prepare_image(bytes: Vec<u8>) -> Result<(&'static str, &'static str, Vec<u8>), String> {
    use image::{imageops::FilterType, ImageFormat};
    let format = match image::guess_format(&bytes).ok() {
        Some(format @ (ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)) => format,
        // GIFs can be animated, and resizing would keep only the first frame.
        Some(ImageFormat::Gif) => return Ok(("gif", "image/gif", bytes)),
        _ => {
            if std::str::from_utf8(&bytes).is_ok_and(|value| value.contains("<svg")) {
                let sanitized = super::book_svg::sanitize(&bytes)?;
                return Ok(("svg", "image/svg+xml", sanitized.into_owned()));
            }
            return Err("An image cannot be included in EPUB. Choose PNG, JPEG, GIF, WebP, or a static SVG image.".into());
        }
    };
    let original = match format {
        ImageFormat::Png => Some(("png", "image/png")),
        ImageFormat::Jpeg => Some(("jpg", "image/jpeg")),
        _ => None,
    };
    if let Some((extension, media_type)) = original {
        let fits = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_or(true, |(width, height)| fitted_size(width, height).is_none());
        if fits {
            return Ok((extension, media_type, bytes));
        }
    }
    let Some(mut decoded) = decode_image(&bytes, format) else {
        return match original {
            // Embedding an oversized original is better than failing the export.
            Some((extension, media_type)) => Ok((extension, media_type, bytes)),
            None => {
                Err("Could not convert a WebP image for EPUB export. Choose PNG or JPEG.".into())
            }
        };
    };
    if let Some((width, height)) = fitted_size(decoded.width(), decoded.height()) {
        decoded = decoded.resize_exact(width, height, FilterType::Lanczos3);
    }
    let opaque = !decoded.color().has_alpha()
        || decoded.to_rgba8().pixels().all(|pixel| pixel[3] == u8::MAX);
    let as_png = format == ImageFormat::Png || !opaque;
    let mut output = Cursor::new(Vec::new());
    let written =
        if as_png {
            decoded.write_to(&mut output, ImageFormat::Png)
        } else {
            decoded.to_rgb8().write_with_encoder(
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, JPEG_QUALITY),
            )
        };
    match (written, original) {
        (Ok(()), _) if as_png => Ok(("png", "image/png", output.into_inner())),
        (Ok(()), _) => Ok(("jpg", "image/jpeg", output.into_inner())),
        (Err(_), Some((extension, media_type))) => Ok((extension, media_type, bytes)),
        (Err(_), None) => Err("Could not convert a WebP image for EPUB export.".into()),
    }
}

fn unavailable_image_notice(url: &str, reason: &str) -> String {
    // Link the source so a reader who is online can still open it.
    let source = url::Url::parse(url)
        .ok()
        .filter(|parsed| matches!(parsed.scheme(), "http" | "https"))
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| format!(" from <a href=\"{}\">{}</a>", xml(url), xml(host)))
        })
        .unwrap_or_default();
    format!(
        "<p class=\"missing-image\">An image{source} could not be included: {}.</p>",
        xml(reason)
    )
}

fn load_image(image: &ExportImage) -> Result<LoadedImage, String> {
    let (extension, media_type, data) = match image {
        // Remote links expire and move. Like PDF export, show a notice in place
        // of the image so one dead link does not block the whole ebook.
        ExportImage::Url(url) => match download_public_image_bytes_detailed(url) {
            Err(error) => {
                return Ok(LoadedImage::Unavailable(unavailable_image_notice(
                    url,
                    &error.to_string(),
                )))
            }
            Ok(bytes) => match prepare_image(bytes) {
                Ok(prepared) => prepared,
                Err(_) => {
                    return Ok(LoadedImage::Unavailable(unavailable_image_notice(
                        url,
                        "it is not a supported PNG, JPEG, GIF, WebP, or SVG image",
                    )))
                }
            },
        },
        ExportImage::Upload { absolute_path, .. } => prepare_image(upload_bytes(absolute_path)?)?,
    };
    Ok(LoadedImage::Ready(extension, media_type, data))
}

/// Loads every distinct image once, several at a time: a book can hold a
/// hundred remote photos, and fetching them one by one dominated export time.
/// Calls `progress(done, total)` as images finish. Results keep input order.
fn load_images(
    images: &[&ExportImage],
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Vec<LoadedImage>, String> {
    let total = images.len();
    if total == 0 {
        return Ok(Vec::new());
    }
    progress(0, total);
    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let mut results: Vec<Option<Result<LoadedImage, String>>> = (0..total).map(|_| None).collect();
    let (sender, receiver) = mpsc::channel();
    thread::scope(|scope| {
        for _ in 0..IMAGE_WORKERS.min(total) {
            let (sender, next, failed) = (sender.clone(), &next, &failed);
            scope.spawn(move || {
                // A failed upload ends the export, so stop starting new images.
                while !failed.load(Ordering::Relaxed) {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some(image) = images.get(index) else {
                        break;
                    };
                    let result = load_image(image);
                    failed.fetch_or(result.is_err(), Ordering::Relaxed);
                    if sender.send((index, result)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);
        for (done, (index, result)) in receiver.into_iter().enumerate() {
            results[index] = Some(result);
            progress(done + 1, total);
        }
    });
    // Images are taken in order, so a skipped one always follows the failure.
    results
        .into_iter()
        .map(|result| result.unwrap_or_else(|| Err("Could not prepare the EPUB images.".into())))
        .collect()
}

fn section_body(
    section: &Section,
    contents: &str,
    images: &[(&ExportImage, EmbeddedImage)],
) -> String {
    let notes: Vec<_> = section
        .document
        .blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| match block {
            ExportBlock::Footnote {
                number,
                marker,
                anchor_block,
                text,
            } => Some(Note {
                index,
                number: *number,
                marker: *marker,
                anchor: *anchor_block,
                text,
            }),
            _ => None,
        })
        .collect();
    let mut referenced = BTreeSet::new();
    let mut body = format!("<section id=\"start\" class=\"{}\">", xml(&section.kind));
    let mut quote_open = false;
    for (index, block) in section.document.blocks.iter().enumerate() {
        if quote_open && !matches!(block, ExportBlock::Attribution { .. }) {
            body.push_str("</blockquote>");
            quote_open = false;
        }
        let anchor_notes: Vec<_> = notes
            .iter()
            .filter(|note| note.anchor == Some(index))
            .collect();
        match block {
            ExportBlock::Text { text_style, text } => {
                if let Some(kind) = list_kind(text_style) {
                    let items = list_items(text);
                    let mut items_html = items
                        .iter()
                        .map(|item| inline(&item.text, &anchor_notes, &mut referenced))
                        .collect::<Vec<_>>();
                    // Notes whose markers are not in the list follow its last item.
                    if let Some(last) = items_html.last_mut() {
                        for note in &anchor_notes {
                            if !referenced.contains(&note.index) {
                                last.push_str(&noteref(note, &mut referenced));
                            }
                        }
                    }
                    body.push_str(&render_list_html(
                        kind,
                        &items,
                        &items_html,
                        &format!(" id=\"block-{index}\""),
                    ));
                    continue;
                }
                let mut text = inline(text, &anchor_notes, &mut referenced);
                for note in &anchor_notes {
                    if !referenced.contains(&note.index) {
                        text.push_str(&noteref(note, &mut referenced));
                    }
                }
                let (tag, class) = match export_text_style(Some(text_style)).as_str() {
                    "heading1" | "chapter_heading" => ("h1", ""),
                    "heading2" => ("h2", ""),
                    "quote" => ("blockquote", ""),
                    "indented" => ("p", "indented"),
                    "centered" => ("p", "centered"),
                    _ => ("p", ""),
                };
                let _ = write!(body, "<{tag} id=\"block-{index}\" class=\"{class}\">{text}");
                if tag == "blockquote" {
                    quote_open = true;
                } else {
                    let _ = write!(body, "</{tag}>");
                }
            }
            ExportBlock::Attribution { text } => {
                if !quote_open {
                    body.push_str("<blockquote>");
                }
                let _ = write!(
                    body,
                    "<cite class=\"quote-attribution\">{}</cite></blockquote>",
                    inline(text, &[], &mut referenced)
                );
                quote_open = false;
            }
            ExportBlock::Separator => body.push_str("<hr/>"),
            ExportBlock::Image { image, caption } => {
                // Every image in the document was loaded before rendering.
                let Some((_, embedded)) = images.iter().find(|(source, _)| *source == image) else {
                    continue;
                };
                match embedded {
                    EmbeddedImage::Path(path) => {
                        let _ = write!(
                            body,
                            "<figure><img src=\"{}\" alt=\"{}\"/>",
                            xml(path),
                            xml(&inline_visible_text(caption))
                        );
                    }
                    EmbeddedImage::Unavailable(notice) => {
                        let _ = write!(body, "<figure>{notice}");
                    }
                }
                if !caption.trim().is_empty() {
                    let _ = write!(
                        body,
                        "<figcaption>{}</figcaption>",
                        inline(caption, &[], &mut referenced)
                    );
                }
                body.push_str("</figure>");
            }
            ExportBlock::Footnote { .. } => {}
        }
    }
    if quote_open {
        body.push_str("</blockquote>");
    }
    if section.kind == "contents" {
        body.push_str(contents);
    }
    for note in &notes {
        // Image-only rows and omitted custom HTML can leave an unanchored note.
        if !referenced.contains(&note.index) {
            let _ = write!(body, "<p>{}</p>", noteref(note, &mut referenced));
        }
    }
    if !notes.is_empty() {
        body.push_str("<section epub:type=\"footnotes\" role=\"doc-endnotes\">");
        for note in &notes {
            let paragraphs = super::chapter_export::footnote_paragraphs(note.text);
            if paragraphs.len() > 1 {
                let _ = write!(body, "<aside id=\"note-{}\" class=\"footnote\" epub:type=\"footnote\" role=\"doc-footnote\" style=\"display:table;width:100%\"><a href=\"#ref-{}\" aria-label=\"Back to text\" style=\"display:table-cell;padding-right:.5em\">[{}]</a><div style=\"display:table-cell;width:100%\">", note.index, note.index, note.number);
                for (index, paragraph) in paragraphs.iter().enumerate() {
                    let indent = if index == 0 { "0" } else { "1.5em" };
                    let content = inline(paragraph, &[], &mut BTreeSet::new());
                    let content = if inline_visible_text(paragraph).is_empty() {
                        "<br/>"
                    } else {
                        &content
                    };
                    let _ = write!(
                        body,
                        "<p style=\"margin:0;text-indent:{indent}\">{content}</p>"
                    );
                }
                body.push_str("</div></aside>");
                continue;
            }
            let _ = write!(body, "<aside id=\"note-{}\" class=\"footnote\" epub:type=\"footnote\" role=\"doc-footnote\"><p><a href=\"#ref-{}\" aria-label=\"Back to text\">[{}]</a> {}</p></aside>", note.index, note.index, note.number, inline(note.text, &[], &mut BTreeSet::new()));
        }
        body.push_str("</section>");
    }
    body.push_str("</section>");
    body
}

fn navigation(sections: &[Section], chapters_only: bool, include_h1: bool) -> String {
    let mut output = String::from("<ol>");
    for (index, section) in sections.iter().enumerate() {
        if chapters_only && section.kind != "chapter" {
            continue;
        }
        let _ = write!(
            output,
            "<li><a href=\"section-{}.xhtml#start\">{}</a>",
            index + 1,
            xml(&title(&section.document.title))
        );
        let mut headings = String::new();
        for (block_index, block) in section.document.blocks.iter().enumerate() {
            if let ExportBlock::Text { text_style, text } = block {
                let style = export_text_style(Some(text_style));
                // The opening chapter title already has its own navigation entry.
                if block_index > 0
                    && (style == "heading1" || (!chapters_only && style == "heading2"))
                    && (include_h1 || !chapters_only)
                {
                    let _ = write!(
                        headings,
                        "<li><a href=\"section-{}.xhtml#block-{block_index}\">{}</a></li>",
                        index + 1,
                        xml(&title(text))
                    );
                }
            }
        }
        if !headings.is_empty() {
            let _ = write!(output, "<ol>{headings}</ol>");
        }
        output.push_str("</li>");
    }
    output.push_str("</ol>");
    output
}

fn write_entry(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    path: &str,
    data: &[u8],
    stored: bool,
) -> Result<(), String> {
    let options = SimpleFileOptions::default().compression_method(if stored {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    });
    zip.start_file(path, options)
        .map_err(|_| "Could not create the EPUB archive.".to_string())?;
    zip.write_all(data)
        .map_err(|_| "Could not write the EPUB archive.".to_string())
}

/// `progress(done, total)` reports image loading, which is most of the work.
pub(super) fn render_epub_document(
    document: &ExportDocument,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Vec<u8>, String> {
    let sections = if document.book_parts.is_empty() {
        vec![Section {
            document: document.clone(),
            kind: "chapter".into(),
            include_h1: false,
        }]
    } else {
        numbered_book_documents(&document.book_parts)
            .into_iter()
            .zip(&document.book_parts)
            .map(|(mut document, part)| {
                if part.item.kind == "contents" {
                    // The composed flat contents are plain text; EPUB uses live links.
                    document.blocks.truncate(1);
                }
                if document.title.trim().is_empty() {
                    document.title = match part.item.kind.as_str() {
                        "copyright" => "Copyright",
                        "dedication" => "Dedication",
                        "image" => "Image",
                        "contents" => "Contents",
                        _ => "Title page",
                    }
                    .into();
                }
                Section {
                    document,
                    kind: part.item.kind.clone(),
                    include_h1: part.item.include_h1_headings,
                }
            })
            .collect()
    };
    let language = if document.language_code.trim().is_empty() {
        "und"
    } else {
        &document.language_code
    };
    let mut sources: Vec<&ExportImage> = Vec::new();
    for block in sections.iter().flat_map(|section| &section.document.blocks) {
        if let ExportBlock::Image { image, .. } = block {
            if !sources.contains(&image) {
                sources.push(image);
            }
        }
    }
    let mut assets = Vec::new();
    let images: Vec<_> = sources
        .iter()
        .copied()
        .zip(load_images(&sources, progress)?)
        .map(|(source, loaded)| {
            let embedded = match loaded {
                LoadedImage::Ready(extension, media_type, data) => {
                    let path = format!("images/image-{}.{}", assets.len() + 1, extension);
                    assets.push(ImageAsset {
                        path: path.clone(),
                        media_type,
                        data,
                    });
                    EmbeddedImage::Path(path)
                }
                LoadedImage::Unavailable(notice) => EmbeddedImage::Unavailable(notice),
            };
            (source, embedded)
        })
        .collect();
    let mut files = Vec::new();
    let mut manifest = String::from("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/><item id=\"style\" href=\"styles.css\" media-type=\"text/css\"/>");
    let mut spine = String::new();
    for (index, section) in sections.iter().enumerate() {
        let contents = if section.kind == "contents" {
            navigation(&sections, true, section.include_h1)
        } else {
            String::new()
        };
        let body = section_body(section, &contents, &images);
        let file = format!("section-{}.xhtml", index + 1);
        files.push((
            format!("EPUB/{file}"),
            xhtml(&title(&section.document.title), language, &body),
        ));
        let _ = write!(
            manifest,
            "<item id=\"section-{}\" href=\"{file}\" media-type=\"application/xhtml+xml\"/>",
            index + 1
        );
        let _ = write!(spine, "<itemref idref=\"section-{}\"/>", index + 1);
    }
    for (index, asset) in assets.iter().enumerate() {
        let _ = write!(
            manifest,
            "<item id=\"image-{}\" href=\"{}\" media-type=\"{}\"/>",
            index + 1,
            asset.path,
            asset.media_type
        );
    }
    let mut metadata = String::new();
    if let Some(part) = document
        .book_parts
        .iter()
        .find(|part| part.item.kind == "title")
    {
        if !part.item.author.trim().is_empty() {
            let _ = write!(
                metadata,
                "<dc:creator>{}</dc:creator>",
                xml(&part.item.author)
            );
        }
        if !part.item.translator.trim().is_empty() {
            let _ = write!(metadata, "<dc:contributor id=\"translator\">{}</dc:contributor><meta refines=\"#translator\" property=\"role\" scheme=\"marc:relators\">trl</meta>", xml(&part.item.translator));
        }
    }
    let package = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\" xml:lang=\"{}\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"book-id\">urn:uuid:{}</dc:identifier><dc:title>{}</dc:title><dc:language>{}</dc:language><meta property=\"dcterms:modified\">{}</meta>{metadata}</metadata><manifest>{manifest}</manifest><spine page-progression-direction=\"{}\">{spine}</spine></package>", xml(language), uuid::Uuid::now_v7(), xml(&title(book_title(document))), xml(language), chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ"), if rtl(language) { "rtl" } else { "ltr" });
    let nav = xhtml(
        "Contents",
        language,
        &format!(
            "<nav epub:type=\"toc\" id=\"toc\"><h1>Contents</h1>{}</nav>",
            navigation(&sections, false, true)
        ),
    );
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    // OCF requires this to be the first entry, uncompressed, without extra fields.
    write_entry(&mut zip, "mimetype", b"application/epub+zip", true)?;
    write_entry(&mut zip, "META-INF/container.xml", br#"<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#, false)?;
    write_entry(&mut zip, "EPUB/package.opf", package.as_bytes(), false)?;
    write_entry(&mut zip, "EPUB/nav.xhtml", nav.as_bytes(), false)?;
    write_entry(&mut zip, "EPUB/styles.css", STYLES.as_bytes(), false)?;
    for (path, content) in files {
        write_entry(&mut zip, &path, content.as_bytes(), false)?;
    }
    for asset in assets {
        // Raster formats are already compressed; deflating them again only costs time.
        write_entry(
            &mut zip,
            &format!("EPUB/{}", asset.path),
            &asset.data,
            asset.media_type != "image/svg+xml",
        )?;
    }
    zip.finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|_| "Could not finish the EPUB archive.".into())
}

#[cfg(test)]
mod tests;
