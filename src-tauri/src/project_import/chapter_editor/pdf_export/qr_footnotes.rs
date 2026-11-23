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
use regex::Regex;
use std::{ops::Range, sync::LazyLock};
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
            removable_end(&visible, &link, source, &sentences, terminal)
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
