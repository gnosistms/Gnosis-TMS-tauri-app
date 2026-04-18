use super::*;

fn is_git_repo(path: &Path) -> bool {
    path.is_dir() && git_output(path, &["rev-parse", "--git-dir"], None).is_ok()
}

pub(super) fn repo_folder_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn normalized_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_glossary_id_from_repo(repo_path: &Path) -> Option<String> {
    let glossary_path = repo_path.join("glossary.json");
    let contents = fs::read_to_string(glossary_path).ok()?;
    let value = serde_json::from_str::<Value>(&contents).ok()?;
    value
        .get("glossary_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[derive(Deserialize)]
struct StoredGlossaryTermLifecycle {
    state: String,
}

#[derive(Deserialize)]
struct StoredGlossaryTermRecord {
    lifecycle: StoredGlossaryTermLifecycle,
}

pub(super) fn local_project_chapter_count(repo_path: &Path) -> Result<usize, String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok(0);
    }

    let mut chapter_count = 0usize;
    for entry in fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read the local project chapters folder '{}': {error}",
            chapters_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a local chapter entry: {error}"))?;
        let chapter_path = entry.path();
        if chapter_path.is_dir() && chapter_path.join("chapter.json").exists() {
            chapter_count += 1;
        }
    }

    Ok(chapter_count)
}

pub(super) fn local_glossary_term_count(repo_path: &Path) -> Result<usize, String> {
    let terms_root = repo_path.join("terms");
    if !terms_root.exists() {
        return Ok(0);
    }

    let mut term_count = 0usize;
    for entry in fs::read_dir(&terms_root).map_err(|error| {
        format!(
            "Could not read the local glossary terms folder '{}': {error}",
            terms_root.display()
        )
    })? {
        let entry = entry
            .map_err(|error| format!("Could not read a local glossary term entry: {error}"))?;
        let term_path = entry.path();
        if !term_path.is_file()
            || term_path.extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }

        let contents = fs::read_to_string(&term_path).map_err(|error| {
            format!(
                "Could not read the local glossary term file '{}': {error}",
                term_path.display()
            )
        })?;
        let record =
            serde_json::from_str::<StoredGlossaryTermRecord>(&contents).map_err(|error| {
                format!(
                    "Could not parse the local glossary term file '{}': {error}",
                    term_path.display()
                )
            })?;
        if record.lifecycle.state == "active" {
            term_count += 1;
        }
    }

    Ok(term_count)
}

fn unique_project_record_for_repo_name<'a>(
    records: &'a [GithubProjectMetadataRecord],
    repo_name: &str,
) -> Option<&'a GithubProjectMetadataRecord> {
    let normalized = repo_name.trim();
    if normalized.is_empty() {
        return None;
    }

    let mut matches = records.iter().filter(|record| {
        record.record_state != "tombstone"
            && (record.repo_name.trim() == normalized
                || record
                    .previous_repo_names
                    .iter()
                    .any(|value| value.trim() == normalized))
    });
    let first = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(first)
}

fn unique_glossary_record_for_repo_name<'a>(
    records: &'a [GithubGlossaryMetadataRecord],
    repo_name: &str,
) -> Option<&'a GithubGlossaryMetadataRecord> {
    let normalized = repo_name.trim();
    if normalized.is_empty() {
        return None;
    }

    let mut matches = records.iter().filter(|record| {
        record.record_state != "tombstone"
            && (record.repo_name.trim() == normalized
                || record
                    .previous_repo_names
                    .iter()
                    .any(|value| value.trim() == normalized))
    });
    let first = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(first)
}

pub(super) fn maybe_repair_sync_state(
    repo_path: &Path,
    kind: &str,
    resource_id: &str,
    repo_name: &str,
    sync_state: Option<&LocalRepoSyncState>,
) -> Result<bool, String> {
    let expected_resource_id = resource_id.trim();
    let expected_repo_name = repo_name.trim();
    if expected_resource_id.is_empty() || expected_repo_name.is_empty() {
        return Ok(false);
    }

    let current_resource_id = sync_state
        .and_then(|state| state.resource_id.as_deref())
        .map(str::trim)
        .unwrap_or_default();
    let current_repo_name = sync_state
        .and_then(|state| state.current_repo_name.as_deref())
        .map(str::trim)
        .unwrap_or_default();
    let current_kind = sync_state
        .and_then(|state| state.kind.as_deref())
        .map(str::trim)
        .unwrap_or_default();

    if current_resource_id == expected_resource_id
        && current_repo_name == expected_repo_name
        && current_kind == kind
    {
        return Ok(false);
    }

    upsert_local_repo_sync_state(
        repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(expected_resource_id.to_string()),
            current_repo_name: Some(expected_repo_name.to_string()),
            kind: Some(kind.to_string()),
            ..Default::default()
        },
    )?;
    Ok(true)
}

pub(super) fn inspect_project_repo_repairs(
    app: &AppHandle,
    installation_id: i64,
    project_records: &[GithubProjectMetadataRecord],
) -> Result<LocalRepoRepairScanResult, String> {
    let repo_root = local_project_repo_root(app, installation_id)?;
    let mut issues = Vec::new();
    let mut auto_repaired_count = 0usize;
    let mut matched_project_ids = std::collections::BTreeSet::new();

    for entry in fs::read_dir(&repo_root).map_err(|error| {
        format!(
            "Could not read the local project repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a local project repo entry: {error}"))?;
        let repo_path = entry.path();
        if !is_git_repo(&repo_path) {
            continue;
        }

        let folder_name = repo_folder_name(&repo_path);
        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        let matched_record = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .and_then(|resource_id| {
                project_records
                    .iter()
                    .find(|record| record.id.trim() == resource_id.trim())
            })
            .or_else(|| {
                sync_state
                    .as_ref()
                    .and_then(|state| state.current_repo_name.as_deref())
                    .and_then(|repo_name| {
                        unique_project_record_for_repo_name(project_records, repo_name)
                    })
            })
            .or_else(|| {
                folder_name.as_deref().and_then(|repo_name| {
                    unique_project_record_for_repo_name(project_records, repo_name)
                })
            });

        let Some(record) = matched_record else {
            issues.push(LocalRepoRepairIssue {
                kind: "project".to_string(),
                issue_type: "strayLocalRepo".to_string(),
                resource_id: sync_state
                    .as_ref()
                    .and_then(|state| normalized_optional_text(state.resource_id.as_deref())),
                repo_name: folder_name.clone(),
                expected_repo_name: None,
                message: "This local project repo has no matching team-metadata record and was left as a repair candidate.".to_string(),
                can_auto_repair: false,
            });
            continue;
        };

        matched_project_ids.insert(record.id.clone());
        if maybe_repair_sync_state(
            &repo_path,
            "project",
            &record.id,
            &record.repo_name,
            sync_state.as_ref(),
        )? {
            auto_repaired_count += 1;
        }

        if folder_name.as_deref() != Some(record.repo_name.trim()) {
            issues.push(LocalRepoRepairIssue {
                kind: "project".to_string(),
                issue_type: "repoNameMismatch".to_string(),
                resource_id: Some(record.id.clone()),
                repo_name: folder_name.clone(),
                expected_repo_name: Some(record.repo_name.clone()),
                message: "The local project repo folder name no longer matches team metadata. The repo stayed bound by stable ID, but it should be repaired.".to_string(),
                can_auto_repair: false,
            });
        }

        if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
            let expected_remote_url = expected_repo_url_from_full_name(&full_name)?;
            if current_origin_remote_url(&repo_path).as_deref()
                != Some(expected_remote_url.as_str())
            {
                issues.push(LocalRepoRepairIssue {
                    kind: "project".to_string(),
                    issue_type: "missingOrigin".to_string(),
                    resource_id: Some(record.id.clone()),
                    repo_name: folder_name.clone().or_else(|| Some(record.repo_name.clone())),
                    expected_repo_name: Some(record.repo_name.clone()),
                    message: "The local project repo is missing the expected origin remote or points at the wrong GitHub repo.".to_string(),
                    can_auto_repair: true,
                });
            }
        }
    }

    for record in project_records
        .iter()
        .filter(|record| record.record_state != "tombstone")
    {
        if matched_project_ids.contains(&record.id) {
            continue;
        }
        issues.push(LocalRepoRepairIssue {
            kind: "project".to_string(),
            issue_type: "missingLocalRepo".to_string(),
            resource_id: Some(record.id.clone()),
            repo_name: None,
            expected_repo_name: Some(record.repo_name.clone()),
            message: "Team metadata references this project, but its local repo is missing."
                .to_string(),
            can_auto_repair: true,
        });
    }

    Ok(LocalRepoRepairScanResult {
        issues,
        auto_repaired_count,
    })
}

pub(super) fn inspect_glossary_repo_repairs(
    app: &AppHandle,
    installation_id: i64,
    glossary_records: &[GithubGlossaryMetadataRecord],
) -> Result<LocalRepoRepairScanResult, String> {
    let repo_root = local_glossary_repo_root(app, installation_id)?;
    let mut issues = Vec::new();
    let mut auto_repaired_count = 0usize;
    let mut matched_glossary_ids = std::collections::BTreeSet::new();

    for entry in fs::read_dir(&repo_root).map_err(|error| {
        format!(
            "Could not read the local glossary repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry = entry
            .map_err(|error| format!("Could not read a local glossary repo entry: {error}"))?;
        let repo_path = entry.path();
        if !is_git_repo(&repo_path) {
            continue;
        }

        let folder_name = repo_folder_name(&repo_path);
        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        let embedded_glossary_id = read_glossary_id_from_repo(&repo_path);
        let matched_record = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .and_then(|resource_id| {
                glossary_records
                    .iter()
                    .find(|record| record.id.trim() == resource_id.trim())
            })
            .or_else(|| {
                embedded_glossary_id.as_deref().and_then(|resource_id| {
                    glossary_records
                        .iter()
                        .find(|record| record.id.trim() == resource_id.trim())
                })
            })
            .or_else(|| {
                sync_state
                    .as_ref()
                    .and_then(|state| state.current_repo_name.as_deref())
                    .and_then(|repo_name| {
                        unique_glossary_record_for_repo_name(glossary_records, repo_name)
                    })
            })
            .or_else(|| {
                folder_name.as_deref().and_then(|repo_name| {
                    unique_glossary_record_for_repo_name(glossary_records, repo_name)
                })
            });

        let Some(record) = matched_record else {
            issues.push(LocalRepoRepairIssue {
                kind: "glossary".to_string(),
                issue_type: "strayLocalRepo".to_string(),
                resource_id: embedded_glossary_id.clone().or_else(|| {
                    sync_state
                        .as_ref()
                        .and_then(|state| normalized_optional_text(state.resource_id.as_deref()))
                }),
                repo_name: folder_name.clone(),
                expected_repo_name: None,
                message: "This local glossary repo has no matching team-metadata record and was left as a repair candidate.".to_string(),
                can_auto_repair: false,
            });
            continue;
        };

        matched_glossary_ids.insert(record.id.clone());
        if maybe_repair_sync_state(
            &repo_path,
            "glossary",
            &record.id,
            &record.repo_name,
            sync_state.as_ref(),
        )? {
            auto_repaired_count += 1;
        }

        if folder_name.as_deref() != Some(record.repo_name.trim()) {
            issues.push(LocalRepoRepairIssue {
                kind: "glossary".to_string(),
                issue_type: "repoNameMismatch".to_string(),
                resource_id: Some(record.id.clone()),
                repo_name: folder_name.clone(),
                expected_repo_name: Some(record.repo_name.clone()),
                message: "The local glossary repo folder name no longer matches team metadata. The repo stayed bound by stable ID, but it should be repaired.".to_string(),
                can_auto_repair: false,
            });
        }

        if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
            let expected_remote_url = expected_repo_url_from_full_name(&full_name)?;
            if current_origin_remote_url(&repo_path).as_deref()
                != Some(expected_remote_url.as_str())
            {
                issues.push(LocalRepoRepairIssue {
                    kind: "glossary".to_string(),
                    issue_type: "missingOrigin".to_string(),
                    resource_id: Some(record.id.clone()),
                    repo_name: folder_name.clone().or_else(|| Some(record.repo_name.clone())),
                    expected_repo_name: Some(record.repo_name.clone()),
                    message: "The local glossary repo is missing the expected origin remote or points at the wrong GitHub repo.".to_string(),
                    can_auto_repair: true,
                });
            }
        }
    }

    for record in glossary_records
        .iter()
        .filter(|record| record.record_state != "tombstone")
    {
        if matched_glossary_ids.contains(&record.id) {
            continue;
        }
        issues.push(LocalRepoRepairIssue {
            kind: "glossary".to_string(),
            issue_type: "missingLocalRepo".to_string(),
            resource_id: Some(record.id.clone()),
            repo_name: None,
            expected_repo_name: Some(record.repo_name.clone()),
            message: "Team metadata references this glossary, but its local repo is missing."
                .to_string(),
            can_auto_repair: true,
        });
    }

    Ok(LocalRepoRepairScanResult {
        issues,
        auto_repaired_count,
    })
}

pub(super) fn find_project_repo_for_record(
    app: &AppHandle,
    installation_id: i64,
    record: &GithubProjectMetadataRecord,
) -> Result<Option<PathBuf>, String> {
    let repo_root = local_project_repo_root(app, installation_id)?;
    let candidate_repo_names = std::iter::once(record.repo_name.as_str())
        .chain(record.previous_repo_names.iter().map(String::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let mut matches = Vec::new();

    for entry in fs::read_dir(&repo_root).map_err(|error| {
        format!(
            "Could not read the local project repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a local project repo entry: {error}"))?;
        let repo_path = entry.path();
        if !is_git_repo(&repo_path) {
            continue;
        }

        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        let folder_name = repo_folder_name(&repo_path).unwrap_or_default();
        let matches_record = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            == Some(record.id.trim())
            || sync_state
                .as_ref()
                .and_then(|state| state.current_repo_name.as_deref())
                .map(str::trim)
                .is_some_and(|repo_name| {
                    candidate_repo_names
                        .iter()
                        .any(|candidate| *candidate == repo_name)
                })
            || candidate_repo_names
                .iter()
                .any(|candidate| *candidate == folder_name);

        if matches_record {
            matches.push(repo_path);
        }
    }

    if matches.len() > 1 {
        return Err(format!(
            "More than one local project repo matches metadata record '{}'.",
            record.id
        ));
    }

    Ok(matches.into_iter().next())
}

pub(super) fn find_glossary_repo_for_record(
    app: &AppHandle,
    installation_id: i64,
    record: &GithubGlossaryMetadataRecord,
) -> Result<Option<PathBuf>, String> {
    let repo_root = local_glossary_repo_root(app, installation_id)?;
    let candidate_repo_names = std::iter::once(record.repo_name.as_str())
        .chain(record.previous_repo_names.iter().map(String::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let mut matches = Vec::new();

    for entry in fs::read_dir(&repo_root).map_err(|error| {
        format!(
            "Could not read the local glossary repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry = entry
            .map_err(|error| format!("Could not read a local glossary repo entry: {error}"))?;
        let repo_path = entry.path();
        if !is_git_repo(&repo_path) {
            continue;
        }

        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        let folder_name = repo_folder_name(&repo_path).unwrap_or_default();
        let embedded_glossary_id = read_glossary_id_from_repo(&repo_path);
        let matches_record = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            == Some(record.id.trim())
            || embedded_glossary_id.as_deref().map(str::trim) == Some(record.id.trim())
            || sync_state
                .as_ref()
                .and_then(|state| state.current_repo_name.as_deref())
                .map(str::trim)
                .is_some_and(|repo_name| {
                    candidate_repo_names
                        .iter()
                        .any(|candidate| *candidate == repo_name)
                })
            || candidate_repo_names
                .iter()
                .any(|candidate| *candidate == folder_name);

        if matches_record {
            matches.push(repo_path);
        }
    }

    if matches.len() > 1 {
        return Err(format!(
            "More than one local glossary repo matches metadata record '{}'.",
            record.id
        ));
    }

    Ok(matches.into_iter().next())
}
