use encoding_rs::{
    Encoding, BIG5, EUC_KR, GBK, SHIFT_JIS, UTF_8, WINDOWS_1250, WINDOWS_1251, WINDOWS_1252,
    WINDOWS_1253, WINDOWS_1254, WINDOWS_1255, WINDOWS_1256, WINDOWS_1257, WINDOWS_1258,
    WINDOWS_874,
};

#[derive(Clone, Copy)]
struct RtfGroupState {
    skip_destination: bool,
    unicode_fallback_count: usize,
    pending_ignorable_destination: bool,
    encoding: &'static Encoding,
}

impl Default for RtfGroupState {
    fn default() -> Self {
        Self {
            skip_destination: false,
            unicode_fallback_count: 1,
            pending_ignorable_destination: false,
            encoding: WINDOWS_1252,
        }
    }
}

pub(super) fn extract_rtf_plain_text(bytes: &[u8]) -> Result<Vec<String>, String> {
    if bytes.is_empty() {
        return Err("The selected RTF file is empty.".to_string());
    }
    let content_start = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    if !bytes[content_start..].starts_with(b"{\\rtf") {
        return Err("The selected file is not a valid RTF document.".to_string());
    }

    let text = parse_rtf_visible_text(bytes)?;
    let blocks = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if blocks.is_empty() {
        return Err("The selected RTF file does not contain any readable text.".to_string());
    }
    Ok(blocks)
}

fn parse_rtf_visible_text(bytes: &[u8]) -> Result<String, String> {
    let mut index = 0usize;
    let mut stack = Vec::new();
    let mut state = RtfGroupState::default();
    let mut output = String::new();
    let mut fallback_remaining = 0usize;
    let mut pending_high_surrogate = None;

    while index < bytes.len() {
        match bytes[index] {
            b'{' => {
                stack.push(state);
                index += 1;
            }
            b'}' => {
                flush_pending_surrogate(&mut output, &mut pending_high_surrogate);
                state = stack.pop().ok_or_else(|| {
                    "The selected RTF document has unbalanced groups.".to_string()
                })?;
                index += 1;
            }
            b'\\' => {
                index = parse_control(
                    bytes,
                    index,
                    &mut state,
                    &mut output,
                    &mut fallback_remaining,
                    &mut pending_high_surrogate,
                )?;
            }
            b'\r' | b'\n' => {
                index += 1;
            }
            _ => {
                let run_start = index;
                while index < bytes.len()
                    && !matches!(bytes[index], b'{' | b'}' | b'\\' | b'\r' | b'\n')
                {
                    index += 1;
                }
                if !state.skip_destination {
                    let decoded = decode_rtf_bytes(&bytes[run_start..index], state.encoding)?;
                    let mut characters = decoded.chars().peekable();
                    while fallback_remaining > 0 {
                        if characters.next().is_none() {
                            break;
                        }
                        fallback_remaining -= 1;
                    }
                    if characters.peek().is_some() {
                        flush_pending_surrogate(&mut output, &mut pending_high_surrogate);
                        output.extend(characters);
                    }
                }
            }
        }
    }

    if !stack.is_empty() {
        return Err("The selected RTF document has unbalanced groups.".to_string());
    }
    flush_pending_surrogate(&mut output, &mut pending_high_surrogate);
    Ok(output)
}

fn parse_control(
    bytes: &[u8],
    slash_index: usize,
    state: &mut RtfGroupState,
    output: &mut String,
    fallback_remaining: &mut usize,
    pending_high_surrogate: &mut Option<u16>,
) -> Result<usize, String> {
    let mut index = slash_index + 1;
    let Some(&next) = bytes.get(index) else {
        return Err("The selected RTF document ends with an incomplete control word.".to_string());
    };

    match next {
        b'\\' | b'{' | b'}' => {
            if *fallback_remaining > 0 {
                *fallback_remaining -= 1;
            } else if !state.skip_destination {
                flush_pending_surrogate(output, pending_high_surrogate);
                output.push(next as char);
            }
            return Ok(index + 1);
        }
        b'*' => {
            state.pending_ignorable_destination = true;
            return Ok(index + 1);
        }
        b'\'' => {
            let mut encoded = Vec::new();
            loop {
                let hex = bytes.get(index + 1..index + 3).ok_or_else(|| {
                    "The selected RTF document contains an invalid hex escape.".to_string()
                })?;
                encoded.push(parse_hex_byte(hex)?);
                index += 3;
                if bytes.get(index..index + 2) != Some(b"\\'") {
                    break;
                }
                index += 1;
            }
            if !state.skip_destination {
                let decoded = decode_rtf_bytes(&encoded, state.encoding)?;
                let mut characters = decoded.chars().peekable();
                while *fallback_remaining > 0 {
                    if characters.next().is_none() {
                        break;
                    }
                    *fallback_remaining -= 1;
                }
                if characters.peek().is_some() {
                    flush_pending_surrogate(output, pending_high_surrogate);
                    output.extend(characters);
                }
            }
            return Ok(index);
        }
        b'~' => {
            if *fallback_remaining > 0 {
                *fallback_remaining -= 1;
            } else if !state.skip_destination {
                output.push('\u{00a0}');
            }
            return Ok(index + 1);
        }
        b'_' => {
            if *fallback_remaining > 0 {
                *fallback_remaining -= 1;
            } else if !state.skip_destination {
                output.push('\u{2011}');
            }
            return Ok(index + 1);
        }
        b'-' => {
            if *fallback_remaining > 0 {
                *fallback_remaining -= 1;
            }
            return Ok(index + 1);
        }
        _ if !next.is_ascii_alphabetic() => {
            if *fallback_remaining > 0 && next != b'*' {
                *fallback_remaining -= 1;
            }
            return Ok(index + 1);
        }
        _ => {}
    }

    let word_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_alphabetic) {
        index += 1;
    }
    let word = std::str::from_utf8(&bytes[word_start..index])
        .map_err(|_| "The selected RTF document contains an invalid control word.".to_string())?
        .to_ascii_lowercase();

    let mut sign = 1i32;
    if bytes.get(index) == Some(&b'-') {
        sign = -1;
        index += 1;
    }
    let number_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    let parameter = if index > number_start {
        let value = std::str::from_utf8(&bytes[number_start..index])
            .ok()
            .and_then(|digits| digits.parse::<i32>().ok())
            .ok_or_else(|| "The selected RTF document has an invalid control value.".to_string())?;
        Some(value.saturating_mul(sign))
    } else {
        None
    };
    if bytes.get(index) == Some(&b' ') {
        index += 1;
    }

    if word == "bin" {
        return Err("RTF documents containing binary data are not supported.".to_string());
    }
    if state.pending_ignorable_destination || is_skipped_destination(&word) {
        state.skip_destination = true;
        state.pending_ignorable_destination = false;
        return Ok(index);
    }
    state.pending_ignorable_destination = false;
    if state.skip_destination {
        return Ok(index);
    }

    match word.as_str() {
        "ansi" => {
            state.encoding = WINDOWS_1252;
        }
        "ansicpg" => {
            let code_page = parameter.ok_or_else(|| {
                "The selected RTF document has an invalid ANSI code page.".to_string()
            })?;
            state.encoding = encoding_for_code_page(code_page).ok_or_else(|| {
                format!(
                    "RTF ANSI code page {code_page} is not supported. Save the file as Unicode RTF and try again."
                )
            })?;
        }
        "par" | "line" => {
            flush_pending_surrogate(output, pending_high_surrogate);
            if !output.ends_with('\n') {
                output.push('\n');
            }
        }
        "tab" => {
            flush_pending_surrogate(output, pending_high_surrogate);
            output.push('\t');
        }
        "emdash" => output.push('\u{2014}'),
        "endash" => output.push('\u{2013}'),
        "bullet" => output.push('\u{2022}'),
        "lquote" => output.push('\u{2018}'),
        "rquote" => output.push('\u{2019}'),
        "ldblquote" => output.push('\u{201c}'),
        "rdblquote" => output.push('\u{201d}'),
        "uc" => {
            state.unicode_fallback_count = parameter.unwrap_or(1).max(0) as usize;
        }
        "u" => {
            let signed = parameter.ok_or_else(|| {
                "The selected RTF document has an invalid Unicode escape.".to_string()
            })?;
            append_utf16_unit(output, pending_high_surrogate, signed as i16 as u16);
            *fallback_remaining = state.unicode_fallback_count;
        }
        _ => {}
    }
    Ok(index)
}

fn is_skipped_destination(word: &str) -> bool {
    matches!(
        word,
        "fonttbl"
            | "colortbl"
            | "stylesheet"
            | "info"
            | "pict"
            | "object"
            | "header"
            | "headerl"
            | "headerr"
            | "headerf"
            | "footer"
            | "footerl"
            | "footerr"
            | "footerf"
            | "footnote"
            | "annotation"
            | "fldinst"
            | "datastore"
            | "themedata"
            | "xmlnstbl"
            | "generator"
    )
}

fn append_utf16_unit(output: &mut String, pending_high: &mut Option<u16>, unit: u16) {
    if (0xd800..=0xdbff).contains(&unit) {
        flush_pending_surrogate(output, pending_high);
        *pending_high = Some(unit);
        return;
    }
    if (0xdc00..=0xdfff).contains(&unit) {
        if let Some(high) = pending_high.take() {
            let scalar = 0x10000 + (((high as u32 - 0xd800) << 10) | (unit as u32 - 0xdc00));
            output.push(char::from_u32(scalar).unwrap_or('\u{fffd}'));
        } else {
            output.push('\u{fffd}');
        }
        return;
    }
    flush_pending_surrogate(output, pending_high);
    output.push(char::from_u32(unit as u32).unwrap_or('\u{fffd}'));
}

fn flush_pending_surrogate(output: &mut String, pending_high: &mut Option<u16>) {
    if pending_high.take().is_some() {
        output.push('\u{fffd}');
    }
}

fn parse_hex_byte(hex: &[u8]) -> Result<u8, String> {
    let value = std::str::from_utf8(hex)
        .ok()
        .and_then(|text| u8::from_str_radix(text, 16).ok())
        .ok_or_else(|| "The selected RTF document contains an invalid hex escape.".to_string())?;
    Ok(value)
}

fn encoding_for_code_page(code_page: i32) -> Option<&'static Encoding> {
    match code_page {
        65001 => Some(UTF_8),
        874 => Some(WINDOWS_874),
        932 => Some(SHIFT_JIS),
        936 => Some(GBK),
        949 => Some(EUC_KR),
        950 => Some(BIG5),
        1250 => Some(WINDOWS_1250),
        1251 => Some(WINDOWS_1251),
        1252 => Some(WINDOWS_1252),
        1253 => Some(WINDOWS_1253),
        1254 => Some(WINDOWS_1254),
        1255 => Some(WINDOWS_1255),
        1256 => Some(WINDOWS_1256),
        1257 => Some(WINDOWS_1257),
        1258 => Some(WINDOWS_1258),
        _ => None,
    }
}

fn decode_rtf_bytes<'a>(
    bytes: &'a [u8],
    encoding: &'static Encoding,
) -> Result<std::borrow::Cow<'a, str>, String> {
    let (decoded, had_errors) = encoding.decode_without_bom_handling(bytes);
    if had_errors {
        return Err(format!(
            "The RTF text is not valid {} data. Save the file as Unicode RTF and try again.",
            encoding.name()
        ));
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plain_text_and_discards_inline_formatting() {
        let blocks = extract_rtf_plain_text(
            br#"{\rtf1\ansi First paragraph.\par Second {\b bold} paragraph.}"#,
        )
        .expect("RTF should parse");

        assert_eq!(blocks, vec!["First paragraph.", "Second bold paragraph."]);
    }

    #[test]
    fn extracts_unicode_and_escaped_punctuation() {
        let blocks = extract_rtf_plain_text(
            br#"{\rtf1\ansi Vietnamese: Ti\u7871?n Vi\u7879?t\emdash test.}"#,
        )
        .expect("RTF should parse");

        assert_eq!(blocks, vec!["Vietnamese: Tiến Việt—test."]);
    }

    #[test]
    fn extracts_surrogate_pairs_and_hex_escapes() {
        let blocks = extract_rtf_plain_text(
            br#"{\rtf1\ansi Emoji: \u-10179?\u-8704? Quote: \'93hello\'94.}"#,
        )
        .expect("RTF should parse");

        assert_eq!(blocks, vec!["Emoji: 😀 Quote: “hello”."]);
    }

    #[test]
    fn honors_declared_code_pages_for_hex_escapes_and_raw_bytes() {
        let escaped = extract_rtf_plain_text(
            br#"{\rtf1\ansi\ansicpg1251 Russian: \'cf\'f0\'e8\'e2\'e5\'f2}"#,
        )
        .expect("Windows-1251 hex escapes should parse");
        assert_eq!(escaped, vec!["Russian: Привет"]);

        let mut raw = br#"{\rtf1\ansi\ansicpg1251 Russian: "#.to_vec();
        raw.extend_from_slice(&[0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
        raw.push(b'}');
        let raw = extract_rtf_plain_text(&raw).expect("Windows-1251 raw bytes should parse");
        assert_eq!(raw, vec!["Russian: Привет"]);

        let multibyte_fallback =
            extract_rtf_plain_text(br#"{\rtf1\ansi\ansicpg932 Unicode: \u12354\'82\'a0 text}"#)
                .expect("a multibyte Unicode fallback should be skipped as one character");
        assert_eq!(multibyte_fallback, vec!["Unicode: あ text"]);
    }

    #[test]
    fn ignores_metadata_images_and_footnotes() {
        let blocks = extract_rtf_plain_text(
            br#"{\rtf1{\fonttbl{\f0 Times;}}Visible{\pict 89504e47}{\footnote hidden}\par Text}"#,
        )
        .expect("RTF should parse");

        assert_eq!(blocks, vec!["Visible", "Text"]);
    }

    #[test]
    fn rejects_binary_rtf_destinations() {
        let error = extract_rtf_plain_text(br#"{\rtf1\ansi\bin4 abcd}"#)
            .expect_err("binary RTF should be rejected");
        assert!(error.contains("binary data"));

        let skipped_destination =
            extract_rtf_plain_text(br#"{\rtf1 Visible{\pict\bin4 {\\}} text}"#)
                .expect_err("binary data in a skipped destination should still be rejected");
        assert!(skipped_destination.contains("binary data"));
    }

    #[test]
    fn binary_detection_does_not_reject_escaped_text_or_longer_control_words() {
        let escaped = extract_rtf_plain_text(br#"{\rtf1 Visible \\binary text}"#)
            .expect("escaped visible text should not be treated as binary data");
        assert_eq!(escaped, vec![r"Visible \binary text"]);

        let longer = extract_rtf_plain_text(br#"{\rtf1 Visible \binary text}"#)
            .expect("a longer control word should not be treated as the bin control");
        assert_eq!(longer, vec!["Visible text"]);
    }

    #[test]
    fn rejects_empty_non_rtf_and_unbalanced_files() {
        assert!(extract_rtf_plain_text(b"").is_err());
        assert!(extract_rtf_plain_text(b"plain text").is_err());
        assert!(extract_rtf_plain_text(br#"{\rtf1 broken"#).is_err());
    }
}
