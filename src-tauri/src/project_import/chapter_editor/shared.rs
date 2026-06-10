use crate::project_import::chapter_import::languages::language_display_name;

use super::*;

pub(super) fn current_repo_head_sha(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"]).ok()
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

/// TEMPORARY bulk backfill (see plans/bulk-backfill-source-word-count-plan.md; remove
/// around 2026-06-23): persist the source word counts the projects-page fallback already
/// computed from rows, so teams with many files do not have to open every chapter in the
/// editor to warm the cache. One commit per project. Best-effort like the editor-load
/// refresh: a viewer without write access is a clean no-op.
pub(super) fn backfill_chapter_source_word_counts(
    app: &AppHandle,
    repo_path: &Path,
    entries: &[(PathBuf, usize)],
) {
    if entries.is_empty() {
        return;
    }
    if let Err(error) = persist_chapter_source_word_counts_batch(
        app,
        repo_path,
        entries,
        "Backfill cached source word counts",
    ) {
        if cfg!(debug_assertions) {
            eprintln!("[gtms word-count cache] skipped bulk backfill: {error}");
        }
    }
}

fn persist_chapter_source_word_counts_batch(
    app: &AppHandle,
    repo_path: &Path,
    entries: &[(PathBuf, usize)],
    commit_message: &str,
) -> Result<(), String> {
    // This runs from read paths (editor load, projects-page listing), so it must not be able
    // to leave the repo dirty: the commit helper commits everything staged (no pathspec), and
    // a leftover modified/staged chapter.json would be swept into the next unrelated commit
    // or break a later pull. Check the commit preconditions before touching any file, prepare
    // every update before writing the first one, and roll back everything if a later step fails.
    crate::installation_access::ensure_repo_allows_writes(app, repo_path)?;

    struct PreparedUpdate {
        chapter_json_path: PathBuf,
        original_text: String,
        updated_value: serde_json::Value,
        relative_path: String,
    }

    let mut updates = Vec::with_capacity(entries.len());
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
        updates.push(PreparedUpdate {
            chapter_json_path: chapter_json_path.clone(),
            original_text,
            updated_value: value,
            relative_path: repo_relative_path(repo_path, chapter_json_path)?,
        });
    }

    let mut written_count = 0usize;
    let mut write_and_commit = || -> Result<(), String> {
        for update in &updates {
            write_json_pretty(&update.chapter_json_path, &update.updated_value)?;
            written_count += 1;
        }
        let relative_paths = updates
            .iter()
            .map(|update| update.relative_path.as_str())
            .collect::<Vec<_>>();
        let mut add_args = vec!["add"];
        add_args.extend(relative_paths.iter().copied());
        git_output(repo_path, &add_args)?;
        crate::git_commit::git_commit_as_signed_in_user(
            app,
            repo_path,
            commit_message,
            &relative_paths,
        )?;
        Ok(())
    };
    if let Err(error) = write_and_commit() {
        for update in updates.iter().take(written_count) {
            let _ = fs::write(&update.chapter_json_path, &update.original_text);
        }
        let mut reset_args = vec!["reset", "-q", "--"];
        reset_args.extend(updates.iter().map(|update| update.relative_path.as_str()));
        let _ = git_output(repo_path, &reset_args);
        return Err(error);
    }
    Ok(())
}

/// Returns the chapter summaries plus, TEMPORARILY (see
/// plans/bulk-backfill-source-word-count-plan.md; remove around 2026-06-23), the
/// `(chapter.json path, source count)` pairs for chapters that had no cached
/// `source_word_count` — the caller persists them so the row-read fallback runs once
/// per chapter instead of on every refresh.
pub(super) fn load_project_chapter_summaries(
    repo_path: &Path,
) -> Result<(Vec<ProjectChapterSummary>, Vec<(PathBuf, usize)>), String> {
    let mut source_word_count_backfill = Vec::new();
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok((Vec::new(), source_word_count_backfill));
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
                let computed = build_word_counts_from_stored_rows(&rows, &languages);
                source_word_count_backfill.push((
                    chapter_json_path.clone(),
                    selected_source_language_code
                        .as_deref()
                        .and_then(|code| computed.get(code))
                        .copied()
                        .unwrap_or(0),
                ));
                computed
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

    Ok((chapters, source_word_count_backfill))
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
