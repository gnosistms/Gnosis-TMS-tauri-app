use super::*;

pub(super) fn actor_login(app: &AppHandle) -> Result<Option<String>, String> {
    let session = load_broker_auth_session(app.clone())?;
    Ok(session.and_then(|value| {
        let normalized_login = value.login.trim().to_lowercase();
        if normalized_login.is_empty() {
            None
        } else {
            Some(normalized_login)
        }
    }))
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_optional_vec(values: Option<&Vec<String>>) -> Vec<String> {
    values
        .map(|entries| {
            entries
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn merge_previous_repo_names(
    current_repo_name: Option<&str>,
    next_repo_name: &str,
    current_previous_repo_names: Vec<String>,
    input_previous_repo_names: Vec<String>,
) -> Vec<String> {
    let mut merged = current_previous_repo_names
        .into_iter()
        .chain(input_previous_repo_names)
        .collect::<Vec<_>>();
    if let Some(current_repo_name) = normalize_optional_string(current_repo_name) {
        if current_repo_name != next_repo_name {
            merged.push(current_repo_name);
        }
    }

    let mut deduped = Vec::new();
    for value in merged {
        let normalized = value.trim();
        if normalized.is_empty()
            || normalized == next_repo_name
            || deduped.iter().any(|entry: &String| entry == normalized)
        {
            continue;
        }
        deduped.push(normalized.to_string());
    }
    deduped
}

fn json_string(value: &str) -> Value {
    Value::String(value.to_string())
}

pub(super) fn build_project_record_value(
    current: Option<Map<String, Value>>,
    input: &UpsertGithubProjectMetadataRecordInput,
    actor_login: Option<&str>,
) -> Result<Value, String> {
    let mut record = current.unwrap_or_default();
    let next_repo_name = input.repo_name.trim();
    if next_repo_name.is_empty() {
        return Err(
            "Could not determine the project repo name for local team metadata.".to_string(),
        );
    }
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Could not determine the project title for local team metadata.".to_string());
    }

    let previous_repo_names = merge_previous_repo_names(
        record.get("repoName").and_then(Value::as_str),
        next_repo_name,
        record
            .get("previousRepoNames")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        normalize_optional_vec(input.previous_repo_names.as_ref()),
    );

    record.insert("id".to_string(), json_string(&input.project_id));
    record.insert("kind".to_string(), json_string("project"));
    record.insert("title".to_string(), json_string(title));
    record.insert("repoName".to_string(), json_string(next_repo_name));
    record.insert(
        "previousRepoNames".to_string(),
        Value::Array(previous_repo_names.into_iter().map(Value::String).collect()),
    );
    record.insert(
        "githubRepoId".to_string(),
        input
            .github_repo_id
            .map(Value::from)
            .unwrap_or_else(|| record.get("githubRepoId").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "githubNodeId".to_string(),
        normalize_optional_string(input.github_node_id.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("githubNodeId").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "fullName".to_string(),
        normalize_optional_string(input.full_name.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("fullName").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "defaultBranch".to_string(),
        json_string(
            normalize_optional_string(input.default_branch.as_deref())
                .or_else(|| {
                    record
                        .get("defaultBranch")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "main".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "lifecycleState".to_string(),
        json_string(
            normalize_optional_string(input.lifecycle_state.as_deref())
                .or_else(|| {
                    record
                        .get("lifecycleState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "active".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "remoteState".to_string(),
        json_string(
            normalize_optional_string(input.remote_state.as_deref())
                .or_else(|| {
                    record
                        .get("remoteState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "pendingCreate".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "recordState".to_string(),
        json_string(
            normalize_optional_string(input.record_state.as_deref())
                .or_else(|| {
                    record
                        .get("recordState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "live".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "createdAt".to_string(),
        record.get("createdAt").cloned().unwrap_or(Value::Null),
    );
    record.insert(
        "updatedAt".to_string(),
        record.get("updatedAt").cloned().unwrap_or(Value::Null),
    );
    record.insert(
        "deletedAt".to_string(),
        normalize_optional_string(input.deleted_at.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("deletedAt").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "createdBy".to_string(),
        record
            .get("createdBy")
            .cloned()
            .or_else(|| actor_login.map(json_string))
            .unwrap_or(Value::Null),
    );
    record.insert(
        "updatedBy".to_string(),
        actor_login
            .map(json_string)
            .unwrap_or_else(|| record.get("updatedBy").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "deletedBy".to_string(),
        record.get("deletedBy").cloned().unwrap_or(Value::Null),
    );
    record.remove("chapterCount");

    Ok(Value::Object(record))
}

pub(super) fn build_glossary_record_value(
    current: Option<Map<String, Value>>,
    input: &UpsertGithubGlossaryMetadataRecordInput,
    actor_login: Option<&str>,
) -> Result<Value, String> {
    let mut record = current.unwrap_or_default();
    let next_repo_name = input.repo_name.trim();
    if next_repo_name.is_empty() {
        return Err(
            "Could not determine the glossary repo name for local team metadata.".to_string(),
        );
    }
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Could not determine the glossary title for local team metadata.".to_string());
    }

    let previous_repo_names = merge_previous_repo_names(
        record.get("repoName").and_then(Value::as_str),
        next_repo_name,
        record
            .get("previousRepoNames")
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        normalize_optional_vec(input.previous_repo_names.as_ref()),
    );

    record.insert("id".to_string(), json_string(&input.glossary_id));
    record.insert("kind".to_string(), json_string("glossary"));
    record.insert("title".to_string(), json_string(title));
    record.insert("repoName".to_string(), json_string(next_repo_name));
    record.insert(
        "previousRepoNames".to_string(),
        Value::Array(previous_repo_names.into_iter().map(Value::String).collect()),
    );
    record.insert(
        "githubRepoId".to_string(),
        input
            .github_repo_id
            .map(Value::from)
            .unwrap_or_else(|| record.get("githubRepoId").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "githubNodeId".to_string(),
        normalize_optional_string(input.github_node_id.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("githubNodeId").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "fullName".to_string(),
        normalize_optional_string(input.full_name.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("fullName").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "defaultBranch".to_string(),
        json_string(
            normalize_optional_string(input.default_branch.as_deref())
                .or_else(|| {
                    record
                        .get("defaultBranch")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "main".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "lifecycleState".to_string(),
        json_string(
            normalize_optional_string(input.lifecycle_state.as_deref())
                .or_else(|| {
                    record
                        .get("lifecycleState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "active".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "remoteState".to_string(),
        json_string(
            normalize_optional_string(input.remote_state.as_deref())
                .or_else(|| {
                    record
                        .get("remoteState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "pendingCreate".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "recordState".to_string(),
        json_string(
            normalize_optional_string(input.record_state.as_deref())
                .or_else(|| {
                    record
                        .get("recordState")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "live".to_string())
                .as_str(),
        ),
    );
    record.insert(
        "createdAt".to_string(),
        record.get("createdAt").cloned().unwrap_or(Value::Null),
    );
    record.insert(
        "updatedAt".to_string(),
        record.get("updatedAt").cloned().unwrap_or(Value::Null),
    );
    record.insert(
        "deletedAt".to_string(),
        normalize_optional_string(input.deleted_at.as_deref())
            .map(Value::String)
            .unwrap_or_else(|| record.get("deletedAt").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "createdBy".to_string(),
        record
            .get("createdBy")
            .cloned()
            .or_else(|| actor_login.map(json_string))
            .unwrap_or(Value::Null),
    );
    record.insert(
        "updatedBy".to_string(),
        actor_login
            .map(json_string)
            .unwrap_or_else(|| record.get("updatedBy").cloned().unwrap_or(Value::Null)),
    );
    record.insert(
        "deletedBy".to_string(),
        record.get("deletedBy").cloned().unwrap_or(Value::Null),
    );
    record.insert(
        "sourceLanguage".to_string(),
        serde_json::to_value(&input.source_language).unwrap_or(Value::Null),
    );
    record.insert(
        "targetLanguage".to_string(),
        serde_json::to_value(&input.target_language).unwrap_or(Value::Null),
    );
    record.remove("termCount");

    Ok(Value::Object(record))
}

fn relative_repo_path(repo_path: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(repo_path).map_err(|_| {
        format!(
            "Could not compute the repo-relative path for '{}'.",
            path.display()
        )
    })?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn has_repo_changes_for_path(repo_path: &Path, relative_path: &str) -> Result<bool, String> {
    Ok(!git_output(
        repo_path,
        &["status", "--porcelain", "--", relative_path],
        None,
    )?
    .trim()
    .is_empty())
}

fn commit_local_metadata_change(
    app: &AppHandle,
    repo_path: &Path,
    relative_path: &str,
    message: &str,
    operation: &str,
) -> Result<bool, String> {
    if !has_repo_changes_for_path(repo_path, relative_path)? {
        return Ok(false);
    }

    let _ = git_commit_as_signed_in_user_with_metadata(
        app,
        repo_path,
        message,
        &[relative_path],
        GitCommitMetadata {
            operation: Some(operation),
            status_note: Some("local-team-metadata"),
            ai_model: None,
        },
    )?;
    Ok(true)
}

pub(super) fn upsert_local_record(
    app: &AppHandle,
    repo_path: &Path,
    record_path: &Path,
    record_value: &Value,
    message: &str,
    operation: &str,
) -> Result<LocalTeamMetadataMutationResult, String> {
    let parent = record_path.parent().ok_or_else(|| {
        format!(
            "Could not resolve the local metadata folder for '{}'.",
            record_path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Could not create the local metadata folder '{}': {error}",
            parent.display()
        )
    })?;
    let contents = serde_json::to_string_pretty(record_value)
        .map_err(|error| format!("Could not encode the local team-metadata record: {error}"))?;
    fs::write(record_path, format!("{contents}\n")).map_err(|error| {
        format!(
            "Could not write the local team-metadata file '{}': {error}",
            record_path.display()
        )
    })?;

    let relative_path = relative_repo_path(repo_path, record_path)?;
    let _ = git_output(repo_path, &["add", "--", &relative_path], None)?;
    let commit_created =
        commit_local_metadata_change(app, repo_path, &relative_path, message, operation)?;

    Ok(LocalTeamMetadataMutationResult {
        repo_path: repo_path.display().to_string(),
        record_path: relative_path,
        current_head_oid: read_current_head_oid(repo_path),
        commit_created,
    })
}

pub(super) fn delete_local_record(
    app: &AppHandle,
    repo_path: &Path,
    record_path: &Path,
    message: &str,
    operation: &str,
) -> Result<LocalTeamMetadataMutationResult, String> {
    let relative_path = relative_repo_path(repo_path, record_path)?;
    if !record_path.exists() {
        return Ok(LocalTeamMetadataMutationResult {
            repo_path: repo_path.display().to_string(),
            record_path: relative_path,
            current_head_oid: read_current_head_oid(repo_path),
            commit_created: false,
        });
    }

    fs::remove_file(record_path).map_err(|error| {
        format!(
            "Could not remove the local team-metadata file '{}': {error}",
            record_path.display()
        )
    })?;
    let _ = git_output(repo_path, &["add", "--all", "--", &relative_path], None)?;
    let commit_created =
        commit_local_metadata_change(app, repo_path, &relative_path, message, operation)?;

    Ok(LocalTeamMetadataMutationResult {
        repo_path: repo_path.display().to_string(),
        record_path: relative_path,
        current_head_oid: read_current_head_oid(repo_path),
        commit_created,
    })
}
