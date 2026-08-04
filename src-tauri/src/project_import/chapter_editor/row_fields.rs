use std::collections::BTreeSet;

use super::*;

fn merge_editor_string_maps(
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    remote: &BTreeMap<String, String>,
) -> Option<BTreeMap<String, String>> {
    merge_editor_string_maps_by(base, local, remote, |value| value.to_string())
}

fn merge_editor_footnote_maps(
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    remote: &BTreeMap<String, String>,
) -> Option<BTreeMap<String, String>> {
    merge_editor_string_maps_by(base, local, remote, normalize_editor_footnote_merge_value)
}

// Subtitle timings ride the string-map merge by encoding each timing as
// "start_ms:end_ms" (absent override = absent key), so timing edits get the
// exact same 3-way semantics as field text.
fn encode_editor_timing_map(
    timings: &BTreeMap<String, EditorFieldTimingInput>,
) -> BTreeMap<String, String> {
    timings
        .iter()
        .map(|(code, timing)| {
            (
                code.clone(),
                format!("{}:{}", timing.start_ms, timing.end_ms),
            )
        })
        .collect()
}

fn decode_editor_timing_map(
    encoded: &BTreeMap<String, String>,
) -> BTreeMap<String, EditorFieldTimingInput> {
    encoded
        .iter()
        .filter_map(|(code, value)| {
            let (start, end) = value.split_once(':')?;
            Some((
                code.clone(),
                EditorFieldTimingInput {
                    start_ms: start.parse().ok()?,
                    end_ms: end.parse().ok()?,
                },
            ))
        })
        .collect()
}

fn row_timing_string_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .filter_map(|(code, value)| {
            value.timing.map(|timing| {
                (
                    code.clone(),
                    format!("{}:{}", timing.start_ms, timing.end_ms),
                )
            })
        })
        .collect()
}

fn merge_editor_string_maps_by<F>(
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    remote: &BTreeMap<String, String>,
    normalize: F,
) -> Option<BTreeMap<String, String>>
where
    F: Fn(&str) -> String,
{
    let keys: BTreeSet<String> = base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .cloned()
        .collect();
    let mut merged = BTreeMap::new();

    for key in keys {
        let remote_present = remote.contains_key(&key);
        let base_value = base.get(&key).cloned().unwrap_or_default();
        let local_value = local.get(&key).cloned().unwrap_or_default();
        let remote_value = remote.get(&key).cloned().unwrap_or_default();
        let base_merge_value = normalize(&base_value);
        let local_merge_value = normalize(&local_value);
        let remote_merge_value = normalize(&remote_value);
        let local_changed = local_merge_value != base_merge_value;
        let remote_changed = remote_merge_value != base_merge_value;

        let next_value = if !local_changed {
            remote_value
        } else if !remote_changed || local_merge_value == remote_merge_value {
            local_value
        } else {
            return None;
        };
        if next_value.is_empty() && !local_changed && !remote_changed && !remote_present {
            continue;
        }
        merged.insert(key, next_value);
    }

    Some(merged)
}

/// Three-way merge for per-language field images, restricted to URL images.
///
/// Only the languages present in `local` are considered, so unrelated images are
/// never touched. Returns `None` (conflict) when both the local resolution and the
/// current on-disk image diverge from the base, or when an uploaded image is involved
/// (uploaded-file conflicts are out of scope and must not be silently overwritten).
fn merge_editor_image_maps(
    base: &BTreeMap<String, Option<EditorFieldImageInput>>,
    local: &BTreeMap<String, Option<EditorFieldImageInput>>,
    current_row: &StoredRowFile,
) -> Option<BTreeMap<String, Option<StoredFieldImage>>> {
    let mut merged = BTreeMap::new();

    for (language_code, local_image) in local {
        let base_value = normalize_editor_field_image_input(
            base.get(language_code).and_then(|value| value.as_ref()),
        );
        let local_value = normalize_editor_field_image_input(local_image.as_ref());
        let current_value = row_language_stored_image(current_row, language_code);

        let local_changed = local_value != base_value;
        let current_changed = current_value != base_value;

        let next_value = if !local_changed {
            // The resolution matches the base it was computed against; leave the
            // current on-disk image in place.
            continue;
        } else if !current_changed || local_value == current_value {
            local_value
        } else {
            return None;
        };

        // URL-only scope: never replace or produce an uploaded image through the
        // conflict-resolution path.
        let involves_upload = [&next_value, &current_value]
            .into_iter()
            .flatten()
            .any(|image| image.kind == "upload");
        if involves_upload {
            return None;
        }

        merged.insert(language_code.clone(), next_value);
    }

    Some(merged)
}

fn normalize_editor_footnote_merge_value(value: &str) -> String {
    let normalized = normalize_editor_footnote_value(value);
    if normalized.is_empty() {
        return normalized;
    }

    let entries = parse_labeled_footnote_text_for_merge(&normalized);
    if entries.len() <= 1 {
        return normalized;
    }

    entries
        .into_iter()
        .map(|entry| {
            let label = format!("[{}]", entry.marker);
            if entry.text.is_empty() {
                label
            } else {
                format!("{label} {}", entry.text)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(super) struct ParsedFootnoteEntry {
    pub(super) marker: usize,
    pub(super) text: String,
}

struct FootnoteMarkerMatch {
    marker: usize,
    marker_start: usize,
    content_start: usize,
}

pub(super) fn parse_labeled_footnote_text_for_merge(value: &str) -> Vec<ParsedFootnoteEntry> {
    let mut markers = Vec::new();
    let mut offset = 0usize;

    while let Some(open_relative) = value[offset..].find('[') {
        let marker_start = offset + open_relative;
        let Some(close_relative) = value[marker_start + 1..].find(']') else {
            break;
        };
        let marker_end = marker_start + 1 + close_relative;
        let marker_text = &value[marker_start + 1..marker_end];
        if marker_text.is_empty() || !marker_text.chars().all(|ch| ch.is_ascii_digit()) {
            offset = marker_start + 1;
            continue;
        }

        let marker = marker_text
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .unwrap_or(markers.len() + 1);
        let mut content_start = marker_end + 1;
        while let Some(ch) = value[content_start..].chars().next() {
            if !ch.is_whitespace() {
                break;
            }
            content_start += ch.len_utf8();
        }

        let previous_marker: Option<&FootnoteMarkerMatch> = markers.last();
        let starts_at_source_start = value[..marker_start].trim().is_empty();
        let starts_line = footnote_marker_starts_line(value, marker_start);
        let follows_blank_previous_entry = previous_marker
            .map(|entry| value[entry.content_start..marker_start].trim().is_empty())
            .unwrap_or(false);

        if starts_at_source_start || starts_line || follows_blank_previous_entry {
            markers.push(FootnoteMarkerMatch {
                marker,
                marker_start,
                content_start,
            });
        }
        offset = content_start;
    }

    if markers.is_empty() || !value[..markers[0].marker_start].trim().is_empty() {
        return Vec::new();
    }

    markers
        .iter()
        .enumerate()
        .map(|(index, marker)| {
            let end = markers
                .get(index + 1)
                .map(|next_marker| next_marker.marker_start)
                .unwrap_or(value.len());
            ParsedFootnoteEntry {
                marker: marker.marker,
                text: value[marker.content_start..end].trim().to_string(),
            }
        })
        .collect()
}

pub(super) fn parse_editor_footnote_entries(value: &str) -> Vec<ParsedFootnoteEntry> {
    let normalized = normalize_editor_footnote_value(value);
    if normalized.is_empty() {
        return Vec::new();
    }
    let parsed = parse_labeled_footnote_text_for_merge(&normalized);
    if parsed.is_empty() {
        vec![ParsedFootnoteEntry {
            marker: 1,
            text: normalized,
        }]
    } else {
        parsed
    }
}

pub(super) fn serialize_editor_footnote_entries(entries: &[ParsedFootnoteEntry]) -> String {
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

fn merge_ai_review_footnote_corrections(
    current: &str,
    corrections: &[EditorAiReviewFootnoteCorrection],
) -> Result<Option<String>, String> {
    if corrections.is_empty() {
        return Ok(None);
    }
    let mut entries = parse_editor_footnote_entries(current);
    let original_markers = entries.iter().map(|entry| entry.marker).collect::<Vec<_>>();
    let mut seen = BTreeSet::new();
    for correction in corrections {
        if correction.marker == 0 || !seen.insert(correction.marker) {
            return Err("invalid footnote marker".to_string());
        }
        let Some(entry) = entries
            .iter_mut()
            .find(|entry| entry.marker == correction.marker)
        else {
            return Err("unknown footnote marker".to_string());
        };
        entry.text = correction.text.trim().to_string();
    }
    let serialized = serialize_editor_footnote_entries(&entries);
    let reparsed_markers = parse_editor_footnote_entries(&serialized)
        .iter()
        .map(|entry| entry.marker)
        .collect::<Vec<_>>();
    if original_markers != reparsed_markers {
        return Err("footnote markers changed during serialization".to_string());
    }
    Ok(Some(serialized))
}

fn sanitize_ai_review_suggestions(
    current_text: &str,
    current_footnote: &str,
    suggested_text: &mut String,
    suggested_footnotes: &mut Vec<EditorAiReviewFootnoteCorrection>,
    suggested_image_caption: &mut String,
    reviewed: &mut bool,
    please_check: &mut bool,
) -> (Option<String>, bool) {
    let main_markers_changed = !suggested_text.trim().is_empty()
        && super::row_merge::unescaped_footnote_marker_sequence(current_text)
            != super::row_merge::unescaped_footnote_marker_sequence(suggested_text);
    let merged_footnote =
        merge_ai_review_footnote_corrections(current_footnote, suggested_footnotes);
    if main_markers_changed || merged_footnote.is_err() {
        suggested_text.clear();
        suggested_footnotes.clear();
        suggested_image_caption.clear();
        *reviewed = false;
        *please_check = true;
        (None, true)
    } else {
        (merged_footnote.ok().flatten(), false)
    }
}

fn footnote_marker_starts_line(value: &str, marker_start: usize) -> bool {
    let line_start = value[..marker_start]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    value[line_start..marker_start].trim().is_empty()
}

fn log_row_save_merge_conflict(
    row_id: &str,
    label: &str,
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    current: &BTreeMap<String, String>,
) {
    if !cfg!(debug_assertions) {
        return;
    }

    eprintln!(
        "[gtms row-save] conflict-detail row='{}' field='{}' base={:?} local={:?} current={:?}",
        row_id, label, base, local, current
    );
}

pub(crate) fn update_gtms_editor_row_fields_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldsInput,
) -> Result<SaveEditorRowWithConcurrencyResponse, String> {
    if cfg!(debug_assertions) {
        eprintln!(
            "[gtms row-save] start installation={} project={:?} repo='{}' chapter='{}' row='{}'",
            input.installation_id,
            input.project_id,
            input.repo_name,
            input.chapter_id,
            input.row_id
        );
    }
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    if cfg!(debug_assertions) {
        eprintln!(
            "[gtms row-save] repo-resolved path='{}'",
            repo_path.display()
        );
    }
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    if cfg!(debug_assertions) {
        eprintln!(
            "[gtms row-save] chapter-resolved path='{}'",
            chapter_path.display()
        );
    }
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let word_counts = load_word_counts(&chapter_path.join("rows"), &languages)?;
    if !row_json_path.exists() {
        if cfg!(debug_assertions) {
            eprintln!(
                "[gtms row-save] row-missing path='{}'",
                row_json_path.display()
            );
        }
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "deleted".to_string(),
            row: None,
            word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            base_image_captions: input.base_image_captions,
            conflict_remote_version: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        if cfg!(debug_assertions) {
            eprintln!("[gtms row-save] row-deleted row='{}'", input.row_id);
        }
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            base_image_captions: input.base_image_captions,
            conflict_remote_version: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_fields = row_plain_text_map(&original_row_file);
    let current_footnotes = row_footnote_map(&original_row_file);
    let current_image_captions = row_image_caption_map(&original_row_file);
    let current_timings = row_timing_string_map(&original_row_file);
    let merged_fields =
        merge_editor_string_maps(&input.base_fields, &input.fields, &current_fields);
    let merged_footnotes =
        merge_editor_footnote_maps(&input.base_footnotes, &input.footnotes, &current_footnotes);
    let merged_image_captions = merge_editor_string_maps(
        &input.base_image_captions,
        &input.image_captions,
        &current_image_captions,
    );
    let merged_images =
        merge_editor_image_maps(&input.base_images, &input.images, &original_row_file);
    let merged_timings = merge_editor_string_maps(
        &encode_editor_timing_map(&input.base_timings),
        &encode_editor_timing_map(&input.timings),
        &current_timings,
    );
    if merged_fields.is_none()
        || merged_footnotes.is_none()
        || merged_image_captions.is_none()
        || merged_images.is_none()
        || merged_timings.is_none()
    {
        if cfg!(debug_assertions) {
            eprintln!("[gtms row-save] conflict row='{}'", input.row_id);
        }
        if merged_fields.is_none() {
            log_row_save_merge_conflict(
                &input.row_id,
                "fields",
                &input.base_fields,
                &input.fields,
                &current_fields,
            );
        }
        if merged_footnotes.is_none() {
            log_row_save_merge_conflict(
                &input.row_id,
                "footnotes",
                &input.base_footnotes,
                &input.footnotes,
                &current_footnotes,
            );
        }
        if merged_image_captions.is_none() {
            log_row_save_merge_conflict(
                &input.row_id,
                "image_captions",
                &input.base_image_captions,
                &input.image_captions,
                &current_image_captions,
            );
        }
        if merged_images.is_none() && cfg!(debug_assertions) {
            eprintln!("[gtms row-save] image conflict row='{}'", input.row_id);
        }
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            base_image_captions: input.base_image_captions,
            conflict_remote_version: load_latest_row_version_metadata(
                &repo_path,
                &relative_row_json,
            )?,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }
    let merged_fields = merged_fields.unwrap_or_default();
    let merged_footnotes = merged_footnotes.unwrap_or_default();
    let merged_image_captions = merged_image_captions.unwrap_or_default();
    let merged_images = merged_images.unwrap_or_default();
    let merged_timings = decode_editor_timing_map(&merged_timings.unwrap_or_default());

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_plain_text_updates(&mut row_value, &merged_fields)?;
    apply_editor_footnote_updates(&mut row_value, &merged_footnotes)?;
    apply_editor_image_caption_updates(&mut row_value, &merged_image_captions)?;
    apply_editor_timing_updates(&mut row_value, &merged_timings)?;
    for (language_code, image) in merged_images {
        apply_editor_field_image_update(&mut row_value, &language_code, image)?;
    }

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut next_word_counts = word_counts.clone();
    let mut next_row = original_row_file.clone();
    if updated_row_text != original_row_text {
        if cfg!(debug_assertions) {
            eprintln!(
                "[gtms row-save] write-file:start row='{}' path='{}'",
                input.row_id,
                row_json_path.display()
            );
        }
        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        next_word_counts = apply_word_count_delta(
            &word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        write_row_files_and_commit(
            app,
            &repo_path,
            &format!("Update row {}", input.row_id),
            CommitMetadata {
                operation: Some(if input.operation.trim().is_empty() {
                    "editor-update"
                } else {
                    input.operation.trim()
                }),
                migration: None,
                status_note: None,
                ai_model: Some(input.ai_model.trim()).filter(|value| !value.is_empty()),
            },
            &[PreparedRowFileWrite {
                path: row_json_path.clone(),
                relative_path: relative_row_json.clone(),
                original_text: Some(original_row_text.clone()),
                updated_text: updated_row_text,
            }],
        )?;
        if cfg!(debug_assertions) {
            eprintln!("[gtms row-save] git-commit:done row='{}'", input.row_id);
        }
        next_row = updated_row_file;
    } else if cfg!(debug_assertions) {
        eprintln!("[gtms row-save] unchanged row='{}'", input.row_id);
    }

    if cfg!(debug_assertions) {
        eprintln!(
            "[gtms row-save] clear-imported-conflict:start row='{}'",
            input.row_id
        );
    }
    let _ = clear_imported_editor_conflict_entry(&repo_path, &input.chapter_id, &input.row_id);
    if cfg!(debug_assertions) {
        eprintln!("[gtms row-save] done row='{}'", input.row_id);
    }

    Ok(SaveEditorRowWithConcurrencyResponse {
        row_id: input.row_id,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            next_row,
        )?),
        word_counts: next_word_counts,
        base_fields: input.base_fields,
        base_footnotes: input.base_footnotes,
        base_image_captions: input.base_image_captions,
        conflict_remote_version: None,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::*;

    fn map(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    #[test]
    fn ai_review_footnote_corrections_preserve_marker_identity() {
        let merged = merge_ai_review_footnote_corrections(
            "[1] One\n\n[2] Two\n\n[3] Three",
            &[
                EditorAiReviewFootnoteCorrection {
                    marker: 3,
                    text: "Three corrected".to_string(),
                },
                EditorAiReviewFootnoteCorrection {
                    marker: 1,
                    text: "One corrected".to_string(),
                },
            ],
        )
        .expect("known marker corrections should merge");

        assert_eq!(
            merged.as_deref(),
            Some("[1] One corrected\n\n[2] Two\n\n[3] Three corrected")
        );
        assert_eq!(
            merge_ai_review_footnote_corrections(
                "[9] Nine",
                &[EditorAiReviewFootnoteCorrection {
                    marker: 9,
                    text: "Nine corrected".to_string(),
                }],
            )
            .expect("non-default marker should merge")
            .as_deref(),
            Some("[9] Nine corrected")
        );
    }

    #[test]
    fn ai_review_footnote_corrections_reject_unknown_and_duplicate_markers() {
        assert!(merge_ai_review_footnote_corrections(
            "[9] Nine",
            &[EditorAiReviewFootnoteCorrection {
                marker: 1,
                text: "Unknown".to_string(),
            }],
        )
        .is_err());
        assert!(merge_ai_review_footnote_corrections(
            "[9] Nine",
            &[
                EditorAiReviewFootnoteCorrection {
                    marker: 9,
                    text: "First".to_string(),
                },
                EditorAiReviewFootnoteCorrection {
                    marker: 9,
                    text: "Second".to_string(),
                },
            ],
        )
        .is_err());
    }

    #[test]
    fn ai_review_footnote_corrections_reject_serialized_marker_changes() {
        for text in ["", "[9] Invented"] {
            assert!(merge_ai_review_footnote_corrections(
                "One",
                &[EditorAiReviewFootnoteCorrection {
                    marker: 1,
                    text: text.to_string(),
                }],
            )
            .is_err());
        }
        assert!(merge_ai_review_footnote_corrections(
            "[1] One\n\n[2] Two",
            &[EditorAiReviewFootnoteCorrection {
                marker: 1,
                text: "Corrected\n\n[9] Invented".to_string(),
            }],
        )
        .is_err());
    }

    #[test]
    fn ai_review_sanitizer_fails_closed_when_main_or_note_markers_change() {
        let mut suggested_text = "One without marker Two[2]".to_string();
        let mut suggested_footnotes = vec![EditorAiReviewFootnoteCorrection {
            marker: 1,
            text: "One corrected".to_string(),
        }];
        let mut suggested_image_caption = "Caption corrected".to_string();
        let mut reviewed = true;
        let mut please_check = false;

        let merged = sanitize_ai_review_suggestions(
            "One[1] Two[2]",
            "[1] One\n\n[2] Two",
            &mut suggested_text,
            &mut suggested_footnotes,
            &mut suggested_image_caption,
            &mut reviewed,
            &mut please_check,
        );

        assert_eq!(merged, (None, true));
        assert_eq!(suggested_text, "");
        assert!(suggested_footnotes.is_empty());
        assert_eq!(suggested_image_caption, "");
        assert!(!reviewed);
        assert!(please_check);

        suggested_text.clear();
        suggested_footnotes = vec![EditorAiReviewFootnoteCorrection {
            marker: 9,
            text: "Unknown".to_string(),
        }];
        reviewed = true;
        please_check = false;
        assert_eq!(
            sanitize_ai_review_suggestions(
                "One[1] Two[2]",
                "[1] One\n\n[2] Two",
                &mut suggested_text,
                &mut suggested_footnotes,
                &mut suggested_image_caption,
                &mut reviewed,
                &mut please_check,
            ),
            (None, true)
        );
        assert!(!reviewed);
        assert!(please_check);
    }

    #[test]
    fn merge_editor_string_maps_merges_disjoint_language_changes() {
        let merged = merge_editor_string_maps(
            &map(&[("es", "hola"), ("en", "hello")]),
            &map(&[("es", "hola"), ("en", "hello local")]),
            &map(&[("es", "hola remoto"), ("en", "hello")]),
        );

        assert_eq!(
            merged,
            Some(map(&[("es", "hola remoto"), ("en", "hello local")])),
        );
    }

    #[test]
    fn merge_editor_string_maps_rejects_same_slice_text_conflicts() {
        let merged = merge_editor_string_maps(
            &map(&[("es", "hola"), ("en", "hello")]),
            &map(&[("es", "hola local"), ("en", "hello")]),
            &map(&[("es", "hola remoto"), ("en", "hello")]),
        );

        assert_eq!(merged, None);
    }

    #[test]
    fn merge_editor_string_maps_accepts_matching_remote_and_local_updates() {
        let merged = merge_editor_string_maps(
            &map(&[("es", "hola"), ("en", "hello")]),
            &map(&[("es", "hola"), ("en", "hello updated")]),
            &map(&[("es", "hola"), ("en", "hello updated")]),
        );

        assert_eq!(
            merged,
            Some(map(&[("es", "hola"), ("en", "hello updated")])),
        );
    }

    #[test]
    fn merge_editor_string_maps_does_not_materialize_unchanged_absent_blank_fields() {
        let merged = merge_editor_string_maps(
            &map(&[("es", "hola")]),
            &map(&[("es", "hola"), ("en", "hello"), ("vi", "")]),
            &map(&[("es", "hola")]),
        );

        assert_eq!(merged, Some(map(&[("es", "hola"), ("en", "hello")])));
    }

    #[test]
    fn merge_editor_string_maps_keeps_intentional_clears() {
        let merged = merge_editor_string_maps(
            &map(&[("es", "hola"), ("vi", "xin chao")]),
            &map(&[("es", "hola"), ("vi", "")]),
            &map(&[("es", "hola"), ("vi", "xin chao")]),
        );

        assert_eq!(merged, Some(map(&[("es", "hola"), ("vi", "")])));
    }

    fn url_input(url: &str) -> Option<EditorFieldImageInput> {
        Some(EditorFieldImageInput {
            kind: "url".to_string(),
            url: url.to_string(),
            path: String::new(),
        })
    }

    fn upload_input(path: &str) -> Option<EditorFieldImageInput> {
        Some(EditorFieldImageInput {
            kind: "upload".to_string(),
            url: String::new(),
            path: path.to_string(),
        })
    }

    fn image_input_map(
        entries: &[(&str, Option<EditorFieldImageInput>)],
    ) -> BTreeMap<String, Option<EditorFieldImageInput>> {
        entries
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone()))
            .collect()
    }

    fn stored_row_with_image(language_code: &str, image_url: Option<&str>) -> StoredRowFile {
        let image_json = match image_url {
            Some(url) => serde_json::json!({ "kind": "url", "url": url }),
            None => serde_json::Value::Null,
        };
        serde_json::from_value(serde_json::json!({
            "row_id": "row-1",
            "structure": { "order_key": "00001" },
            "status": { "review_state": "pending" },
            "origin": { "source_row_number": 1 },
            "fields": {
                language_code: { "plain_text": "hola", "image": image_json },
            },
        }))
        .expect("stored row fixture")
    }

    #[test]
    fn merge_editor_image_maps_applies_resolved_url_when_disk_matches_base() {
        let merged = merge_editor_image_maps(
            &image_input_map(&[("es", url_input("https://example.com/remote.png"))]),
            &image_input_map(&[("es", url_input("https://example.com/local.png"))]),
            &stored_row_with_image("es", Some("https://example.com/remote.png")),
        )
        .expect("resolvable image merge");

        assert_eq!(
            merged
                .get("es")
                .and_then(|image| image.as_ref())
                .map(|image| image.url.clone()),
            Some(Some("https://example.com/local.png".to_string())),
        );
    }

    #[test]
    fn merge_editor_image_maps_conflicts_when_disk_changed_again() {
        let merged = merge_editor_image_maps(
            &image_input_map(&[("es", url_input("https://example.com/remote.png"))]),
            &image_input_map(&[("es", url_input("https://example.com/local.png"))]),
            &stored_row_with_image("es", Some("https://example.com/changed.png")),
        );

        assert_eq!(merged, None);
    }

    #[test]
    fn merge_editor_image_maps_rejects_uploaded_resolutions() {
        let merged = merge_editor_image_maps(
            &image_input_map(&[("es", url_input("https://example.com/remote.png"))]),
            &image_input_map(&[("es", upload_input("images/local.png"))]),
            &stored_row_with_image("es", Some("https://example.com/remote.png")),
        );

        assert_eq!(merged, None);
    }

    #[test]
    fn merge_editor_image_maps_clears_image_when_resolved_to_none() {
        let merged = merge_editor_image_maps(
            &image_input_map(&[("es", url_input("https://example.com/remote.png"))]),
            &image_input_map(&[("es", None)]),
            &stored_row_with_image("es", Some("https://example.com/remote.png")),
        )
        .expect("resolvable image clear");

        assert_eq!(merged.get("es"), Some(&None));
    }

    #[test]
    fn merge_editor_footnote_maps_accepts_canonical_legacy_marker_spacing() {
        let merged = merge_editor_footnote_maps(
            &map(&[("vi", "[1] fdsfd\n\n[2] [3]")]),
            &map(&[("vi", "")]),
            &map(&[("vi", "[1] fdsfd\n\n[2] \n\n[3] ")]),
        );

        assert_eq!(merged, Some(map(&[("vi", "")])));
    }

    #[test]
    fn merge_editor_footnote_maps_preserves_inline_marker_reference_conflicts() {
        let merged = merge_editor_footnote_maps(
            &map(&[("vi", "[1] see [3]")]),
            &map(&[("vi", "")]),
            &map(&[("vi", "[1] see [4]")]),
        );

        assert_eq!(merged, None);
    }
}

/// Repo and chapter resolution shared by the batched row-write commands:
/// validate the repo, locate the chapter, and load its languages and current
/// word counts.
struct BatchChapterContext {
    repo_path: PathBuf,
    chapter_path: PathBuf,
    languages: Vec<ChapterLanguage>,
    word_counts: BTreeMap<String, usize>,
}

fn load_batch_chapter_context(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
    chapter_id: &str,
) -> Result<BatchChapterContext, String> {
    let repo_path =
        resolve_project_git_repo_path(app, installation_id, project_id, Some(repo_name))?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    load_batch_chapter_context_from_repo(app, repo_path, chapter_id)
}

fn load_batch_chapter_context_from_repo(
    app: &AppHandle,
    repo_path: PathBuf,
    chapter_id: &str,
) -> Result<BatchChapterContext, String> {
    let chapter_path = find_chapter_path_by_id(app, &repo_path.join("chapters"), chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let word_counts = load_word_counts(&chapter_path.join("rows"), &languages)?;
    Ok(BatchChapterContext {
        repo_path,
        chapter_path,
        languages,
        word_counts,
    })
}

/// One row file loaded for editing: the original text plus both parsed forms,
/// so callers mutate `value` while validating against `original_file`.
struct EditableRowFile {
    row_id: String,
    path: PathBuf,
    relative_path: String,
    original_text: String,
    original_file: StoredRowFile,
    value: Value,
}

fn load_editable_row_file(
    repo_path: &Path,
    chapter_path: &Path,
    row_id: &str,
) -> Result<EditableRowFile, String> {
    let path = validated_row_json_path(chapter_path, row_id)?;
    let relative_path = repo_relative_path(repo_path, &path)?;
    let original_text = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read row file '{}': {error}", path.display()))?;
    let original_file: StoredRowFile = serde_json::from_str(&original_text)
        .map_err(|error| format!("Could not parse row file '{}': {error}", path.display()))?;
    let value: Value = serde_json::from_str(&original_text)
        .map_err(|error| format!("Could not parse row file '{}': {error}", path.display()))?;
    Ok(EditableRowFile {
        row_id: row_id.to_string(),
        path,
        relative_path,
        original_text,
        original_file,
        value,
    })
}

/// Serialize the edited value; when the text changed (or `force_changed`),
/// fold the word-count delta, queue the write, and record the row id.
/// Returns whether the row changed plus its final parsed form (the updated
/// parse when changed, the original otherwise).
fn finish_editable_row_file(
    edit: EditableRowFile,
    force_changed: bool,
    languages: &[ChapterLanguage],
    word_counts: &mut BTreeMap<String, usize>,
    prepared_writes: &mut Vec<PreparedRowFileWrite>,
    changed_row_ids: &mut Vec<String>,
) -> Result<(bool, StoredRowFile), String> {
    let updated_row_json = serde_json::to_string_pretty(&edit.value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            edit.path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    if updated_row_text == edit.original_text && !force_changed {
        return Ok((false, edit.original_file));
    }

    let updated_row_file: StoredRowFile =
        serde_json::from_str(&updated_row_text).map_err(|error| {
            format!(
                "Could not parse updated row file '{}': {error}",
                edit.path.display()
            )
        })?;
    let next_word_counts = apply_word_count_delta(
        word_counts,
        &edit.original_file,
        &updated_row_file,
        languages,
    );
    *word_counts = next_word_counts;
    prepared_writes.push(PreparedRowFileWrite {
        relative_path: edit.relative_path,
        path: edit.path,
        original_text: Some(edit.original_text),
        updated_text: updated_row_text,
    });
    changed_row_ids.push(edit.row_id);
    Ok((true, updated_row_file))
}

/// The per-row accumulators a batch loop fills via `finish_editable_row_file`
/// (plus any uploaded-image removals), handed to the commit epilogue as one
/// unit.
struct BatchRowWrites<'a> {
    prepared_writes: &'a [PreparedRowFileWrite],
    removed_uploaded_paths: &'a [String],
    changed_row_ids: &'a [String],
}

/// Commit queued batch writes as one commit and clear the imported-conflict
/// entries for every written row. No-op when no row changed. Returns the
/// short commit sha when a commit was created.
fn commit_batch_row_writes(
    app: &AppHandle,
    repo_path: &Path,
    chapter_id: &str,
    commit_message: &str,
    metadata: CommitMetadata<'_>,
    writes: BatchRowWrites<'_>,
) -> Result<Option<String>, String> {
    if writes.changed_row_ids.is_empty() {
        return Ok(None);
    }
    let commit_output = write_row_files_and_commit_with_removals(
        app,
        repo_path,
        commit_message,
        metadata,
        writes.prepared_writes,
        writes.removed_uploaded_paths,
    )?;
    let commit_sha = if commit_output.is_empty() {
        None
    } else {
        Some(git_output(repo_path, &["rev-parse", "--short", "HEAD"])?)
    };
    for row_id in writes.changed_row_ids {
        let _ = clear_imported_editor_conflict_entry(repo_path, chapter_id, row_id);
    }
    Ok(commit_sha)
}

pub(crate) fn update_gtms_editor_row_fields_batch_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldsBatchInput,
) -> Result<UpdateEditorRowFieldsBatchResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);
    let BatchChapterContext {
        repo_path,
        chapter_path,
        languages,
        mut word_counts,
    } = load_batch_chapter_context_from_repo(app, repo_path, &input.chapter_id)?;

    let mut rows_by_id = BTreeMap::new();
    for row in input.rows {
        let row_id = row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }
        rows_by_id.insert(row_id, row);
    }

    let mut changed_row_ids = Vec::new();
    let mut prepared_writes = Vec::new();
    let mut removed_uploaded_paths = Vec::new();

    for (row_id, batch_row) in rows_by_id {
        let mut edit = load_editable_row_file(&repo_path, &chapter_path, &row_id)?;
        apply_editor_plain_text_updates(&mut edit.value, &batch_row.fields)?;
        apply_editor_footnote_updates(&mut edit.value, &batch_row.footnotes)?;
        apply_editor_image_caption_updates(&mut edit.value, &batch_row.image_captions)?;
        apply_editor_timing_updates(&mut edit.value, &batch_row.timings)?;
        for language_code in &batch_row.remove_images {
            let language_code = language_code.trim();
            if language_code.is_empty() {
                continue;
            }
            // Only touch fields that actually hold an image so image-free rows do not
            // churn (apply_editor_field_image_update inserts field defaults).
            let Some(current_image) = row_language_stored_image(&edit.original_file, language_code)
            else {
                continue;
            };
            if current_image.kind == "upload" {
                if let Some(path) = current_image.path.clone() {
                    if !removed_uploaded_paths.contains(&path) {
                        removed_uploaded_paths.push(path);
                    }
                }
            }
            apply_editor_field_image_update(&mut edit.value, language_code, None)?;
        }
        finish_editable_row_file(
            edit,
            false,
            &languages,
            &mut word_counts,
            &mut prepared_writes,
            &mut changed_row_ids,
        )?;
    }

    let commit_message = input.commit_message.trim();
    let operation = input.operation.trim();
    let row_overlays = prepared_writes
        .iter()
        .map(|write| {
            serde_json::from_str::<StoredRowFile>(&write.updated_text)
                .map(|row| (write.relative_path.clone(), Some(row)))
                .map_err(|error| {
                    format!(
                        "Could not decode updated row '{}' while checking image references: {error}",
                        write.relative_path
                    )
                })
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let removable_uploaded_paths = unreferenced_uploaded_paths_after_row_updates(
        &repo_path,
        &removed_uploaded_paths,
        &row_overlays,
    )?;
    let commit_output = write_row_files_and_commit_with_removals_locked(
        app,
        &repo_path,
        if commit_message.is_empty() {
            "Update editor rows"
        } else {
            commit_message
        },
        CommitMetadata {
            operation: if operation.is_empty() {
                None
            } else {
                Some(operation)
            },
            migration: None,
            status_note: None,
            ai_model: Some(input.ai_model.trim()).filter(|value| !value.is_empty()),
        },
        &prepared_writes,
        &removable_uploaded_paths,
    )?;
    let commit_sha = if commit_output.is_empty() {
        None
    } else {
        Some(git_output(&repo_path, &["rev-parse", "--short", "HEAD"])?)
    };
    for row_id in &changed_row_ids {
        let _ = clear_imported_editor_conflict_entry(&repo_path, &input.chapter_id, row_id);
    }

    Ok(UpdateEditorRowFieldsBatchResponse {
        row_ids: changed_row_ids,
        word_counts,
        commit_sha,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn update_gtms_editor_row_field_flag_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldFlagInput,
) -> Result<UpdateEditorRowFieldFlagResponse, String> {
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
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let (reviewed, please_check, changed) = apply_editor_field_flag_update(
        &mut row_value,
        &input.language_code,
        &input.flag,
        input.enabled,
    )?;

    if changed {
        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        let status_note = status_note_for_field_flag(
            normalize_editor_field_flag_key(&input.flag)?,
            input.enabled,
        );
        write_row_files_and_commit(
            app,
            &repo_path,
            &format!(
                "Update row {} {} markers",
                input.row_id, input.language_code
            ),
            CommitMetadata {
                operation: Some("field-status"),
                migration: None,
                status_note: Some(status_note),
                ai_model: None,
            },
            &[PreparedRowFileWrite {
                path: row_json_path.clone(),
                relative_path: relative_row_json.clone(),
                original_text: Some(original_row_text),
                updated_text: updated_row_text,
            }],
        )?;
    }

    Ok(UpdateEditorRowFieldFlagResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        reviewed,
        please_check,
        last_update: load_latest_row_version_metadata(&repo_path, &relative_row_json)?,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn apply_gtms_editor_ai_review_result_sync(
    app: &AppHandle,
    mut input: ApplyEditorAiReviewResultInput,
) -> Result<ApplyEditorAiReviewResultResponse, String> {
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
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;

    let current_text = row_plain_text_map(&original_row_file)
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();
    let current_footnote = row_footnote_map(&original_row_file)
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();
    let (merged_footnote, marker_integrity_rejected) = sanitize_ai_review_suggestions(
        &current_text,
        &current_footnote,
        &mut input.suggested_text,
        &mut input.suggested_footnotes,
        &mut input.suggested_image_caption,
        &mut input.reviewed,
        &mut input.please_check,
    );

    if !input.suggested_text.trim().is_empty() {
        let mut fields = BTreeMap::new();
        fields.insert(input.language_code.clone(), input.suggested_text.clone());
        apply_editor_plain_text_updates(&mut row_value, &fields)?;
    }
    if let Some(suggested_footnote) = merged_footnote {
        let mut footnotes = BTreeMap::new();
        footnotes.insert(input.language_code.clone(), suggested_footnote);
        apply_editor_footnote_updates(&mut row_value, &footnotes)?;
    }
    if !input.suggested_image_caption.trim().is_empty() {
        let mut image_captions = BTreeMap::new();
        image_captions.insert(
            input.language_code.clone(),
            input.suggested_image_caption.clone(),
        );
        apply_editor_image_caption_updates(&mut row_value, &image_captions)?;
    }
    let (_, _, reviewed_changed) = apply_editor_field_flag_update(
        &mut row_value,
        &input.language_code,
        "reviewed",
        input.reviewed,
    )?;
    let (reviewed, please_check, please_check_changed) = apply_editor_field_flag_update(
        &mut row_value,
        &input.language_code,
        "please-check",
        input.please_check,
    )?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let changed = updated_row_text != original_row_text || reviewed_changed || please_check_changed;

    if changed {
        let ai_model = input.ai_model.trim();
        write_row_files_and_commit(
            app,
            &repo_path,
            &format!("AI review row {} {}", input.row_id, input.language_code),
            CommitMetadata {
                operation: Some("ai-review"),
                migration: None,
                status_note: None,
                ai_model: if ai_model.is_empty() {
                    None
                } else {
                    Some(ai_model)
                },
            },
            &[PreparedRowFileWrite {
                path: row_json_path.clone(),
                relative_path: relative_row_json.clone(),
                original_text: Some(original_row_text.clone()),
                updated_text: updated_row_text.clone(),
            }],
        )?;
    }

    let updated_row_file: StoredRowFile = if changed {
        serde_json::from_str(&updated_row_text).map_err(|error| {
            format!(
                "Could not parse updated row file '{}': {error}",
                row_json_path.display()
            )
        })?
    } else {
        original_row_file
    };
    let text = row_plain_text_map(&updated_row_file)
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();
    let footnote = row_footnote_map(&updated_row_file)
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();
    let image_caption = row_image_caption_map(&updated_row_file)
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();

    Ok(ApplyEditorAiReviewResultResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        text,
        footnote,
        image_caption,
        reviewed,
        please_check,
        marker_integrity_rejected,
        last_update: load_latest_row_version_metadata(&repo_path, &relative_row_json)?,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

// Applies every review result from one AI batch response in a single git
// commit. Per-row semantics match apply_gtms_editor_ai_review_result_sync;
// committing per batch instead of per row keeps long AI Review All runs from
// starving interactive saves behind hundreds of sequential commits.
pub(crate) fn apply_gtms_editor_ai_review_results_batch_sync(
    app: &AppHandle,
    input: ApplyEditorAiReviewResultsBatchInput,
) -> Result<ApplyEditorAiReviewResultsBatchResponse, String> {
    let BatchChapterContext {
        repo_path,
        chapter_path,
        languages,
        mut word_counts,
    } = load_batch_chapter_context(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        &input.repo_name,
        &input.chapter_id,
    )?;

    let mut rows_by_id = BTreeMap::new();
    for row in input.rows {
        let row_id = row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }
        rows_by_id.insert(row_id, row);
    }

    struct PendingRowResult {
        row_id: String,
        relative_path: String,
        row_file: StoredRowFile,
        reviewed: bool,
        please_check: bool,
        marker_integrity_rejected: bool,
    }

    let mut changed_row_ids = Vec::new();
    let mut prepared_writes = Vec::new();
    let mut pending_results = Vec::new();

    for (row_id, mut review_row) in rows_by_id {
        let mut edit = load_editable_row_file(&repo_path, &chapter_path, &row_id)?;

        let current_text = row_plain_text_map(&edit.original_file)
            .get(&input.language_code)
            .cloned()
            .unwrap_or_default();
        let current_footnote = row_footnote_map(&edit.original_file)
            .get(&input.language_code)
            .cloned()
            .unwrap_or_default();
        let (merged_footnote, marker_integrity_rejected) = sanitize_ai_review_suggestions(
            &current_text,
            &current_footnote,
            &mut review_row.suggested_text,
            &mut review_row.suggested_footnotes,
            &mut review_row.suggested_image_caption,
            &mut review_row.reviewed,
            &mut review_row.please_check,
        );

        if !review_row.suggested_text.trim().is_empty() {
            let mut fields = BTreeMap::new();
            fields.insert(
                input.language_code.clone(),
                review_row.suggested_text.clone(),
            );
            apply_editor_plain_text_updates(&mut edit.value, &fields)?;
        }
        if let Some(suggested_footnote) = merged_footnote {
            let mut footnotes = BTreeMap::new();
            footnotes.insert(input.language_code.clone(), suggested_footnote);
            apply_editor_footnote_updates(&mut edit.value, &footnotes)?;
        }
        if !review_row.suggested_image_caption.trim().is_empty() {
            let mut image_captions = BTreeMap::new();
            image_captions.insert(
                input.language_code.clone(),
                review_row.suggested_image_caption.clone(),
            );
            apply_editor_image_caption_updates(&mut edit.value, &image_captions)?;
        }
        let (_, _, reviewed_changed) = apply_editor_field_flag_update(
            &mut edit.value,
            &input.language_code,
            "reviewed",
            review_row.reviewed,
        )?;
        let (reviewed, please_check, please_check_changed) = apply_editor_field_flag_update(
            &mut edit.value,
            &input.language_code,
            "please-check",
            review_row.please_check,
        )?;

        let relative_path = edit.relative_path.clone();
        let (_, row_file) = finish_editable_row_file(
            edit,
            reviewed_changed || please_check_changed,
            &languages,
            &mut word_counts,
            &mut prepared_writes,
            &mut changed_row_ids,
        )?;
        pending_results.push(PendingRowResult {
            row_id,
            relative_path,
            row_file,
            reviewed,
            please_check,
            marker_integrity_rejected,
        });
    }

    let ai_model = input.ai_model.trim();
    commit_batch_row_writes(
        app,
        &repo_path,
        &input.chapter_id,
        &format!(
            "AI review {} row{} {}",
            changed_row_ids.len(),
            if changed_row_ids.len() == 1 { "" } else { "s" },
            input.language_code
        ),
        CommitMetadata {
            operation: Some("ai-review"),
            migration: None,
            status_note: None,
            ai_model: if ai_model.is_empty() {
                None
            } else {
                Some(ai_model)
            },
        },
        BatchRowWrites {
            prepared_writes: &prepared_writes,
            removed_uploaded_paths: &[],
            changed_row_ids: &changed_row_ids,
        },
    )?;

    let mut rows = Vec::new();
    for pending in pending_results {
        let text = row_plain_text_map(&pending.row_file)
            .get(&input.language_code)
            .cloned()
            .unwrap_or_default();
        let footnote = row_footnote_map(&pending.row_file)
            .get(&input.language_code)
            .cloned()
            .unwrap_or_default();
        let image_caption = row_image_caption_map(&pending.row_file)
            .get(&input.language_code)
            .cloned()
            .unwrap_or_default();
        rows.push(ApplyEditorAiReviewResultsBatchRowResult {
            row_id: pending.row_id,
            text,
            footnote,
            image_caption,
            reviewed: pending.reviewed,
            please_check: pending.please_check,
            marker_integrity_rejected: pending.marker_integrity_rejected,
            last_update: load_latest_row_version_metadata(&repo_path, &pending.relative_path)?,
        });
    }

    Ok(ApplyEditorAiReviewResultsBatchResponse {
        language_code: input.language_code,
        rows,
        word_counts,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn update_gtms_editor_row_text_style_sync(
    app: &AppHandle,
    input: UpdateEditorRowTextStyleInput,
) -> Result<UpdateEditorRowTextStyleResponse, String> {
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
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let (text_style, changed) = apply_editor_text_style_update(&mut row_value, &input.text_style)?;

    if changed {
        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        write_row_files_and_commit(
            app,
            &repo_path,
            &format!("Update row {} text style", input.row_id),
            CommitMetadata {
                operation: Some("text-style"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
            &[PreparedRowFileWrite {
                path: row_json_path.clone(),
                relative_path: relative_row_json.clone(),
                original_text: Some(original_row_text),
                updated_text: updated_row_text,
            }],
        )?;
    }

    Ok(UpdateEditorRowTextStyleResponse {
        row_id: input.row_id,
        text_style,
        last_update: load_latest_row_version_metadata(&repo_path, &relative_row_json)?,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn clear_gtms_editor_reviewed_markers_sync(
    app: &AppHandle,
    input: ClearEditorReviewedMarkersInput,
) -> Result<ClearEditorReviewedMarkersResponse, String> {
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
    let rows_path = chapter_path.join("rows");
    let mut changed_row_ids = Vec::new();
    let mut prepared_writes = Vec::new();

    for stored_row in load_editor_rows(&rows_path)? {
        let row_id = stored_row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }

        let row_json_path = validated_row_json_path(&chapter_path, &row_id)?;
        let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
            format!(
                "Could not read row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let (_, _, changed) = apply_editor_field_flag_update(
            &mut row_value,
            &input.language_code,
            "reviewed",
            false,
        )?;
        if !changed {
            continue;
        }

        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        prepared_writes.push(PreparedRowFileWrite {
            relative_path: repo_relative_path(&repo_path, &row_json_path)?,
            path: row_json_path,
            original_text: Some(original_row_text),
            updated_text: updated_row_text,
        });
        changed_row_ids.push(row_id);
    }

    if !changed_row_ids.is_empty() {
        write_row_files_and_commit(
            app,
            &repo_path,
            &format!("Mark all {} translations unreviewed", input.language_code),
            CommitMetadata {
                operation: Some("field-status"),
                migration: None,
                status_note: Some("Marked all unreviewed"),
                ai_model: None,
            },
            &prepared_writes,
        )?;
    }

    Ok(ClearEditorReviewedMarkersResponse {
        row_ids: changed_row_ids,
        language_code: input.language_code,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn apply_editor_plain_text_updates(
    row_value: &mut Value,
    fields: &BTreeMap<String, String>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;

    for (code, plain_text) in fields {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        let previous_plain_text = field_object
            .get("plain_text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
        field_object.insert("plain_text".to_string(), Value::String(plain_text.clone()));
        if previous_plain_text != *plain_text {
            field_object.remove("html_preview");
        }
    }

    Ok(())
}

pub(super) fn apply_editor_footnote_updates(
    row_value: &mut Value,
    footnotes: &BTreeMap<String, String>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;

    for (code, footnote) in footnotes {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "footnote".to_string(),
            Value::String(normalize_editor_footnote_value(footnote)),
        );
    }

    Ok(())
}

pub(super) fn apply_editor_timing_updates(
    row_value: &mut Value,
    timings: &BTreeMap<String, EditorFieldTimingInput>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    for (code, timing) in timings {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| format!("The row field '{code}' is not a JSON object."))?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "timing".to_string(),
            json!({
              "start_ms": timing.start_ms,
              "end_ms": timing.end_ms,
            }),
        );
    }

    Ok(())
}

pub(super) fn apply_editor_image_caption_updates(
    row_value: &mut Value,
    image_captions: &BTreeMap<String, String>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    for (code, image_caption) in image_captions {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| format!("The row field '{code}' is not a JSON object."))?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "image_caption".to_string(),
            Value::String(normalize_editor_image_caption_value(image_caption)),
        );
    }

    Ok(())
}

pub(super) fn apply_editor_text_style_update(
    row_value: &mut Value,
    text_style: &str,
) -> Result<(String, bool), String> {
    let normalized_text_style = normalize_editor_text_style_value(Some(text_style));
    let row_object = row_object_mut(row_value)?;
    let previous_text_style =
        normalize_editor_text_style_value(row_object.get("text_style").and_then(Value::as_str));
    let changed = previous_text_style != normalized_text_style;
    if changed {
        row_object.insert(
            "text_style".to_string(),
            Value::String(normalized_text_style.clone()),
        );
        let fields_object = row_object
            .get_mut("fields")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
        clear_editor_html_preview_cache(fields_object)?;
    }

    Ok((normalized_text_style, changed))
}

pub(super) fn apply_editor_field_flag_update(
    row_value: &mut Value,
    language_code: &str,
    flag: &str,
    enabled: bool,
) -> Result<(bool, bool, bool), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    let field_value = fields_object
        .entry(language_code.to_string())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    let flag_key = normalize_editor_field_flag_key(flag)?;

    let editor_flags_object = field_object
        .get_mut("editor_flags")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
    let previous_value = editor_flags_object
        .get(flag_key)
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let changed = previous_value != enabled;
    if changed {
        editor_flags_object.insert(flag_key.to_string(), Value::Bool(enabled));
    }
    let reviewed = editor_flags_object
        .get("reviewed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let please_check = editor_flags_object
        .get("please_check")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if changed {
        field_object.remove("html_preview");
    }

    Ok((reviewed, please_check, changed))
}

fn normalize_editor_field_flag_key(flag: &str) -> Result<&'static str, String> {
    match flag.trim() {
        "reviewed" => Ok("reviewed"),
        "please-check" => Ok("please_check"),
        _ => Err("Unknown row field flag.".to_string()),
    }
}
