use super::chapter_export::{ExportBlock, ExportDocument, ExportImage};
use super::*;
use tauri::Manager;

#[derive(Clone, Default, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct BookItemInput {
    #[serde(default)]
    pub(super) id: String,
    pub(super) kind: String,
    #[serde(default)]
    pub(super) chapter_id: String,
    /// Missing in older saved layouts/clients: chapter numbering is on by default.
    #[serde(default)]
    pub(super) numbered: Option<bool>,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) title_override: Option<String>,
    #[serde(default)]
    pub(super) subtitle: String,
    #[serde(default)]
    pub(super) author: String,
    #[serde(default)]
    pub(super) translator: String,
    #[serde(default)]
    pub(super) text: String,
    #[serde(default)]
    pub(super) caption: String,
    #[serde(default)]
    pub(super) image_asset_id: String,
    #[serde(default)]
    pub(super) include_h1_headings: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct BookPart {
    pub(super) item: BookItemInput,
    pub(super) document: ExportDocument,
}

// Front-matter LF is a paragraph boundary; U+2028 is an in-paragraph soft break.
// Balance italics at each boundary so separate export paragraphs retain styling.
pub(super) fn book_text_blocks(text: &str, text_style: &str) -> Vec<ExportBlock> {
    fn paragraph(blocks: &mut Vec<ExportBlock>, text: &mut String, depth: usize, style: &str) {
        text.push_str(&"</i>".repeat(depth));
        blocks.push(ExportBlock::Text {
            text_style: style.into(),
            text: std::mem::take(text).replace('\u{2028}', "\n"),
        });
        text.push_str(&"<i>".repeat(depth));
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut remaining = normalized.as_str();
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut has_text = false;
    let mut after_paragraph = false;
    while !remaining.is_empty() {
        if let Some(rest) = remaining.strip_prefix("<i>") {
            depth += 1;
            current.push_str("<i>");
            remaining = rest;
        } else if let Some(rest) = remaining.strip_prefix("</i>") {
            if depth > 0 {
                depth -= 1;
                current.push_str("</i>");
            }
            remaining = rest;
        } else if let Some(rest) = remaining.strip_prefix('\n') {
            paragraph(&mut blocks, &mut current, depth, text_style);
            has_text = false;
            after_paragraph = true;
            remaining = rest;
        } else if let Some(rest) = remaining.strip_prefix("<hr>") {
            if has_text {
                paragraph(&mut blocks, &mut current, depth, text_style);
                has_text = false;
            }
            blocks.push(ExportBlock::Separator);
            after_paragraph = false;
            remaining = rest;
        } else if let Some(character) = remaining.chars().next() {
            current.push(character);
            has_text = true;
            after_paragraph = false;
            remaining = &remaining[character.len_utf8()..];
        }
    }
    if has_text || after_paragraph || blocks.is_empty() {
        paragraph(&mut blocks, &mut current, depth, text_style);
    }
    blocks
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportBookImageInput {
    #[serde(default)]
    source_path: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    data_base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedBookImage {
    asset_id: String,
    file_path: String,
    file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_url: Option<String>,
}
pub(super) fn asset_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("book-export-images"))
        .map_err(|_| "The local book image folder is unavailable.".to_string())
}

pub(crate) fn import_project_book_image_sync(
    app: &AppHandle,
    input: ImportBookImageInput,
) -> Result<ImportedBookImage, String> {
    use crate::constants::{decoded_base64_len, ensure_within_import_size_limit};
    let (name, bytes) = if !input.source_path.trim().is_empty() {
        let path = Path::new(&input.source_path);
        let size = fs::metadata(path)
            .map_err(|_| "Could not read the selected image.".to_string())?
            .len();
        ensure_within_import_size_limit(size, "image")?;
        (
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("image")
                .to_string(),
            fs::read(path).map_err(|_| "Could not read the selected image.".to_string())?,
        )
    } else {
        ensure_within_import_size_limit(
            decoded_base64_len(&input.data_base64) as u64,
            &input.file_name,
        )?;
        (
            input.file_name,
            base64::engine::general_purpose::STANDARD
                .decode(input.data_base64.trim())
                .map_err(|_| "Could not decode the selected image.".to_string())?,
        )
    };
    ensure_within_import_size_limit(bytes.len() as u64, &name)?;
    let (extension, bytes) = validate_book_image(&name, &bytes)?;
    let asset_id = format!("{:x}.{extension}", Sha256::digest(&bytes));
    let root = asset_root(app)?;
    fs::create_dir_all(&root)
        .map_err(|_| "Could not create the local book image folder.".to_string())?;
    let path = root.join(&asset_id);
    fs::write(&path, &bytes).map_err(|_| "Could not save the book image.".to_string())?;
    Ok(ImportedBookImage {
        asset_id,
        file_path: path.to_string_lossy().to_string(),
        file_name: name,
        data_url: if extension == "svg" {
            Some(format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            ))
        } else {
            None
        },
    })
}

pub(super) fn validate_book_image<'a>(
    name: &str,
    bytes: &'a [u8],
) -> Result<(&'static str, std::borrow::Cow<'a, [u8]>), String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension == "svg" {
        return Ok(("svg", super::book_svg::sanitize(bytes)?));
    }
    let extension = super::images::validated_uploaded_image_extension(name, bytes)?;
    if !matches!(extension, "png" | "jpg" | "webp") {
        return Err("Choose a PNG, JPG, WebP, or SVG image for the book.".to_string());
    }
    let image = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "The selected file is not a readable image.".to_string())?
        .into_dimensions()
        .map_err(|_| "The selected file is not a valid image.".to_string())?;
    if image.0 == 0 || image.1 == 0 || (image.0 as u64) * (image.1 as u64) > 100_000_000 {
        return Err("Choose an image with at most 100 million pixels.".to_string());
    }
    Ok((extension, std::borrow::Cow::Borrowed(bytes)))
}

pub(super) fn book_image(app: &AppHandle, id: &str) -> Result<Option<ExportImage>, String> {
    if id.is_empty() {
        return Ok(None);
    }
    let (hash, extension) = id
        .split_once('.')
        .ok_or_else(|| "The saved book image reference is invalid.".to_string())?;
    if hash.len() != 64
        || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !matches!(extension, "png" | "jpg" | "webp" | "svg")
    {
        return Err("The saved book image reference is invalid.".into());
    }
    let path = asset_root(app)?.join(id);
    if !path.is_file() {
        return Err("A saved book image is missing. Please select it again.".into());
    }
    Ok(Some(ExportImage::Upload {
        repo_relative_path: id.to_string(),
        raw_url: None,
        absolute_path: path,
    }))
}

pub(super) fn section_document(
    app: &AppHandle,
    item: &BookItemInput,
    language_code: &str,
    contents: &[String],
) -> Result<ExportDocument, String> {
    let mut blocks = Vec::new();
    let mut text = |value: &str, style: &str| {
        if !value.trim().is_empty() {
            blocks.push(ExportBlock::Text {
                text_style: style.into(),
                text: value.into(),
            });
        }
    };
    match item.kind.as_str() {
        "title" => {
            text(&item.title, "heading1");
            text(&item.subtitle, "heading2");
            text(&item.author, "centered");
            text(&item.translator, "centered");
        }
        "contents" => {
            text(&item.title, "heading1");
            for entry in contents {
                text(entry, "paragraph");
            }
        }
        "dedication" | "copyright" => {
            blocks.extend(book_text_blocks(
                &item.text,
                if item.kind == "dedication" {
                    "centered"
                } else {
                    "paragraph"
                },
            ));
        }
        "image" => {}
        _ => return Err("The book contains an unsupported section.".into()),
    }
    if let Some(image) = book_image(app, &item.image_asset_id)? {
        blocks.push(ExportBlock::Image {
            image,
            caption: item.caption.clone(),
        });
    }
    Ok(ExportDocument {
        title: item.title.clone(),
        language_code: language_code.to_string(),
        blocks,
        book_parts: Vec::new(),
    })
}

pub(super) fn svg_dimensions(bytes: &[u8]) -> (u32, u32) {
    use quick_xml::{events::Event, Reader};
    let mut reader = Reader::from_reader(bytes);
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let attributes = element
                    .attributes()
                    .flatten()
                    .filter_map(|attribute| {
                        Some((
                            String::from_utf8_lossy(attribute.key.as_ref()).to_string(),
                            attribute
                                .decode_and_unescape_value(&reader)
                                .ok()?
                                .to_string(),
                        ))
                    })
                    .collect::<BTreeMap<_, _>>();
                if let Some(viewbox) = attributes.get("viewBox") {
                    let values = viewbox
                        .split(|character: char| character.is_whitespace() || character == ',')
                        .filter_map(|value| value.parse::<f64>().ok())
                        .collect::<Vec<_>>();
                    if values.len() == 4 && values[2] > 0.0 && values[3] > 0.0 {
                        return (values[2].round() as u32, values[3].round() as u32);
                    }
                }
                let dimension = |key| {
                    attributes
                        .get(key)
                        .and_then(|value| value.trim_end_matches("px").parse::<f64>().ok())
                        .filter(|value| value.is_finite() && *value > 0.0)
                        .map(|value| value.round() as u32)
                };
                return (
                    dimension("width").unwrap_or(600),
                    dimension("height").unwrap_or(600),
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    (600, 600)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn book_text_paragraphs_preserve_soft_breaks_italics_and_blank_lines() {
        let blocks = book_text_blocks(
            "<i>First\r\n\r\nSecond\u{2028}soft<hr>Third</i>",
            "centered",
        );
        assert_eq!(
            blocks,
            vec![
                ExportBlock::Text {
                    text_style: "centered".into(),
                    text: "<i>First</i>".into()
                },
                ExportBlock::Text {
                    text_style: "centered".into(),
                    text: "<i></i>".into()
                },
                ExportBlock::Text {
                    text_style: "centered".into(),
                    text: "<i>Second\nsoft</i>".into()
                },
                ExportBlock::Separator,
                ExportBlock::Text {
                    text_style: "centered".into(),
                    text: "<i>Third</i>".into()
                },
            ]
        );
        assert_eq!(book_text_blocks("First\n", "paragraph").len(), 2);
    }
    #[test]
    fn book_svg_accepts_vectors_and_rejects_active_or_external_content() {
        assert!(validate_book_image(
            "logo.svg",
            br##"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>"##
        )
        .is_ok());
        for bad in [
            r#"<svg><script>alert(1)</script></svg>"#,
            r#"<svg onload="x()"/>"#,
            r#"<svg><image href="https://example.com/x.png"/></svg>"#,
            r#"<!DOCTYPE svg><svg/>"#,
            r#"<!DOCTYPE svg SYSTEM "https://example.com/svg.dtd"><svg/>"#,
            r#"<!DOCTYPE svg [<!ENTITY logo SYSTEM "file:///logo">]><svg>&logo;</svg>"#,
            r#"<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY logo "test">]><svg/>"#,
            r#"<svg><foreignObject/></svg>"#,
        ] {
            assert!(
                validate_book_image("logo.svg", bad.as_bytes()).is_err(),
                "{bad}"
            );
        }
        assert!(validate_book_image("photo.jpg", b"not an image").is_err());
    }

    #[test]
    fn book_svg_strips_standard_design_tool_doctype_before_storage() {
        let artwork = r#"<svg width="100%" height="100%" viewBox="0 0 2048 1536" xmlns="http://www.w3.org/2000/svg"><g transform="translate(1,2)"><path d="M0 0L1 1"/><circle cx="2" cy="2" r="1"/></g></svg>"#;
        let prolog = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n";
        for doctype in [
            r#"<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">"#,
            "<!DOCTYPE svg\n PUBLIC '-//W3C//DTD SVG 1.1//EN'\n 'https://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'>",
        ] {
            let source = format!("{prolog}{doctype}\n{artwork}");
            let (extension, normalized) = validate_book_image("logo.SVG", source.as_bytes()).unwrap();
            assert_eq!(extension, "svg");
            assert_eq!(normalized.as_ref(), super::book_svg::sanitize(format!("{prolog}\n{artwork}").as_bytes()).unwrap().as_ref());
            assert_eq!(svg_dimensions(&normalized), (2048, 1536));
            assert!(validate_book_image("logo.svg", &normalized).is_ok());

            for bad in [
                format!("{doctype}{doctype}{artwork}"),
                format!("{artwork}{doctype}"),
                format!("{doctype}<svg><script>alert(1)</script></svg>"),
                format!("{doctype}<svg><image href=\"https://example.com/logo.png\"/></svg>"),
            ] {
                assert!(validate_book_image("logo.svg", bad.as_bytes()).is_err(), "{bad}");
            }
        }
    }
}
