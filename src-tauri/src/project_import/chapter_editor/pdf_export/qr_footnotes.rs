//! Prepare print links before native Typst footnotes are attached to body markers.
use super::super::chapter_export::{inline_link_tag, InlineLinkTag};
use super::{
    footnote_paragraphs, inline_segments, inline_visible_text,
    qr_shortlinks::{same_destination, Shortlinks},
    render_footnote_typst, render_styled_typst_text, typst_link_target, typst_string, ExportBlock,
    ExportDocument,
};
use qrcode::{
    bits::Bits,
    optimize::{total_encoded_len, Optimizer, Parser},
    render::svg,
    types::{Mode, QrError},
    EcLevel, QrCode, QrResult, Version,
};
use regex::Regex;
use std::{borrow::Cow, cmp::Reverse, collections::HashSet, ops::Range, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
use url::Url;

pub(super) fn write_templates(workspace: &std::path::Path) -> Result<(), String> {
    for (name, template) in [
        ("qr-footnotes.typ", include_str!("qr_footnotes.typ")),
        ("qr-wrap.typ", include_str!("qr_wrap.typ")),
    ] {
        std::fs::write(workspace.join(name), template)
            .map_err(|error| format!("Could not prepare the QR footnote layout: {error}"))?;
    }
    Ok(())
}

pub(super) fn document_urls(document: &ExportDocument) -> Vec<String> {
    let mut urls = Vec::new();
    if document.book_parts.is_empty() {
        collect_urls(document, &mut urls);
    } else {
        for part in &document.book_parts {
            if part.item.kind == "chapter" {
                collect_urls(&part.document, &mut urls);
            }
        }
    }
    urls
}

fn collect_urls(document: &ExportDocument, urls: &mut Vec<String>) {
    for block in &document.blocks {
        if let ExportBlock::Footnote { text, .. } = block {
            urls.extend(
                note_links(&link_pasted_urls(text))
                    .1
                    .into_iter()
                    .map(|link| link.href),
            );
        }
    }
}

// Share the same transient link markup between destination discovery and PDF
// rendering. Skip complete authored anchors, including their labels.
fn link_pasted_urls(source: &str) -> Cow<'_, str> {
    static TOKENS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)<a href="[^"]*">|</a>|https?://[^\s<>"“”]+"#).unwrap());
    let mut linked = false;
    let mut cursor = 0;
    let mut out = String::new();
    for hit in TOKENS.find_iter(source) {
        let token = hit.as_str();
        if let Some(tag) = inline_link_tag(token) {
            linked = matches!(tag, InlineLinkTag::Open { .. });
            continue;
        }
        if linked || token.starts_with('<') {
            continue;
        }
        let mut href = token.trim_end_matches(['.', ',', ';', '!', '?', '…']);
        while let Some((_, close)) =
            [('(', ')'), ('[', ']'), ('{', '}')]
                .into_iter()
                .find(|(open, close)| {
                    href.ends_with(*close)
                        && href.matches(*close).count() > href.matches(*open).count()
                })
        {
            href = &href[..href.len() - close.len_utf8()];
        }
        // A standalone URL is the entire authored address, including a final
        // punctuation character that can legally belong to its path or query.
        if href.len() != token.len() && inline_visible_text(source).trim() == token {
            href = token;
        }
        if !Url::parse(href).is_ok_and(|url| url.host().is_some()) {
            continue;
        }
        out.push_str(&source[cursor..hit.start()]);
        out.push_str("<a href=\"");
        out.push_str(&href.replace('&', "&amp;"));
        out.push_str("\">");
        out.push_str(href);
        out.push_str("</a>");
        cursor = hit.start() + href.len();
    }
    if cursor == 0 {
        return Cow::Borrowed(source);
    }
    out.push_str(&source[cursor..]);
    Cow::Owned(out)
}

struct NoteLink {
    href: String,
    markup: Range<usize>,
    visible: Range<usize>,
}

// Keep the original anchor boundaries even when an anchor contains italic text
// or two adjacent anchors point to the same recording.
fn note_links(source: &str) -> (String, Vec<NoteLink>) {
    let mut visible = String::new();
    let mut links = Vec::new();
    let mut cursor = 0;
    let mut open = None;
    for (pos, _) in source.match_indices('<') {
        if pos < cursor {
            continue;
        }
        let Some(tag) = inline_link_tag(&source[pos..]) else {
            continue;
        };
        visible.push_str(&inline_visible_text(&source[cursor..pos]));
        match tag {
            InlineLinkTag::Open { source_len, href } => {
                open = Some((pos, visible.len(), href));
                cursor = pos + source_len;
            }
            InlineLinkTag::Close { source_len } => {
                cursor = pos + source_len;
                if let Some((start, first, href)) = open.take() {
                    links.push(NoteLink {
                        href,
                        markup: start..cursor,
                        visible: first..visible.len(),
                    });
                }
            }
        }
    }
    visible.push_str(&inline_visible_text(&source[cursor..]));
    (visible, links)
}

// Unicode sentence terminals include, for example, Khmer ។ and Ethiopic ።.
// Keep the ellipsis accepted by the original footnote renderer as well.
static TERMINAL_RUN: LazyLock<Result<Regex, regex::Error>> =
    LazyLock::new(|| Regex::new(r"[\p{Sentence_Terminal}…]+\z"));

fn has_paragraph_break(whitespace: &str) -> bool {
    whitespace.contains('\u{2029}')
        || whitespace
            .split_once('\n')
            .is_some_and(|(_, rest)| rest.contains('\n'))
}

// Move the anchor only if neither edge cuts through the surrounding prose.
// A paragraph can end with an unpunctuated prompt; a soft return can occur
// anywhere in a sentence. Offsets into visible text and markup stay separate.
fn removable_end(
    visible: &str,
    link: &NoteLink,
    source: &str,
    sentences: &[Range<usize>],
    terminal: &Regex,
) -> Option<usize> {
    let words = &visible[link.visible.clone()];
    let trimmed = words.trim();
    if trimmed.is_empty() || trimmed.starts_with(['“', '‘', '"', '«', '「', '『']) {
        return None;
    }
    let start = link.visible.start + words.len() - words.trim_start().len();
    let end = start + trimmed.len();
    let before = &visible[..start];
    let previous = before.trim_end();
    let gap = &before[previous.len()..];
    if !previous.is_empty() && !has_paragraph_break(gap) {
        let previous = previous.trim_end_matches(['”', '’', '"', '»', '」', '』', ')', ']']);
        if !terminal.is_match(previous) {
            return None;
        }
        // Unicode keeps lowercase text after a period in the same segment.
        // An isolated lowercase link after a space can still be a prompt.
        let lowercase_prompt = !gap.is_empty() && trimmed.starts_with(char::is_lowercase);
        if !lowercase_prompt && sentences.binary_search_by_key(&start, |s| s.start).is_err() {
            return None;
        }
        // Common citation prefixes and initials introduce what follows.
        if let Some(word) = previous
            .split_whitespace()
            .next_back()
            .and_then(|w| w.strip_suffix('.'))
        {
            if (word.chars().count() == 1 && word.chars().all(char::is_alphabetic))
                || word.contains('.')
                || matches!(
                    word.to_ascii_lowercase().as_str(),
                    "dr" | "mr" | "mrs" | "ms" | "prof" | "fig" | "pp" | "vol" | "cf" | "no"
                )
            {
                return None;
            }
        }
    }
    let after = &visible[end..];
    let following = after.trim_start();
    if following.is_empty() || has_paragraph_break(&after[..after.len() - following.len()]) {
        return Some(link.markup.end);
    }

    // When prose follows, the link must end at a real sentence ending.
    // If the author put the punctuation just outside the anchor, take it too.
    let sentence = sentences.get(sentences.partition_point(|s| s.end < end))?;
    let punctuation = terminal.find(&visible[sentence.clone()])?;
    if end < sentence.start + punctuation.start() {
        return None;
    }
    // Only remove trailing punctuation when it is literal text at this anchor.
    let tail = &visible[end..sentence.end];
    source[link.markup.end..]
        .starts_with(tail)
        .then_some(link.markup.end + tail.len())
}

// URLs are UTF-8. The binary encoder can otherwise interpret some UTF-8
// bytes as Shift JIS. Keep numeric/alphanumeric compression and signal UTF-8
// explicitly when the destination contains non-ASCII characters.
fn encode_url(url: &str, level: EcLevel, version: Option<Version>) -> QrResult<QrCode> {
    if url.is_ascii() {
        return match version {
            Some(version) => QrCode::with_version(url, version, level),
            None => QrCode::with_error_correction_level(url, level),
        };
    }
    let runs: Vec<_> = Parser::new(url.as_bytes())
        .map(|mut run| {
            if run.mode == Mode::Kanji {
                run.mode = Mode::Byte;
            }
            run
        })
        .collect();
    let versions = (1..=40).map(Version::Normal);
    for version in versions.filter(|candidate| version.is_none_or(|version| *candidate == version))
    {
        let segments: Vec<_> = Optimizer::new(runs.iter().copied(), version).collect();
        let mut bits = Bits::new(version);
        bits.push_eci_designator(26)?;
        if bits.len() + total_encoded_len(&segments, version) <= bits.max_len(level)? {
            bits.push_segments(url.as_bytes(), segments.into_iter())?;
            bits.push_terminator(level)?;
            return QrCode::with_bits(bits, level);
        }
    }
    Err(QrError::DataTooLong)
}

static ESCAPED_UTF8: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?:%[89a-fA-F][0-9a-fA-F])+").ok());

fn readable_url(url: &str) -> Cow<'_, str> {
    let Some(escapes) = ESCAPED_UTF8.as_ref() else {
        return Cow::Borrowed(url);
    };
    escapes.replace_all(url, |matched: &regex::Captures<'_>| {
        let escapes = &matched[0];
        let bytes: Option<Vec<u8>> = (0..escapes.len())
            .step_by(3)
            .map(|index| u8::from_str_radix(&escapes[index + 1..index + 3], 16).ok())
            .collect();
        bytes
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|text| !text.chars().any(|ch| {
                ch.is_control() || ch.is_whitespace() || matches!(ch, '\u{200e}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            }))
            .unwrap_or_else(|| escapes.to_owned())
    })
}

fn url_spellings(url: &str) -> Vec<String> {
    let mut spellings = vec![url.to_owned()];
    let Ok(parsed) = Url::parse(url) else {
        return spellings;
    };
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return spellings;
    }
    let readable = readable_url(url);
    let mut seen = HashSet::from([url.to_owned()]);
    for spelling in std::iter::once(url).chain((readable != url).then_some(readable.as_ref())) {
        let Some((scheme, address)) = spelling.split_once("://") else {
            continue;
        };
        let authority = address
            .split(['/', '?', '#', '\\'])
            .next()
            .unwrap_or_default();
        let domain = parsed
            .domain()
            .filter(|domain| domain.eq_ignore_ascii_case(authority));
        let can_drop_scheme = parsed.scheme() == "https"
            && domain.is_some_and(|domain| domain.contains('.'))
            && !address
                .chars()
                .any(|ch| ch.is_whitespace() || ch.is_control());
        let upper_scheme = scheme.to_ascii_uppercase();
        let upper_address = domain.map(|_| {
            format!(
                "{}{}",
                authority.to_ascii_uppercase(),
                &address[authority.len()..]
            )
        });
        for scheme in [scheme, upper_scheme.as_str()] {
            for address in std::iter::once(address).chain(upper_address.as_deref()) {
                let explicit = format!("{scheme}://{address}");
                if !Url::parse(&explicit)
                    .is_ok_and(|candidate| same_destination(&candidate, &parsed))
                {
                    continue;
                }
                if seen.insert(explicit.clone()) {
                    spellings.push(explicit);
                }
                if can_drop_scheme && seen.insert(address.to_owned()) {
                    spellings.push(address.to_owned());
                }
            }
        }
    }
    spellings
}

pub(super) fn fits_version_one(original: &str, shortlinks: &[Url]) -> bool {
    std::iter::once(original)
        .chain(shortlinks.iter().map(Url::as_str))
        .flat_map(url_spellings)
        .any(|payload| encode_url(&payload, EcLevel::L, Some(Version::Normal(1))).is_ok())
}

fn optimize_url(payload: &str) -> QrResult<QrCode> {
    let smallest = encode_url(payload, EcLevel::L, None)?;
    let version = Some(smallest.version());
    Ok([EcLevel::H, EcLevel::Q, EcLevel::M]
        .into_iter()
        .find_map(|level| encode_url(payload, level, version).ok())
        .unwrap_or(smallest))
}

fn best_code(original: &str, shortlinks: &[Url]) -> QrResult<(QrCode, String)> {
    std::iter::once(original)
        .chain(shortlinks.iter().map(Url::as_str))
        .flat_map(url_spellings)
        .filter_map(|payload| Some((optimize_url(&payload).ok()?, payload)))
        .min_by_key(|(code, payload)| {
            let scheme = payload.split_once("://").map(|(scheme, _)| scheme);
            let scheme_priority = match scheme {
                Some(scheme) if scheme.eq_ignore_ascii_case("https") => 0,
                Some(scheme) if scheme.eq_ignore_ascii_case("http") => 1,
                _ => 2,
            };
            (
                code.width(),
                Reverse(code.error_correction_level()),
                scheme_priority,
            )
        })
        .ok_or(QrError::DataTooLong)
}

// Put reference letters at the precise authored link boundaries, including
// adjacent links to the same address. Tokenize before NFC and paragraph
// trimming so both sides retain the editor's normal inline styling.
fn marked_prose(source: &str, token: &str) -> String {
    let mut mark = 0;
    footnote_paragraphs(source)
        .iter()
        .map(|paragraph| {
            let mut out = String::new();
            for segment in inline_segments(paragraph) {
                for (index, piece) in segment.text.split(token).enumerate() {
                    if index > 0 {
                        out.push_str(&format!("#metadata((qr-source: {mark}))"));
                        mark += 1;
                    }
                    out.push_str(&render_styled_typst_text(
                        &piece.nfc().collect::<String>(),
                        &segment.style,
                        false,
                    ));
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("#parbreak()")
}

pub(super) fn render(
    source: &str,
    number: usize,
    shortlinks: &Shortlinks,
) -> Result<Option<String>, String> {
    let linked_source = link_pasted_urls(source);
    let source = linked_source.as_ref();
    let (visible, links) = note_links(source);
    if links.is_empty() {
        return Ok(None);
    }
    let mut previous_end = 0;
    let links_only = links.iter().all(|link| {
        let gap = &visible[previous_end..link.visible.start];
        previous_end = link.visible.end;
        gap.trim().is_empty()
    }) && visible[previous_end..].trim().is_empty();
    let multi = links.len() > 1;
    let mut token = "\u{e000}\u{e001}".to_owned();
    while visible.contains(&token) {
        token.insert('\u{e000}'.len_utf8(), '_');
    }
    let terminal = TERMINAL_RUN
        .as_ref()
        .map_err(|error| format!("Could not classify PDF footnote punctuation: {error}"))?;
    let sentences: Vec<_> = visible
        .split_sentence_bound_indices()
        .filter_map(|(pos, text)| {
            let trimmed = text.trim();
            let start = pos + text.len() - text.trim_start().len();
            (!trimmed.is_empty()).then_some(start..start + trimmed.len())
        })
        .collect();
    let mut refs = String::new();
    let mut prose = String::new();
    let mut full_prose = String::new();
    let mut cursor = 0;
    for link in links {
        let label = visible[link.visible.clone()].trim();
        let label = if label.is_empty() { &link.href } else { label };
        // Every lettered code needs a matching marker at the authored link.
        let remove_to =
            if multi || links_only || label == link.href || label.graphemes(true).count() > 40 {
                None
            } else {
                removable_end(&visible, &link, source, &sentences, terminal)
            };
        let mut caption = label.split_whitespace().collect::<Vec<_>>().join(" ");
        if let Some(end) = remove_to {
            // A shared row with different captions uses the authored words in
            // their original places and reserves the QR labels for owner numbers.
            full_prose = format!(", full-prose: [{}]", render_footnote_typst(source, false));
            caption.push_str(&source[link.markup.end..end]);
        }
        let candidates = shortlinks
            .get(&link.href)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let (code, _) = best_code(&link.href, candidates).map_err(|_| format!(
            "The link in footnote {number} is too long for a QR code. Shorten the link or select URLs in parentheses."
        ))?;
        let svg = code
            .render::<svg::Color>()
            .module_dimensions(1, 1)
            .quiet_zone(false)
            .build();
        refs.push_str(&format!(
            "(url: {}, words: {}, modules: {}, detached: {}, svg: {}),",
            typst_link_target(&link.href),
            typst_string(&caption),
            code.width(),
            remove_to.is_some(),
            typst_string(&svg)
        ));
        if let Some(end) = remove_to {
            prose.push_str(&source[cursor..link.markup.start]);
            cursor = end;
            if prose.ends_with([' ', '\t']) {
                cursor += source[end..].len() - source[end..].trim_start_matches([' ', '\t']).len();
            }
        } else {
            if visible[link.visible.clone()].trim().is_empty() {
                prose.push_str(&source[cursor..link.markup.start]);
                prose.push_str(&format!(
                    "<a href=\"{}\">{}</a>",
                    link.href.replace('&', "&amp;"),
                    link.href
                ));
            } else {
                prose.push_str(&source[cursor..link.markup.end]);
            }
            if multi {
                prose.push_str(&token);
            }
            cursor = link.markup.end;
        }
    }
    prose.push_str(&source[cursor..]);
    let prose = if multi {
        marked_prose(&prose, &token)
    } else {
        render_footnote_typst(&prose, false)
    };
    Ok(Some(format!(
        "#gnosis-qr-note([{prose}], ({refs}), link-only: {links_only}{full_prose})"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(source: &str) -> String {
        render(source, 3, &Shortlinks::new()).unwrap().unwrap()
    }

    #[test]
    fn optimizes_size_then_error_correction_then_scheme() {
        for (original, payload, width, level) in [
            (
                "https://wp.me/p6Zr2M-2Xo",
                "wp.me/p6Zr2M-2Xo",
                21,
                EcLevel::L,
            ),
            ("https://go.co/ABC123", "GO.CO/ABC123", 21, EcLevel::Q),
            ("https://x.co/1", "x.co/1", 21, EcLevel::H),
            ("HTTPS://X.CO", "X.CO", 21, EcLevel::H),
            (
                "http://host.local:8080/a",
                "http://host.local:8080/a",
                25,
                EcLevel::M,
            ),
        ] {
            let (code, chosen) = best_code(original, &[]).unwrap();
            assert_eq!(
                (chosen.as_str(), code.width(), code.error_correction_level()),
                (payload, width, level),
                "{original}"
            );
        }

        let fits_with_scheme = format!("HTTPS://EXAMPLE.ORG/{}", "A".repeat(50));
        let (code, payload) = best_code(&fits_with_scheme, &[]).unwrap();
        assert_eq!(
            (
                payload.as_str(),
                code.width(),
                code.error_correction_level()
            ),
            (fits_with_scheme.as_str(), 29, EcLevel::L)
        );
    }

    #[test]
    fn uses_the_smallest_verified_candidate_for_the_qr_only() {
        let original = "https://gnosisvn.org/2023/01/25/ky-nguyen-bao-binh/";
        let wp_me = url::Url::parse("https://wp.me/p6Zr2M-2Xo").unwrap();
        let own_domain = url::Url::parse("https://gnosisvn.org/?p=11370").unwrap();
        let (code, payload) = best_code(original, &[own_domain.clone(), wp_me.clone()]).unwrap();
        assert_eq!(code.width(), 21);
        assert!(
            payload == "wp.me/p6Zr2M-2Xo" || payload == "GNOSISVN.ORG/?p=11370",
            "{payload}"
        );

        let shortlinks = Shortlinks::from([(original.to_string(), vec![wp_me, own_domain])]);
        let note = format!(r#"Read the <a href="{original}">article</a>."#);
        let output = render(&note, 1, &shortlinks).unwrap().unwrap();
        assert!(output.contains(&format!("url: \"{original}\"")));
        assert!(output.contains("words: \"article\", modules: 21"));
    }

    #[test]
    fn optimizes_non_ascii_link_payloads_at_the_chosen_version() {
        let original = "https://example.org/Đọc";
        let (code, payload) = best_code(original, &[]).unwrap();
        assert_eq!(
            code.to_colors(),
            encode_url(
                &payload,
                code.error_correction_level(),
                Some(code.version())
            )
            .unwrap()
            .to_colors()
        );
        assert!(payload.ends_with("/Đọc"));
    }

    #[test]
    fn minimizes_the_verified_wikipedia_section_link() {
        let original =
            "https://vi.wikipedia.org/wiki/Phẩm_trật_Thiên_sứ_trong_Kitô_giáo#Cherubim_-_Minh_thần";
        let page_id_link =
            Url::parse("https://vi.wikipedia.org/?curid=1519434#Cherubim_-_Minh_th%E1%BA%A7n")
                .unwrap();
        let (code, payload) = best_code(original, &[page_id_link]).unwrap();
        assert_eq!(
            payload,
            "VI.WIKIPEDIA.ORG/?curid=1519434#Cherubim_-_Minh_thần"
        );
        assert_eq!(code.width(), 29);
        assert_eq!(code.error_correction_level(), EcLevel::L);
    }

    #[test]
    fn equivalent_spellings_preserve_escaped_delimiters_and_case_sensitive_fields() {
        let original = "https://example.org/B%C3%A0i%2F%252F?Token=ABC%26ghi#%C4%90%E1%BB%81";
        let spellings = url_spellings(original);
        assert!(spellings
            .iter()
            .any(|url| url == "HTTPS://EXAMPLE.ORG/Bài%2F%252F?Token=ABC%26ghi#Đề"));
        assert!(spellings
            .iter()
            .any(|url| url == "EXAMPLE.ORG/Bài%2F%252F?Token=ABC%26ghi#Đề"));
        let parsed = Url::parse(original).unwrap();
        for spelling in spellings {
            let candidate = if spelling.contains("://") {
                spelling.clone()
            } else {
                format!("https://{spelling}")
            };
            assert!(
                same_destination(&parsed, &Url::parse(&candidate).unwrap()),
                "{spelling}"
            );
        }
        let invalid = "https://example.org/%C0%AF/%E2%80%AE/%C2%A0/%00/%2F";
        assert_eq!(readable_url(invalid), invalid);
        for explicit in [
            "https://user@example.org/Đề",
            "https://example.org:443/Đề",
            "http://example.org/Đề",
        ] {
            assert!(url_spellings(explicit)
                .iter()
                .all(|spelling| spelling.contains("://")));
        }
    }

    #[test]
    fn prefers_an_explicit_https_scheme_when_size_and_correction_tie() {
        let original = "HTTPS://EXAMPLE.ORG/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let compact = original.strip_prefix("HTTPS://").unwrap();
        let (code, payload) = best_code(original, &[]).unwrap();
        let compact = optimize_url(compact).unwrap();
        assert_eq!(code.width(), compact.width());
        assert_eq!(
            code.error_correction_level(),
            compact.error_correction_level()
        );
        assert_eq!(payload, original);
    }

    #[test]
    fn preserves_sentence_context_and_groups_styled_link_words() {
        let output = body(
            r#"Read <a href="https://example.org/a">the <i>paper</i></a>. <a href="https://example.org/b">Watch the film</a>. She asks “<a href="https://example.org/c">Where now?</a>” in the recording."#,
        );
        let (prose, codes) = output.split_once("], (").unwrap();
        assert!(prose.contains("#emph[#text(\"paper\")]"));
        assert!(prose.contains("Where now?"));
        assert!(prose.contains(r#"#text("Watch the film")]#metadata((qr-source: 1))"#));
        assert!(prose.contains("#text(\". She asks “\")"));
        assert_eq!(codes.matches("modules: ").count(), 3);
        assert!(codes.contains("words: \"the paper\""));
        assert!(codes.contains("words: \"Watch the film\""));
        assert_eq!(codes.matches("detached: false").count(), 3);
    }

    #[test]
    fn an_initial_or_line_break_can_introduce_a_linked_continuation() {
        for source in [
            r#"Ask Dr. <a href="https://example.org">Smith.</a> Then read the paper."#,
            "The editor asks\n<a href=\"https://example.org\">Where now?</a>",
        ] {
            let output = body(source);
            assert!(output.split_once("], (").unwrap().0.contains("#link("));
        }
    }

    #[test]
    fn independent_prompts_need_no_final_punctuation_in_any_script() {
        for (before, label, after) in [
            ("Ê-lo-him là thiên thần. ", "Đọc thêm", ""),
            ("The archive is open. ", "click here", ""),
            ("前文。", "詳しくはこちら", ""),
            ("مَن المترجم؟ ", "اقرأ المزيد", ""),
            ("अध्याय समाप्त। ", "और पढ़ें", ""),
            ("ឯកសារយោង។ ", "អានបន្ថែម", ""),
            ("ማብራሪያ። ", "ተጨማሪ ያንብቡ", ""),
            ("คำอธิบาย\n \n", "อ่านเพิ่มเติม", "\n\nข้อความถัดไป"),
            ("", "Read more", "\n\nA separate paragraph."),
            ("First note. ", "Play the audio. View the transcript", ""),
        ] {
            let source = format!("{before}<a href=\"https://example.org\">{label}</a>{after}");
            let output = body(&source);
            let (prose, codes) = output.split_once("], (").unwrap();
            assert_eq!(
                prose.strip_prefix("#gnosis-qr-note([").unwrap(),
                render_footnote_typst(&format!("{before}{after}"), false),
                "{source}"
            );
            assert!(codes.contains(&format!("words: {}", typst_string(label))));
        }
    }

    #[test]
    fn prompts_that_belong_to_a_larger_phrase_stay_in_both_places() {
        for (before, label, after) in [
            ("Đọc thêm về thiên thần ", "tại đây", "."),
            ("Xin ", "đọc thêm", ""),
            ("", "Click here", " for the recording."),
            ("The editor wrote “", "Đọc thêm", "” in the margin."),
            ("Read more. ", "Click here", "\nfor details."),
            ("See Dr. ", "smith", ""),
            ("The measured value is 3.", "14", ""),
            ("資料を", "こちら", "から読む。"),
            ("ดูข้อมูล", "เพิ่มเติม", ""),
        ] {
            let source = format!("{before}<a href=\"https://example.org\">{label}</a>{after}");
            let output = body(&source);
            let (prose, codes) = output.split_once("], (").unwrap();
            assert_eq!(
                prose.strip_prefix("#gnosis-qr-note([").unwrap(),
                render_footnote_typst(&source, false),
                "{source}"
            );
            assert!(codes.contains(&format!("words: {}", typst_string(label))));
        }
    }

    #[test]
    fn standalone_links_in_a_multi_code_note_keep_their_own_text_markers() {
        let output = body(
            r#"Listen in order. <a href="https://example.org/1">Play recording 1.</a> <a href="https://example.org/2">Play recording 2.</a>"#,
        );
        let (prose, codes) = output.split_once("], (").unwrap();
        assert!(prose.contains("Listen in order."));
        assert!(prose.contains(r#"#text("Play recording 1.")]#metadata((qr-source: 0))"#));
        assert!(prose.contains(r#"#text("Play recording 2.")]#metadata((qr-source: 1))"#));
        assert_eq!(codes.matches("words: \"Play recording").count(), 2);
    }

    #[test]
    fn pasted_destinations_keep_punctuation_styles_and_distinct_native_keys() {
        let url = "https://example.org/a_(b)?one=1&two=2";
        let note = format!(
            r#"See (<i>{url}</i>), then <a href="https://example.org/watch">https://example.org/title</a>. Revisit https://example.org/two)."#
        );
        let (visible, links) = note_links(&link_pasted_urls(&note));
        assert!(visible.contains(&format!("({url}), then")));
        assert_eq!(
            links.iter().map(|l| l.href.as_str()).collect::<Vec<_>>(),
            [url, "https://example.org/watch", "https://example.org/two"]
        );
        let output = body(&note);
        let prose = output.split_once("], (").unwrap().0;
        assert!(prose.contains("#emph["));
        for i in 0..3 {
            assert_eq!(prose.matches(&format!("qr-source: {i}")).count(), 1);
        }
        assert!(prose.ends_with(r#"#text(").")"#));
    }

    #[test]
    fn whole_urls_adjacent_anchors_and_non_latin_sentences() {
        for value in [
            "https://example.org/page?q=a&b=2#section",
            r#"<a href="https://example.org/page?q=a&amp;b=2#section">Short title</a>"#,
        ] {
            let output = body(value);
            assert!(output.contains("url: \"https://example.org/page?q=a&b=2#section\""));
            assert!(output.contains("detached: false"));
            assert!(output.split_once("], (").unwrap().0.contains("#link("));
        }
        assert!(body("<i>https://example.org/hello!</i>")
            .contains("url: \"https://example.org/hello!\""));
        let repeat =
            body(r#"<a href="https://example.org">One.</a><a href="https://example.org">Two.</a>"#);
        assert_eq!(repeat.matches("modules: ").count(), 2);
        assert_eq!(repeat.matches("qr-source:").count(), 2);
        let output = body(r#"前文。<a href="https://example.org">動画を見る。</a>次の文。"#);
        assert!(!output.split_once("], (").unwrap().0.contains("動画"));
        let shortlinks = Shortlinks::new();
        assert!(render("A plain note", 1, &shortlinks).unwrap().is_none());
        assert!(render(
            &format!("https://example.org/{}", "x".repeat(5000)),
            9,
            &shortlinks
        )
        .unwrap_err()
        .contains("footnote 9"));
    }
}
