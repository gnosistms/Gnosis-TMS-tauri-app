use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::{
    broker_auth_storage::load_broker_auth_session,
    git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata},
    github::types::{
        DeleteGithubGlossaryMetadataRecordInput, DeleteGithubProjectMetadataRecordInput,
        UpsertGithubGlossaryMetadataRecordInput, UpsertGithubProjectMetadataRecordInput,
    },
    github::types::{GithubGlossaryMetadataRecord, GithubProjectMetadataRecord},
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncState,
        LocalRepoSyncStateUpdate,
    },
    repo_sync_shared::{
        abort_rebase_after_failed_pull, git_output, load_git_transport_token,
        read_current_head_oid, GitTransportAuth,
    },
    storage_paths::{
        local_glossary_repo_root, local_project_repo_root, local_team_metadata_repo_path,
    },
};

const TEAM_METADATA_REPO_NAME: &str = "team-metadata";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataRepoInfo {
    pub(crate) repo_path: String,
    pub(crate) full_name: String,
    pub(crate) has_manifest: bool,
    pub(crate) current_head_oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataMutationResult {
    pub(crate) repo_path: String,
    pub(crate) record_path: String,
    pub(crate) current_head_oid: Option<String>,
    pub(crate) commit_created: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataPushResult {
    pub(crate) repo_path: String,
    pub(crate) current_head_oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoRepairIssue {
    pub(crate) kind: String,
    pub(crate) issue_type: String,
    pub(crate) resource_id: Option<String>,
    pub(crate) repo_name: Option<String>,
    pub(crate) expected_repo_name: Option<String>,
    pub(crate) message: String,
    pub(crate) can_auto_repair: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoRepairScanResult {
    pub(crate) issues: Vec<LocalRepoRepairIssue>,
    pub(crate) auto_repaired_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepairLocalRepoBindingInput {
    pub(crate) installation_id: i64,
    pub(crate) kind: String,
    pub(crate) resource_id: String,
}

fn metadata_repo_full_name(org_login: &str) -> Result<String, String> {
    let normalized_org_login = org_login.trim();
    if normalized_org_login.is_empty() {
        return Err(
            "Could not determine the GitHub organization for the team-metadata repo.".to_string(),
        );
    }

    Ok(format!("{normalized_org_login}/{TEAM_METADATA_REPO_NAME}"))
}

fn expected_remote_url(org_login: &str) -> Result<String, String> {
    Ok(format!(
        "https://github.com/{}.git",
        metadata_repo_full_name(org_login)?
    ))
}

fn expected_repo_url_from_full_name(full_name: &str) -> Result<String, String> {
    let normalized = full_name.trim();
    if normalized.is_empty() {
        return Err("Could not determine the expected remote repository URL.".to_string());
    }
    Ok(format!("https://github.com/{normalized}.git"))
}

fn repo_has_git_dir(repo_path: &Path) -> bool {
    git_output(repo_path, &["rev-parse", "--git-dir"], None).is_ok()
}

fn repo_dir_is_empty(repo_path: &Path) -> Result<bool, String> {
    let mut entries = fs::read_dir(repo_path).map_err(|error| {
        format!(
            "Could not inspect the local team-metadata folder '{}': {error}",
            repo_path.display()
        )
    })?;
    Ok(entries.next().is_none())
}

fn ensure_origin_remote(repo_path: &Path, org_login: &str) -> Result<(), String> {
    let remote_url = expected_remote_url(org_login)?;
    ensure_repo_origin_remote(repo_path, &remote_url)
}

fn ensure_repo_origin_remote(repo_path: &Path, remote_url: &str) -> Result<(), String> {
    match git_output(repo_path, &["remote", "get-url", "origin"], None) {
        Ok(existing_url) => {
            if existing_url.trim() != remote_url {
                git_output(
                    repo_path,
                    &["remote", "set-url", "origin", &remote_url],
                    None,
                )?;
            }
        }
        Err(_) => {
            git_output(repo_path, &["remote", "add", "origin", &remote_url], None)?;
        }
    }
    Ok(())
}

fn current_origin_remote_url(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["remote", "get-url", "origin"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn clone_team_metadata_repo(
    repo_path: &Path,
    org_login: &str,
    git_transport_token: &str,
) -> Result<(), String> {
    let repo_parent = repo_path
        .parent()
        .ok_or_else(|| "Could not resolve the local team-metadata repo folder.".to_string())?;
    fs::create_dir_all(repo_parent).map_err(|error| {
        format!("Could not create the local team-metadata repo folder: {error}")
    })?;

    let repo_url = expected_remote_url(org_login)?;
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    let repo_path_string = repo_path.display().to_string();
    git_output(
        repo_parent,
        &["clone", repo_url.as_str(), repo_path_string.as_str()],
        Some(&git_transport_auth),
    )?;
    Ok(())
}

fn manifest_path(repo_path: &Path) -> PathBuf {
    repo_path.join("manifest.json")
}

fn resource_directory_path(repo_path: &Path, kind: &str) -> PathBuf {
    match kind {
        "project" => repo_path.join("resources").join("projects"),
        "glossary" => repo_path.join("resources").join("glossaries"),
        _ => repo_path.join("resources").join(kind),
    }
}

fn resource_record_path(repo_path: &Path, kind: &str, resource_id: &str) -> PathBuf {
    resource_directory_path(repo_path, kind).join(format!("{resource_id}.json"))
}

fn build_local_team_metadata_repo_info(
    repo_path: &Path,
    org_login: &str,
) -> Result<LocalTeamMetadataRepoInfo, String> {
    Ok(LocalTeamMetadataRepoInfo {
        repo_path: repo_path.display().to_string(),
        full_name: metadata_repo_full_name(org_login)?,
        has_manifest: manifest_path(repo_path).exists(),
        current_head_oid: read_current_head_oid(repo_path),
    })
}

fn ensure_local_repo_exists(
    app: &AppHandle,
    installation_id: i64,
    org_login: &str,
    session_token: &str,
) -> Result<PathBuf, String> {
    let repo_path = local_team_metadata_repo_path(app, installation_id)?;

    if repo_path.exists() {
        if repo_has_git_dir(&repo_path) {
            ensure_origin_remote(&repo_path, org_login)?;
            return Ok(repo_path);
        }

        if repo_dir_is_empty(&repo_path)? {
            fs::remove_dir_all(&repo_path).map_err(|error| {
                format!(
                    "Could not reset the empty local team-metadata folder '{}': {error}",
                    repo_path.display()
                )
            })?;
        } else {
            return Err(format!(
                "The local team-metadata folder '{}' exists but is not a git repo.",
                repo_path.display()
            ));
        }
    }

    let git_transport_token = load_git_transport_token(installation_id, session_token)?;
    clone_team_metadata_repo(&repo_path, org_login, &git_transport_token)?;
    ensure_origin_remote(&repo_path, org_login)?;
    Ok(repo_path)
}

fn require_local_metadata_repo(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
    let repo_path = local_team_metadata_repo_path(app, installation_id)?;
    if !repo_path.exists() || !repo_has_git_dir(&repo_path) {
        return Err(format!(
            "The local team-metadata repo for installation {installation_id} is not available yet."
        ));
    }
    if !manifest_path(&repo_path).exists() {
        return Err(format!(
            "The local team-metadata repo '{}' is missing manifest.json.",
            repo_path.display()
        ));
    }
    Ok(repo_path)
}

fn pull_local_metadata_repo(
    repo_path: &Path,
    installation_id: i64,
    session_token: &str,
) -> Result<(), String> {
    let git_transport_token = load_git_transport_token(installation_id, session_token)?;
    let git_transport_auth = GitTransportAuth::from_token(&git_transport_token)?;
    let pull_result = git_output(repo_path, &["pull", "--ff-only"], Some(&git_transport_auth));
    pull_result
        .map(|_| ())
        .map_err(|error| abort_rebase_after_failed_pull(repo_path, error))
}

fn list_local_metadata_records<T>(repo_path: &Path, kind: &str) -> Result<Vec<T>, String>
where
    T: DeserializeOwned,
{
    let directory_path = resource_directory_path(repo_path, kind);
    if !directory_path.exists() {
        return Ok(Vec::new());
    }

    let mut file_paths = fs::read_dir(&directory_path)
        .map_err(|error| {
            format!(
                "Could not list the local team-metadata {} directory '{}': {error}",
                kind,
                directory_path.display()
            )
        })?
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    file_paths.sort();

    file_paths
        .into_iter()
        .map(|path| {
            let contents = fs::read_to_string(&path).map_err(|error| {
                format!(
                    "Could not read the local team-metadata file '{}': {error}",
                    path.display()
                )
            })?;
            serde_json::from_str::<T>(&contents).map_err(|error| {
                format!(
                    "Could not parse the local team-metadata file '{}': {error}",
                    path.display()
                )
            })
        })
        .collect()
}

fn is_git_repo(path: &Path) -> bool {
    path.is_dir() && git_output(path, &["rev-parse", "--git-dir"], None).is_ok()
}

fn repo_folder_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalized_optional_text(value: Option<&str>) -> Option<String> {
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

fn local_project_chapter_count(repo_path: &Path) -> Result<usize, String> {
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

fn local_glossary_term_count(repo_path: &Path) -> Result<usize, String> {
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

fn maybe_repair_sync_state(
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

fn inspect_project_repo_repairs(
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
        resource_id: sync_state.as_ref().and_then(|state| normalized_optional_text(state.resource_id.as_deref())),
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

fn inspect_glossary_repo_repairs(
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
        resource_id: embedded_glossary_id.clone().or_else(|| sync_state.as_ref().and_then(|state| normalized_optional_text(state.resource_id.as_deref()))),
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

fn find_project_repo_for_record(
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

fn find_glossary_repo_for_record(
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

fn local_record_has_tombstone(
    repo_path: &Path,
    kind: &str,
    resource_id: &str,
) -> Result<bool, String> {
    let normalized_resource_id = resource_id.trim();
    if normalized_resource_id.is_empty() {
        return Err("Could not determine which team-metadata record to inspect.".to_string());
    }

    let record_path = resource_record_path(repo_path, kind, normalized_resource_id);
    if !record_path.exists() {
        return Ok(false);
    }

    let record_contents = fs::read_to_string(&record_path).map_err(|error| {
        format!(
            "Could not read the local team-metadata file '{}': {error}",
            record_path.display()
        )
    })?;
    let record_value: serde_json::Value =
        serde_json::from_str(&record_contents).map_err(|error| {
            format!(
                "Could not parse the local team-metadata file '{}': {error}",
                record_path.display()
            )
        })?;

    Ok(record_value
        .get("recordState")
        .and_then(|value| value.as_str())
        .map(|value| value.trim() == "tombstone")
        .unwrap_or(false))
}

fn actor_login(app: &AppHandle) -> Result<Option<String>, String> {
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

fn read_json_object(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Could not read the local team-metadata file '{}': {error}",
            path.display()
        )
    })?;
    let value = serde_json::from_str::<Value>(&contents).map_err(|error| {
        format!(
            "Could not parse the local team-metadata file '{}': {error}",
            path.display()
        )
    })?;

    match value {
        Value::Object(map) => Ok(Some(map)),
        _ => Err(format!(
            "The local team-metadata file '{}' does not contain a JSON object.",
            path.display()
        )),
    }
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

fn build_project_record_value(
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

fn build_glossary_record_value(
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
        },
    )?;
    Ok(true)
}

fn upsert_local_record(
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

fn delete_local_record(
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

fn current_branch_name(repo_path: &Path) -> String {
    git_output(repo_path, &["branch", "--show-current"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "main".to_string())
}

fn push_local_metadata_repo(
    repo_path: &Path,
    installation_id: i64,
    session_token: &str,
) -> Result<LocalTeamMetadataPushResult, String> {
    let git_transport_token = load_git_transport_token(installation_id, session_token)?;
    let git_transport_auth = GitTransportAuth::from_token(&git_transport_token)?;
    let branch_name = current_branch_name(repo_path);
    git_output(
        repo_path,
        &["push", "origin", &branch_name],
        Some(&git_transport_auth),
    )?;

    Ok(LocalTeamMetadataPushResult {
        repo_path: repo_path.display().to_string(),
        current_head_oid: read_current_head_oid(repo_path),
    })
}

#[tauri::command]
pub(crate) async fn ensure_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataRepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        build_local_team_metadata_repo_info(&repo_path, &org_login)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata bootstrap task: {error}"))?
}

#[tauri::command]
pub(crate) async fn sync_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataRepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        pull_local_metadata_repo(&repo_path, installation_id, &session_token)?;
        build_local_team_metadata_repo_info(&repo_path, &org_login)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata sync task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gnosis_project_metadata_records(
    app: AppHandle,
    installation_id: i64,
) -> Result<Vec<GithubProjectMetadataRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let mut records =
            list_local_metadata_records::<GithubProjectMetadataRecord>(&repo_path, "project")?;
        for record in &mut records {
            record.chapter_count = find_project_repo_for_record(&app, installation_id, record)
                .ok()
                .flatten()
                .and_then(|repo_path| local_project_chapter_count(&repo_path).ok())
                .unwrap_or(0);
        }
        Ok(records)
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gnosis_glossary_metadata_records(
    app: AppHandle,
    installation_id: i64,
) -> Result<Vec<GithubGlossaryMetadataRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let mut records =
            list_local_metadata_records::<GithubGlossaryMetadataRecord>(&repo_path, "glossary")?;
        for record in &mut records {
            record.term_count = find_glossary_repo_for_record(&app, installation_id, record)
                .ok()
                .flatten()
                .and_then(|repo_path| local_glossary_term_count(&repo_path).ok())
                .unwrap_or(0);
        }
        Ok(records)
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn lookup_local_team_metadata_tombstone(
    app: AppHandle,
    installation_id: i64,
    kind: String,
    resource_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized_kind = match kind.trim() {
            "project" => "project",
            "glossary" => "glossary",
            _ => {
                return Err(format!(
                    "Unsupported team-metadata resource kind '{}'.",
                    kind.trim()
                ))
            }
        };
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        local_record_has_tombstone(&repo_path, normalized_kind, &resource_id)
    })
    .await
    .map_err(|error| format!("Could not run the local tombstone lookup task: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_and_migrate_local_repo_bindings(
    app: AppHandle,
    installation_id: i64,
) -> Result<LocalRepoRepairScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let project_records =
            list_local_metadata_records::<GithubProjectMetadataRecord>(&repo_path, "project")?;
        let glossary_records =
            list_local_metadata_records::<GithubGlossaryMetadataRecord>(&repo_path, "glossary")?;

        let project_scan = inspect_project_repo_repairs(&app, installation_id, &project_records)?;
        let glossary_scan =
            inspect_glossary_repo_repairs(&app, installation_id, &glossary_records)?;

        Ok(LocalRepoRepairScanResult {
            issues: project_scan
                .issues
                .into_iter()
                .chain(glossary_scan.issues.into_iter())
                .collect(),
            auto_repaired_count: project_scan.auto_repaired_count
                + glossary_scan.auto_repaired_count,
        })
    })
    .await
    .map_err(|error| format!("Could not run the local repo repair inspection task: {error}"))?
}

#[tauri::command]
pub(crate) async fn repair_local_repo_binding(
    app: AppHandle,
    input: RepairLocalRepoBindingInput,
) -> Result<LocalRepoRepairIssue, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, input.installation_id)?;
        let normalized_kind = input.kind.trim();
        let normalized_resource_id = input.resource_id.trim();
        if normalized_resource_id.is_empty() {
            return Err("Could not determine which repo binding to repair.".to_string());
        }

        match normalized_kind {
            "project" => {
                let records = list_local_metadata_records::<GithubProjectMetadataRecord>(
                    &repo_path, "project",
                )?;
                let record = records
                    .into_iter()
                    .find(|record| record.id.trim() == normalized_resource_id)
                    .ok_or_else(|| {
                        format!(
                            "Could not find project metadata record '{}'.",
                            normalized_resource_id
                        )
                    })?;
                let local_repo_path =
                    find_project_repo_for_record(&app, input.installation_id, &record)?
                        .ok_or_else(|| {
                            "The local project repo is not available to repair.".to_string()
                        })?;
                maybe_repair_sync_state(
                    &local_repo_path,
                    "project",
                    &record.id,
                    &record.repo_name,
                    read_local_repo_sync_state(&local_repo_path)
                        .ok()
                        .flatten()
                        .as_ref(),
                )?;
                if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
                    ensure_repo_origin_remote(
                        &local_repo_path,
                        &expected_repo_url_from_full_name(&full_name)?,
                    )?;
                }
                Ok(LocalRepoRepairIssue {
                    kind: "project".to_string(),
                    issue_type: "repaired".to_string(),
                    resource_id: Some(record.id),
                    repo_name: repo_folder_name(&local_repo_path),
                    expected_repo_name: Some(record.repo_name),
                    message: "The local project repo binding was repaired from team metadata."
                        .to_string(),
                    can_auto_repair: false,
                })
            }
            "glossary" => {
                let records = list_local_metadata_records::<GithubGlossaryMetadataRecord>(
                    &repo_path, "glossary",
                )?;
                let record = records
                    .into_iter()
                    .find(|record| record.id.trim() == normalized_resource_id)
                    .ok_or_else(|| {
                        format!(
                            "Could not find glossary metadata record '{}'.",
                            normalized_resource_id
                        )
                    })?;
                let local_repo_path =
                    find_glossary_repo_for_record(&app, input.installation_id, &record)?
                        .ok_or_else(|| {
                            "The local glossary repo is not available to repair.".to_string()
                        })?;
                maybe_repair_sync_state(
                    &local_repo_path,
                    "glossary",
                    &record.id,
                    &record.repo_name,
                    read_local_repo_sync_state(&local_repo_path)
                        .ok()
                        .flatten()
                        .as_ref(),
                )?;
                if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
                    ensure_repo_origin_remote(
                        &local_repo_path,
                        &expected_repo_url_from_full_name(&full_name)?,
                    )?;
                }
                Ok(LocalRepoRepairIssue {
                    kind: "glossary".to_string(),
                    issue_type: "repaired".to_string(),
                    resource_id: Some(record.id),
                    repo_name: repo_folder_name(&local_repo_path),
                    expected_repo_name: Some(record.repo_name),
                    message: "The local glossary repo binding was repaired from team metadata."
                        .to_string(),
                    can_auto_repair: false,
                })
            }
            _ => Err(format!(
                "Unsupported team-metadata resource kind '{}'.",
                normalized_kind
            )),
        }
    })
    .await
    .map_err(|error| format!("Could not run the local repo repair task: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_local_gnosis_project_metadata_record(
    app: AppHandle,
    input: UpsertGithubProjectMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "project", &input.project_id);
        let current = read_json_object(&record_path)?;
        let actor_login = actor_login(&app)?;
        let record_value = build_project_record_value(current, &input, actor_login.as_deref())?;
        upsert_local_record(
            &app,
            &repo_path,
            &record_path,
            &record_value,
            &format!("Update project metadata record for {}", input.project_id),
            "team-metadata.project.upsert",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_local_gnosis_project_metadata_record(
    app: AppHandle,
    input: DeleteGithubProjectMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "project", &input.project_id);
        delete_local_record(
            &app,
            &repo_path,
            &record_path,
            &format!("Delete project metadata record for {}", input.project_id),
            "team-metadata.project.delete",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_local_gnosis_glossary_metadata_record(
    app: AppHandle,
    input: UpsertGithubGlossaryMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "glossary", &input.glossary_id);
        let current = read_json_object(&record_path)?;
        let actor_login = actor_login(&app)?;
        let record_value = build_glossary_record_value(current, &input, actor_login.as_deref())?;
        upsert_local_record(
            &app,
            &repo_path,
            &record_path,
            &record_value,
            &format!("Update glossary metadata record for {}", input.glossary_id),
            "team-metadata.glossary.upsert",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_local_gnosis_glossary_metadata_record(
    app: AppHandle,
    input: DeleteGithubGlossaryMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "glossary", &input.glossary_id);
        delete_local_record(
            &app,
            &repo_path,
            &record_path,
            &format!("Delete glossary metadata record for {}", input.glossary_id),
            "team-metadata.glossary.delete",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn push_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataPushResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        push_local_metadata_repo(&repo_path, installation_id, &session_token)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata push task: {error}"))?
}
