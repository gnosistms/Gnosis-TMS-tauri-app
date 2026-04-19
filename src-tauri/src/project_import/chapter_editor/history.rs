use super::images::{
    file_bytes_equal, load_historical_blob_bytes, normalize_editor_field_image_value,
    push_repo_file_snapshot, remove_repo_file_from_disk, row_language_stored_image,
    with_repo_file_rollback, write_binary_file,
};
use super::*;

pub(crate) fn load_gtms_editor_field_history_sync(
    app: &AppHandle,
    input: LoadEditorFieldHistoryInput,
) -> Result<LoadEditorFieldHistoryResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Err(format!(
            "Could not find row '{}' in the local project repo.",
            input.row_id
        ));
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commits = load_git_history_for_path(&repo_path, &relative_row_json)?;
    let historical_field_values = load_historical_row_field_values_batch(
        &repo_path,
        &relative_row_json,
        &commits,
        &input.language_code,
    )?;
    let entries = build_editor_field_history_entries(&repo_path, commits, historical_field_values);

    Ok(LoadEditorFieldHistoryResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        entries,
    })
}

pub(crate) fn restore_gtms_editor_field_from_history_sync(
    app: &AppHandle,
    input: RestoreEditorFieldHistoryInput,
) -> Result<RestoreEditorFieldHistoryResponse, String> {
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
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Err(format!(
            "Could not find row '{}' in the local project repo.",
            input.row_id
        ));
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let historical_field_value = load_historical_row_field_value(
        &repo_path,
        &relative_row_json,
        &input.commit_sha,
        &input.language_code,
    )?
    .ok_or_else(|| {
        format!(
            "The selected history entry does not contain the '{}' field.",
            input.language_code
        )
    })?;
    let historical_plain_text = historical_field_value.field_value.plain_text.clone();
    let historical_footnote =
        normalize_editor_footnote_value(&historical_field_value.field_value.footnote);
    let historical_image_caption =
        normalize_editor_image_caption_value(&historical_field_value.field_value.image_caption);
    let historical_image =
        normalize_editor_field_image_value(&historical_field_value.field_value.image);
    let historical_text_style = historical_field_value.text_style.clone();

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
    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let _ = apply_editor_text_style_update(&mut row_value, &historical_text_style)?;
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let fields_value = row_object
        .entry("fields".to_string())
        .or_insert_with(|| json!({}));
    let fields_object = fields_value
        .as_object_mut()
        .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
    let field_value = fields_object
        .entry(input.language_code.clone())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;

    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
    field_object.insert(
        "plain_text".to_string(),
        Value::String(historical_plain_text.clone()),
    );
    field_object.insert(
        "footnote".to_string(),
        Value::String(historical_footnote.clone()),
    );
    field_object.insert(
        "image_caption".to_string(),
        Value::String(historical_image_caption.clone()),
    );
    field_object.insert(
        "image".to_string(),
        serde_json::to_value(historical_image.clone())
            .map_err(|error| format!("Could not serialize the restored image metadata: {error}"))?,
    );
    let field_changed = original_row_file
        .fields
        .get(&input.language_code)
        .map(|field| {
            field.plain_text != historical_plain_text
                || field.editor_flags.reviewed
                    != historical_field_value.field_value.editor_flags.reviewed
                || field.editor_flags.please_check
                    != historical_field_value.field_value.editor_flags.please_check
        })
        .unwrap_or(true);
    if field_changed {
        field_object.remove("html_preview");
    }
    set_editor_field_flags(
        field_object,
        &historical_field_value.field_value.editor_flags,
    );

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let mut source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let historical_uploaded_path = historical_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let current_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let mut added_asset_paths = Vec::new();
    let mut removed_asset_paths = Vec::new();
    let mut rollback_snapshots = Vec::new();
    let mut historical_asset_update: Option<(String, Vec<u8>)> = None;

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;

    if let Some(relative_path) = historical_uploaded_path.as_deref() {
        let historical_bytes =
            load_historical_blob_bytes(&repo_path, &input.commit_sha, relative_path)?;
        let absolute_path = repo_path.join(relative_path);
        if !file_bytes_equal(&absolute_path, &historical_bytes) {
            push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
            historical_asset_update = Some((relative_path.to_string(), historical_bytes));
            added_asset_paths.push(relative_path.to_string());
        }
    }

    let removed_uploaded_path = current_uploaded_path
        .as_deref()
        .filter(|path| Some(*path) != historical_uploaded_path.as_deref())
        .map(str::to_string);
    if let Some(relative_path) = removed_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
        removed_asset_paths.push(relative_path.to_string());
    }

    if updated_row_text != original_row_text
        || !added_asset_paths.is_empty()
        || !removed_asset_paths.is_empty()
    {
        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode restored row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        source_word_counts = apply_source_word_count_delta(
            &source_word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        let short_commit = short_commit_sha(&input.commit_sha);
        with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
            if let Some((relative_path, historical_bytes)) = historical_asset_update.as_ref() {
                let absolute_path = repo_path.join(relative_path);
                write_binary_file(&absolute_path, historical_bytes)?;
            }

            if let Some(relative_path) = removed_uploaded_path.as_deref() {
                remove_repo_file_from_disk(&repo_path, relative_path)?;
                git_output(
                    &repo_path,
                    &["rm", "--cached", "--ignore-unmatch", relative_path],
                )?;
            }

            if updated_row_text != original_row_text {
                write_text_file(&row_json_path, &updated_row_text)?;
            }

            let mut add_args = vec!["add"];
            if updated_row_text != original_row_text {
                add_args.push(relative_row_json.as_str());
            }
            for path in &added_asset_paths {
                add_args.push(path.as_str());
            }
            if add_args.len() > 1 {
                git_output(&repo_path, &add_args)?;
            }
            let mut commit_paths = Vec::new();
            if updated_row_text != original_row_text {
                commit_paths.push(relative_row_json.clone());
            }
            commit_paths.extend(added_asset_paths.clone());
            commit_paths.extend(removed_asset_paths.clone());
            let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
            git_commit_as_signed_in_user_with_metadata(
                app,
                &repo_path,
                &format!(
                    "Restore row {} {} from {}",
                    input.row_id, input.language_code, short_commit
                ),
                &commit_path_refs,
                CommitMetadata {
                    operation: Some("restore"),
                    status_note: None,
                    ai_model: None,
                },
            )?;
            Ok(())
        })?;
    }

    Ok(RestoreEditorFieldHistoryResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        plain_text: historical_plain_text,
        footnote: historical_footnote,
        image_caption: historical_image_caption,
        image: editor_field_image_from_stored(
            &repo_path,
            &historical_field_value.field_value.image,
        ),
        text_style: historical_text_style,
        reviewed: historical_field_value.field_value.editor_flags.reviewed,
        please_check: historical_field_value.field_value.editor_flags.please_check,
        source_word_counts,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn reverse_gtms_editor_batch_replace_commit_sync(
    app: &AppHandle,
    input: ReverseEditorBatchReplaceCommitInput,
) -> Result<ReverseEditorBatchReplaceCommitResponse, String> {
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
    let selected_operation = load_git_commit_operation_type(&repo_path, &input.commit_sha)?;
    if selected_operation.as_deref() != Some("editor-replace") {
        return Err("Only batch replace commits can be undone from history.".to_string());
    }

    let parent_commit_sha = git_output(
        &repo_path,
        &["rev-parse", &format!("{}^", input.commit_sha)],
    )
    .map_err(|_| {
        "The selected batch replace commit does not have a previous version to restore.".to_string()
    })?;
    let relative_chapter_path = repo_relative_path(&repo_path, &chapter_path)?;
    let relative_row_paths =
        load_commit_row_paths_for_chapter(&repo_path, &input.commit_sha, &relative_chapter_path)?;
    if relative_row_paths.is_empty() {
        return Err(
            "The selected batch replace commit does not contain any rows in this file.".to_string(),
        );
    }

    let mut updated_rows = Vec::new();
    let mut skipped_row_ids = Vec::new();
    let mut relative_paths_to_add = Vec::new();

    for relative_row_path in relative_row_paths {
        let row_id = row_id_from_relative_row_path(&relative_row_path).ok_or_else(|| {
            format!(
                "Could not determine the row id for '{}'.",
                relative_row_path
            )
        })?;
        if commit_has_later_changes_for_path(&repo_path, &input.commit_sha, &relative_row_path)? {
            skipped_row_ids.push(row_id);
            continue;
        }

        let row_json_path = repo_path.join(&relative_row_path);
        if !row_json_path.exists() {
            skipped_row_ids.push(row_id);
            continue;
        }

        let restored_row_text = git_output(
            &repo_path,
            &["show", &format!("{parent_commit_sha}:{relative_row_path}")],
        )
        .map_err(|_| format!("Could not load the previous version of row '{}'.", row_id))?;
        let normalized_restored_row_text = ensure_text_has_trailing_newline(&restored_row_text);
        let current_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
            format!(
                "Could not read row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        if normalized_restored_row_text == current_row_text {
            continue;
        }

        let restored_row_file: StoredRowFile = serde_json::from_str(&normalized_restored_row_text)
            .map_err(|error| {
                format!(
                    "Could not parse the previous version of row '{}': {error}",
                    row_id
                )
            })?;
        write_text_file(&row_json_path, &normalized_restored_row_text)?;
        relative_paths_to_add.push(relative_row_path);
        updated_rows.push(UpdateEditorRowFieldsBatchRowInput {
            row_id,
            fields: row_plain_text_fields(&restored_row_file),
            footnotes: row_footnote_map(&restored_row_file),
            image_captions: row_image_caption_map(&restored_row_file),
        });
    }

    if updated_rows.is_empty() {
        let source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
        return Ok(ReverseEditorBatchReplaceCommitResponse {
            updated_rows,
            skipped_row_ids,
            source_word_counts,
            commit_sha: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);

    let mut add_args = vec!["add"];
    for path in &relative_paths_to_add {
        add_args.push(path.as_str());
    }
    git_output(&repo_path, &add_args)?;

    let commit_paths: Vec<&str> = relative_paths_to_add.iter().map(String::as_str).collect();
    let commit_output = git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!(
            "Undo batch replace in {} {}",
            updated_rows.len(),
            if updated_rows.len() == 1 {
                "row"
            } else {
                "rows"
            }
        ),
        &commit_paths,
        CommitMetadata {
            operation: Some("editor-replace"),
            status_note: None,
            ai_model: None,
        },
    )?;
    let commit_sha = if commit_output.is_empty() {
        None
    } else {
        Some(git_output(&repo_path, &["rev-parse", "--short", "HEAD"])?)
    };

    Ok(ReverseEditorBatchReplaceCommitResponse {
        updated_rows,
        skipped_row_ids,
        source_word_counts,
        commit_sha,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn load_git_history_for_path(
    repo_path: &Path,
    relative_path: &str,
) -> Result<Vec<GitCommitMetadata>, String> {
    let output = git_output(
        repo_path,
        &[
            "log",
            "--format=%H%x1f%an%x1f%aI%x1f%B%x1e",
            "--",
            relative_path,
        ],
    )?;
    if output.is_empty() {
        return Ok(Vec::new());
    }

    output
        .split('\u{1e}')
        .filter(|record| !record.trim().is_empty())
        .map(|record| {
            let mut parts = record.split('\u{1f}');
            let commit_sha = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Could not parse git history for '{}'.", relative_path))?;
            let author_name = parts.next().unwrap_or_default().trim();
            let committed_at = parts.next().unwrap_or_default().trim();
            let full_message = parts.next().unwrap_or_default();
            let (message, operation_type, status_note, ai_model) =
                parse_git_commit_message(full_message);

            Ok(GitCommitMetadata {
                commit_sha: commit_sha.to_string(),
                author_name: author_name.to_string(),
                committed_at: committed_at.to_string(),
                message,
                operation_type,
                status_note,
                ai_model,
            })
        })
        .collect()
}

pub(super) fn parse_git_commit_message(
    message: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return (String::new(), None, None, None);
    }

    let subject = trimmed_message
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string();
    let operation_type = trimmed_message
        .lines()
        .find_map(parse_gtms_operation_trailer)
        .or_else(|| infer_commit_operation_from_subject(&subject));
    let status_note = trimmed_message
        .lines()
        .find_map(parse_gtms_status_note_trailer);
    let ai_model = trimmed_message
        .lines()
        .find_map(parse_gtms_ai_model_trailer);
    (subject, operation_type, status_note, ai_model)
}

fn parse_gtms_operation_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-Operation") {
        return None;
    }

    let operation = value.trim();
    if operation.is_empty() {
        None
    } else {
        Some(operation.to_string())
    }
}

fn parse_gtms_status_note_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-Status-Note") {
        return None;
    }

    let note = value.trim();
    if note.is_empty() {
        None
    } else {
        Some(note.to_string())
    }
}

fn parse_gtms_ai_model_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-AI-Model") {
        return None;
    }

    let ai_model = value.trim();
    if ai_model.is_empty() {
        None
    } else {
        Some(ai_model.to_string())
    }
}

fn infer_commit_operation_from_subject(subject: &str) -> Option<String> {
    let trimmed_subject = subject.trim();
    if trimmed_subject.starts_with("Import ") {
        Some("import".to_string())
    } else {
        None
    }
}

pub(super) fn status_note_for_field_flag(flag: &str, enabled: bool) -> &'static str {
    match (flag, enabled) {
        ("reviewed", true) => "Marked reviewed",
        ("reviewed", false) => "Marked unreviewed",
        ("please_check", true) => "Marked \"Please check\"",
        ("please_check", false) => "Removed \"Please check\"",
        _ => "Updated markers",
    }
}

fn row_plain_text_fields(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, field)| (code.clone(), field.plain_text.clone()))
        .collect()
}

fn ensure_text_has_trailing_newline(text: &str) -> String {
    if text.ends_with('\n') {
        text.to_string()
    } else {
        format!("{text}\n")
    }
}

fn load_git_commit_operation_type(
    repo_path: &Path,
    commit_sha: &str,
) -> Result<Option<String>, String> {
    let full_message = git_output(repo_path, &["show", "-s", "--format=%B", commit_sha])?;
    let (_, operation_type, _, _) = parse_git_commit_message(&full_message);
    Ok(operation_type)
}

fn load_commit_row_paths_for_chapter(
    repo_path: &Path,
    commit_sha: &str,
    relative_chapter_path: &str,
) -> Result<Vec<String>, String> {
    let changed_paths = git_output(repo_path, &["show", "--format=", "--name-only", commit_sha])?;
    Ok(filter_commit_row_paths_for_chapter(
        changed_paths.lines(),
        relative_chapter_path,
    ))
}

pub(super) fn filter_commit_row_paths_for_chapter<'a>(
    changed_paths: impl IntoIterator<Item = &'a str>,
    relative_chapter_path: &str,
) -> Vec<String> {
    let row_prefix = format!("{}/rows/", relative_chapter_path.trim_end_matches('/'));
    let mut row_paths = changed_paths
        .into_iter()
        .map(str::trim)
        .filter(|path| path.starts_with(&row_prefix) && path.ends_with(".json"))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    row_paths.sort();
    row_paths.dedup();
    row_paths
}

fn row_id_from_relative_row_path(relative_row_path: &str) -> Option<String> {
    Path::new(relative_row_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

fn commit_has_later_changes_for_path(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Result<bool, String> {
    let output = git_output(
        repo_path,
        &[
            "log",
            "--format=%H",
            &format!("{commit_sha}..HEAD"),
            "--",
            relative_path,
        ],
    )?;
    Ok(!output.trim().is_empty())
}

#[derive(Clone, PartialEq, Eq)]
struct HistoricalFieldSignature {
    plain_text: String,
    footnote: String,
    image_caption: String,
    image: Option<StoredFieldImage>,
    text_style: String,
    reviewed: bool,
    please_check: bool,
}

#[derive(Clone)]
pub(super) struct HistoricalFieldVersion {
    pub(super) field_value: StoredFieldValue,
    pub(super) text_style: String,
}

impl HistoricalFieldSignature {
    fn from_version(version: &HistoricalFieldVersion) -> Self {
        Self {
            plain_text: version.field_value.plain_text.clone(),
            footnote: normalize_editor_footnote_value(&version.field_value.footnote),
            image_caption: normalize_editor_image_caption_value(&version.field_value.image_caption),
            image: normalize_editor_field_image_value(&version.field_value.image),
            text_style: version.text_style.clone(),
            reviewed: version.field_value.editor_flags.reviewed,
            please_check: version.field_value.editor_flags.please_check,
        }
    }
}

pub(super) fn build_editor_field_history_entries(
    repo_path: &Path,
    commits: Vec<GitCommitMetadata>,
    historical_field_versions: Vec<Option<HistoricalFieldVersion>>,
) -> Vec<EditorFieldHistoryEntry> {
    let baseline_index = historical_field_versions.iter().rposition(Option::is_some);
    let mut entries = Vec::new();
    let mut last_recorded_field_signature: Option<HistoricalFieldSignature> = None;

    for (index, (commit, historical_field_version)) in commits
        .into_iter()
        .zip(historical_field_versions.into_iter())
        .enumerate()
    {
        let Some(field_version) = historical_field_version else {
            continue;
        };
        let plain_text = field_version.field_value.plain_text.clone();
        let footnote = normalize_editor_footnote_value(&field_version.field_value.footnote);
        let image_caption =
            normalize_editor_image_caption_value(&field_version.field_value.image_caption);
        let image = editor_field_image_from_stored(repo_path, &field_version.field_value.image);
        let text_style = field_version.text_style.clone();
        let field_signature = HistoricalFieldSignature::from_version(&field_version);
        let is_baseline_entry = baseline_index == Some(index);

        if !is_baseline_entry && last_recorded_field_signature.as_ref() == Some(&field_signature) {
            continue;
        }

        last_recorded_field_signature = Some(field_signature);
        entries.push(EditorFieldHistoryEntry {
            commit_sha: commit.commit_sha,
            author_name: commit.author_name,
            committed_at: commit.committed_at,
            message: commit.message,
            operation_type: commit.operation_type,
            status_note: commit.status_note,
            ai_model: commit.ai_model,
            plain_text,
            footnote,
            image_caption,
            image,
            text_style,
            reviewed: field_version.field_value.editor_flags.reviewed,
            please_check: field_version.field_value.editor_flags.please_check,
        });
    }

    entries
}

fn load_historical_row_field_value(
    repo_path: &Path,
    relative_row_json: &str,
    commit_sha: &str,
    language_code: &str,
) -> Result<Option<HistoricalFieldVersion>, String> {
    let row_text = git_output(
        repo_path,
        &["show", &format!("{commit_sha}:{relative_row_json}")],
    )?;
    let row_file: StoredRowFile = serde_json::from_str(&row_text).map_err(|error| {
        format!(
            "Could not parse historical row file '{}' at commit '{}': {error}",
            relative_row_json, commit_sha
        )
    })?;

    Ok(row_file
        .fields
        .get(language_code)
        .cloned()
        .map(|field_value| HistoricalFieldVersion {
            field_value,
            text_style: row_text_style(&row_file),
        }))
}

fn load_historical_row_field_values_batch(
    repo_path: &Path,
    relative_row_json: &str,
    commits: &[GitCommitMetadata],
    language_code: &str,
) -> Result<Vec<Option<HistoricalFieldVersion>>, String> {
    if commits.is_empty() {
        return Ok(Vec::new());
    }

    let request = commits
        .iter()
        .map(|commit| format!("{}:{}\n", commit.commit_sha, relative_row_json))
        .collect::<String>();
    let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
    let mut cursor = 0usize;
    let mut values = Vec::with_capacity(commits.len());

    for commit in commits {
        let header_start = cursor;
        let header_end = output[header_start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|offset| header_start + offset)
            .ok_or_else(|| {
                format!(
                    "Could not parse historical row header for '{}' at commit '{}'.",
                    relative_row_json, commit.commit_sha
                )
            })?;
        let header = str::from_utf8(&output[header_start..header_end]).map_err(|error| {
            format!(
                "Could not decode historical row header for '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        cursor = header_end + 1;

        if header.ends_with(" missing") {
            values.push(None);
            continue;
        }

        let mut header_parts = header.split_whitespace();
        let _object_name = header_parts.next().unwrap_or_default();
        let object_type = header_parts.next().unwrap_or_default();
        let object_size = header_parts
            .next()
            .ok_or_else(|| {
                format!(
                    "Could not parse historical row size for '{}' at commit '{}'.",
                    relative_row_json, commit.commit_sha
                )
            })?
            .parse::<usize>()
            .map_err(|error| {
                format!(
                    "Could not decode historical row size for '{}' at commit '{}': {error}",
                    relative_row_json, commit.commit_sha
                )
            })?;

        if object_type != "blob" {
            return Err(format!(
                "Expected a blob for historical row '{}' at commit '{}', found '{}'.",
                relative_row_json, commit.commit_sha, object_type
            ));
        }

        let body_end = cursor.checked_add(object_size).ok_or_else(|| {
            format!(
                "Historical row size overflow for '{}' at commit '{}'.",
                relative_row_json, commit.commit_sha
            )
        })?;
        if body_end > output.len() {
            return Err(format!(
                "Historical row output was truncated for '{}' at commit '{}'.",
                relative_row_json, commit.commit_sha
            ));
        }

        let row_text = str::from_utf8(&output[cursor..body_end]).map_err(|error| {
            format!(
                "Could not decode historical row file '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        cursor = body_end;
        if output.get(cursor) == Some(&b'\n') {
            cursor += 1;
        }

        let row_file: StoredRowFile = serde_json::from_str(row_text).map_err(|error| {
            format!(
                "Could not parse historical row file '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        values.push(
            row_file
                .fields
                .get(language_code)
                .cloned()
                .map(|field_value| HistoricalFieldVersion {
                    field_value,
                    text_style: row_text_style(&row_file),
                }),
        );
    }

    Ok(values)
}

pub(super) fn load_latest_row_version_metadata(
    repo_path: &Path,
    relative_row_json: &str,
) -> Result<Option<EditorRowVersionMetadata>, String> {
    Ok(load_git_history_for_path(repo_path, relative_row_json)?
        .into_iter()
        .next()
        .map(|commit| EditorRowVersionMetadata {
            commit_sha: commit.commit_sha,
            author_name: commit.author_name,
            committed_at: commit.committed_at,
        }))
}

fn short_commit_sha(commit_sha: &str) -> String {
    commit_sha.chars().take(8).collect()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn history_commit(commit_sha: &str, operation_type: Option<&str>) -> GitCommitMetadata {
        GitCommitMetadata {
            commit_sha: commit_sha.to_string(),
            author_name: "Test User".to_string(),
            committed_at: "2026-04-14T00:00:00Z".to_string(),
            message: format!("Commit {commit_sha}"),
            operation_type: operation_type.map(str::to_string),
            status_note: None,
            ai_model: None,
        }
    }

    fn history_field(plain_text: &str, reviewed: bool, please_check: bool) -> StoredFieldValue {
        StoredFieldValue {
            plain_text: plain_text.to_string(),
            footnote: String::new(),
            image_caption: String::new(),
            image: None,
            editor_flags: StoredFieldEditorFlags {
                reviewed,
                please_check,
            },
        }
    }

    fn history_version(
        plain_text: &str,
        text_style: &str,
        reviewed: bool,
        please_check: bool,
    ) -> HistoricalFieldVersion {
        HistoricalFieldVersion {
            field_value: history_field(plain_text, reviewed, please_check),
            text_style: text_style.to_string(),
        }
    }

    #[test]
    fn parse_git_commit_message_reads_editor_replace_operation_trailer() {
        let (subject, operation_type, status_note, ai_model) = parse_git_commit_message(
            "Undo batch replace in 3 rows\n\nGTMS-Operation: editor-replace\n",
        );

        assert_eq!(subject, "Undo batch replace in 3 rows");
        assert_eq!(operation_type.as_deref(), Some("editor-replace"));
        assert_eq!(status_note, None);
        assert_eq!(ai_model, None);
    }

    #[test]
    fn parse_git_commit_message_reads_ai_model_trailer() {
        let (subject, operation_type, status_note, ai_model) = parse_git_commit_message(
            "Update row row-1\n\nGTMS-Operation: ai-translation\nGTMS-AI-Model: gpt-5.4\n",
        );

        assert_eq!(subject, "Update row row-1");
        assert_eq!(operation_type.as_deref(), Some("ai-translation"));
        assert_eq!(status_note, None);
        assert_eq!(ai_model.as_deref(), Some("gpt-5.4"));
    }

    #[test]
    fn filter_commit_row_paths_for_chapter_keeps_only_row_files_in_that_chapter() {
        let row_paths = filter_commit_row_paths_for_chapter(
            [
                "chapters/chapter-a/chapter.json",
                "chapters/chapter-a/rows/a.json",
                "chapters/chapter-a/rows/b.json",
                "chapters/chapter-b/rows/c.json",
                "chapters/chapter-a/rows/a.json",
            ],
            "chapters/chapter-a",
        );

        assert_eq!(
            row_paths,
            vec![
                "chapters/chapter-a/rows/a.json".to_string(),
                "chapters/chapter-a/rows/b.json".to_string(),
            ]
        );
    }

    #[test]
    fn build_editor_field_history_entries_keeps_oldest_import_baseline_when_field_is_unchanged() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c3", Some("editor-update")),
                history_commit("c2", Some("editor-update")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c3");
        assert_eq!(entries[0].operation_type.as_deref(), Some("editor-update"));
        assert_eq!(entries[0].text_style, DEFAULT_EDITOR_TEXT_STYLE);
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].operation_type.as_deref(), Some("import"));
        assert_eq!(entries[1].plain_text, "Hello");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_uses_oldest_present_field_as_the_baseline() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c3", Some("editor-update")),
                history_commit("c2", Some("insert")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version(
                    "Translated",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version("", DEFAULT_EDITOR_TEXT_STYLE, false, false)),
                None,
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c3");
        assert_eq!(entries[0].plain_text, "Translated");
        assert_eq!(entries[0].text_style, DEFAULT_EDITOR_TEXT_STYLE);
        assert_eq!(entries[1].commit_sha, "c2");
        assert_eq!(entries[1].operation_type.as_deref(), Some("insert"));
        assert_eq!(entries[1].plain_text, "");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_keeps_style_only_changes() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c2", Some("text-style")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version("Hello", "heading1", false, false)),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c2");
        assert_eq!(entries[0].text_style, "heading1");
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_keeps_footnote_only_changes() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c2", Some("editor-update")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(HistoricalFieldVersion {
                    field_value: StoredFieldValue {
                        plain_text: "Hello".to_string(),
                        footnote: "Note".to_string(),
                        image_caption: String::new(),
                        image: None,
                        editor_flags: StoredFieldEditorFlags::default(),
                    },
                    text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
                }),
                Some(HistoricalFieldVersion {
                    field_value: StoredFieldValue {
                        plain_text: "Hello".to_string(),
                        footnote: String::new(),
                        image_caption: String::new(),
                        image: None,
                        editor_flags: StoredFieldEditorFlags::default(),
                    },
                    text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
                }),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c2");
        assert_eq!(entries[0].footnote, "Note");
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].footnote, "");
    }
}
