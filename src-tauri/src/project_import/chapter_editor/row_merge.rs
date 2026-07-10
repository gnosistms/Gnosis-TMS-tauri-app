use super::row_fields::{
    apply_editor_footnote_updates, apply_editor_image_caption_updates,
    apply_editor_plain_text_updates, parse_labeled_footnote_text_for_merge, ParsedFootnoteEntry,
};
use super::*;

/// Content changes produced by merging `next` into `previous`, keyed by language code.
///
/// `images` only contains languages that gain `next`'s image; `moved_from_next` lists
/// the languages whose image and caption must be cleared on the soft-deleted `next`
/// row so an uploaded image file is referenced by exactly one row.
struct MergedEditorRowContent {
    fields: BTreeMap<String, String>,
    footnotes: BTreeMap<String, String>,
    image_captions: BTreeMap<String, String>,
    images: BTreeMap<String, Option<StoredFieldImage>>,
    moved_from_next: Vec<String>,
}

pub(crate) fn merge_gtms_editor_rows_sync(
    app: &AppHandle,
    input: MergeEditorRowsInput,
) -> Result<MergeEditorRowsResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let previous_index = rows
        .iter()
        .position(|row| row.row_id == input.previous_row_id)
        .ok_or_else(|| {
            format!(
                "Could not find row '{}' in this file.",
                input.previous_row_id
            )
        })?;
    let next_index = rows
        .iter()
        .position(|row| row.row_id == input.next_row_id)
        .ok_or_else(|| format!("Could not find row '{}' in this file.", input.next_row_id))?;
    if rows[previous_index].lifecycle.state != "active"
        || rows[next_index].lifecycle.state != "active"
    {
        return Err("Only active rows can be merged.".to_string());
    }
    let rows_are_adjacent = previous_index < next_index
        && rows[previous_index + 1..next_index]
            .iter()
            .all(|row| row.lifecycle.state == "deleted");
    if !rows_are_adjacent {
        return Err(
            "The rows are no longer next to each other. Refresh and try again.".to_string(),
        );
    }

    let merged = merge_editor_row_content(&rows[previous_index], &rows[next_index]);

    let previous_json_path = validated_row_json_path(&chapter_path, &input.previous_row_id)?;
    let next_json_path = validated_row_json_path(&chapter_path, &input.next_row_id)?;
    let previous_original_text = fs::read_to_string(&previous_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            previous_json_path.display()
        )
    })?;
    let next_original_text = fs::read_to_string(&next_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            next_json_path.display()
        )
    })?;

    let mut previous_value: Value =
        serde_json::from_str(&previous_original_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                previous_json_path.display()
            )
        })?;
    apply_editor_plain_text_updates(&mut previous_value, &merged.fields)?;
    apply_editor_footnote_updates(&mut previous_value, &merged.footnotes)?;
    apply_editor_image_caption_updates(&mut previous_value, &merged.image_captions)?;
    for (language_code, image) in &merged.images {
        apply_editor_field_image_update(&mut previous_value, language_code, image.clone())?;
    }

    let mut next_value: Value = serde_json::from_str(&next_original_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            next_json_path.display()
        )
    })?;
    let next_object = next_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let lifecycle_value = next_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The row lifecycle is not a JSON object.".to_string())?
        .insert("state".to_string(), Value::String("deleted".to_string()));
    let cleared_captions: BTreeMap<String, String> = merged
        .moved_from_next
        .iter()
        .map(|language_code| (language_code.clone(), String::new()))
        .collect();
    apply_editor_image_caption_updates(&mut next_value, &cleared_captions)?;
    for language_code in &merged.moved_from_next {
        apply_editor_field_image_update(&mut next_value, language_code, None)?;
    }

    let updated_previous_row: StoredRowFile = serde_json::from_value(previous_value.clone())
        .map_err(|error| {
            format!(
                "Could not decode merged row '{}': {error}",
                input.previous_row_id
            )
        })?;
    let updated_next_row: StoredRowFile =
        serde_json::from_value(next_value.clone()).map_err(|error| {
            format!(
                "Could not decode merged-away row '{}': {error}",
                input.next_row_id
            )
        })?;

    let previous_updated_json = serde_json::to_string_pretty(&previous_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            previous_json_path.display()
        )
    })?;
    let next_updated_json = serde_json::to_string_pretty(&next_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            next_json_path.display()
        )
    })?;

    write_row_files_and_commit(
        app,
        &repo_path,
        &format!(
            "Merge row {} into {}",
            input.next_row_id, input.previous_row_id
        ),
        CommitMetadata {
            operation: Some("merge"),
            migration: None,
            status_note: None,
            ai_model: None,
        },
        &[
            PreparedRowFileWrite {
                relative_path: repo_relative_path(&repo_path, &previous_json_path)?,
                path: previous_json_path,
                original_text: Some(previous_original_text),
                updated_text: format!("{previous_updated_json}\n"),
            },
            PreparedRowFileWrite {
                relative_path: repo_relative_path(&repo_path, &next_json_path)?,
                path: next_json_path,
                original_text: Some(next_original_text),
                updated_text: format!("{next_updated_json}\n"),
            },
        ],
    )?;

    let mut updated_rows = rows;
    updated_rows[previous_index] = updated_previous_row.clone();
    updated_rows[next_index] = updated_next_row.clone();

    Ok(MergeEditorRowsResponse {
        row: editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            updated_previous_row,
        )?,
        removed_row: editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            updated_next_row,
        )?,
        removed_row_id: input.next_row_id,
        removed_lifecycle_state: "deleted".to_string(),
        word_counts: build_word_counts_from_stored_rows(&updated_rows, &languages),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn merge_editor_row_content(
    previous: &StoredRowFile,
    next: &StoredRowFile,
) -> MergedEditorRowContent {
    let language_codes: BTreeSet<String> = previous
        .fields
        .keys()
        .chain(next.fields.keys())
        .cloned()
        .collect();
    let mut merged = MergedEditorRowContent {
        fields: BTreeMap::new(),
        footnotes: BTreeMap::new(),
        image_captions: BTreeMap::new(),
        images: BTreeMap::new(),
        moved_from_next: Vec::new(),
    };

    for code in language_codes {
        let empty = StoredFieldValue::default();
        let previous_field = previous.fields.get(&code).unwrap_or(&empty);
        let next_field = next.fields.get(&code).unwrap_or(&empty);

        let previous_entries = parse_footnote_entries(&previous_field.footnote);
        let next_entries = parse_footnote_entries(&next_field.footnote);
        let offset = max_footnote_marker(&previous_field.plain_text, &previous_entries);
        let shifted_next_text = shift_unescaped_footnote_markers(&next_field.plain_text, offset);
        let mut combined_entries = previous_entries;
        combined_entries.extend(next_entries.into_iter().map(|entry| ParsedFootnoteEntry {
            marker: entry.marker + offset,
            text: entry.text,
        }));

        merged.fields.insert(
            code.clone(),
            join_paragraphs(&previous_field.plain_text, &shifted_next_text),
        );
        merged
            .footnotes
            .insert(code.clone(), serialize_footnote_entries(&combined_entries));

        let previous_image = row_language_stored_image(previous, &code);
        let next_image = row_language_stored_image(next, &code);
        match (previous_image, next_image) {
            // Both rows hold an image for this language: leave images and their
            // captions in their original rows for the user to resolve.
            (Some(_), Some(_)) => {}
            (None, Some(image)) => {
                merged.images.insert(code.clone(), Some(image));
                merged
                    .image_captions
                    .insert(code.clone(), next_field.image_caption.clone());
                merged.moved_from_next.push(code.clone());
            }
            (Some(_), None) => {
                // The previous row already owns the sole image and caption.
            }
            (None, None) => {
                merged.image_captions.insert(
                    code.clone(),
                    join_paragraphs(&previous_field.image_caption, &next_field.image_caption),
                );
            }
        }
    }

    merged
}

fn join_paragraphs(previous: &str, next: &str) -> String {
    if previous.trim().is_empty() {
        return next.to_string();
    }
    if next.trim().is_empty() {
        return previous.to_string();
    }
    format!("{previous}\n{next}")
}

fn parse_footnote_entries(value: &str) -> Vec<ParsedFootnoteEntry> {
    if value.trim().is_empty() {
        return Vec::new();
    }
    let parsed = parse_labeled_footnote_text_for_merge(value);
    if parsed.is_empty() {
        return vec![ParsedFootnoteEntry {
            marker: 1,
            text: value.trim().to_string(),
        }];
    }
    parsed
}

/// Serializes footnote entries in the stored legacy format: a single marker-1 entry
/// stays bare text; anything else is labeled `[n] text` joined by blank lines.
fn serialize_footnote_entries(entries: &[ParsedFootnoteEntry]) -> String {
    match entries {
        [] => String::new(),
        [single] if single.marker == 1 => single.text.clone(),
        _ => entries
            .iter()
            .map(|entry| {
                if entry.text.is_empty() {
                    format!("[{}]", entry.marker)
                } else {
                    format!("[{}] {}", entry.marker, entry.text)
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
    }
}

fn max_footnote_marker(text: &str, entries: &[ParsedFootnoteEntry]) -> usize {
    let text_max = unescaped_marker_spans(text)
        .iter()
        .map(|span| span.marker)
        .max()
        .unwrap_or(0);
    let entry_max = entries.iter().map(|entry| entry.marker).max().unwrap_or(0);
    text_max.max(entry_max)
}

struct MarkerSpan {
    start: usize,
    end: usize,
    marker: usize,
}

/// Finds `[n]` footnote markers whose opening bracket is not escaped (an even number
/// of preceding backslashes), mirroring `parseUnescapedFootnoteMarkers` in
/// `src-ui/app/editor-footnotes.js`.
fn unescaped_marker_spans(text: &str) -> Vec<MarkerSpan> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] != b'[' {
            index += 1;
            continue;
        }
        let mut backslashes = 0usize;
        while backslashes < index && bytes[index - 1 - backslashes] == b'\\' {
            backslashes += 1;
        }
        if !backslashes.is_multiple_of(2) {
            index += 1;
            continue;
        }
        let mut cursor = index + 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor == index + 1 || cursor >= bytes.len() || bytes[cursor] != b']' {
            index += 1;
            continue;
        }
        match text[index + 1..cursor].parse::<usize>() {
            Ok(marker) => {
                spans.push(MarkerSpan {
                    start: index,
                    end: cursor + 1,
                    marker,
                });
                index = cursor + 1;
            }
            Err(_) => {
                index += 1;
            }
        }
    }

    spans
}

fn shift_unescaped_footnote_markers(text: &str, offset: usize) -> String {
    if offset == 0 {
        return text.to_string();
    }
    let spans = unescaped_marker_spans(text);
    if spans.is_empty() {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len() + spans.len() * 2);
    let mut last = 0usize;
    for span in spans {
        result.push_str(&text[last..span.start]);
        result.push_str(&format!("[{}]", span.marker + offset));
        last = span.end;
    }
    result.push_str(&text[last..]);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_row(fields: Value) -> StoredRowFile {
        serde_json::from_value(json!({
            "row_id": "row-1",
            "structure": { "order_key": "00000000000000000000000000000001" },
            "status": { "review_state": "unreviewed" },
            "origin": { "source_row_number": 1 },
            "fields": fields,
        }))
        .expect("stored row fixture")
    }

    #[test]
    fn shift_unescaped_footnote_markers_shifts_only_unescaped_markers() {
        assert_eq!(
            shift_unescaped_footnote_markers("see [1] and \\[2] and [3]", 2),
            "see [3] and \\[2] and [5]"
        );
        assert_eq!(
            shift_unescaped_footnote_markers("double escape \\\\[1]", 2),
            "double escape \\\\[3]"
        );
        assert_eq!(
            shift_unescaped_footnote_markers("no markers", 2),
            "no markers"
        );
        assert_eq!(shift_unescaped_footnote_markers("[1]", 0), "[1]");
        assert_eq!(
            shift_unescaped_footnote_markers("not [a] marker", 3),
            "not [a] marker"
        );
    }

    #[test]
    fn merge_editor_row_content_joins_text_with_a_newline() {
        let previous = stored_row(json!({ "vi": { "plain_text": "first" } }));
        let next = stored_row(json!({ "vi": { "plain_text": "second" } }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(merged.fields.get("vi"), Some(&"first\nsecond".to_string()));
    }

    #[test]
    fn merge_editor_row_content_skips_the_newline_when_one_side_is_empty() {
        let previous = stored_row(json!({ "vi": { "plain_text": "" } }));
        let next = stored_row(json!({ "vi": { "plain_text": "second" } }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(merged.fields.get("vi"), Some(&"second".to_string()));
    }

    #[test]
    fn merge_editor_row_content_renumbers_next_row_footnotes() {
        let previous = stored_row(json!({
            "vi": { "plain_text": "first[1] more[2]", "footnote": "[1] one\n\n[2] two" },
        }));
        let next = stored_row(json!({
            "vi": { "plain_text": "second[1]", "footnote": "uno" },
        }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(
            merged.fields.get("vi"),
            Some(&"first[1] more[2]\nsecond[3]".to_string())
        );
        assert_eq!(
            merged.footnotes.get("vi"),
            Some(&"[1] one\n\n[2] two\n\n[3] uno".to_string())
        );
    }

    #[test]
    fn merge_editor_row_content_keeps_a_single_plain_footnote_bare() {
        let previous = stored_row(json!({
            "vi": { "plain_text": "first[1]", "footnote": "only note" },
        }));
        let next = stored_row(json!({ "vi": { "plain_text": "second" } }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(merged.footnotes.get("vi"), Some(&"only note".to_string()));
    }

    #[test]
    fn merge_editor_row_content_moves_the_next_row_image_and_caption() {
        let previous = stored_row(json!({
            "vi": {
                "plain_text": "first",
                "image_caption": "orphan previous caption",
            },
        }));
        let next = stored_row(json!({
            "vi": {
                "plain_text": "second",
                "image": { "kind": "url", "url": "https://example.com/next.png" },
                "image_caption": "next caption",
            },
        }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(
            merged
                .images
                .get("vi")
                .and_then(|image| image.as_ref())
                .and_then(|image| image.url.clone()),
            Some("https://example.com/next.png".to_string())
        );
        assert_eq!(
            merged.image_captions.get("vi"),
            Some(&"next caption".to_string())
        );
        assert_eq!(merged.moved_from_next, vec!["vi".to_string()]);
    }

    #[test]
    fn merge_editor_row_content_leaves_images_alone_when_both_rows_have_one() {
        let previous = stored_row(json!({
            "vi": {
                "plain_text": "first",
                "image": { "kind": "url", "url": "https://example.com/previous.png" },
                "image_caption": "previous caption",
            },
        }));
        let next = stored_row(json!({
            "vi": {
                "plain_text": "second",
                "image": { "kind": "upload", "path": "chapters/c1/images/next.png" },
                "image_caption": "next caption",
            },
        }));

        let merged = merge_editor_row_content(&previous, &next);

        assert_eq!(merged.fields.get("vi"), Some(&"first\nsecond".to_string()));
        assert!(merged.images.is_empty());
        assert!(merged.image_captions.is_empty());
        assert!(merged.moved_from_next.is_empty());
    }

    #[test]
    fn merge_editor_row_content_keeps_the_previous_row_image_without_a_next_image() {
        let previous = stored_row(json!({
            "vi": {
                "plain_text": "first",
                "image": { "kind": "url", "url": "https://example.com/previous.png" },
                "image_caption": "previous caption",
            },
        }));
        let next = stored_row(json!({
            "vi": {
                "plain_text": "second",
                "image_caption": "orphan next caption",
            },
        }));

        let merged = merge_editor_row_content(&previous, &next);

        assert!(merged.images.is_empty());
        assert!(merged.image_captions.is_empty());
        assert!(merged.moved_from_next.is_empty());
    }
}
