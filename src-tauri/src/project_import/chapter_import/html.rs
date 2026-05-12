use std::collections::BTreeMap;

use readabilityrs::{Readability, ReadabilityOptions};
use scraper::{ElementRef, Html, Selector};
use url::Url;

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    txt::decode_text_file,
    ImportHtmlInput, ImportedField, ImportedFieldImage, ImportedLanguage, ImportedRow,
    ParsedWorkbook,
};

const MIN_READABILITY_TEXT_CHARS: usize = 200;
const MIN_FALLBACK_TEXT_CHARS: usize = 500;
const MIN_FALLBACK_PARAGRAPH_BLOCKS: usize = 2;

#[derive(Clone, Default)]
pub(super) struct HtmlRowMetadata {
    pub(super) source_url: String,
    pub(super) block_kind: String,
    pub(super) block_index: usize,
    pub(super) original_tag: String,
    pub(super) image_url: Option<String>,
}

struct HtmlArticle {
    title: Option<String>,
    content: String,
}

struct HtmlBlock {
    text: String,
    text_style: Option<String>,
    block_kind: String,
    original_tag: String,
    image_url: Option<String>,
    image_caption: String,
}

pub(super) fn parse_html_file(input: ImportHtmlInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected HTML page is empty.".to_string());
    }

    let code = normalize_language_code(&input.source_language_code)
        .ok_or_else(|| "Select a supported source language.".to_string())?;
    let name = language_display_name(&code);
    let decoded = decode_text_file(&input.bytes)?;
    let article = extract_reader_article(&decoded, &input.source_url)?;
    let mut blocks = html_blocks_from_fragment(&article.content, &input.source_url)?;

    if let Some(title) = article
        .title
        .as_ref()
        .map(|value| normalize_html_text(value, false))
    {
        let duplicate_first = blocks
            .first()
            .map(|block| normalize_html_text(&block.text, false) == title)
            .unwrap_or(false);
        if !title.is_empty() && !duplicate_first {
            blocks.insert(
                0,
                HtmlBlock {
                    text: title,
                    text_style: Some("heading1".to_string()),
                    block_kind: "heading".to_string(),
                    original_tag: "title".to_string(),
                    image_url: None,
                    image_caption: String::new(),
                },
            );
        }
    }

    if blocks.is_empty() {
        return Err("The selected HTML page does not contain any readable text.".to_string());
    }

    let mut rows = Vec::new();
    for (index, block) in blocks.into_iter().enumerate() {
        let mut fields = BTreeMap::new();
        fields.insert(
            code.clone(),
            ImportedField {
                plain_text: block.text,
                footnote: String::new(),
                image_caption: block.image_caption,
                image: block.image_url.as_ref().map(|url| ImportedFieldImage {
                    kind: "url".to_string(),
                    url: Some(url.clone()),
                    path: None,
                }),
            },
        );
        rows.push(ImportedRow {
            external_id: None,
            description: None,
            context: None,
            comments: Vec::new(),
            source_row_number: index + 1,
            fields,
            text_style: block.text_style,
            docx_metadata: None,
            html_metadata: Some(HtmlRowMetadata {
                source_url: input.source_url.clone(),
                block_kind: block.block_kind,
                block_index: index + 1,
                original_tag: block.original_tag,
                image_url: block.image_url,
            }),
        });
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: "HTML".to_string(),
        source_file_name: input.file_name,
        source_format: "html",
        header_blob: Vec::new(),
        languages: vec![ImportedLanguage {
            code,
            name,
            role: "source",
            base_code: None,
        }],
        rows,
        import_summary: None,
    })
}

fn extract_reader_article(html: &str, source_url: &str) -> Result<HtmlArticle, String> {
    let options = ReadabilityOptions::builder()
        .char_threshold(MIN_READABILITY_TEXT_CHARS)
        .keep_classes(false)
        .build();
    if let Ok(readability) = Readability::new(html, Some(source_url), Some(options)) {
        if let Some(article) = readability.parse() {
            let content = article.content.unwrap_or_default();
            let text = normalize_html_text(
                &Html::parse_fragment(&content)
                    .root_element()
                    .text()
                    .collect::<Vec<_>>()
                    .join(" "),
                false,
            );
            if text.chars().count() >= MIN_READABILITY_TEXT_CHARS {
                return Ok(HtmlArticle {
                    title: article.title,
                    content,
                });
            }
        }
    }

    fallback_article(html)
}

fn fallback_article(html: &str) -> Result<HtmlArticle, String> {
    let document = Html::parse_document(html);
    let candidate_selector = Selector::parse("article, main, [role=\"main\"]")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;
    let paragraph_selector = Selector::parse("p, li, blockquote, h1, h2, h3, h4, h5, h6")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;
    let link_selector = Selector::parse("a")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;

    let mut best: Option<(usize, String)> = None;
    for candidate in document.select(&candidate_selector) {
        let text = element_text(candidate, false);
        let text_len = text.chars().count();
        let paragraph_count = candidate.select(&paragraph_selector).count();
        let link_text_len = candidate
            .select(&link_selector)
            .map(|link| element_text(link, false).chars().count())
            .sum::<usize>();
        let link_density_percent = if text_len == 0 {
            100
        } else {
            (link_text_len * 100) / text_len
        };
        if text_len < MIN_FALLBACK_TEXT_CHARS
            || paragraph_count < MIN_FALLBACK_PARAGRAPH_BLOCKS
            || link_density_percent > 35
        {
            continue;
        }

        let score = text_len + paragraph_count.saturating_mul(120) - link_density_percent;
        if best
            .as_ref()
            .map(|(best_score, _)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((score, candidate.inner_html()));
        }
    }

    best.map(|(_, content)| HtmlArticle {
        title: html_title(html),
        content,
    })
    .ok_or_else(|| "The selected HTML page does not contain readable article text.".to_string())
}

fn html_blocks_from_fragment(content: &str, source_url: &str) -> Result<Vec<HtmlBlock>, String> {
    let fragment = Html::parse_fragment(content);
    let selector = Selector::parse("figure, img, h1, h2, h3, h4, h5, h6, blockquote, p, pre, li")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;
    let mut blocks = Vec::new();

    for element in fragment.select(&selector) {
        let tag = element.value().name();
        if should_skip_element(element) {
            continue;
        }

        if tag == "figure" {
            if let Some(block) = image_block_from_figure(element, source_url)? {
                blocks.push(block);
            }
            continue;
        }

        if tag == "img" {
            if has_ancestor_tag(element, "figure") {
                continue;
            }
            if let Some(block) = image_block_from_img(element, "img", source_url)? {
                blocks.push(block);
            }
            continue;
        }

        if has_block_ancestor(element) {
            continue;
        }

        let preserve_breaks = tag == "pre";
        let mut text = element_text(element, preserve_breaks);
        if tag == "li" && !text.starts_with("- ") && !text.starts_with("* ") {
            text = format!("- {text}");
        }
        if text.trim().is_empty() {
            continue;
        }

        let (text_style, block_kind) = html_text_style_for_tag(tag);
        blocks.push(HtmlBlock {
            text,
            text_style,
            block_kind: block_kind.to_string(),
            original_tag: tag.to_string(),
            image_url: None,
            image_caption: String::new(),
        });
    }

    Ok(blocks)
}

fn image_block_from_figure(
    figure: ElementRef<'_>,
    source_url: &str,
) -> Result<Option<HtmlBlock>, String> {
    let img_selector = Selector::parse("img")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;
    let caption_selector = Selector::parse("figcaption")
        .map_err(|_| "Could not prepare HTML reader extraction.".to_string())?;
    let Some(img) = figure.select(&img_selector).find(|image| {
        !should_skip_image_element(*image) && image_url_from_element(*image, source_url).is_some()
    }) else {
        return Ok(None);
    };

    let caption = figure
        .select(&caption_selector)
        .map(|caption| element_text(caption, false))
        .find(|caption| !caption.is_empty())
        .or_else(|| meaningful_alt_caption(img));
    let Some(image_url) = image_url_from_element(img, source_url) else {
        return Ok(None);
    };

    Ok(Some(HtmlBlock {
        text: String::new(),
        text_style: None,
        block_kind: "image".to_string(),
        original_tag: "figure".to_string(),
        image_url: Some(image_url),
        image_caption: caption.unwrap_or_default(),
    }))
}

fn image_block_from_img(
    img: ElementRef<'_>,
    original_tag: &str,
    source_url: &str,
) -> Result<Option<HtmlBlock>, String> {
    if should_skip_image_element(img) {
        return Ok(None);
    }
    let Some(image_url) = image_url_from_element(img, source_url) else {
        return Ok(None);
    };

    Ok(Some(HtmlBlock {
        text: String::new(),
        text_style: None,
        block_kind: "image".to_string(),
        original_tag: original_tag.to_string(),
        image_url: Some(image_url),
        image_caption: meaningful_alt_caption(img).unwrap_or_default(),
    }))
}

fn has_block_ancestor(element: ElementRef<'_>) -> bool {
    for ancestor in element.ancestors() {
        let Some(ancestor) = ElementRef::wrap(ancestor) else {
            continue;
        };
        if ancestor.id() == element.id() {
            continue;
        }
        let tag = ancestor.value().name();
        if matches!(
            tag,
            "figure" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "p" | "pre" | "li"
        ) {
            return true;
        }
    }
    false
}

fn has_ancestor_tag(element: ElementRef<'_>, tag_name: &str) -> bool {
    for node in element.ancestors() {
        let Some(candidate) = ElementRef::wrap(node) else {
            continue;
        };
        if candidate.id() == element.id() {
            continue;
        }
        if candidate.value().name().eq_ignore_ascii_case(tag_name) {
            return true;
        }
    }
    false
}

fn should_skip_element(element: ElementRef<'_>) -> bool {
    for node in element.ancestors() {
        let Some(candidate) = ElementRef::wrap(node) else {
            continue;
        };
        let tag = candidate.value().name();
        if matches!(
            tag,
            "script"
                | "style"
                | "noscript"
                | "nav"
                | "footer"
                | "header"
                | "form"
                | "aside"
                | "svg"
                | "canvas"
                | "template"
        ) {
            return true;
        }
        if candidate.attr("hidden").is_some() {
            return true;
        }
        let aria_hidden = candidate.attr("aria-hidden").unwrap_or("").trim();
        if aria_hidden.eq_ignore_ascii_case("true") {
            return true;
        }
    }

    false
}

fn should_skip_image_element(element: ElementRef<'_>) -> bool {
    if should_skip_element(element) {
        return true;
    }
    let alt =
        normalize_html_text(element.attr("alt").unwrap_or_default(), false).to_ascii_lowercase();
    if matches!(alt.as_str(), "logo" | "icon" | "share" | "social") {
        return true;
    }

    for node in element.ancestors() {
        let Some(candidate) = ElementRef::wrap(node) else {
            continue;
        };
        if element_has_noise_token(candidate) {
            return true;
        }
    }

    let (width, height) = image_dimensions(element);
    if let (Some(width), Some(height)) = (width, height) {
        if width < 100 && height < 100 {
            return true;
        }
        let max = width.max(height) as f64;
        let min = width.min(height) as f64;
        if min > 0.0 && max / min > 8.0 {
            return true;
        }
    }

    false
}

fn element_has_noise_token(element: ElementRef<'_>) -> bool {
    let mut values = Vec::new();
    for attr in ["class", "id", "src", "srcset", "data-src", "data-original"] {
        if let Some(value) = element.attr(attr) {
            values.push(value.to_string());
        }
    }
    let joined = values.join(" ").to_ascii_lowercase();
    let mut current = String::new();
    for character in joined.chars() {
        if character.is_ascii_alphanumeric() {
            current.push(character);
            continue;
        }
        if image_noise_token_matches(&current) {
            return true;
        }
        current.clear();
    }
    image_noise_token_matches(&current)
}

fn image_noise_token_matches(token: &str) -> bool {
    matches!(
        token,
        "ad" | "ads"
            | "advert"
            | "advertisement"
            | "banner"
            | "promo"
            | "sponsor"
            | "sponsored"
            | "tracking"
            | "tracker"
            | "pixel"
            | "spacer"
            | "logo"
            | "avatar"
            | "icon"
            | "sprite"
            | "share"
            | "social"
    )
}

fn image_dimensions(element: ElementRef<'_>) -> (Option<u32>, Option<u32>) {
    (
        parse_dimension(element.attr("width")),
        parse_dimension(element.attr("height")),
    )
}

fn parse_dimension(value: Option<&str>) -> Option<u32> {
    let value = value?.trim();
    let digits = value
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    digits.parse::<u32>().ok()
}

fn image_url_from_element(element: ElementRef<'_>, source_url: &str) -> Option<String> {
    let raw = best_srcset_url(element)
        .or_else(|| lazy_image_url(element))
        .or_else(|| element.attr("src").map(str::to_string))?;
    resolve_image_url(&raw, source_url)
}

fn best_srcset_url(element: ElementRef<'_>) -> Option<String> {
    let srcset = element.attr("srcset")?.trim();
    if srcset.is_empty() {
        return None;
    }

    srcset
        .split(',')
        .filter_map(|candidate| {
            let mut parts = candidate.split_whitespace();
            let url = parts.next()?.trim();
            if url.is_empty() {
                return None;
            }
            let descriptor = parts.next().unwrap_or("").trim();
            let score = if let Some(width) = descriptor.strip_suffix('w') {
                width.parse::<u32>().unwrap_or(1)
            } else if let Some(density) = descriptor.strip_suffix('x') {
                (density.parse::<f32>().unwrap_or(1.0) * 10_000.0) as u32
            } else {
                1
            };
            Some((score, url.to_string()))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, url)| url)
}

fn lazy_image_url(element: ElementRef<'_>) -> Option<String> {
    [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-image",
        "data-url",
    ]
    .into_iter()
    .filter_map(|attr| element.attr(attr))
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(str::to_string)
}

fn resolve_image_url(raw_url: &str, source_url: &str) -> Option<String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("data:")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("javascript:")
    {
        return None;
    }

    if let Ok(parsed) = Url::parse(trimmed) {
        return image_url_with_supported_scheme(parsed);
    }

    let base = Url::parse(source_url).ok()?;
    image_url_with_supported_scheme(base.join(trimmed).ok()?)
}

fn image_url_with_supported_scheme(url: Url) -> Option<String> {
    if matches!(url.scheme(), "http" | "https") {
        Some(url.to_string())
    } else {
        None
    }
}

fn meaningful_alt_caption(element: ElementRef<'_>) -> Option<String> {
    let caption = normalize_html_text(element.attr("alt").unwrap_or_default(), false);
    if caption.is_empty() || caption.chars().count() > 180 {
        return None;
    }

    let lower = caption.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "image" | "photo" | "picture" | "graphic" | "thumbnail" | "logo" | "icon"
    ) {
        return None;
    }
    if lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".svg")
    {
        return None;
    }

    Some(caption)
}

fn html_text_style_for_tag(tag: &str) -> (Option<String>, &'static str) {
    match tag {
        "h1" => (Some("heading1".to_string()), "heading"),
        "h2" | "h3" | "h4" | "h5" | "h6" => (Some("heading2".to_string()), "heading"),
        "blockquote" => (Some("quote".to_string()), "quote"),
        _ => (None, "paragraph"),
    }
}

fn element_text(element: ElementRef<'_>, preserve_breaks: bool) -> String {
    let separator = if preserve_breaks { "\n" } else { " " };
    normalize_html_text(
        &element.text().collect::<Vec<_>>().join(separator),
        preserve_breaks,
    )
}

fn normalize_html_text(value: &str, preserve_breaks: bool) -> String {
    if preserve_breaks {
        return value
            .lines()
            .map(|line| normalize_html_text(line, false))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
    }

    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after_start = lower[start..].find('>')? + start + 1;
    let end = lower[after_start..].find("</title>")? + after_start;
    let title = normalize_html_text(&html[after_start..end], false);
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn html_input(html: &str) -> ImportHtmlInput {
        ImportHtmlInput {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_name: "article.html".to_string(),
            bytes: html.as_bytes().to_vec(),
            source_language_code: "en".to_string(),
            source_url: "https://example.com/article".to_string(),
        }
    }

    #[test]
    fn html_import_preserves_reader_block_styles() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <head><title>Article Title</title></head>
              <body>
                <article>
                  <h1>Article Title</h1>
                  <h2>Section</h2>
                  <p>{long_text}</p>
                  <blockquote>Quoted text.</blockquote>
                  <ul><li>List item</li></ul>
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        assert_eq!(parsed.rows[0].text_style.as_deref(), Some("heading1"));
        assert_eq!(parsed.rows[1].text_style.as_deref(), Some("heading2"));
        assert_eq!(parsed.rows[2].text_style.as_deref(), None);
        assert_eq!(parsed.rows[3].text_style.as_deref(), Some("quote"));
        assert_eq!(
            parsed.rows[4].fields["en"].plain_text,
            "- List item".to_string(),
        );
        assert!(parsed.rows[0].html_metadata.is_some());
    }

    #[test]
    fn html_import_preserves_article_images_with_figcaptions() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <head><title>Article Title</title></head>
              <body>
                <article>
                  <h1>Article Title</h1>
                  <p>{long_text}</p>
                  <figure>
                    <img src="/images/plate.jpg" width="640" height="420" alt="Generic photo">
                    <figcaption>Plate 12. Temple entrance.</figcaption>
                  </figure>
                  <blockquote>Quoted text.</blockquote>
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        let image_row = parsed
            .rows
            .iter()
            .find(|row| {
                row.html_metadata
                    .as_ref()
                    .map(|metadata| metadata.block_kind.as_str())
                    == Some("image")
            })
            .expect("image row should be imported");
        let field = image_row
            .fields
            .get("en")
            .expect("English field should exist");

        assert_eq!(field.plain_text, "");
        assert_eq!(field.image_caption, "Plate 12. Temple entrance.");
        assert_eq!(
            field.image.as_ref().and_then(|image| image.url.as_deref()),
            Some("https://example.com/images/plate.jpg")
        );
        assert_eq!(
            image_row
                .html_metadata
                .as_ref()
                .and_then(|metadata| metadata.image_url.as_deref()),
            Some("https://example.com/images/plate.jpg")
        );
    }

    #[test]
    fn html_import_uses_best_srcset_candidate_and_alt_fallback() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <body>
                <article>
                  <p>{long_text}</p>
                  <img
                    src="/images/small.jpg"
                    srcset="/images/small.jpg 320w, /images/large.jpg 1200w"
                    width="1200"
                    height="800"
                    alt="The completed manuscript page"
                  >
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        let image_field = parsed
            .rows
            .iter()
            .find_map(|row| row.fields.get("en").filter(|field| field.image.is_some()))
            .expect("image field should be imported");

        assert_eq!(image_field.image_caption, "The completed manuscript page");
        assert_eq!(
            image_field
                .image
                .as_ref()
                .and_then(|image| image.url.as_deref()),
            Some("https://example.com/images/large.jpg")
        );
    }

    #[test]
    fn html_import_skips_likely_noise_images() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <body>
                <article>
                  <p>{long_text}</p>
                  <img class="site-logo" src="/logo.png" width="240" height="120" alt="Logo">
                  <img src="/pixel.gif" width="1" height="1" alt="Tracking pixel">
                  <img class="share-icon" src="/share.png" width="160" height="160" alt="Share">
                  <img src="data:image/png;base64,abc" width="640" height="420" alt="Inline image">
                  <img src="/content/photo.jpg" width="640" height="420" alt="Content image">
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        let image_urls = parsed
            .rows
            .iter()
            .filter_map(|row| row.fields.get("en"))
            .filter_map(|field| field.image.as_ref())
            .filter_map(|image| image.url.as_deref())
            .collect::<Vec<_>>();

        assert_eq!(image_urls, vec!["https://example.com/content/photo.jpg"]);
    }

    #[test]
    fn html_import_preserves_dom_order_for_text_and_images() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <body>
                <article>
                  <h1>Article Title</h1>
                  <p>{long_text}</p>
                  <img src="/first.jpg" width="640" height="420" alt="First image">
                  <blockquote>Quoted text.</blockquote>
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        let block_kinds = parsed
            .rows
            .iter()
            .map(|row| {
                row.html_metadata
                    .as_ref()
                    .map(|metadata| metadata.block_kind.as_str())
                    .unwrap_or("")
            })
            .collect::<Vec<_>>();

        assert_eq!(block_kinds, vec!["heading", "paragraph", "image", "quote"]);
    }

    #[test]
    fn fallback_rejects_nav_only_html() {
        let input = html_input("<html><body><nav><a href=\"/a\">Home</a></nav></body></html>");
        assert!(parse_html_file(input).is_err());
    }

    #[test]
    fn html_import_skips_blocks_inside_page_chrome() {
        let long_text =
            "This paragraph contains enough article text for reader extraction. ".repeat(12);
        let input = html_input(&format!(
            r#"
            <html>
              <head><title>Article Title</title></head>
              <body>
                <article>
                  <header><p>Navigation title</p></header>
                  <p>{long_text}</p>
                  <footer><p>Footer link text</p></footer>
                </article>
              </body>
            </html>
            "#
        ));

        let parsed = parse_html_file(input).expect("html should parse");
        let row_text = parsed
            .rows
            .iter()
            .map(|row| row.fields["en"].plain_text.as_str())
            .collect::<Vec<_>>();
        assert!(!row_text.contains(&"Navigation title"));
        assert!(!row_text.contains(&"Footer link text"));
    }
}
