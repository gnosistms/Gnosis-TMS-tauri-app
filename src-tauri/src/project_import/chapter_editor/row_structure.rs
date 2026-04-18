use super::images::remove_repo_file_from_disk;
#[cfg(test)]
use super::shared::row_revision_token;
use super::*;

pub(crate) fn insert_gtms_editor_row_sync(
    app: &AppHandle,
    input: InsertEditorRowInput,
    insert_before: bool,
) -> Result<InsertEditorRowResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_json_path = chapter_path.join("chapter.json");
    let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let anchor_index = rows
        .iter()
        .position(|row| row.row_id == input.row_id)
        .ok_or_else(|| format!("Could not find row '{}' in this file.", input.row_id))?;
    let (previous, next) = if insert_before {
        (
            anchor_index
                .checked_sub(1)
                .and_then(|index| rows.get(index)),
            rows.get(anchor_index),
        )
    } else {
        (rows.get(anchor_index), rows.get(anchor_index + 1))
    };
    let order_key = allocate_order_key_between(
        previous.map(|row| row.structure.order_key.as_str()),
        next.map(|row| row.structure.order_key.as_str()),
    )?;
    let row_id = uuid::Uuid::now_v7().to_string();
    let row_file = create_inserted_row_file(&row_id, &order_key, &chapter_file, &languages);
    let row_json_path = chapter_path.join("rows").join(format!("{row_id}.json"));
    write_json_pretty(&row_json_path, &row_file)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commit_message = if insert_before {
        format!("Insert row {} before {}", row_id, input.row_id)
    } else {
        format!("Insert row {} after {}", row_id, input.row_id)
    };
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &commit_message,
        &[&relative_row_json],
        CommitMetadata {
            operation: Some("insert"),
            status_note: None,
            ai_model: None,
        },
    )?;

    let inserted_row_file: StoredRowFile = serde_json::from_value(row_file)
        .map_err(|error| format!("Could not decode inserted row '{}': {error}", row_id))?;

    Ok(InsertEditorRowResponse {
        row: editor_row_from_stored_row_file(&repo_path, inserted_row_file)?,
        source_word_counts: build_source_word_counts_from_stored_rows(&rows, &languages),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn update_gtms_editor_row_lifecycle_sync(
    app: &AppHandle,
    input: UpdateEditorRowLifecycleInput,
    next_state: &str,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
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
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
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
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let lifecycle_value = row_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The row lifecycle is not a JSON object.".to_string())?;
    let current_state = lifecycle_object
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("active");

    if current_state == next_state {
        return Ok(UpdateEditorRowLifecycleResponse {
            row_id: input.row_id,
            lifecycle_state: next_state.to_string(),
            source_word_counts: load_source_word_counts(&chapter_path.join("rows"), &languages)?,
            chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"])
                .ok(),
        });
    }

    lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
    let updated_row_file: StoredRowFile =
        serde_json::from_value(row_value.clone()).map_err(|error| {
            format!(
                "Could not decode updated row '{}': {error}",
                row_json_path.display()
            )
        })?;
    let existing_source_word_counts =
        load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let source_word_counts = apply_source_word_count_delta(
        &existing_source_word_counts,
        &original_row_file,
        &updated_row_file,
        &languages,
    );
    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    write_text_file(&row_json_path, &updated_row_text)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commit_message = if next_state == "deleted" {
        format!("Delete row {}", input.row_id)
    } else {
        format!("Restore row {}", input.row_id)
    };
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &commit_message,
        &[&relative_row_json],
        CommitMetadata {
            operation: Some(if next_state == "deleted" {
                "delete"
            } else {
                "restore"
            }),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(UpdateEditorRowLifecycleResponse {
        row_id: input.row_id,
        lifecycle_state: next_state.to_string(),
        source_word_counts,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
    })
}

pub(crate) fn permanently_delete_gtms_editor_row_sync(
    app: &AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
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
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let row_file: StoredRowFile = read_json_file(&row_json_path, "row file")?;
    if row_file.lifecycle.state != "deleted" {
        return Err("Only soft-deleted rows can be permanently deleted.".to_string());
    }

    let existing_source_word_counts =
        load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let source_word_counts = apply_source_word_count_delta(
        &existing_source_word_counts,
        &row_file,
        &empty_deleted_row_stub(&row_file),
        &languages,
    );
    let uploaded_image_paths = row_uploaded_image_relative_paths(&row_file);
    fs::remove_file(&row_json_path).map_err(|error| {
        format!(
            "Could not remove the deleted row from disk at '{}': {error}",
            row_json_path.display()
        )
    })?;
    for relative_path in &uploaded_image_paths {
        remove_repo_file_from_disk(&repo_path, relative_path)?;
        git_output(
            &repo_path,
            &["rm", "--cached", "--ignore-unmatch", relative_path],
        )?;
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    git_output(
        &repo_path,
        &["rm", "--cached", "--ignore-unmatch", &relative_row_json],
    )?;
    let mut commit_paths = vec![relative_row_json.clone()];
    commit_paths.extend(uploaded_image_paths);
    let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Delete row {} permanently", input.row_id),
        &commit_path_refs,
        CommitMetadata {
            operation: Some("permanent-delete"),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(UpdateEditorRowLifecycleResponse {
        row_id: input.row_id,
        lifecycle_state: "deleted".to_string(),
        source_word_counts,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
    })
}

fn allocate_order_key_between(
    previous: Option<&str>,
    next: Option<&str>,
) -> Result<String, String> {
    let previous_value = previous.map(parse_order_key_hex).transpose()?;
    let next_value = next.map(parse_order_key_hex).transpose()?;
    let allocated = match (previous_value, next_value) {
        (Some(previous_key), Some(next_key)) => {
            if previous_key >= next_key {
                return Err("The surrounding rows are out of order.".to_string());
            }
            let gap = next_key - previous_key;
            if gap <= 1 {
                return Err(
                    "There is no space left to insert here. Insert nearby instead.".to_string(),
                );
            }
            previous_key + (gap / 2)
        }
        (Some(previous_key), None) => {
            previous_key.checked_add(ORDER_KEY_SPACING).ok_or_else(|| {
                "There is no space left to insert here. Insert nearby instead.".to_string()
            })?
        }
        (None, Some(next_key)) => next_key.checked_sub(ORDER_KEY_SPACING).ok_or_else(|| {
            "There is no space left to insert here. Insert nearby instead.".to_string()
        })?,
        (None, None) => ORDER_KEY_SPACING,
    };

    Ok(format!("{allocated:032x}"))
}

fn parse_order_key_hex(value: &str) -> Result<u128, String> {
    let normalized = value.trim();
    if normalized.len() != 32 {
        return Err("The row order key is invalid.".to_string());
    }

    u128::from_str_radix(normalized, 16).map_err(|_| "The row order key is invalid.".to_string())
}

pub(super) fn create_inserted_row_file(
    row_id: &str,
    order_key: &str,
    chapter_file: &StoredChapterFile,
    languages: &[ChapterLanguage],
) -> Value {
    let fields = languages
        .iter()
        .map(|language| {
            (
                language.code.clone(),
                json!({
                  "value_kind": "text",
                  "plain_text": "",
                  "footnote": "",
                  "rich_text": Value::Null,
                  "notes_html": "",
                  "attachments": [],
                  "passthrough_value": Value::Null,
                  "editor_flags": {
                    "reviewed": false,
                    "please_check": false,
                  }
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();
    let source_path_hint = chapter_file
        .source_files
        .first()
        .map(|source_file| source_file.path_hint.clone())
        .unwrap_or_default();

    json!({
      "row_id": row_id,
      "unit_type": "string",
      "guidance": {
        "description": Value::Null,
        "context": Value::Null,
        "comments": [],
        "source_references": [],
      },
      "lifecycle": {
        "state": "active",
      },
      "status": {
        "review_state": "unreviewed",
        "reviewed_at": Value::Null,
        "reviewed_by": Value::Null,
        "flags": [],
      },
      "structure": {
        "source_file": source_path_hint,
        "container_path": {},
        "order_key": order_key,
        "group_context": Value::Null,
      },
      "origin": {
        "source_format": "manual",
        "source_sheet": "",
        "source_row_number": 0,
      },
      "format_state": {
        "translatable": true,
        "character_limit": Value::Null,
        "tags": [],
        "source_state": Value::Null,
        "custom_attributes": {},
      },
      "placeholders": [],
      "variants": [],
      "editor_comments_revision": 0,
      "editor_comments": [],
      "text_style": DEFAULT_EDITOR_TEXT_STYLE,
      "fields": fields,
      "format_metadata": {},
    })
}

#[cfg(test)]
pub(super) fn create_inserted_editor_row(
    row_id: &str,
    order_key: &str,
    languages: &[ChapterLanguage],
) -> Result<EditorRow, String> {
    let fields = languages
        .iter()
        .map(|language| (language.code.clone(), String::new()))
        .collect();
    let footnotes = languages
        .iter()
        .map(|language| (language.code.clone(), String::new()))
        .collect();
    let field_states = languages
        .iter()
        .map(|language| {
            (
                language.code.clone(),
                EditorFieldState {
                    reviewed: false,
                    please_check: false,
                },
            )
        })
        .collect();

    Ok(EditorRow {
        row_id: row_id.to_string(),
        revision_token: row_revision_token(
            &serde_json::from_value::<StoredRowFile>(create_inserted_row_file(
                row_id,
                order_key,
                &StoredChapterFile {
                    chapter_id: String::new(),
                    title: String::new(),
                    lifecycle: active_lifecycle_state(),
                    source_files: Vec::new(),
                    languages: languages.to_vec(),
                    settings: None,
                },
                languages,
            ))
            .map_err(|error| format!("Could not build the inserted row token: {error}"))?,
        )?,
        external_id: None,
        description: None,
        context: None,
        comment_count: 0,
        comments_revision: 0,
        source_row_number: 0,
        review_state: "unreviewed".to_string(),
        lifecycle_state: "active".to_string(),
        order_key: order_key.to_string(),
        text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
        fields,
        footnotes,
        images: BTreeMap::new(),
        field_states,
    })
}

pub(super) fn empty_deleted_row_stub(row: &StoredRowFile) -> StoredRowFile {
    let mut stub = row.clone();
    stub.fields.clear();
    stub
}
