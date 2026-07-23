use crate::project_import::chapter_import::languages::language_display_name;

use super::*;

pub(super) fn current_repo_head_sha(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"]).ok()
}

/// Row ids come straight from IPC input and end up in `Path::join`, `fs::write`, and
/// `fs::remove_file`. `Path::strip_prefix` is lexical, so a `..` component would survive
/// the repo-relative check downstream — reject anything outside a plain single-component
/// file name here. Mirrors `validated_resource_id` in `team_metadata_local/repo.rs`.
pub(in crate::project_import) fn validated_row_json_path(
    chapter_path: &Path,
    row_id: &str,
) -> Result<PathBuf, String> {
    let normalized = row_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || !normalized
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(format!("'{normalized}' is not a valid row id."));
    }
    Ok(chapter_path.join("rows").join(format!("{normalized}.json")))
}

pub(in crate::project_import) struct PreparedRowFileWrite {
    pub(in crate::project_import) path: PathBuf,
    pub(in crate::project_import) relative_path: String,
    /// `None` when the file is being created (rollback removes it instead of restoring).
    pub(in crate::project_import) original_text: Option<String>,
    pub(in crate::project_import) updated_text: String,
}

/// Write the prepared files and commit them as the signed-in user without ever being
/// able to leave the working tree dirty: the commit preconditions (write access,
/// signed-in session) are checked before the first write, and any later failure rolls
/// the written files back and unstages them before the error is returned. Returns the
/// commit helper's stdout (empty when there was nothing to commit).
pub(in crate::project_import) fn write_row_files_and_commit(
    app: &AppHandle,
    repo_path: &Path,
    commit_message: &str,
    metadata: CommitMetadata<'_>,
    writes: &[PreparedRowFileWrite],
) -> Result<String, String> {
    // Serialize the index-mutating `git add`/commit below against the background
    // reconcile and editor-driven syncs, which hold this same per-repo lock. Without
    // it a content save racing a sync collides on `.git/index.lock`.
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    crate::git_commit::ensure_local_commit_preconditions(app, repo_path)?;

    let mut written_count = 0usize;
    let mut failure = None;
    for write in writes {
        if let Err(error) = write_text_file(&write.path, &write.updated_text) {
            failure = Some(error);
            break;
        }
        written_count += 1;
    }

    let mut commit_output = String::new();
    if failure.is_none() {
        let relative_paths = writes
            .iter()
            .map(|write| write.relative_path.as_str())
            .collect::<Vec<_>>();
        let mut add_args = vec!["add"];
        add_args.extend(relative_paths.iter().copied());
        let result = git_output(repo_path, &add_args).and_then(|_| {
            git_commit_as_signed_in_user_with_metadata(
                app,
                repo_path,
                commit_message,
                &relative_paths,
                metadata,
            )
        });
        match result {
            Ok(output) => commit_output = output,
            Err(error) => failure = Some(error),
        }
    }

    if let Some(error) = failure {
        for write in writes.iter().take(written_count) {
            match &write.original_text {
                Some(text) => {
                    let _ = fs::write(&write.path, text);
                }
                None => {
                    let _ = fs::remove_file(&write.path);
                }
            }
        }
        let mut reset_args = vec!["reset", "-q", "--"];
        reset_args.extend(writes.iter().map(|write| write.relative_path.as_str()));
        let _ = git_output(repo_path, &reset_args);
        return Err(error);
    }

    Ok(commit_output)
}

/// `write_row_files_and_commit` plus repo file removals (uploaded row images) in the
/// same commit. Removals go through the snapshot/rollback helpers so a failed commit
/// restores the removed files on disk and in the index as well as the written ones.
pub(in crate::project_import) fn write_row_files_and_commit_with_removals(
    app: &AppHandle,
    repo_path: &Path,
    commit_message: &str,
    metadata: CommitMetadata<'_>,
    writes: &[PreparedRowFileWrite],
    removed_relative_paths: &[String],
) -> Result<String, String> {
    if removed_relative_paths.is_empty() {
        // Delegates before acquiring the lock; the delegate takes it itself.
        return write_row_files_and_commit(app, repo_path, commit_message, metadata, writes);
    }

    // Same serialization as `write_row_files_and_commit` — the removals path stages and
    // commits directly here, so it must hold the per-repo lock too.
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    crate::git_commit::ensure_local_commit_preconditions(app, repo_path)?;

    let mut snapshots = Vec::new();
    for write in writes {
        push_repo_file_snapshot(&mut snapshots, repo_path, &write.relative_path)?;
    }
    for relative_path in removed_relative_paths {
        push_repo_file_snapshot(&mut snapshots, repo_path, relative_path)?;
    }

    with_repo_file_rollback(repo_path, &snapshots, || {
        for write in writes {
            write_text_file(&write.path, &write.updated_text)?;
        }
        for relative_path in removed_relative_paths {
            remove_repo_file_from_disk(repo_path, relative_path)?;
            git_output(
                repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }
        if !writes.is_empty() {
            let mut add_args = vec!["add"];
            add_args.extend(writes.iter().map(|write| write.relative_path.as_str()));
            git_output(repo_path, &add_args)?;
        }

        let mut commit_paths = writes
            .iter()
            .map(|write| write.relative_path.as_str())
            .collect::<Vec<_>>();
        commit_paths.extend(removed_relative_paths.iter().map(String::as_str));
        git_commit_as_signed_in_user_with_metadata(
            app,
            repo_path,
            commit_message,
            &commit_paths,
            metadata,
        )
    })
}

/// Write and commit a single chapter.json change through the shared row-commit
/// helper so a failed commit gate (expired session, lost write access) cannot strand a
/// dirty, staged chapter.json that would break the next pull.
pub(in crate::project_import) fn commit_chapter_json_update(
    app: &AppHandle,
    repo_path: &Path,
    chapter_json_path: &Path,
    chapter_value: &Value,
    commit_message: &str,
) -> Result<(), String> {
    let updated_text = format!(
        "{}\n",
        serde_json::to_string_pretty(chapter_value)
            .map_err(|error| format!("Could not serialize chapter.json: {error}"))?
    );
    write_row_files_and_commit(
        app,
        repo_path,
        commit_message,
        CommitMetadata {
            operation: None,
            migration: None,
            status_note: None,
            ai_model: None,
        },
        &[PreparedRowFileWrite {
            relative_path: repo_relative_path(repo_path, chapter_json_path)?,
            original_text: fs::read_to_string(chapter_json_path).ok(),
            path: chapter_json_path.to_path_buf(),
            updated_text,
        }],
    )?;
    Ok(())
}

pub(super) fn load_editor_rows(rows_path: &Path) -> Result<Vec<StoredRowFile>, String> {
    if !rows_path.exists() {
        return Ok(Vec::new());
    }

    let mut rows = Vec::new();
    for entry in fs::read_dir(rows_path).map_err(|error| {
        format!(
            "Could not read rows folder '{}': {error}",
            rows_path.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Could not read a row file entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        rows.push(read_json_file(&path, "row file")?);
    }

    rows.sort_by(compare_stored_rows);
    Ok(rows)
}

/// Best-effort: refresh the cached `source_word_count` in a chapter's `chapter.json` and commit it,
/// but only when the value actually changed — so opening or saving an unchanged chapter does not
/// churn git history. The cache is a projects-page read optimization, so any failure (most notably a
/// viewer without write access) is swallowed; the summary simply falls back to recomputing the count
/// from rows. Call this where the source word count is already known for free (e.g. editor load).
pub(super) fn refresh_cached_chapter_source_word_count(
    app: &AppHandle,
    repo_path: &Path,
    chapter_json_path: &Path,
    cached_source_word_count: Option<usize>,
    source_word_count: usize,
) {
    if cached_source_word_count == Some(source_word_count) {
        return;
    }
    if let Err(error) =
        persist_chapter_source_word_count(app, repo_path, chapter_json_path, source_word_count)
    {
        if cfg!(debug_assertions) {
            eprintln!("[gtms word-count cache] skipped persisting source word count: {error}");
        }
    }
}

fn persist_chapter_source_word_count(
    app: &AppHandle,
    repo_path: &Path,
    chapter_json_path: &Path,
    source_word_count: usize,
) -> Result<(), String> {
    persist_chapter_source_word_counts_batch(
        app,
        repo_path,
        &[(chapter_json_path.to_path_buf(), source_word_count)],
        "Update cached source word count",
    )
}

fn persist_chapter_source_word_counts_batch(
    app: &AppHandle,
    repo_path: &Path,
    entries: &[(PathBuf, usize)],
    commit_message: &str,
) -> Result<(), String> {
    // This runs from a read path (editor load), so it must not be able to leave the repo
    // dirty: a failed commit would strand modified/staged chapter.json files that break a
    // later pull. write_row_files_and_commit checks the commit preconditions before touching
    // any file and rolls everything back if a later step fails; prepare every update before
    // writing the first one.
    let mut writes = Vec::with_capacity(entries.len());
    for (chapter_json_path, source_word_count) in entries {
        let original_text = fs::read_to_string(chapter_json_path)
            .map_err(|error| format!("Could not read chapter.json: {error}"))?;
        // Edit as a Value so unknown chapter.json keys round-trip untouched.
        let mut value: serde_json::Value = serde_json::from_str(&original_text)
            .map_err(|error| format!("Could not parse chapter.json: {error}"))?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| "chapter.json is not a JSON object".to_string())?;
        object.insert(
            "source_word_count".to_string(),
            serde_json::json!(source_word_count),
        );
        let updated_json = serde_json::to_string_pretty(&value).map_err(|error| {
            format!(
                "Could not serialize '{}': {error}",
                chapter_json_path.display()
            )
        })?;
        writes.push(PreparedRowFileWrite {
            path: chapter_json_path.clone(),
            relative_path: repo_relative_path(repo_path, chapter_json_path)?,
            original_text: Some(original_text),
            updated_text: format!("{updated_json}\n"),
        });
    }

    write_row_files_and_commit(
        app,
        repo_path,
        commit_message,
        CommitMetadata {
            operation: None,
            migration: None,
            status_note: None,
            ai_model: None,
        },
        &writes,
    )?;
    Ok(())
}

pub(super) fn load_project_chapter_summaries(
    repo_path: &Path,
) -> Result<Vec<ProjectChapterSummary>, String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;
    let conflicted_chapter_ids = list_imported_editor_conflict_refs(repo_path)?
        .into_iter()
        .map(|entry| entry.chapter_id)
        .collect::<BTreeSet<_>>();

    let mut chapters = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let chapter_json_path = path.join("chapter.json");
        if !chapter_json_path.exists() {
            continue;
        }

        let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
        let languages = sanitize_chapter_languages(&chapter_file.languages);
        let selected_source_language_code =
            preferred_source_language_code(&chapter_file, &languages);
        // Use the cached source-language word count when present so the projects-page file list does
        // not have to read every row of every chapter. Legacy chapters (no cached value) fall back to
        // computing from rows; the editor-load path then backfills and persists the cache.
        let word_counts = match chapter_file.source_word_count {
            Some(count) => match selected_source_language_code.as_deref() {
                Some(code) => BTreeMap::from([(code.to_string(), count)]),
                None => BTreeMap::new(),
            },
            None => {
                let rows = load_editor_rows(&path.join("rows"))?;
                build_word_counts_from_stored_rows(&rows, &languages)
            }
        };
        let selected_target_language_code = preferred_target_language_code(
            &chapter_file,
            &languages,
            selected_source_language_code.as_deref(),
        );
        let linked_glossary = linked_chapter_glossary(&chapter_file);
        let workflow_status = normalize_chapter_workflow_status(
            chapter_file
                .settings
                .as_ref()
                .and_then(|settings| settings.workflow_status.as_deref()),
        );
        let has_imported_editor_conflicts =
            conflicted_chapter_ids.contains(&chapter_file.chapter_id);

        chapters.push(ProjectChapterSummary {
            id: chapter_file.chapter_id,
            name: chapter_file.title,
            status: if chapter_file.lifecycle.state == "deleted" {
                "deleted".to_string()
            } else {
                "active".to_string()
            },
            languages,
            word_counts,
            selected_source_language_code,
            selected_target_language_code,
            workflow_status,
            linked_glossary,
            has_imported_editor_conflicts,
        });
    }

    Ok(chapters)
}

pub(super) fn ensure_editor_field_object_defaults(
    field_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    let plain_text = field_object
        .get("plain_text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let footnote = field_object
        .get("footnote")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let image_caption = field_object
        .get("image_caption")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    field_object
        .entry("value_kind".to_string())
        .or_insert_with(|| Value::String("text".to_string()));
    field_object
        .entry("plain_text".to_string())
        .or_insert_with(|| Value::String(plain_text.clone()));
    field_object
        .entry("footnote".to_string())
        .or_insert_with(|| Value::String(footnote));
    field_object
        .entry("image_caption".to_string())
        .or_insert_with(|| Value::String(image_caption));

    let editor_flags_value = field_object
        .entry("editor_flags".to_string())
        .or_insert_with(|| json!({}));
    let editor_flags_object = editor_flags_value
        .as_object_mut()
        .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
    editor_flags_object
        .entry("reviewed".to_string())
        .or_insert(Value::Bool(false));
    editor_flags_object
        .entry("please_check".to_string())
        .or_insert(Value::Bool(false));

    Ok(())
}

pub(super) fn normalize_editor_text_style_value(value: Option<&str>) -> String {
    match value.unwrap_or_default().trim() {
        "h1" | "heading1" => "heading1".to_string(),
        "h2" | "heading2" => "heading2".to_string(),
        "q" | "quote" => "quote".to_string(),
        "i" | "indented" => "indented".to_string(),
        "c" | "center" | "centered" => "centered".to_string(),
        "html" | "custom-html" | "custom_html" => "custom_html".to_string(),
        _ => DEFAULT_EDITOR_TEXT_STYLE.to_string(),
    }
}

pub(super) fn normalize_editor_footnote_value(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        value.to_string()
    }
}

pub(super) fn normalize_editor_image_caption_value(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        value.to_string()
    }
}

pub(super) fn row_object_mut(
    row_value: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())
}

pub(super) fn row_fields_object_mut(
    row_value: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    let row_object = row_object_mut(row_value)?;
    let fields_value = row_object
        .entry("fields".to_string())
        .or_insert_with(|| json!({}));
    fields_value
        .as_object_mut()
        .ok_or_else(|| "The row fields are not a JSON object.".to_string())
}

pub(super) fn clear_editor_html_preview_cache(
    fields_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    for field_value in fields_object.values_mut() {
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        field_object.remove("html_preview");
    }

    Ok(())
}

pub(super) fn set_editor_field_flags(
    field_object: &mut serde_json::Map<String, Value>,
    flags: &StoredFieldEditorFlags,
) {
    if let Some(editor_flags_object) = field_object
        .get_mut("editor_flags")
        .and_then(Value::as_object_mut)
    {
        editor_flags_object.insert("reviewed".to_string(), Value::Bool(flags.reviewed));
        editor_flags_object.insert("please_check".to_string(), Value::Bool(flags.please_check));
    }
}

pub(super) fn sanitize_chapter_languages(languages: &[ChapterLanguage]) -> Vec<ChapterLanguage> {
    let mut seen = BTreeMap::<String, ()>::new();
    let mut sanitized = Vec::new();

    for language in languages {
        if is_reserved_non_language_header(&language.code)
            || is_reserved_non_language_header(&language.name)
        {
            continue;
        }

        if seen.contains_key(&language.code) {
            continue;
        }

        seen.insert(language.code.clone(), ());
        sanitized.push(language.clone());
    }

    number_duplicate_language_names(&mut sanitized);
    sanitized
}

fn sanitized_language_base_code(language: &ChapterLanguage) -> String {
    language
        .base_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .unwrap_or(language.code.as_str())
        .to_string()
}

fn duplicate_language_base_name(languages: &[ChapterLanguage], base_code: &str) -> String {
    let supported_name = language_display_name(base_code);
    if !supported_name.eq_ignore_ascii_case(base_code) {
        return supported_name;
    }

    languages
        .iter()
        .find(|language| sanitized_language_base_code(language).eq_ignore_ascii_case(base_code))
        .map(|language| {
            let trimmed_name = language.name.trim();
            if trimmed_name.is_empty() {
                base_code.to_string()
            } else {
                trimmed_name
                    .trim_end_matches(|character: char| character.is_ascii_digit())
                    .trim()
                    .to_string()
            }
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| base_code.to_string())
}

fn language_has_duplicate_marker(language: &ChapterLanguage, base_code: &str) -> bool {
    language
        .base_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .is_some()
        || !language.code.eq_ignore_ascii_case(base_code)
}

fn number_duplicate_language_names(languages: &mut [ChapterLanguage]) {
    let mut groups = BTreeMap::<String, Vec<usize>>::new();
    for (index, language) in languages.iter().enumerate() {
        let base_code = sanitized_language_base_code(language);
        if base_code.is_empty() {
            continue;
        }
        groups.entry(base_code).or_default().push(index);
    }

    for (base_code, indexes) in groups {
        let base_name = duplicate_language_base_name(languages, &base_code);
        if indexes.len() == 1 {
            let language_index = indexes[0];
            let should_collapse = languages
                .get(language_index)
                .map(|language| language_has_duplicate_marker(language, &base_code))
                .unwrap_or(false);
            if should_collapse {
                if let Some(language) = languages.get_mut(language_index) {
                    language.name = base_name;
                    language.base_code = Some(base_code.clone());
                }
            }
            continue;
        }

        for (position, language_index) in indexes.into_iter().enumerate() {
            if let Some(language) = languages.get_mut(language_index) {
                language.name = format!("{} {}", base_name, position + 1);
                language.base_code = Some(base_code.clone());
            }
        }
    }
}

pub(super) fn editor_row_from_stored_row_file(
    repo_path: &Path,
    row: StoredRowFile,
) -> Result<EditorRow, String> {
    let revision_token = row_revision_token(&row)?;
    let fields = row_plain_text_map(&row);
    let footnotes = row_footnote_map(&row);
    let image_captions = row_image_caption_map(&row);
    let images = row_image_map(repo_path, &row);
    let text_style = row_text_style(&row);

    Ok(EditorRow {
        row_id: row.row_id,
        revision_token,
        external_id: row.external_id,
        description: row
            .guidance
            .as_ref()
            .and_then(|guidance| guidance.description.clone()),
        context: row
            .guidance
            .as_ref()
            .and_then(|guidance| guidance.context.clone()),
        comment_count: row.editor_comments.len(),
        comments_revision: row.editor_comments_revision,
        source_row_number: row.origin.source_row_number,
        review_state: row.status.review_state,
        lifecycle_state: row.lifecycle.state,
        order_key: row.structure.order_key,
        text_style,
        last_update: None,
        fields,
        footnotes,
        image_captions,
        images,
        field_states: row
            .fields
            .into_iter()
            .map(|(code, value)| {
                (
                    code,
                    EditorFieldState {
                        reviewed: value.editor_flags.reviewed,
                        please_check: value.editor_flags.please_check,
                    },
                )
            })
            .collect(),
        imported_conflict: None,
    })
}

pub(super) fn attach_latest_row_update_metadata(
    repo_path: &Path,
    chapter_path: &Path,
    row: &mut EditorRow,
) -> Result<(), String> {
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", row.row_id));
    if !row_json_path.exists() {
        row.last_update = None;
        return Ok(());
    }

    let relative_row_json = repo_relative_path(repo_path, &row_json_path)?;
    row.last_update = load_latest_row_version_metadata(repo_path, &relative_row_json)?;
    Ok(())
}

pub(super) fn editor_row_from_stored_row_file_with_update(
    repo_path: &Path,
    chapter_path: &Path,
    row: StoredRowFile,
) -> Result<EditorRow, String> {
    let mut editor_row = editor_row_from_stored_row_file(repo_path, row)?;
    attach_latest_row_update_metadata(repo_path, chapter_path, &mut editor_row)?;
    Ok(editor_row)
}

pub(super) fn row_plain_text_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, value)| (code.clone(), value.plain_text.clone()))
        .collect()
}

pub(super) fn row_footnote_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, value)| {
            (
                code.clone(),
                normalize_editor_footnote_value(&value.footnote),
            )
        })
        .collect()
}

pub(super) fn row_image_caption_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, value)| {
            (
                code.clone(),
                normalize_editor_image_caption_value(&value.image_caption),
            )
        })
        .collect()
}

fn row_image_map(repo_path: &Path, row: &StoredRowFile) -> BTreeMap<String, EditorFieldImage> {
    row.fields
        .iter()
        .filter_map(|(code, value)| {
            editor_field_image_from_stored(repo_path, &value.image)
                .map(|image| (code.clone(), image))
        })
        .collect()
}

pub(super) fn row_text_style(row: &StoredRowFile) -> String {
    normalize_editor_text_style_value(row.text_style.as_deref())
}

pub(super) fn row_revision_token(row: &StoredRowFile) -> Result<String, String> {
    let row_json = serde_json::to_string_pretty(row)
        .map_err(|error| format!("Could not serialize the row revision token: {error}"))?;
    let mut digest = Sha256::new();
    digest.update(row_json.as_bytes());
    digest.update(b"\n");
    let hash = digest.finalize();
    let mut token = String::with_capacity(hash.len() * 2);
    for byte in hash {
        let _ = write!(&mut token, "{byte:02x}");
    }
    Ok(token)
}

fn compare_stored_rows(left: &StoredRowFile, right: &StoredRowFile) -> Ordering {
    left.structure
        .order_key
        .cmp(&right.structure.order_key)
        .then_with(|| left.row_id.cmp(&right.row_id))
}

fn is_reserved_non_language_header(value: &str) -> bool {
    matches!(
        normalize_header(value).as_str(),
        "" | "row"
            | "row number"
            | "row id"
            | "source label"
            | "source title"
            | "description"
            | "desc"
            | "context"
            | "comment"
            | "comments"
            | "note"
            | "notes"
            | "developer comment"
            | "developer note"
            | "translator comment"
            | "translator note"
            | "key"
            | "id"
            | "identifier"
            | "string key"
            | "string id"
            | "resource key"
    )
}

fn normalize_header(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn build_word_counts_from_stored_rows(
    rows: &[StoredRowFile],
    languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
    let mut counts = languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();

    for row in rows {
        if row.lifecycle.state == "deleted" {
            continue;
        }
        for language in languages {
            let value = row
                .fields
                .get(&language.code)
                .map(|field| field.plain_text.as_str())
                .unwrap_or("");
            *counts.entry(language.code.clone()).or_default() += count_words(value);
        }
    }

    counts
}

pub(super) fn load_word_counts(
    rows_path: &Path,
    languages: &[ChapterLanguage],
) -> Result<BTreeMap<String, usize>, String> {
    let rows = load_editor_rows(rows_path)?;
    Ok(build_word_counts_from_stored_rows(&rows, languages))
}

pub(super) fn apply_word_count_delta(
    existing_counts: &BTreeMap<String, usize>,
    original_row: &StoredRowFile,
    updated_row: &StoredRowFile,
    languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
    let mut next_counts = existing_counts.clone();

    for language in languages {
        let original_words = if original_row.lifecycle.state == "deleted" {
            0
        } else {
            original_row
                .fields
                .get(&language.code)
                .map(|field| count_words(&field.plain_text))
                .unwrap_or(0)
        };
        let updated_words = if updated_row.lifecycle.state == "deleted" {
            0
        } else {
            updated_row
                .fields
                .get(&language.code)
                .map(|field| count_words(&field.plain_text))
                .unwrap_or(0)
        };
        let previous_total = next_counts.get(&language.code).copied().unwrap_or(0);
        let adjusted_total = previous_total.saturating_sub(original_words) + updated_words;
        next_counts.insert(language.code.clone(), adjusted_total);
    }

    next_counts
}

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .count()
}

/// Normalizes legacy `chapter.json` shapes in place:
/// - non-object `settings` / `settings.linked_glossaries` values (older app
///   versions serialized `None` as `null`) are dropped;
/// - explicit `null`s for the optional settings fields are dropped (current
///   serializers omit absent fields);
/// - the pre-0.8 `glossary_1` / `glossary_2` link keys are dropped.
///
/// Returns true when the value changed. The 0.8.56 repo migration runs this
/// over every chapter once, and the targeted settings updaters run it on read
/// so shapes written by pre-0.8.56 apps after that migration still repair.
pub(crate) fn normalize_chapter_settings_value(chapter_value: &mut Value) -> bool {
    let Some(chapter_object) = chapter_value.as_object_mut() else {
        return false;
    };
    let mut changed = false;

    if let Some(settings_value) = chapter_object.get_mut("settings") {
        if let Some(settings_object) = settings_value.as_object_mut() {
            if let Some(linked_value) = settings_object.get_mut("linked_glossaries") {
                if let Some(linked_object) = linked_value.as_object_mut() {
                    changed |= linked_object.remove("glossary_1").is_some();
                    changed |= linked_object.remove("glossary_2").is_some();
                } else {
                    settings_object.remove("linked_glossaries");
                    changed = true;
                }
            }
            for key in [
                "linked_glossaries",
                "default_source_language",
                "default_target_language",
                "workflow_status",
            ] {
                if settings_object
                    .get(key)
                    .map(Value::is_null)
                    .unwrap_or(false)
                {
                    settings_object.remove(key);
                    changed = true;
                }
            }
        } else {
            chapter_object.remove("settings");
            changed = true;
        }
    }

    changed
}

/// Access `settings` as a mutable object, repairing legacy shapes first instead
/// of failing on them.
pub(in crate::project_import) fn chapter_settings_object_mut(
    chapter_value: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    normalize_chapter_settings_value(chapter_value);
    let chapter_object = chapter_value
        .as_object_mut()
        .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
    chapter_object
        .entry("settings".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())
}

/// Access `settings.linked_glossaries` as a mutable object, repairing legacy
/// shapes first instead of failing on them.
pub(in crate::project_import) fn chapter_linked_glossaries_object_mut(
    chapter_value: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    chapter_settings_object_mut(chapter_value)?
        .entry("linked_glossaries".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "The chapter linked glossaries are not a JSON object.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_chapter_settings_drops_legacy_shapes() {
        let mut chapter = serde_json::json!({
            "chapter_id": "c1",
            "title": "Chapter",
            "settings": {
                "linked_glossaries": null,
                "workflow_status": null,
                "default_source_language": "en",
            },
        });
        assert!(normalize_chapter_settings_value(&mut chapter));
        let settings = chapter.get("settings").and_then(Value::as_object).unwrap();
        assert!(!settings.contains_key("linked_glossaries"));
        assert!(!settings.contains_key("workflow_status"));
        assert_eq!(
            settings
                .get("default_source_language")
                .and_then(Value::as_str),
            Some("en")
        );

        let mut non_object_settings = serde_json::json!({
            "chapter_id": "c2",
            "settings": null,
        });
        assert!(normalize_chapter_settings_value(&mut non_object_settings));
        assert!(non_object_settings.get("settings").is_none());

        let mut legacy_keys = serde_json::json!({
            "chapter_id": "c3",
            "settings": {
                "linked_glossaries": {
                    "glossary": { "glossary_id": "g1", "repo_name": "repo" },
                    "glossary_1": "old",
                    "glossary_2": "old",
                },
            },
        });
        assert!(normalize_chapter_settings_value(&mut legacy_keys));
        let linked = legacy_keys
            .pointer("/settings/linked_glossaries")
            .and_then(Value::as_object)
            .unwrap();
        assert!(linked.contains_key("glossary"));
        assert!(!linked.contains_key("glossary_1"));
        assert!(!linked.contains_key("glossary_2"));

        let mut array_linked = serde_json::json!({
            "chapter_id": "c4",
            "settings": { "linked_glossaries": ["repo-a"] },
        });
        assert!(normalize_chapter_settings_value(&mut array_linked));
        assert!(array_linked
            .pointer("/settings/linked_glossaries")
            .is_none());
    }

    #[test]
    fn normalize_chapter_settings_leaves_modern_files_untouched() {
        let mut modern = serde_json::json!({
            "chapter_id": "c1",
            "title": "Chapter",
            "settings": {
                "linked_glossaries": {
                    "glossary": { "glossary_id": "g1", "repo_name": "repo" },
                },
                "workflow_status": "review2",
            },
        });
        let before = modern.clone();
        assert!(!normalize_chapter_settings_value(&mut modern));
        assert_eq!(modern, before);

        // A `"glossary": null` cleared link deserializes as None either way; the
        // normalizer leaves it alone so unchanged files never churn.
        let mut cleared = serde_json::json!({
            "chapter_id": "c2",
            "settings": { "linked_glossaries": { "glossary": null } },
        });
        assert!(!normalize_chapter_settings_value(&mut cleared));

        let mut no_settings = serde_json::json!({ "chapter_id": "c3" });
        assert!(!normalize_chapter_settings_value(&mut no_settings));
    }

    #[test]
    fn settings_accessor_repairs_null_settings() {
        let mut chapter = serde_json::json!({ "chapter_id": "c1", "settings": null });

        let settings =
            chapter_settings_object_mut(&mut chapter).expect("null settings must repair");
        settings.insert("workflow_status".to_string(), serde_json::json!("review1"));

        assert_eq!(
            chapter.pointer("/settings/workflow_status"),
            Some(&serde_json::json!("review1"))
        );
    }

    #[test]
    fn linked_glossaries_accessor_repairs_null_link_container() {
        let mut chapter = serde_json::json!({
            "chapter_id": "c1",
            "settings": { "linked_glossaries": null },
        });

        let linked = chapter_linked_glossaries_object_mut(&mut chapter)
            .expect("null linked glossaries must repair");
        linked.insert(
            "glossary".to_string(),
            serde_json::json!({ "glossary_id": "g1", "repo_name": "repo" }),
        );

        assert_eq!(
            chapter.pointer("/settings/linked_glossaries/glossary/glossary_id"),
            Some(&serde_json::json!("g1"))
        );
    }

    #[test]
    fn validated_row_json_path_accepts_plain_ids_and_trims() {
        let chapter = Path::new("/repos/project/chapters/chapter-1");
        let path = validated_row_json_path(chapter, " 0196a7e2-aa11-7def-8000-1234abcd5678 ")
            .expect("plain id should resolve");
        assert_eq!(
            path,
            chapter
                .join("rows")
                .join("0196a7e2-aa11-7def-8000-1234abcd5678.json")
        );
        assert!(validated_row_json_path(chapter, "Row_1.v2").is_ok());
    }

    #[test]
    fn validated_row_json_path_rejects_traversal_and_empty_ids() {
        let chapter = Path::new("/repos/project/chapters/chapter-1");
        for invalid in [
            "",
            "   ",
            ".",
            "..",
            "../../chapter.json",
            "../../../../../etc/target",
            "nested/row",
            "nested\\row",
        ] {
            assert!(
                validated_row_json_path(chapter, invalid).is_err(),
                "'{invalid}' should be rejected"
            );
        }
    }
}
