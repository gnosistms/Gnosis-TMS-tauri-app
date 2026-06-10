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

struct ParsedFootnoteEntry {
    marker: usize,
    text: String,
}

struct FootnoteMarkerMatch {
    marker: usize,
    marker_start: usize,
    content_start: usize,
}

fn parse_labeled_footnote_text_for_merge(value: &str) -> Vec<ParsedFootnoteEntry> {
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
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
    let merged_fields =
        merge_editor_string_maps(&input.base_fields, &input.fields, &current_fields);
    let merged_footnotes =
        merge_editor_footnote_maps(&input.base_footnotes, &input.footnotes, &current_footnotes);
    let merged_image_captions = merge_editor_string_maps(
        &input.base_image_captions,
        &input.image_captions,
        &current_image_captions,
    );
    if merged_fields.is_none() || merged_footnotes.is_none() || merged_image_captions.is_none() {
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

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_plain_text_updates(&mut row_value, &merged_fields)?;
    apply_editor_footnote_updates(&mut row_value, &merged_footnotes)?;
    apply_editor_image_caption_updates(&mut row_value, &merged_image_captions)?;

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
        write_text_file(&row_json_path, &updated_row_text)?;
        if cfg!(debug_assertions) {
            eprintln!(
                "[gtms row-save] git-add:start row='{}' path='{}'",
                input.row_id, relative_row_json
            );
        }
        git_output(&repo_path, &["add", &relative_row_json])?;
        if cfg!(debug_assertions) {
            eprintln!("[gtms row-save] git-commit:start row='{}'", input.row_id);
        }
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {}", input.row_id),
            &[&relative_row_json],
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let mut word_counts = load_word_counts(&chapter_path.join("rows"), &languages)?;
    let mut rows_by_id = BTreeMap::new();
    for row in input.rows {
        let row_id = row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }

        rows_by_id.insert(
            row_id,
            UpdateEditorRowFieldsBatchRowInput {
                row_id: row.row_id,
                fields: row.fields,
                footnotes: row.footnotes,
                image_captions: row.image_captions,
            },
        );
    }

    let mut changed_row_ids = Vec::new();
    let mut relative_row_paths = Vec::new();

    for (row_id, batch_row) in rows_by_id {
        let fields = batch_row.fields;
        let footnotes = batch_row.footnotes;
        let image_captions = batch_row.image_captions;
        let row_json_path = validated_row_json_path(&chapter_path, &row_id)?;
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
        apply_editor_plain_text_updates(&mut row_value, &fields)?;
        apply_editor_footnote_updates(&mut row_value, &footnotes)?;
        apply_editor_image_caption_updates(&mut row_value, &image_captions)?;

        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        if updated_row_text == original_row_text {
            continue;
        }

        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        word_counts = apply_word_count_delta(
            &word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        write_text_file(&row_json_path, &updated_row_text)?;
        relative_row_paths.push(repo_relative_path(&repo_path, &row_json_path)?);
        changed_row_ids.push(row_id);
    }

    if !changed_row_ids.is_empty() {
        let mut add_args = vec!["add"];
        for path in &relative_row_paths {
            add_args.push(path.as_str());
        }
        git_output(&repo_path, &add_args)?;

        let commit_paths: Vec<&str> = relative_row_paths.iter().map(String::as_str).collect();
        let commit_message = input.commit_message.trim();
        let operation = input.operation.trim();
        let commit_output = git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            if commit_message.is_empty() {
                "Update editor rows"
            } else {
                commit_message
            },
            &commit_paths,
            CommitMetadata {
                operation: if operation.is_empty() {
                    None
                } else {
                    Some(operation)
                },
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )?;
        let commit_sha = if commit_output.is_empty() {
            None
        } else {
            Some(git_output(&repo_path, &["rev-parse", "--short", "HEAD"])?)
        };

        return Ok(UpdateEditorRowFieldsBatchResponse {
            row_ids: changed_row_ids,
            word_counts,
            commit_sha,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    Ok(UpdateEditorRowFieldsBatchResponse {
        row_ids: changed_row_ids,
        word_counts,
        commit_sha: None,
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
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
        write_text_file(&row_json_path, &updated_row_text)?;

        let status_note = status_note_for_field_flag(
            normalize_editor_field_flag_key(&input.flag)?,
            input.enabled,
        );
        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!(
                "Update row {} {} markers",
                input.row_id, input.language_code
            ),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some("field-status"),
                migration: None,
                status_note: Some(status_note),
                ai_model: None,
            },
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
    input: ApplyEditorAiReviewResultInput,
) -> Result<ApplyEditorAiReviewResultResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
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

    if !input.suggested_text.trim().is_empty() {
        let mut fields = BTreeMap::new();
        fields.insert(input.language_code.clone(), input.suggested_text.clone());
        apply_editor_plain_text_updates(&mut row_value, &fields)?;
    }
    if !input.suggested_footnote.trim().is_empty() {
        let mut footnotes = BTreeMap::new();
        footnotes.insert(
            input.language_code.clone(),
            input.suggested_footnote.clone(),
        );
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
        write_text_file(&row_json_path, &updated_row_text)?;
        git_output(&repo_path, &["add", &relative_row_json])?;
        let ai_model = input.ai_model.trim();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("AI review row {} {}", input.row_id, input.language_code),
            &[&relative_row_json],
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
        last_update: load_latest_row_version_metadata(&repo_path, &relative_row_json)?,
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
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
        write_text_file(&row_json_path, &updated_row_text)?;

        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} text style", input.row_id),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some("text-style"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
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

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let rows_path = chapter_path.join("rows");
    let mut changed_row_ids = Vec::new();
    let mut relative_row_paths = Vec::new();

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
        write_text_file(&row_json_path, &updated_row_text)?;
        relative_row_paths.push(repo_relative_path(&repo_path, &row_json_path)?);
        changed_row_ids.push(row_id);
    }

    if !changed_row_ids.is_empty() {
        let mut add_args = vec!["add"];
        for path in &relative_row_paths {
            add_args.push(path.as_str());
        }
        git_output(&repo_path, &add_args)?;

        let commit_paths: Vec<&str> = relative_row_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Mark all {} translations unreviewed", input.language_code),
            &commit_paths,
            CommitMetadata {
                operation: Some("field-status"),
                migration: None,
                status_note: Some("Marked all unreviewed"),
                ai_model: None,
            },
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
