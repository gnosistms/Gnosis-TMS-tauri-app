use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::*;

const IMPORTED_EDITOR_CONFLICT_JOURNAL_FILE: &str =
    "gnosis-project-editor-imported-conflicts.json";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedEditorConflictRef {
    pub(crate) chapter_id: String,
    pub(crate) row_id: String,
    pub(crate) row_path: String,
    pub(crate) conflict_kind: String,
}

#[derive(Clone)]
pub(crate) struct PendingImportedEditorConflictEntry {
    pub(crate) row_path: String,
    pub(crate) row_id: String,
    pub(crate) conflict_kind: String,
    pub(crate) base_row: Option<Value>,
    pub(crate) local_row: Value,
}

pub(crate) enum ResolvedEditorConflictAction {
    Write { text: String },
    Delete,
}

pub(crate) struct ResolvedRowGitConflictPlan {
    pub(crate) action: ResolvedEditorConflictAction,
    pub(crate) imported_conflict: Option<PendingImportedEditorConflictEntry>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedEditorConflictJournalFile {
    #[serde(default)]
    entries: Vec<ImportedEditorConflictJournalEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedEditorConflictJournalEntry {
    row_path: String,
    chapter_id: String,
    row_id: String,
    conflict_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_row: Option<Value>,
    local_row: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote_head_sha: Option<String>,
    imported_at: u64,
}

#[derive(Clone)]
struct ParsedRowStage {
    typed: StoredRowFile,
    value: Value,
}

pub(crate) fn repo_has_imported_editor_conflicts(repo_path: &Path) -> Result<bool, String> {
    Ok(!read_imported_editor_conflict_entries(repo_path)?.is_empty())
}

pub(crate) fn list_imported_editor_conflict_refs(
    repo_path: &Path,
) -> Result<Vec<ImportedEditorConflictRef>, String> {
    Ok(read_imported_editor_conflict_entries(repo_path)?
        .into_iter()
        .map(|entry| ImportedEditorConflictRef {
            chapter_id: entry.chapter_id,
            row_id: entry.row_id,
            row_path: entry.row_path,
            conflict_kind: entry.conflict_kind,
        })
        .collect())
}

pub(crate) fn persist_imported_editor_conflict_entries(
    repo_path: &Path,
    pending_entries: Vec<PendingImportedEditorConflictEntry>,
    remote_head_sha: Option<&str>,
) -> Result<Vec<ImportedEditorConflictRef>, String> {
    if pending_entries.is_empty() {
        return Ok(Vec::new());
    }

    let mut journal = read_imported_editor_conflict_journal(repo_path)?;
    let mut entries_by_path = BTreeMap::new();
    for entry in journal.entries.drain(..) {
        entries_by_path.insert(entry.row_path.clone(), entry);
    }

    let normalized_remote_head_sha = remote_head_sha
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let imported_at = current_unix_timestamp();

    for pending in pending_entries {
        let chapter_id = chapter_id_for_row_path(repo_path, &pending.row_path)?;
        entries_by_path.insert(
            pending.row_path.clone(),
            ImportedEditorConflictJournalEntry {
                row_path: pending.row_path.clone(),
                chapter_id: chapter_id.clone(),
                row_id: pending.row_id.clone(),
                conflict_kind: pending.conflict_kind.clone(),
                base_row: pending.base_row.clone(),
                local_row: pending.local_row.clone(),
                remote_head_sha: normalized_remote_head_sha.clone(),
                imported_at,
            },
        );
    }

    journal.entries = entries_by_path.into_values().collect();
    write_imported_editor_conflict_journal(repo_path, &journal)?;

    Ok(journal
        .entries
        .iter()
        .map(|entry| ImportedEditorConflictRef {
            chapter_id: entry.chapter_id.clone(),
            row_id: entry.row_id.clone(),
            row_path: entry.row_path.clone(),
            conflict_kind: entry.conflict_kind.clone(),
        })
        .collect())
}

pub(crate) fn clear_imported_editor_conflict_entry(
    repo_path: &Path,
    chapter_id: &str,
    row_id: &str,
) -> Result<bool, String> {
    let normalized_chapter_id = chapter_id.trim();
    let normalized_row_id = row_id.trim();
    if normalized_chapter_id.is_empty() || normalized_row_id.is_empty() {
        return Ok(false);
    }

    let mut journal = read_imported_editor_conflict_journal(repo_path)?;
    let previous_len = journal.entries.len();
    journal.entries.retain(|entry| {
        !(entry.chapter_id == normalized_chapter_id && entry.row_id == normalized_row_id)
    });
    if journal.entries.len() == previous_len {
        return Ok(false);
    }

    write_imported_editor_conflict_journal(repo_path, &journal)?;
    Ok(true)
}

pub(super) fn overlay_imported_editor_conflict_rows(
    repo_path: &Path,
    chapter_id: &str,
    rows: Vec<EditorRow>,
) -> Result<Vec<EditorRow>, String> {
    let imported_conflicts = imported_editor_conflicts_by_row_id(repo_path, chapter_id)?;
    if imported_conflicts.is_empty() {
        return Ok(rows);
    }

    rows.into_iter()
        .map(|row| overlay_imported_editor_conflict_row_with_entries(repo_path, row, &imported_conflicts))
        .collect()
}

pub(super) fn overlay_imported_editor_conflict_row(
    repo_path: &Path,
    chapter_id: &str,
    row: Option<EditorRow>,
) -> Result<Option<EditorRow>, String> {
    let Some(row) = row else {
        return Ok(None);
    };
    let imported_conflicts = imported_editor_conflicts_by_row_id(repo_path, chapter_id)?;
    Ok(Some(overlay_imported_editor_conflict_row_with_entries(
        repo_path,
        row,
        &imported_conflicts,
    )?))
}

pub(crate) fn resolve_row_git_conflict_from_stage_texts(
    path: &str,
    base_text: Option<&str>,
    remote_text: Option<&str>,
    local_text: Option<&str>,
) -> Result<ResolvedRowGitConflictPlan, String> {
    match (base_text, remote_text, local_text) {
        (None, Some(remote_text), Some(local_text)) => {
            resolve_add_add_row_conflict(path, remote_text, local_text)
        }
        (_, None, Some(_)) | (_, Some(_), None) => Ok(ResolvedRowGitConflictPlan {
            action: ResolvedEditorConflictAction::Delete,
            imported_conflict: None,
        }),
        (_, Some(remote_text), Some(local_text)) => {
            resolve_three_way_row_conflict(path, base_text, remote_text, local_text)
        }
        _ => Err(format!(
            "Could not resolve conflicted row '{path}': unsupported Git stage layout."
        )),
    }
}

pub(crate) fn resolve_chapter_json_git_conflict_from_stage_texts(
    path: &str,
    base_text: Option<&str>,
    remote_text: Option<&str>,
    local_text: Option<&str>,
) -> Result<String, String> {
    let Some(remote_text) = remote_text else {
        return Err(format!(
            "Could not resolve conflicted chapter metadata '{path}': the rebased remote stage is missing."
        ));
    };
    let Some(local_text) = local_text else {
        return Err(format!(
            "Could not resolve conflicted chapter metadata '{path}': the replayed local stage is missing."
        ));
    };

    let base_value = match base_text {
        Some(text) => Some(parse_json_stage(path, text, "base")?),
        None => None,
    };
    let remote_value = parse_json_stage(path, remote_text, "remote")?;
    let local_value = parse_json_stage(path, local_text, "local")?;

    if local_chapter_metadata_change_is_unsupported(
        base_value.as_ref(),
        &local_value,
        &remote_value,
    )? {
        return Err(format!(
            "Could not resolve conflicted chapter metadata '{path}': unsupported local-only changes remain after applying the supported chapter merge rules."
        ));
    }

    let base_typed = match base_text {
        Some(text) => Some(parse_chapter_stage(path, text, "base")?),
        None => None,
    };
    let remote_typed = parse_chapter_stage(path, remote_text, "remote")?;
    let local_typed = parse_chapter_stage(path, local_text, "local")?;

    let mut merged_value = remote_value.clone();
    set_json_string_field(
        &mut merged_value,
        &["title"],
        &merge_scalar_remote_wins_on_overlap(
            base_typed.as_ref().map(|value| value.title.as_str()),
            Some(local_typed.title.as_str()),
            Some(remote_typed.title.as_str()),
        ),
    )?;
    set_json_string_field(
        &mut merged_value,
        &["lifecycle", "state"],
        &merge_lifecycle_state(
            base_typed
                .as_ref()
                .map(|value| value.lifecycle.state.as_str())
                .unwrap_or("active"),
            &local_typed.lifecycle.state,
            &remote_typed.lifecycle.state,
        ),
    )?;
    merge_optional_string_setting(
        &mut merged_value,
        &["settings", "default_source_language"],
        base_typed
            .as_ref()
            .and_then(|value| value.settings.as_ref())
            .and_then(|value| value.default_source_language.as_deref()),
        local_typed
            .settings
            .as_ref()
            .and_then(|value| value.default_source_language.as_deref()),
        remote_typed
            .settings
            .as_ref()
            .and_then(|value| value.default_source_language.as_deref()),
    )?;
    merge_optional_string_setting(
        &mut merged_value,
        &["settings", "default_target_language"],
        base_typed
            .as_ref()
            .and_then(|value| value.settings.as_ref())
            .and_then(|value| value.default_target_language.as_deref()),
        local_typed
            .settings
            .as_ref()
            .and_then(|value| value.default_target_language.as_deref()),
        remote_typed
            .settings
            .as_ref()
            .and_then(|value| value.default_target_language.as_deref()),
    )?;
    merge_optional_glossary_setting(
        &mut merged_value,
        &["settings", "linked_glossaries", "glossary"],
        base_typed
            .as_ref()
            .and_then(|value| value.settings.as_ref())
            .and_then(|value| value.linked_glossaries.as_ref())
            .and_then(|value| value.glossary.as_ref()),
        local_typed
            .settings
            .as_ref()
            .and_then(|value| value.linked_glossaries.as_ref())
            .and_then(|value| value.glossary.as_ref()),
        remote_typed
            .settings
            .as_ref()
            .and_then(|value| value.linked_glossaries.as_ref())
            .and_then(|value| value.glossary.as_ref()),
    )?;

    serialize_json_with_trailing_newline(path, &merged_value)
}

fn imported_editor_conflicts_by_row_id(
    repo_path: &Path,
    chapter_id: &str,
) -> Result<BTreeMap<String, ImportedEditorConflictJournalEntry>, String> {
    let normalized_chapter_id = chapter_id.trim();
    Ok(read_imported_editor_conflict_entries(repo_path)?
        .into_iter()
        .filter(|entry| entry.chapter_id == normalized_chapter_id)
        .map(|entry| (entry.row_id.clone(), entry))
        .collect())
}

fn overlay_imported_editor_conflict_row_with_entries(
    repo_path: &Path,
    row: EditorRow,
    entries_by_row_id: &BTreeMap<String, ImportedEditorConflictJournalEntry>,
) -> Result<EditorRow, String> {
    let Some(entry) = entries_by_row_id.get(&row.row_id) else {
        return Ok(row);
    };

    let local_row_file: StoredRowFile = serde_json::from_value(entry.local_row.clone()).map_err(|error| {
        format!(
            "Could not parse the imported local row conflict snapshot '{}': {error}",
            entry.row_path
        )
    })?;
    let base_row = entry
        .base_row
        .clone()
        .map(|value| {
            serde_json::from_value::<StoredRowFile>(value).map_err(|error| {
                format!(
                    "Could not parse the imported base row conflict snapshot '{}': {error}",
                    entry.row_path
                )
            })
        })
        .transpose()?;
    let local_row = editor_row_from_stored_row_file(repo_path, local_row_file)?;
    let base_row = base_row
        .map(|value| editor_row_from_stored_row_file(repo_path, value))
        .transpose()?;

    Ok(EditorRow {
        imported_conflict: Some(EditorRowImportedConflict {
            conflict_kind: entry.conflict_kind.clone(),
            remote_row: Box::new(row.clone()),
            base_row: base_row.map(Box::new),
        }),
        ..local_row
    })
}

fn read_imported_editor_conflict_entries(
    repo_path: &Path,
) -> Result<Vec<ImportedEditorConflictJournalEntry>, String> {
    Ok(read_imported_editor_conflict_journal(repo_path)?.entries)
}

fn read_imported_editor_conflict_journal(
    repo_path: &Path,
) -> Result<ImportedEditorConflictJournalFile, String> {
    let journal_path = imported_editor_conflict_journal_path(repo_path)?;
    if !journal_path.exists() {
        return Ok(ImportedEditorConflictJournalFile::default());
    }

    let bytes = fs::read(&journal_path).map_err(|error| {
        format!(
            "Could not read the imported editor conflict journal '{}': {error}",
            journal_path.display()
        )
    })?;
    serde_json::from_slice::<ImportedEditorConflictJournalFile>(&bytes).map_err(|error| {
        format!(
            "Could not parse the imported editor conflict journal '{}': {error}",
            journal_path.display()
        )
    })
}

fn write_imported_editor_conflict_journal(
    repo_path: &Path,
    journal: &ImportedEditorConflictJournalFile,
) -> Result<(), String> {
    let journal_path = imported_editor_conflict_journal_path(repo_path)?;
    if journal.entries.is_empty() {
        if journal_path.exists() {
            fs::remove_file(&journal_path).map_err(|error| {
                format!(
                    "Could not remove the imported editor conflict journal '{}': {error}",
                    journal_path.display()
                )
            })?;
        }
        return Ok(());
    }

    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Could not serialize the imported conflict journal: {error}"))?;
    fs::write(&journal_path, bytes).map_err(|error| {
        format!(
            "Could not write the imported editor conflict journal '{}': {error}",
            journal_path.display()
        )
    })
}

fn imported_editor_conflict_journal_path(repo_path: &Path) -> Result<PathBuf, String> {
    Ok(resolve_repo_git_dir(repo_path)?.join(IMPORTED_EDITOR_CONFLICT_JOURNAL_FILE))
}

fn resolve_repo_git_dir(repo_path: &Path) -> Result<PathBuf, String> {
    let git_dir = git_output(repo_path, &["rev-parse", "--git-dir"])?;
    if git_dir.trim().is_empty() {
        return Err(format!(
            "Could not resolve the git directory for '{}'.",
            repo_path.display()
        ));
    }
    let git_dir_path = PathBuf::from(git_dir.trim());
    Ok(if git_dir_path.is_absolute() {
        git_dir_path
    } else {
        repo_path.join(git_dir_path)
    })
}

fn chapter_id_for_row_path(repo_path: &Path, row_path: &str) -> Result<String, String> {
    let chapter_json_path = repo_path
        .join(row_path)
        .parent()
        .and_then(Path::parent)
        .map(|path| path.join("chapter.json"))
        .ok_or_else(|| format!("Could not locate the chapter metadata for '{row_path}'."))?;
    let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
    Ok(chapter_file.chapter_id)
}

fn resolve_add_add_row_conflict(
    path: &str,
    remote_text: &str,
    local_text: &str,
) -> Result<ResolvedRowGitConflictPlan, String> {
    let remote_value = parse_json_stage(path, remote_text, "remote")?;
    let local_value = parse_json_stage(path, local_text, "local")?;
    let remote_row = parse_row_stage(path, remote_text, "remote")?;
    if remote_value == local_value {
        return Ok(ResolvedRowGitConflictPlan {
            action: ResolvedEditorConflictAction::Write {
                text: serialize_json_with_trailing_newline(path, &remote_value)?,
            },
            imported_conflict: None,
        });
    }

    Ok(ResolvedRowGitConflictPlan {
        action: ResolvedEditorConflictAction::Write {
            text: serialize_json_with_trailing_newline(path, &remote_value)?,
        },
        imported_conflict: Some(PendingImportedEditorConflictEntry {
            row_path: path.to_string(),
            row_id: remote_row.row_id,
            conflict_kind: "add-add".to_string(),
            base_row: None,
            local_row: local_value,
        }),
    })
}

fn resolve_three_way_row_conflict(
    path: &str,
    base_text: Option<&str>,
    remote_text: &str,
    local_text: &str,
) -> Result<ResolvedRowGitConflictPlan, String> {
    let base_stage = base_text
        .map(|text| parse_row_stage_with_value(path, text, "base"))
        .transpose()?;
    let remote_stage = parse_row_stage_with_value(path, remote_text, "remote")?;
    let local_stage = parse_row_stage_with_value(path, local_text, "local")?;

    if local_row_change_is_unsupported(
        base_stage.as_ref().map(|stage| &stage.value),
        &local_stage.value,
        &remote_stage.value,
    )? {
        return Err(format!(
            "Could not resolve conflicted row '{path}': unsupported local-only changes remain outside the supported semantic merge fields."
        ));
    }

    let base_row = base_stage.as_ref().map(|stage| &stage.typed);
    let remote_row = &remote_stage.typed;
    let local_row = &local_stage.typed;
    let mut candidate_language_keys = remote_row.fields.keys().cloned().collect::<Vec<_>>();
    candidate_language_keys.extend(local_row.fields.keys().cloned());
    if let Some(base_row) = base_row {
        candidate_language_keys.extend(base_row.fields.keys().cloned());
    }
    let candidate_language_codes = union_keys(candidate_language_keys);

    let mut remote_plain_text = BTreeMap::new();
    let mut local_plain_text = BTreeMap::new();
    let mut remote_footnotes = BTreeMap::new();
    let mut local_footnotes = BTreeMap::new();
    let mut remote_image_captions = BTreeMap::new();
    let mut local_image_captions = BTreeMap::new();
    let mut remote_images = BTreeMap::new();
    let mut local_images = BTreeMap::new();
    let mut remote_flags = BTreeMap::new();
    let mut local_flags = BTreeMap::new();
    let mut conflict_slices = Vec::new();

    for language_code in candidate_language_codes {
        let base_field = base_row.and_then(|row| row.fields.get(&language_code));
        let local_field = local_row.fields.get(&language_code);
        let remote_field = remote_row.fields.get(&language_code);

        let base_plain_text = base_field
            .map(|value| value.plain_text.as_str())
            .unwrap_or_default();
        let local_plain_text_value = local_field
            .map(|value| value.plain_text.as_str())
            .unwrap_or_default();
        let remote_plain_text_value = remote_field
            .map(|value| value.plain_text.as_str())
            .unwrap_or_default();
        let (next_remote_plain_text, next_local_plain_text, plain_text_conflict) =
            merge_string_slice(
                base_plain_text,
                local_plain_text_value,
                remote_plain_text_value,
            );
        remote_plain_text.insert(language_code.clone(), next_remote_plain_text);
        local_plain_text.insert(language_code.clone(), next_local_plain_text);
        if plain_text_conflict {
            conflict_slices.push("field");
        }

        let base_footnote = base_field
            .map(|value| normalize_editor_footnote_value(&value.footnote))
            .unwrap_or_default();
        let local_footnote = local_field
            .map(|value| normalize_editor_footnote_value(&value.footnote))
            .unwrap_or_default();
        let remote_footnote = remote_field
            .map(|value| normalize_editor_footnote_value(&value.footnote))
            .unwrap_or_default();
        let (next_remote_footnote, next_local_footnote, footnote_conflict) = merge_string_slice(
            &base_footnote,
            &local_footnote,
            &remote_footnote,
        );
        remote_footnotes.insert(language_code.clone(), next_remote_footnote);
        local_footnotes.insert(language_code.clone(), next_local_footnote);
        if footnote_conflict {
            conflict_slices.push("footnote");
        }

        let base_image_caption = base_field
            .map(|value| normalize_editor_image_caption_value(&value.image_caption))
            .unwrap_or_default();
        let local_image_caption = local_field
            .map(|value| normalize_editor_image_caption_value(&value.image_caption))
            .unwrap_or_default();
        let remote_image_caption = remote_field
            .map(|value| normalize_editor_image_caption_value(&value.image_caption))
            .unwrap_or_default();
        let (
            next_remote_image_caption,
            next_local_image_caption,
            image_caption_conflict,
        ) = merge_string_slice(
            &base_image_caption,
            &local_image_caption,
            &remote_image_caption,
        );
        remote_image_captions.insert(language_code.clone(), next_remote_image_caption);
        local_image_captions.insert(language_code.clone(), next_local_image_caption);
        if image_caption_conflict {
            conflict_slices.push("image-caption");
        }

        let base_image = base_field.and_then(|value| value.image.clone());
        let local_image = local_field.and_then(|value| value.image.clone());
        let remote_image = remote_field.and_then(|value| value.image.clone());
        let (next_remote_image, next_local_image) =
            merge_image_slice(base_image.clone(), local_image.clone(), remote_image.clone());
        remote_images.insert(language_code.clone(), next_remote_image);
        local_images.insert(language_code.clone(), next_local_image);

        let base_flags = base_field
            .map(|value| value.editor_flags.clone())
            .unwrap_or_default();
        let local_flags_value = local_field
            .map(|value| value.editor_flags.clone())
            .unwrap_or_default();
        let remote_flags_value = remote_field
            .map(|value| value.editor_flags.clone())
            .unwrap_or_default();
        let next_flags =
            merge_field_flags(&base_flags, &local_flags_value, &remote_flags_value);
        remote_flags.insert(language_code.clone(), next_flags.clone());
        local_flags.insert(language_code.clone(), next_flags);
    }

    let mut remote_value = remote_stage.value.clone();
    let mut local_value = remote_stage.value.clone();
    set_row_order_key(
        &mut remote_value,
        &merge_scalar_remote_wins_on_overlap(
            base_row.map(|row| row.structure.order_key.as_str()),
            Some(local_row.structure.order_key.as_str()),
            Some(remote_row.structure.order_key.as_str()),
        ),
    )?;
    set_row_order_key(
        &mut local_value,
        &merge_scalar_remote_wins_on_overlap(
            base_row.map(|row| row.structure.order_key.as_str()),
            Some(local_row.structure.order_key.as_str()),
            Some(remote_row.structure.order_key.as_str()),
        ),
    )?;
    let lifecycle_state = merge_lifecycle_state(
        base_row
            .map(|row| row.lifecycle.state.as_str())
            .unwrap_or("active"),
        &local_row.lifecycle.state,
        &remote_row.lifecycle.state,
    );
    set_row_lifecycle_state(&mut remote_value, &lifecycle_state)?;
    set_row_lifecycle_state(&mut local_value, &lifecycle_state)?;
    apply_plain_text_updates(&mut remote_value, &remote_plain_text)?;
    apply_plain_text_updates(&mut local_value, &local_plain_text)?;
    apply_footnote_updates(&mut remote_value, &remote_footnotes)?;
    apply_footnote_updates(&mut local_value, &local_footnotes)?;
    apply_image_caption_updates(&mut remote_value, &remote_image_captions)?;
    apply_image_caption_updates(&mut local_value, &local_image_captions)?;
    apply_image_updates(&mut remote_value, &remote_images)?;
    apply_image_updates(&mut local_value, &local_images)?;
    apply_field_state_updates(&mut remote_value, &remote_flags)?;
    apply_field_state_updates(&mut local_value, &local_flags)?;

    let imported_conflict = if conflict_slices.is_empty() {
        None
    } else {
        Some(PendingImportedEditorConflictEntry {
            row_path: path.to_string(),
            row_id: remote_row.row_id.clone(),
            conflict_kind: "text-conflict".to_string(),
            base_row: base_stage.map(|stage| stage.value),
            local_row: local_value.clone(),
        })
    };

    Ok(ResolvedRowGitConflictPlan {
        action: ResolvedEditorConflictAction::Write {
            text: serialize_json_with_trailing_newline(path, &remote_value)?,
        },
        imported_conflict,
    })
}

fn merge_string_slice(base: &str, local: &str, remote: &str) -> (String, String, bool) {
    let local_changed = local != base;
    let remote_changed = remote != base;

    if !local_changed {
        return (remote.to_string(), remote.to_string(), false);
    }

    if !remote_changed || local == remote {
        return (local.to_string(), local.to_string(), false);
    }

    (remote.to_string(), local.to_string(), true)
}

fn merge_image_slice(
    base: Option<StoredFieldImage>,
    local: Option<StoredFieldImage>,
    remote: Option<StoredFieldImage>,
) -> (Option<StoredFieldImage>, Option<StoredFieldImage>) {
    let local_changed = local != base;
    let remote_changed = remote != base;

    if !local_changed {
        return (remote.clone(), remote);
    }

    if !remote_changed || local == remote {
        return (local.clone(), local);
    }

    (remote.clone(), remote)
}

fn merge_field_flags(
    base: &StoredFieldEditorFlags,
    local: &StoredFieldEditorFlags,
    remote: &StoredFieldEditorFlags,
) -> StoredFieldEditorFlags {
    let local_touched_any =
        local.reviewed != base.reviewed || local.please_check != base.please_check;
    let remote_touched_any =
        remote.reviewed != base.reviewed || remote.please_check != base.please_check;

    if local_touched_any && remote_touched_any {
        return StoredFieldEditorFlags {
            reviewed: false,
            please_check: true,
        };
    }

    if local.reviewed != base.reviewed || local.please_check != base.please_check {
        return local.clone();
    }

    remote.clone()
}

fn merge_scalar_remote_wins_on_overlap(
    base: Option<&str>,
    local: Option<&str>,
    remote: Option<&str>,
) -> String {
    let base_value = base.unwrap_or_default();
    let local_value = local.unwrap_or_default();
    let remote_value = remote.unwrap_or_default();
    let local_changed = local_value != base_value;
    let remote_changed = remote_value != base_value;

    if !local_changed {
        return remote_value.to_string();
    }

    if !remote_changed || local_value == remote_value {
        return local_value.to_string();
    }

    remote_value.to_string()
}

fn merge_lifecycle_state(base: &str, local: &str, remote: &str) -> String {
    if local == remote {
        return local.to_string();
    }

    if local == "deleted" || remote == "deleted" {
        return "deleted".to_string();
    }

    if local == base {
        return remote.to_string();
    }

    if remote == base {
        return local.to_string();
    }

    remote.to_string()
}

fn apply_plain_text_updates(
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
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
        field_object.insert("plain_text".to_string(), Value::String(plain_text.clone()));
        field_object.remove("html_preview");
    }
    Ok(())
}

fn apply_footnote_updates(
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

fn apply_image_caption_updates(
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
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "image_caption".to_string(),
            Value::String(normalize_editor_image_caption_value(image_caption)),
        );
    }
    Ok(())
}

fn apply_image_updates(
    row_value: &mut Value,
    images: &BTreeMap<String, Option<StoredFieldImage>>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    for (code, image) in images {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "image".to_string(),
            serde_json::to_value(image).map_err(|error| {
                format!("Could not serialize the row image metadata: {error}")
            })?,
        );
    }
    Ok(())
}

fn apply_field_state_updates(
    row_value: &mut Value,
    field_states: &BTreeMap<String, StoredFieldEditorFlags>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    for (code, flags) in field_states {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        ensure_editor_field_object_defaults(field_object)?;
        let editor_flags_object = field_object
            .get_mut("editor_flags")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
        editor_flags_object.insert("reviewed".to_string(), Value::Bool(flags.reviewed));
        editor_flags_object.insert(
            "please_check".to_string(),
            Value::Bool(flags.please_check),
        );
        field_object.remove("html_preview");
    }
    Ok(())
}

fn set_row_order_key(row_value: &mut Value, order_key: &str) -> Result<(), String> {
    let row_object = row_object_mut(row_value)?;
    let structure_value = row_object
        .entry("structure".to_string())
        .or_insert_with(|| json!({}));
    let structure_object = structure_value
        .as_object_mut()
        .ok_or_else(|| "The row structure is not a JSON object.".to_string())?;
    structure_object.insert("order_key".to_string(), Value::String(order_key.to_string()));
    Ok(())
}

fn set_row_lifecycle_state(row_value: &mut Value, lifecycle_state: &str) -> Result<(), String> {
    let row_object = row_object_mut(row_value)?;
    let lifecycle_value = row_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({}));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The row lifecycle is not a JSON object.".to_string())?;
    lifecycle_object.insert("state".to_string(), Value::String(lifecycle_state.to_string()));
    Ok(())
}

fn local_row_change_is_unsupported(
    base_value: Option<&Value>,
    local_value: &Value,
    remote_value: &Value,
) -> Result<bool, String> {
    let mut base_stripped = base_value.cloned().unwrap_or_else(|| Value::Null);
    let mut local_stripped = local_value.clone();
    let mut remote_stripped = remote_value.clone();
    strip_supported_row_merge_keys(&mut base_stripped)?;
    strip_supported_row_merge_keys(&mut local_stripped)?;
    strip_supported_row_merge_keys(&mut remote_stripped)?;
    Ok(local_stripped != base_stripped && local_stripped != remote_stripped)
}

fn local_chapter_metadata_change_is_unsupported(
    base_value: Option<&Value>,
    local_value: &Value,
    remote_value: &Value,
) -> Result<bool, String> {
    let mut base_stripped = base_value.cloned().unwrap_or_else(|| Value::Null);
    let mut local_stripped = local_value.clone();
    let mut remote_stripped = remote_value.clone();
    strip_supported_chapter_merge_keys(&mut base_stripped)?;
    strip_supported_chapter_merge_keys(&mut local_stripped)?;
    strip_supported_chapter_merge_keys(&mut remote_stripped)?;
    Ok(local_stripped != base_stripped && local_stripped != remote_stripped)
}

fn strip_supported_row_merge_keys(value: &mut Value) -> Result<(), String> {
    let Some(row_object) = value.as_object_mut() else {
        return Ok(());
    };

    if let Some(structure_object) = row_object.get_mut("structure").and_then(Value::as_object_mut) {
        structure_object.remove("order_key");
        if structure_object.is_empty() {
            row_object.remove("structure");
        }
    }

    if let Some(lifecycle_object) = row_object.get_mut("lifecycle").and_then(Value::as_object_mut) {
        lifecycle_object.remove("state");
        if lifecycle_object.is_empty() {
            row_object.remove("lifecycle");
        }
    }

    if let Some(fields_object) = row_object.get_mut("fields").and_then(Value::as_object_mut) {
        let language_codes = fields_object.keys().cloned().collect::<Vec<_>>();
        for language_code in language_codes {
            let mut remove_language = false;
            if let Some(field_object) = fields_object
                .get_mut(&language_code)
                .and_then(Value::as_object_mut)
            {
                field_object.remove("plain_text");
                field_object.remove("footnote");
                field_object.remove("image_caption");
                field_object.remove("image");
                field_object.remove("html_preview");
                field_object.remove("value_kind");
                if let Some(editor_flags_object) =
                    field_object.get_mut("editor_flags").and_then(Value::as_object_mut)
                {
                    editor_flags_object.remove("reviewed");
                    editor_flags_object.remove("please_check");
                    if editor_flags_object.is_empty() {
                        field_object.remove("editor_flags");
                    }
                }
                remove_language = field_object.is_empty();
            }
            if remove_language {
                fields_object.remove(&language_code);
            }
        }
        if fields_object.is_empty() {
            row_object.remove("fields");
        }
    }

    Ok(())
}

fn strip_supported_chapter_merge_keys(value: &mut Value) -> Result<(), String> {
    let Some(chapter_object) = value.as_object_mut() else {
        return Ok(());
    };

    chapter_object.remove("title");

    if let Some(lifecycle_object) = chapter_object
        .get_mut("lifecycle")
        .and_then(Value::as_object_mut)
    {
        lifecycle_object.remove("state");
        if lifecycle_object.is_empty() {
            chapter_object.remove("lifecycle");
        }
    }

    if let Some(settings_object) = chapter_object
        .get_mut("settings")
        .and_then(Value::as_object_mut)
    {
        settings_object.remove("default_source_language");
        settings_object.remove("default_target_language");
        if let Some(linked_glossaries_object) = settings_object
            .get_mut("linked_glossaries")
            .and_then(Value::as_object_mut)
        {
            linked_glossaries_object.remove("glossary");
            if linked_glossaries_object.is_empty() {
                settings_object.remove("linked_glossaries");
            }
        }
        if settings_object.is_empty() {
            chapter_object.remove("settings");
        }
    }

    Ok(())
}

fn merge_optional_string_setting(
    chapter_value: &mut Value,
    path: &[&str],
    base: Option<&str>,
    local: Option<&str>,
    remote: Option<&str>,
) -> Result<(), String> {
    let next_value = merge_optional_scalar_remote_wins_on_overlap(base, local, remote);
    set_optional_json_string_field(chapter_value, path, next_value.as_deref())
}

fn merge_optional_glossary_setting(
    chapter_value: &mut Value,
    path: &[&str],
    base: Option<&StoredChapterGlossaryLink>,
    local: Option<&StoredChapterGlossaryLink>,
    remote: Option<&StoredChapterGlossaryLink>,
) -> Result<(), String> {
    let next_value = if !local_changed_optional_glossary(base, local) {
        remote.cloned()
    } else if !local_changed_optional_glossary(base, remote) || local == remote {
        local.cloned()
    } else {
        remote.cloned()
    };
    set_optional_json_value(
        chapter_value,
        path,
        next_value
            .map(|value| serde_json::to_value(value))
            .transpose()
            .map_err(|error| format!("Could not serialize the chapter glossary setting: {error}"))?,
    )
}

fn local_changed_optional_glossary(
    base: Option<&StoredChapterGlossaryLink>,
    candidate: Option<&StoredChapterGlossaryLink>,
) -> bool {
    base != candidate
}

fn merge_optional_scalar_remote_wins_on_overlap(
    base: Option<&str>,
    local: Option<&str>,
    remote: Option<&str>,
) -> Option<String> {
    let base_value = base.map(str::to_string);
    let local_value = local.map(str::to_string);
    let remote_value = remote.map(str::to_string);
    let local_changed = local_value != base_value;
    let remote_changed = remote_value != base_value;

    if !local_changed {
        return remote_value;
    }

    if !remote_changed || local_value == remote_value {
        return local_value;
    }

    remote_value
}

fn set_json_string_field(value: &mut Value, path: &[&str], next_value: &str) -> Result<(), String> {
    set_optional_json_string_field(value, path, Some(next_value))
}

fn set_optional_json_string_field(
    value: &mut Value,
    path: &[&str],
    next_value: Option<&str>,
) -> Result<(), String> {
    set_optional_json_value(
        value,
        path,
        next_value.map(|entry| Value::String(entry.to_string())),
    )
}

fn set_optional_json_value(
    value: &mut Value,
    path: &[&str],
    next_value: Option<Value>,
) -> Result<(), String> {
    if path.is_empty() {
        return Err("Could not update a JSON field: the path is empty.".to_string());
    }

    let (parent_path, final_key) = path.split_at(path.len() - 1);
    let final_key = final_key[0];
    let parent = ensure_json_object_path(value, parent_path)?;

    if let Some(next_value) = next_value {
        parent.insert(final_key.to_string(), next_value);
    } else {
        parent.remove(final_key);
    }

    cleanup_json_path(value, parent_path);
    Ok(())
}

fn ensure_json_object_path<'a>(
    value: &'a mut Value,
    path: &[&str],
) -> Result<&'a mut serde_json::Map<String, Value>, String> {
    let mut current = value;
    for segment in path {
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("The JSON value at '{}' is not an object.", segment))?;
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| json!({}));
    }

    current
        .as_object_mut()
        .ok_or_else(|| "The target JSON value is not an object.".to_string())
}

fn cleanup_json_path(value: &mut Value, path: &[&str]) {
    if path.is_empty() {
        return;
    }

    cleanup_json_path_inner(value, path, 0);
}

fn cleanup_json_path_inner(value: &mut Value, path: &[&str], index: usize) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    let key = path[index];
    let should_remove = if index + 1 == path.len() {
        object
            .get(key)
            .and_then(Value::as_object)
            .map(|value| value.is_empty())
            .unwrap_or(false)
    } else {
        object
            .get_mut(key)
            .map(|child| cleanup_json_path_inner(child, path, index + 1))
            .unwrap_or(false)
    };

    if should_remove {
        object.remove(key);
    }

    object.is_empty()
}

fn parse_row_stage_with_value(
    path: &str,
    text: &str,
    stage_label: &str,
) -> Result<ParsedRowStage, String> {
    Ok(ParsedRowStage {
        typed: parse_row_stage(path, text, stage_label)?,
        value: parse_json_stage(path, text, stage_label)?,
    })
}

fn parse_row_stage(path: &str, text: &str, stage_label: &str) -> Result<StoredRowFile, String> {
    serde_json::from_str::<StoredRowFile>(text).map_err(|error| {
        format!("Could not parse the {stage_label} row stage for '{path}': {error}")
    })
}

fn parse_chapter_stage(
    path: &str,
    text: &str,
    stage_label: &str,
) -> Result<StoredChapterFile, String> {
    serde_json::from_str::<StoredChapterFile>(text).map_err(|error| {
        format!("Could not parse the {stage_label} chapter stage for '{path}': {error}")
    })
}

fn parse_json_stage(path: &str, text: &str, stage_label: &str) -> Result<Value, String> {
    serde_json::from_str::<Value>(text).map_err(|error| {
        format!("Could not parse the {stage_label} JSON stage for '{path}': {error}")
    })
}

fn serialize_json_with_trailing_newline(path: &str, value: &Value) -> Result<String, String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize the resolved JSON for '{path}': {error}"))?;
    Ok(format!("{json}\n"))
}

fn union_keys(keys: Vec<String>) -> Vec<String> {
    let mut set = BTreeSet::new();
    for key in keys {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            continue;
        }
        set.insert(normalized_key.to_string());
    }
    set.into_iter().collect()
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_conflicts_keep_remote_on_disk_and_local_in_journal_for_same_language_text() {
        let plan = resolve_row_git_conflict_from_stage_texts(
            "chapters/ch-1/rows/row-1.json",
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": { "plain_text": "hello", "editor_flags": { "reviewed": false, "please_check": false } }
  }
}"#,
            ),
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": { "plain_text": "remote", "editor_flags": { "reviewed": false, "please_check": false } }
  }
}"#,
            ),
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": { "plain_text": "local", "editor_flags": { "reviewed": false, "please_check": false } }
  }
}"#,
            ),
        )
        .expect("plan should resolve");

        let imported = plan
            .imported_conflict
            .expect("same-language text conflict should be imported");
        let local_row: StoredRowFile =
            serde_json::from_value(imported.local_row).expect("journal row should parse");

        match plan.action {
            ResolvedEditorConflictAction::Write { text } => {
                let remote_row: StoredRowFile =
                    serde_json::from_str(&text).expect("resolved remote row should parse");
                assert_eq!(
                    row_plain_text_map(&remote_row).get("en").map(String::as_str),
                    Some("remote")
                );
                assert_eq!(
                    row_plain_text_map(&local_row).get("en").map(String::as_str),
                    Some("local")
                );
            }
            ResolvedEditorConflictAction::Delete => panic!("row should not delete"),
        }
    }

    #[test]
    fn row_conflicts_resolve_marker_disagreements_to_safer_flags() {
        let plan = resolve_row_git_conflict_from_stage_texts(
            "chapters/ch-1/rows/row-1.json",
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": {
      "plain_text": "hello",
      "editor_flags": { "reviewed": true, "please_check": false }
    }
  }
}"#,
            ),
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": {
      "plain_text": "hello",
      "editor_flags": { "reviewed": true, "please_check": true }
    }
  }
}"#,
            ),
            Some(
                r#"{
  "row_id": "row-1",
  "structure": { "order_key": "001" },
  "status": { "review_state": "unreviewed" },
  "origin": { "source_row_number": 1 },
  "fields": {
    "en": {
      "plain_text": "hello",
      "editor_flags": { "reviewed": false, "please_check": false }
    }
  }
}"#,
            ),
        )
        .expect("plan should resolve");

        match plan.action {
            ResolvedEditorConflictAction::Write { text } => {
                let remote_row: StoredRowFile =
                    serde_json::from_str(&text).expect("resolved row should parse");
                let flags = &remote_row
                    .fields
                    .get("en")
                    .expect("language should exist")
                    .editor_flags;
                assert!(!flags.reviewed);
                assert!(flags.please_check);
            }
            ResolvedEditorConflictAction::Delete => panic!("row should not delete"),
        }
        assert!(plan.imported_conflict.is_none());
    }

    #[test]
    fn chapter_conflicts_keep_remote_title_on_overlap() {
        let merged = resolve_chapter_json_git_conflict_from_stage_texts(
            "chapters/ch-1/chapter.json",
            Some(
                r#"{
  "chapter_id": "chapter-1",
  "title": "Base",
  "lifecycle": { "state": "active" },
  "languages": [],
  "source_files": []
}"#,
            ),
            Some(
                r#"{
  "chapter_id": "chapter-1",
  "title": "Remote",
  "lifecycle": { "state": "active" },
  "languages": [],
  "source_files": []
}"#,
            ),
            Some(
                r#"{
  "chapter_id": "chapter-1",
  "title": "Local",
  "lifecycle": { "state": "active" },
  "languages": [],
  "source_files": []
}"#,
            ),
        )
        .expect("chapter should resolve");
        let merged_value: Value = serde_json::from_str(&merged).expect("merged chapter should parse");
        assert_eq!(merged_value["title"], json!("Remote"));
    }
}
