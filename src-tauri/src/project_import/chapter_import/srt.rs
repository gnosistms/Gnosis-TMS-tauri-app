use std::collections::BTreeMap;

use serde::Serialize;

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    txt::decode_text_file,
    ImportSrtInput, ImportedField, ImportedLanguage, ImportedRow, ParsedWorkbook,
};

// Cap the number of imported rows, matching MAX_TXT_IMPORTED_ROWS.
const MAX_SRT_IMPORTED_ROWS: usize = 20_000;

// Rolling-caption filler cues (YouTube auto-captions) are 10 ms in practice;
// anything at or below this duration is a collapse candidate.
const ROLLING_FILLER_MAX_DURATION_MS: u64 = 100;

#[derive(Clone)]
pub(super) struct SrtRowMetadata {
    pub(super) sequence_number: Option<u64>,
    pub(super) start_ms: u64,
    pub(super) end_ms: u64,
}

// Set when a rolling-caption file was collapsed at import; surfaced in the
// import notice ("Merged rolling captions: X cues → N rows").
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SrtImportSummary {
    pub(super) original_cue_count: usize,
    pub(super) imported_row_count: usize,
}

struct RawCue {
    sequence_number: Option<u64>,
    start_ms: u64,
    end_ms: u64,
    text: String,
}

fn raw_cue_duration_ms(cue: &RawCue) -> u64 {
    cue.end_ms.saturating_sub(cue.start_ms)
}

// A rolling filler: a near-instant cue whose text is empty or entirely made of
// lines already shown by a neighboring cue. YouTube emits one between every
// pair of real cues to bridge the caption roll.
fn cue_is_rolling_filler(cues: &[RawCue], index: usize) -> bool {
    let cue = &cues[index];
    if raw_cue_duration_ms(cue) > ROLLING_FILLER_MAX_DURATION_MS {
        return false;
    }
    if cue.text.is_empty() {
        return true;
    }

    let lines: Vec<&str> = cue.text.lines().collect();
    let neighbor_repeats = |neighbor: Option<&RawCue>| {
        neighbor.is_some_and(|candidate| {
            let neighbor_lines: Vec<&str> = candidate.text.lines().collect();
            lines.iter().all(|line| neighbor_lines.contains(line))
        })
    };
    neighbor_repeats(index.checked_sub(1).map(|previous| &cues[previous]))
        || neighbor_repeats(cues.get(index + 1))
}

// Rolling-caption signature: filler cues are not an occasional artifact but a
// structural feature (they alternate with real cues, so ~half the file).
fn detect_rolling_captions(cues: &[RawCue]) -> bool {
    let filler_count = (0..cues.len())
        .filter(|&index| cue_is_rolling_filler(cues, index))
        .count();
    filler_count >= 3 && filler_count * 3 >= cues.len()
}

// Collapse rolling captions to one row per spoken line: drop the fillers, keep
// only each cue's new lines (the ones not carried over from the previous cue),
// and time each row from when its line appears to when the next line appears
// (small gaps left by dropped fillers are absorbed so rows stay adjacent).
fn collapse_rolling_captions(cues: Vec<RawCue>) -> Vec<RawCue> {
    let mut rows: Vec<RawCue> = Vec::new();
    let mut previous_lines: Vec<String> = Vec::new();

    for (index, cue) in cues.iter().enumerate() {
        if cue_is_rolling_filler(&cues, index) {
            continue;
        }

        let lines: Vec<String> = cue.text.lines().map(str::to_string).collect();
        // Longest carried prefix: leading lines that repeat the trailing lines
        // of the previous kept cue (the caption roll).
        let max_carried = lines.len().min(previous_lines.len());
        let carried = (0..=max_carried)
            .rev()
            .find(|&count| lines[..count] == previous_lines[previous_lines.len() - count..])
            .unwrap_or(0);
        let new_text = lines[carried..].join("\n");

        if new_text.is_empty() && carried > 0 {
            // Entirely carried-over text: the line just stayed on screen —
            // extend the previous row instead of duplicating it.
            if let Some(previous_row) = rows.last_mut() {
                previous_row.end_ms = previous_row.end_ms.max(cue.end_ms);
            }
        } else {
            rows.push(RawCue {
                sequence_number: cue.sequence_number,
                start_ms: cue.start_ms,
                end_ms: cue.end_ms,
                text: new_text,
            });
        }
        previous_lines = lines;
    }

    for index in 0..rows.len().saturating_sub(1) {
        let next_start = rows[index + 1].start_ms;
        if next_start >= rows[index].end_ms
            && next_start - rows[index].end_ms <= ROLLING_FILLER_MAX_DURATION_MS
        {
            rows[index].end_ms = next_start;
        }
    }

    rows
}

pub(super) fn parse_srt_file(input: ImportSrtInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    let code = normalize_language_code(&input.source_language_code)
        .ok_or_else(|| "Select a supported source language.".to_string())?;
    let name = language_display_name(&code);
    let decoded = decode_text_file(&input.bytes)?;
    let lines: Vec<&str> = decoded.lines().collect();

    // Cues are located by their timing lines rather than blank-line separation:
    // YouTube's auto-generated SRT puts a blank line *inside* a cue (between the
    // timing line and the text), so blank lines cannot delimit cues. Any line
    // containing "-->" must be a valid timing line; everything between one
    // timing line and the next cue's index/timing line is that cue's text.
    struct CueStart {
        first_line: usize,
        timing_line: usize,
        sequence_number: Option<u64>,
        start_ms: u64,
        end_ms: u64,
    }

    let mut cue_starts: Vec<CueStart> = Vec::new();
    for (position, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !trimmed.contains("-->") {
            continue;
        }
        let Some((start_ms, end_ms)) = parse_srt_timing_line(trimmed) else {
            return Err(format!(
                "Line {}: Expected an SRT timing line like 00:00:01,000 --> 00:00:02,000.",
                position + 1
            ));
        };
        if end_ms < start_ms {
            return Err(format!(
                "Line {}: The subtitle end time is before its start time.",
                position + 1
            ));
        }
        // An all-digits line directly above the timing line is the cue index.
        let index_line = position.checked_sub(1).filter(|&previous| {
            let candidate = lines[previous].trim();
            !candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_digit())
        });
        cue_starts.push(CueStart {
            first_line: index_line.unwrap_or(position),
            timing_line: position,
            sequence_number: index_line.and_then(|previous| lines[previous].trim().parse().ok()),
            start_ms,
            end_ms,
        });
    }

    let first_content_line = lines.iter().position(|line| !line.trim().is_empty());
    let Some(first_cue) = cue_starts.first() else {
        // No timing line anywhere: point at where one was expected — after a
        // leading numeric index if present, else at the first content line.
        let Some(content_line) = first_content_line else {
            return Err("The selected file does not contain any SRT subtitle entries.".to_string());
        };
        let content = lines[content_line].trim();
        let expected_line = if content.chars().all(|c| c.is_ascii_digit()) {
            content_line + 2
        } else {
            content_line + 1
        };
        return Err(format!(
            "Line {expected_line}: Expected an SRT timing line like 00:00:01,000 --> 00:00:02,000."
        ));
    };
    if let Some(content_line) = first_content_line.filter(|&line| line < first_cue.first_line) {
        return Err(format!(
            "Line {}: Expected an SRT timing line like 00:00:01,000 --> 00:00:02,000.",
            content_line + 1
        ));
    }

    if cue_starts.len() > MAX_SRT_IMPORTED_ROWS {
        return Err("The selected subtitle file contains too many rows to import.".to_string());
    }

    let raw_cues: Vec<RawCue> = cue_starts
        .iter()
        .enumerate()
        .map(|(cue_index, cue)| {
            let text_end = cue_starts
                .get(cue_index + 1)
                .map(|next| next.first_line)
                .unwrap_or(lines.len());
            let mut text_lines: Vec<&str> = lines[cue.timing_line + 1..text_end]
                .iter()
                .map(|line| line.trim())
                .collect();
            while text_lines.first().is_some_and(|line| line.is_empty()) {
                text_lines.remove(0);
            }
            while text_lines.last().is_some_and(|line| line.is_empty()) {
                text_lines.pop();
            }
            RawCue {
                sequence_number: cue.sequence_number,
                start_ms: cue.start_ms,
                end_ms: cue.end_ms,
                text: text_lines.join("\n"),
            }
        })
        .collect();

    let original_cue_count = raw_cues.len();
    let (cues, srt_import_summary) = if detect_rolling_captions(&raw_cues) {
        let collapsed = collapse_rolling_captions(raw_cues);
        let summary = SrtImportSummary {
            original_cue_count,
            imported_row_count: collapsed.len(),
        };
        (collapsed, Some(summary))
    } else {
        (raw_cues, None)
    };

    let rows = cues
        .into_iter()
        .enumerate()
        .map(|(row_index, cue)| {
            let mut fields = BTreeMap::new();
            fields.insert(
                code.clone(),
                ImportedField {
                    plain_text: cue.text,
                    footnote: String::new(),
                    image_caption: String::new(),
                    image: None,
                },
            );
            ImportedRow {
                external_id: None,
                description: None,
                context: None,
                comments: Vec::new(),
                source_row_number: row_index + 1,
                fields,
                text_style: None,
                docx_metadata: None,
                html_metadata: None,
                srt_metadata: Some(SrtRowMetadata {
                    sequence_number: cue.sequence_number,
                    start_ms: cue.start_ms,
                    end_ms: cue.end_ms,
                }),
            }
        })
        .collect();

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: "Subtitles".to_string(),
        source_file_name: input.file_name,
        source_format: "srt",
        header_blob: Vec::new(),
        languages: vec![ImportedLanguage {
            code,
            name,
            role: "source",
            base_code: None,
        }],
        rows,
        import_summary: None,
        srt_import_summary,
    })
}

fn parse_srt_timing_line(line: &str) -> Option<(u64, u64)> {
    let (start_part, end_part) = line.split_once("-->")?;
    let start_ms = parse_srt_timestamp(start_part.trim())?;
    // The end side may carry legacy SRT position hints ("X1:… Y1:…") — only the
    // first whitespace-separated token is the timestamp.
    let end_token = end_part.split_whitespace().next()?;
    let end_ms = parse_srt_timestamp(end_token)?;
    Some((start_ms, end_ms))
}

/// Parse `HH:MM:SS,mmm` into milliseconds. Tolerates `.` as the millisecond
/// separator, 1+ digit hours, an optional missing hours component, and 1–3
/// millisecond digits (interpreted as a fraction: `,5` is 500 ms).
pub(super) fn parse_srt_timestamp(value: &str) -> Option<u64> {
    let parts: Vec<&str> = value.split(':').collect();
    let (hours_part, minutes_part, seconds_part) = match parts.as_slice() {
        [hours, minutes, seconds] => (Some(*hours), *minutes, *seconds),
        [minutes, seconds] => (None, *minutes, *seconds),
        _ => return None,
    };

    let hours = match hours_part {
        Some(part) => parse_timestamp_component(part, 3)?,
        None => 0,
    };
    let minutes = parse_timestamp_component(minutes_part, 2)?;
    let (seconds_digits, millis) = match seconds_part.split_once([',', '.']) {
        Some((seconds, fraction)) => (seconds, parse_timestamp_fraction_ms(fraction)?),
        None => (seconds_part, 0),
    };
    let seconds = parse_timestamp_component(seconds_digits, 2)?;
    if minutes >= 60 || seconds >= 60 {
        return None;
    }

    Some(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn parse_timestamp_component(value: &str, max_digits: usize) -> Option<u64> {
    if value.is_empty() || value.len() > max_digits || !value.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

fn parse_timestamp_fraction_ms(value: &str) -> Option<u64> {
    if value.is_empty() || value.len() > 3 || !value.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let padded = format!("{value:0<3}");
    padded.parse().ok()
}

/// Format milliseconds as a canonical SRT timestamp (`HH:MM:SS,mmm`).
pub(crate) fn format_srt_timestamp(total_ms: u64) -> String {
    let millis = total_ms % 1000;
    let total_seconds = total_ms / 1000;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srt_input(bytes: Vec<u8>) -> ImportSrtInput {
        ImportSrtInput {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_name: "episode.srt".to_string(),
            bytes,
            source_language_code: "en".to_string(),
        }
    }

    #[test]
    fn parses_a_simple_srt_file() {
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line.\n".to_vec(),
        ))
        .expect("srt should parse");

        assert_eq!(parsed.source_format, "srt");
        assert_eq!(parsed.rows.len(), 2);
        let first = parsed.rows[0].srt_metadata.as_ref().expect("timing");
        assert_eq!(first.sequence_number, Some(1));
        assert_eq!(first.start_ms, 1000);
        assert_eq!(first.end_ms, 2500);
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("Hello there.")
        );
        assert_eq!(parsed.languages[0].role, "source");
    }

    #[test]
    fn parses_multi_line_cues_crlf_and_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(
            b"1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst line\r\nSecond line\r\n",
        );
        let parsed = parse_srt_file(srt_input(bytes)).expect("srt should parse");
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("First line\nSecond line")
        );
    }

    #[test]
    fn parses_cues_without_index_and_dot_millisecond_separator() {
        let parsed = parse_srt_file(srt_input(
            b"00:00:01.000 --> 00:00:02.000\nNo index here.\n".to_vec(),
        ))
        .expect("srt should parse");
        let timing = parsed.rows[0].srt_metadata.as_ref().expect("timing");
        assert_eq!(timing.sequence_number, None);
        assert_eq!(timing.start_ms, 1000);
        assert_eq!(timing.end_ms, 2000);
    }

    #[test]
    fn ignores_position_hints_after_the_end_timestamp() {
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:02,000 X1:63 X2:223 Y1:43 Y2:58\nPositioned.\n".to_vec(),
        ))
        .expect("srt should parse");
        let timing = parsed.rows[0].srt_metadata.as_ref().expect("timing");
        assert_eq!(timing.end_ms, 2000);
    }

    #[test]
    fn keeps_empty_cues_and_preserves_file_order() {
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:05,000 --> 00:00:06,000\nLater cue first.\n\n2\n00:00:01,000 --> 00:00:02,000\n\n".to_vec(),
        ))
        .expect("srt should parse");
        assert_eq!(parsed.rows.len(), 2);
        // Out-of-order timings are preserved as-is; the editor surfaces the overlap.
        assert_eq!(
            parsed.rows[0].srt_metadata.as_ref().map(|m| m.start_ms),
            Some(5000)
        );
        assert_eq!(
            parsed.rows[1]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("")
        );
    }

    #[test]
    fn parses_youtube_style_cues_with_blank_lines_inside_the_cue() {
        // YouTube's auto-generated SRT: blank line between timing and text,
        // rolling-caption cues whose text is a single space, and cues whose
        // text follows the timing line directly.
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:10,120\n\n[Music]\n\n2\n00:00:10,120 --> 00:00:10,130\n\n \n\n3\n00:00:10,130 --> 00:00:11,589\n[Music]\nhello there\n\n".to_vec(),
        ))
        .expect("youtube srt should parse");

        assert_eq!(parsed.rows.len(), 3);
        assert_eq!(
            parsed.rows[0]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("[Music]")
        );
        assert_eq!(
            parsed.rows[1]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("")
        );
        assert_eq!(
            parsed.rows[2]
                .fields
                .get("en")
                .map(|f| f.plain_text.as_str()),
            Some("[Music]\nhello there")
        );
        let second = parsed.rows[1].srt_metadata.as_ref().expect("timing");
        assert_eq!(second.start_ms, 10_120);
        assert_eq!(second.end_ms, 10_130);
    }

    #[test]
    fn rejects_unparseable_arrow_lines_with_line_number() {
        let error = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:02,000\nFine.\n\n2\n00:00:0x,000 --> 00:00:04,000\nBroken.\n".to_vec(),
        ))
        .err()
        .expect("broken timing line should fail");
        assert!(error.starts_with("Line 6:"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_content_before_the_first_cue_with_line_number() {
        let error = parse_srt_file(srt_input(
            b"WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,000\nText.\n".to_vec(),
        ))
        .err()
        .expect("leading junk should fail");
        assert!(error.starts_with("Line 1:"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_malformed_timing_with_line_number() {
        let error = parse_srt_file(srt_input(b"1\nnot a timing line\nText.\n".to_vec()))
            .err()
            .expect("malformed timing should fail");
        assert!(error.starts_with("Line 2:"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_end_before_start_with_line_number() {
        let error = parse_srt_file(srt_input(
            b"1\n00:00:05,000 --> 00:00:01,000\nBackwards.\n".to_vec(),
        ))
        .err()
        .expect("end before start should fail");
        assert!(error.starts_with("Line 2:"), "unexpected error: {error}");
        assert!(
            error.contains("end time is before"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn rejects_files_with_no_cues() {
        let error = parse_srt_file(srt_input(b"\n\n".to_vec()))
            .err()
            .expect("blank file should fail");
        assert!(error.contains("does not contain any SRT"));
    }

    #[test]
    fn timestamp_parsing_covers_edge_cases() {
        assert_eq!(parse_srt_timestamp("00:00:00,000"), Some(0));
        assert_eq!(parse_srt_timestamp("01:02:03,004"), Some(3_723_004));
        assert_eq!(parse_srt_timestamp("100:00:00,000"), Some(360_000_000));
        assert_eq!(parse_srt_timestamp("00:00:01,5"), Some(1_500));
        assert_eq!(parse_srt_timestamp("02:03,000"), Some(123_000));
        assert_eq!(parse_srt_timestamp("00:61:00,000"), None);
        assert_eq!(parse_srt_timestamp("00:00:61,000"), None);
        assert_eq!(parse_srt_timestamp("00:00:00,0000"), None);
        assert_eq!(parse_srt_timestamp("abc"), None);
        assert_eq!(parse_srt_timestamp(""), None);
    }

    #[test]
    fn formats_canonical_srt_timestamps() {
        assert_eq!(format_srt_timestamp(0), "00:00:00,000");
        assert_eq!(format_srt_timestamp(3_723_004), "01:02:03,004");
        assert_eq!(format_srt_timestamp(360_000_000), "100:00:00,000");
    }
}

#[cfg(test)]
mod rolling_caption_tests {
    use super::*;

    fn srt_input(bytes: Vec<u8>) -> ImportSrtInput {
        ImportSrtInput {
            installation_id: 1,
            repo_name: "project-repo".to_string(),
            project_id: Some("project-1".to_string()),
            file_name: "episode.srt".to_string(),
            bytes,
            source_language_code: "en".to_string(),
        }
    }

    // Mirrors the YouTube auto-caption structure: long two-line rolling cues
    // alternating with 10 ms fillers that repeat a neighbor's line (or hold a
    // lone space), including a repeated single-line cue at the top.
    fn youtube_rolling_file() -> Vec<u8> {
        b"1\n00:00:01,000 --> 00:00:10,120\n\n[Music]\n\n\
2\n00:00:10,120 --> 00:00:10,130\n\n \n\n\
3\n00:00:10,130 --> 00:00:11,589\n\n[Music]\n\n\
4\n00:00:11,589 --> 00:00:11,599\n[Music]\n \n\n\
5\n00:00:11,599 --> 00:00:13,990\n[Music]\nhello and welcome everyone\n\n\
6\n00:00:13,990 --> 00:00:14,000\nhello and welcome everyone\n \n\n\
7\n00:00:14,000 --> 00:00:16,230\nhello and welcome everyone\nwe've taken an extra minute to let more\n\n\
8\n00:00:16,230 --> 00:00:16,240\nwe've taken an extra minute to let more\n \n\n\
9\n00:00:16,240 --> 00:00:19,670\nwe've taken an extra minute to let more\nparticipants join us\n"
            .to_vec()
    }

    fn row_text(parsed: &ParsedWorkbook, index: usize) -> &str {
        parsed.rows[index]
            .fields
            .get("en")
            .map(|field| field.plain_text.as_str())
            .unwrap_or_default()
    }

    fn row_timing(parsed: &ParsedWorkbook, index: usize) -> (u64, u64) {
        let timing = parsed.rows[index].srt_metadata.as_ref().expect("timing");
        (timing.start_ms, timing.end_ms)
    }

    #[test]
    fn collapses_youtube_rolling_captions_to_one_row_per_line() {
        let parsed = parse_srt_file(srt_input(youtube_rolling_file())).expect("should parse");

        assert_eq!(parsed.rows.len(), 4);
        assert_eq!(row_text(&parsed, 0), "[Music]");
        assert_eq!(row_text(&parsed, 1), "hello and welcome everyone");
        assert_eq!(
            row_text(&parsed, 2),
            "we've taken an extra minute to let more"
        );
        assert_eq!(row_text(&parsed, 3), "participants join us");

        // Each row runs from when its line appears to when the next appears —
        // fillers absorbed, rows exactly adjacent, no overlaps, no short cues.
        assert_eq!(row_timing(&parsed, 0), (1_000, 11_599));
        assert_eq!(row_timing(&parsed, 1), (11_599, 14_000));
        assert_eq!(row_timing(&parsed, 2), (14_000, 16_240));
        assert_eq!(row_timing(&parsed, 3), (16_240, 19_670));

        let summary = parsed.srt_import_summary.expect("collapse summary");
        assert_eq!(summary.original_cue_count, 9);
        assert_eq!(summary.imported_row_count, 4);
    }

    #[test]
    fn leaves_normal_srt_files_untouched() {
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:02,500\nFirst line.\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line.\n".to_vec(),
        ))
        .expect("should parse");

        assert_eq!(parsed.rows.len(), 2);
        assert!(parsed.srt_import_summary.is_none());
        assert_eq!(row_text(&parsed, 0), "First line.");
        assert_eq!(row_timing(&parsed, 0), (1_000, 2_500));
    }

    #[test]
    fn a_few_short_cues_do_not_trigger_the_collapse() {
        // Two 10 ms cues in a five-cue file is below the one-third signature
        // threshold; nothing is merged or dropped.
        let parsed = parse_srt_file(srt_input(
            b"1\n00:00:01,000 --> 00:00:02,000\nA\n\n\
2\n00:00:02,000 --> 00:00:02,010\nA\n\n\
3\n00:00:03,000 --> 00:00:04,000\nB\n\n\
4\n00:00:05,000 --> 00:00:06,000\nC\n\n\
5\n00:00:06,000 --> 00:00:07,000\nD\n\n\
6\n00:00:07,000 --> 00:00:08,000\nE\n\n\
7\n00:00:08,000 --> 00:00:09,000\nF\n"
                .to_vec(),
        ))
        .expect("should parse");

        assert_eq!(parsed.rows.len(), 7);
        assert!(parsed.srt_import_summary.is_none());
    }

    #[test]
    fn short_unique_cues_survive_a_collapse() {
        // A sub-100 ms cue whose text is NOT repeated by a neighbor is a real
        // (if odd) cue, not a filler — it must survive even in a rolling file.
        let mut bytes = youtube_rolling_file();
        bytes.extend_from_slice(b"\n10\n00:00:19,670 --> 00:00:19,680\nunique flash frame\n");
        let parsed = parse_srt_file(srt_input(bytes)).expect("should parse");

        assert!(parsed.srt_import_summary.is_some());
        assert_eq!(
            row_text(&parsed, parsed.rows.len() - 1),
            "unique flash frame"
        );
    }
}
