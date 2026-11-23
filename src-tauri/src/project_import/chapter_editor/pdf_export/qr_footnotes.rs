//! Prepare print links before native Typst footnotes are attached to body markers.
use super::super::chapter_export::{inline_link_tag, InlineLinkTag};
use super::{inline_visible_text, render_footnote_typst, typst_link_target, typst_string};
use qrcode::{
    bits::Bits,
    optimize::{total_encoded_len, Optimizer, Parser},
    render::svg,
    types::{Mode, QrError},
    EcLevel, QrCode, QrResult, Version,
};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

pub(super) const IMPORT: &str = "#import \"qr-footnotes.typ\": gnosis-qr-note\n";

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
    if links.is_empty() {
        let url = visible.trim();
        if !url.chars().any(char::is_whitespace)
            && url::Url::parse(url)
                .is_ok_and(|u| matches!(u.scheme(), "https" | "http") && u.host().is_some())
        {
            links.push(NoteLink {
                href: url.into(),
                markup: 0..source.len(),
                visible: 0..visible.len(),
            });
        }
    }
    (visible, links)
}

fn sentence_end(c: char) -> bool {
    ".!?…。！？؟۔।॥".contains(c)
}

// The link must occupy a sentence of the surrounding note. A question inside
// “She asked, …” does not qualify. Allow the sentence's period outside the
// anchor and consume it with the sentence so it cannot be left in the prose.
fn removable_end(
    visible: &str,
    link: &NoteLink,
    source: &str,
    sentences: &[Range<usize>],
) -> Option<usize> {
    let words = &visible[link.visible.clone()];
    let trimmed = words.trim();
    // A bare address on its own paragraph (for example, after a media
    // caption with a second link) is an independent reference.
    if trimmed == link.href
        && visible[..link.visible.start]
            .rsplit("\n\n")
            .next()
            .unwrap_or("")
            .trim()
            .is_empty()
        && visible[link.visible.end..]
            .split("\n\n")
            .next()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Some(link.markup.end);
    }
    let start = link.visible.start + words.len() - words.trim_start().len();
    // Unicode sentence boundaries also occur at a single line break. Keep
    // a linked continuation of an unfinished sentence in the prose.
    let before = &visible[..start];
    let previous = before.trim_end();
    if !previous.is_empty() && !before[previous.len()..].contains("\n\n") {
        let previous = previous.trim_end_matches(['”', '’', '"', '»', '」', '』', ')', ']']);
        if !previous.ends_with(sentence_end) {
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
    let sentence = &sentences[sentences.binary_search_by_key(&start, |s| s.start).ok()?];
    let tail = visible.get(start + trimmed.len()..sentence.end)?;
    if !(tail.is_empty() || tail.chars().all(sentence_end))
        || !visible[sentence.clone()].ends_with(sentence_end)
        || trimmed.starts_with(['“', '‘', '"', '«', '「', '『'])
    {
        return None;
    }
    // Only remove trailing punctuation when it is literal text at this anchor.
    source[link.markup.end..]
        .starts_with(tail)
        .then_some(link.markup.end + tail.len())
}

// URLs are UTF-8. The binary encoder can otherwise interpret some UTF-8
// bytes as Shift JIS. Keep numeric/alphanumeric compression and signal UTF-8
// explicitly when the destination contains non-ASCII characters.
fn encode_url(url: &str) -> QrResult<QrCode> {
    if url.is_ascii() {
        return QrCode::new(url);
    }
    let runs: Vec<_> = Parser::new(url.as_bytes())
        .map(|mut run| {
            if run.mode == Mode::Kanji {
                run.mode = Mode::Byte;
            }
            run
        })
        .collect();
    for n in 1..=40 {
        let version = Version::Normal(n);
        let segments: Vec<_> = Optimizer::new(runs.iter().copied(), version).collect();
        let mut bits = Bits::new(version);
        bits.push_eci_designator(26)?;
        if bits.len() + total_encoded_len(&segments, version) <= bits.max_len(EcLevel::M)? {
            bits.push_segments(url.as_bytes(), segments.into_iter())?;
            bits.push_terminator(EcLevel::M)?;
            return QrCode::with_bits(bits, EcLevel::M);
        }
    }
    Err(QrError::DataTooLong)
}

pub(super) fn render(source: &str, number: usize) -> Result<Option<String>, String> {
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
    let whole_link = links_only && links.len() == 1;
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
    let mut cursor = 0;
    for link in links {
        let label = visible[link.visible.clone()].trim();
        let label = if label.is_empty() { &link.href } else { label };
        let caption = label.split_whitespace().collect::<Vec<_>>().join(" ");
        let code = encode_url(&link.href).map_err(|_| format!(
            "The link in footnote {number} is too long for a QR code. Shorten the link or select URLs in parentheses."
        ))?;
        let svg = code
            .render::<svg::Color>()
            .module_dimensions(1, 1)
            .quiet_zone(false)
            .build();
        refs.push_str(&format!(
            "(url: {}, words: {}, modules: {}, svg: {}),",
            typst_link_target(&link.href),
            typst_string(&caption),
            code.width(),
            typst_string(&svg)
        ));
        let remove_to = if links_only {
            Some(link.markup.end)
        } else {
            removable_end(&visible, &link, source, &sentences)
        };
        if let Some(end) = remove_to {
            prose.push_str(&source[cursor..link.markup.start]);
            cursor = end;
            if prose.ends_with([' ', '\t']) {
                cursor += source[end..].len() - source[end..].trim_start_matches([' ', '\t']).len();
            }
        }
    }
    prose.push_str(&source[cursor..]);
    let has_prose = !inline_visible_text(&prose).trim().is_empty();
    Ok(Some(format!(
        "#gnosis-qr-note([{}], ({refs}), {whole_link}, {has_prose})",
        render_footnote_typst(&prose, false)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(source: &str) -> String {
        render(source, 3).unwrap().unwrap()
    }

    #[test]
    fn preserves_sentence_context_and_groups_styled_link_words() {
        let output = body(
            r#"Read <a href="https://example.org/a">the <i>paper</i></a>. <a href="https://example.org/b">Watch the film</a>. She asks “<a href="https://example.org/c">Where now?</a>” in the recording."#,
        );
        let (prose, codes) = output.split_once("], (").unwrap();
        assert!(prose.contains("#emph[#text(\"paper\")]"));
        assert!(prose.contains("Where now?"));
        assert!(!prose.contains("Watch the film"));
        assert!(prose.contains("#text(\". She asks “\")"));
        assert_eq!(codes.matches("modules: ").count(), 3);
        assert!(codes.contains("words: \"the paper\""));
        assert!(codes.contains("words: \"Watch the film\""));
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
    fn consecutive_numbered_sentences_move_to_their_captions() {
        let output = body(
            r#"Listen in order. <a href="https://example.org/1">Play recording 1.</a> <a href="https://example.org/2">Play recording 2.</a>"#,
        );
        let (prose, codes) = output.split_once("], (").unwrap();
        assert!(prose.contains("Listen in order."));
        assert!(!prose.contains("Play recording"));
        assert_eq!(codes.matches("words: \"Play recording").count(), 2);
    }

    #[test]
    fn whole_urls_adjacent_anchors_and_non_latin_sentences() {
        for value in [
            "https://example.org/page?q=a&b=2#section",
            r#"<a href="https://example.org/page?q=a&amp;b=2#section">Short title</a>"#,
        ] {
            let output = body(value);
            assert!(output.contains("url: \"https://example.org/page?q=a&b=2#section\""));
            assert!(output.ends_with("true, false)"));
        }
        let repeat =
            body(r#"<a href="https://example.org">One.</a><a href="https://example.org">Two.</a>"#);
        assert_eq!(repeat.matches("modules: ").count(), 2);
        assert!(repeat.ends_with("false, false)"));
        let output = body(r#"前文。<a href="https://example.org">動画を見る。</a>次の文。"#);
        assert!(!output.split_once("], (").unwrap().0.contains("動画"));
        assert!(render("A plain note", 1).unwrap().is_none());
        assert!(
            render(&format!("https://example.org/{}", "x".repeat(5000)), 9)
                .unwrap_err()
                .contains("footnote 9")
        );
    }
}
