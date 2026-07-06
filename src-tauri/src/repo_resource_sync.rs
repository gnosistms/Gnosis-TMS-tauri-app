//! Shared engine for glossary and QA-list repo sync.
//!
//! Glossary and QA-list sync were near-mirror images (see the Batch 6 review and
//! `plans/glossary-qa-unification-plan.md`): ~960 lines each, byte-identical apart from a
//! handful of per-domain values. This module is the single implementation they share, so a
//! fix lands once instead of twice and the two can no longer drift.
//!
//! Per-domain differences are captured by [`RepoResourceDomain`]; the descriptor/input types
//! are unified into one set of structs whose serde aliases accept either domain's existing
//! JSON keys (`glossaryId`/`qaListId`, `glossaries`/`qaLists`), so the frontend wire contract
//! is unchanged. The thin per-domain command wrappers live in `glossary_repo_sync.rs` and
//! `qa_list_repo_sync.rs`.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_app_version::{
        encode_repo_app_update_requirement, parse_repo_app_update_requirement_error,
        remote_ref_requires_newer_app,
    },
    repo_layout_metadata::{RepoKind, STORAGE_LAYOUT_VERSION_V2},
    repo_migrations::{
        discard_local_old_layout_changes_and_adopt_remote,
        is_remote_migrated_local_old_layout_changes_error, repo_requires_0810_migration,
        sync_pending_repo_layout_migration,
    },
    repo_sync_shared::{
        abort_rebase_after_failed_pull, ensure_repo_local_git_identity,
        git_error_indicates_missing_remote_ref, git_output, load_git_transport_token,
        read_current_head_oid, GitTransportAuth,
    },
    short_path_names::allocate_short_folder_name,
};

/// Per-repo sync status returned to the frontend (shared by glossary and QA-list sync).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoSyncSnapshot {
    pub(crate) repo_name: String,
    pub(crate) repo_path: String,
    pub(crate) local_head_oid: Option<String>,
    pub(crate) remote_head_oid: Option<String>,
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) required_app_version: Option<String>,
    pub(crate) current_app_version: Option<String>,
}

/// Result of an old-layout discard command (shared).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscardOldLayoutReposResponse {
    pub(crate) resolved_repo_names: Vec<String>,
    pub(crate) skipped_repo_names: Vec<String>,
}

/// Result of an editor-repo sync (shared); reports head movement and term-level changes.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorRepoSyncResponse {
    pub(crate) old_head_sha: Option<String>,
    pub(crate) new_head_sha: Option<String>,
    pub(crate) changed_term_ids: Vec<String>,
    pub(crate) inserted_term_ids: Vec<String>,
    pub(crate) deleted_term_ids: Vec<String>,
}

// Repo sync status strings shared by glossary and QA-list sync (single source of truth).
pub(crate) const REPO_SYNC_STATUS_NOT_CLONED: &str = "notCloned";
pub(crate) const REPO_SYNC_STATUS_DIRTY_LOCAL: &str = "dirtyLocal";
pub(crate) const REPO_SYNC_STATUS_UP_TO_DATE: &str = "upToDate";
pub(crate) const REPO_SYNC_STATUS_OUT_OF_SYNC: &str = "outOfSync";
pub(crate) const REPO_SYNC_STATUS_SYNC_ERROR: &str = "syncError";
pub(crate) const REPO_SYNC_STATUS_UPDATE_REQUIRED: &str = "updateRequired";
pub(crate) const REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES: &str =
    "remoteMigratedLocalChanges";

/// A repo descriptor as sent by the frontend. The same shape serves glossary and QA-list
/// sync; serde aliases accept either domain's resource-id key (`glossaryId` / `qaListId`).
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoResourceSyncDescriptor {
    #[serde(alias = "glossaryId", alias = "qaListId")]
    pub(crate) resource_id: Option<String>,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
    pub(crate) lifecycle_state: Option<String>,
    pub(crate) record_state: Option<String>,
    pub(crate) remote_state: Option<String>,
    pub(crate) status: Option<String>,
}

/// Batch sync input. The resource list accepts either domain's key (`glossaries`/`qaLists`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoResourceSyncInput {
    pub(crate) installation_id: i64,
    #[serde(alias = "glossaries", alias = "qaLists")]
    pub(crate) resources: Vec<RepoResourceSyncDescriptor>,
}

/// Editor (single-repo) sync input; carries one descriptor inline plus the installation id.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoResourceEditorSyncInput {
    pub(crate) installation_id: i64,
    #[serde(alias = "glossaryId", alias = "qaListId")]
    pub(crate) resource_id: Option<String>,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
    pub(crate) lifecycle_state: Option<String>,
    pub(crate) record_state: Option<String>,
    pub(crate) remote_state: Option<String>,
    pub(crate) status: Option<String>,
}

impl RepoResourceEditorSyncInput {
    fn to_descriptor(&self) -> RepoResourceSyncDescriptor {
        RepoResourceSyncDescriptor {
            resource_id: self.resource_id.clone(),
            repo_name: self.repo_name.clone(),
            full_name: self.full_name.clone(),
            repo_id: self.repo_id,
            default_branch_name: self.default_branch_name.clone(),
            default_branch_head_oid: self.default_branch_head_oid.clone(),
            lifecycle_state: self.lifecycle_state.clone(),
            record_state: self.record_state.clone(),
            remote_state: self.remote_state.clone(),
            status: self.status.clone(),
        }
    }
}

/// On-disk resource identity file (`glossary.json` / `qa-list.json`); both store the resource
/// id under their domain's camelCase key, accepted here via serde aliases.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalResourceIdentityFile {
    #[serde(alias = "glossaryId", alias = "qaListId")]
    resource_id: String,
}

/// The per-domain values that distinguish glossary sync from QA-list sync. Everything else in
/// this module is shared. Implemented by zero-sized marker types in each domain module.
pub(crate) trait RepoResourceDomain {
    /// Layout/migration repo kind for this resource.
    fn repo_kind(&self) -> RepoKind;
    /// On-disk identity file name (`glossary.json` / `qa-list.json`).
    fn identity_filename(&self) -> &'static str;
    /// Stable internal kind label persisted in sync state and used as the app-version
    /// resource kind (`glossary` / `qa_list`). Not user-facing.
    fn state_kind(&self) -> &'static str;
    /// User-facing noun for messages (`glossary` / `QA list`).
    fn display_noun(&self) -> &'static str;
    /// Local checkout root for this resource's repos.
    fn local_repo_root(&self, app: &AppHandle, installation_id: i64) -> Result<PathBuf, String>;
    /// Verify the GitHub App installation permits writes for this resource kind.
    fn ensure_installation_allows_writes(
        &self,
        app: &AppHandle,
        installation_id: i64,
    ) -> Result<(), String>;
}

/// Whether a transport/lifecycle state string represents a deleted/missing resource.
pub(crate) fn repo_transport_deleted_state(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "deleted" | "softdeleted" | "tombstone" | "missing"
            )
        })
        .unwrap_or(false)
}

/// Extract a term id from a repo-relative term file path (e.g. `terms/<id>.json` -> `<id>`).
pub(crate) fn term_id_from_repo_relative_path(path: &str) -> Option<String> {
    let normalized = path.trim();
    if !normalized.ends_with(".json") {
        return None;
    }

    Path::new(normalized)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Trim an optional identifier, returning `None` when it is missing or blank.
pub(crate) fn normalized_optional_identifier(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Whether a sync descriptor represents a deleted/missing resource.
pub(crate) fn descriptor_is_deleted(descriptor: &RepoResourceSyncDescriptor) -> bool {
    repo_transport_deleted_state(descriptor.lifecycle_state.as_deref())
        || repo_transport_deleted_state(descriptor.record_state.as_deref())
        || repo_transport_deleted_state(descriptor.remote_state.as_deref())
        || repo_transport_deleted_state(descriptor.status.as_deref())
}

pub(crate) fn sync_repos(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    input: RepoResourceSyncInput,
    session_token: &str,
) -> Result<Vec<RepoSyncSnapshot>, String> {
    let needs_transport = input.resources.iter().any(|resource| {
        let repo_path = resolve_or_desired_git_repo_path(
            domain,
            app,
            input.installation_id,
            resource.resource_id.as_deref(),
            &resource.repo_name,
        )
        .unwrap_or_else(|_| {
            domain
                .local_repo_root(app, input.installation_id)
                .unwrap_or_else(|_| Path::new("").to_path_buf())
                .join(&resource.repo_name)
        });
        matches!(
            inspect_repo_state(domain, resource, &repo_path)
                .status
                .as_str(),
            REPO_SYNC_STATUS_NOT_CLONED | REPO_SYNC_STATUS_OUT_OF_SYNC
        )
    });
    let git_transport_token = if needs_transport {
        Some(load_git_transport_token(
            input.installation_id,
            session_token,
        )?)
    } else {
        None
    };

    let mut snapshots = Vec::with_capacity(input.resources.len());
    for resource in input.resources {
        let repo_path = resolve_or_desired_git_repo_path(
            domain,
            app,
            input.installation_id,
            resource.resource_id.as_deref(),
            &resource.repo_name,
        )?;
        let inspected = inspect_repo_state(domain, &resource, &repo_path);

        if matches!(
            inspected.status.as_str(),
            REPO_SYNC_STATUS_NOT_CLONED | REPO_SYNC_STATUS_OUT_OF_SYNC
        ) {
            let sync_result = sync_repo(
                domain,
                app,
                &resource,
                &repo_path,
                inspected.remote_head_oid.as_deref().unwrap_or_default(),
                git_transport_token.as_deref().unwrap_or_default(),
            );

            snapshots.push(match sync_result {
                Ok(local_head_oid) => RepoSyncSnapshot {
                    repo_name: resource.repo_name.clone(),
                    repo_path: repo_path.display().to_string(),
                    local_head_oid: local_head_oid.clone(),
                    remote_head_oid: local_head_oid,
                    status: REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
                    message: None,
                    required_app_version: None,
                    current_app_version: None,
                },
                Err(error) => snapshot_from_sync_error(domain, &resource, &repo_path, error),
            });
            continue;
        }

        snapshots.push(inspected);
    }

    Ok(snapshots)
}

pub(crate) fn sync_editor_repo(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    input: RepoResourceEditorSyncInput,
    session_token: &str,
) -> Result<EditorRepoSyncResponse, String> {
    let resource = input.to_descriptor();
    let repo_path = resolve_or_desired_git_repo_path(
        domain,
        app,
        input.installation_id,
        input.resource_id.as_deref(),
        &input.repo_name,
    )?;
    let old_head_sha = read_current_head_oid(&repo_path);
    if descriptor_is_deleted(&resource) {
        return Ok(EditorRepoSyncResponse {
            old_head_sha: old_head_sha.clone(),
            new_head_sha: old_head_sha,
            changed_term_ids: Vec::new(),
            inserted_term_ids: Vec::new(),
            deleted_term_ids: Vec::new(),
        });
    }
    let git_status = git_output(&repo_path, &["status", "--porcelain"], None)?;
    if !git_status.trim().is_empty() {
        return Err("Local repo has uncommitted changes.".to_string());
    }

    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let new_head_sha = sync_repo(
        domain,
        app,
        &resource,
        &repo_path,
        input.default_branch_head_oid.as_deref().unwrap_or_default(),
        &git_transport_token,
    )?;
    let terms_path = repo_path.join("terms");
    let terms_relative_path = terms_path
        .strip_prefix(&repo_path)
        .map_err(|error| {
            format!(
                "Could not resolve the {} terms path for git: {error}",
                domain.display_noun()
            )
        })?
        .to_string_lossy()
        .to_string();
    let (changed_term_ids, inserted_term_ids, deleted_term_ids) =
        match (old_head_sha.as_deref(), new_head_sha.as_deref()) {
            (Some(old_head), Some(new_head)) if old_head != new_head => {
                term_changes_between_commits(&repo_path, &terms_relative_path, old_head, new_head)?
            }
            _ => (Vec::new(), Vec::new(), Vec::new()),
        };

    Ok(EditorRepoSyncResponse {
        old_head_sha,
        new_head_sha,
        changed_term_ids,
        inserted_term_ids,
        deleted_term_ids,
    })
}

pub(crate) fn discard_old_layout_repos(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    input: RepoResourceSyncInput,
    session_token: &str,
) -> Result<DiscardOldLayoutReposResponse, String> {
    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let git_transport_auth = GitTransportAuth::from_token(&git_transport_token)?;
    let mut resolved_repo_names = Vec::new();
    let mut skipped_repo_names = Vec::new();

    for resource in input.resources {
        let repo_path = resolve_or_desired_git_repo_path(
            domain,
            app,
            input.installation_id,
            resource.resource_id.as_deref(),
            &resource.repo_name,
        )?;
        // Skip only repos that verifiably finished the layout migration —
        // unreadable metadata is one of the states this discard heals.
        if !repo_path.exists()
            || git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err()
            || matches!(repo_requires_0810_migration(&repo_path), Ok(false))
        {
            skipped_repo_names.push(resource.repo_name.clone());
            continue;
        }

        domain.ensure_installation_allows_writes(app, input.installation_id)?;
        ensure_origin_remote(domain, &resource, &repo_path)?;
        ensure_repo_local_git_identity(app, &repo_path)?;

        let branch_name = resource
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("main");
        git_output(
            &repo_path,
            &["fetch", "origin", branch_name],
            Some(&git_transport_auth),
        )?;
        let remote_tracking_ref = format!("origin/{branch_name}");
        discard_local_old_layout_changes_and_adopt_remote(
            &repo_path,
            branch_name,
            &remote_tracking_ref,
        )?;
        mark_repo_synced(domain, &resource, &repo_path)?;
        resolved_repo_names.push(resource.repo_name);
    }

    Ok(DiscardOldLayoutReposResponse {
        resolved_repo_names,
        skipped_repo_names,
    })
}

#[allow(clippy::type_complexity)]
fn term_changes_between_commits(
    repo_path: &Path,
    terms_relative_path: &str,
    old_head_sha: &str,
    new_head_sha: &str,
) -> Result<(Vec<String>, Vec<String>, Vec<String>), String> {
    let diff_output = git_output(
        repo_path,
        &[
            "diff",
            "--name-status",
            old_head_sha,
            new_head_sha,
            "--",
            terms_relative_path,
        ],
        None,
    )?;
    let mut changed_term_ids = Vec::new();
    let mut inserted_term_ids = Vec::new();
    let mut deleted_term_ids = Vec::new();

    for line in diff_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split('\t');
        let status = parts.next().unwrap_or_default().trim();
        match status.chars().next() {
            Some('A') => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    inserted_term_ids.push(term_id);
                }
            }
            Some('D') => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    deleted_term_ids.push(term_id);
                }
            }
            Some('R') => {
                let before_path = parts.next().unwrap_or_default();
                let after_path = parts.next().unwrap_or_default();
                if let Some(term_id) = term_id_from_repo_relative_path(before_path) {
                    deleted_term_ids.push(term_id);
                }
                if let Some(term_id) = term_id_from_repo_relative_path(after_path) {
                    inserted_term_ids.push(term_id);
                }
            }
            Some(_) => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    changed_term_ids.push(term_id);
                }
            }
            None => {}
        }
    }

    changed_term_ids.sort();
    changed_term_ids.dedup();
    inserted_term_ids.sort();
    inserted_term_ids.dedup();
    deleted_term_ids.sort();
    deleted_term_ids.dedup();

    Ok((changed_term_ids, inserted_term_ids, deleted_term_ids))
}

pub(crate) fn snapshot_from_sync_error(
    domain: &dyn RepoResourceDomain,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
    error: String,
) -> RepoSyncSnapshot {
    if is_remote_migrated_local_old_layout_changes_error(&error) {
        return RepoSyncSnapshot {
            message: Some(format!(
                "The server has migrated this {} to a new data format, but this computer still has old-format local changes.",
                domain.display_noun()
            )),
            status: REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES.to_string(),
            ..inspect_repo_state(domain, resource, repo_path)
        };
    }

    if let Some(requirement) = parse_repo_app_update_requirement_error(&error) {
        return RepoSyncSnapshot {
            repo_name: resource.repo_name.clone(),
            repo_path: repo_path.display().to_string(),
            local_head_oid: read_current_head_oid(repo_path),
            remote_head_oid: resource.default_branch_head_oid.clone(),
            status: REPO_SYNC_STATUS_UPDATE_REQUIRED.to_string(),
            message: Some(requirement.message),
            required_app_version: Some(requirement.required_version),
            current_app_version: Some(requirement.current_version),
        };
    }

    RepoSyncSnapshot {
        message: Some(error),
        status: REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        ..inspect_repo_state(domain, resource, repo_path)
    }
}

pub(crate) fn inspect_repo_state(
    domain: &dyn RepoResourceDomain,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
) -> RepoSyncSnapshot {
    let default_snapshot = || RepoSyncSnapshot {
        repo_name: resource.repo_name.clone(),
        repo_path: repo_path.display().to_string(),
        local_head_oid: None,
        remote_head_oid: resource.default_branch_head_oid.clone(),
        status: REPO_SYNC_STATUS_NOT_CLONED.to_string(),
        message: None,
        required_app_version: None,
        current_app_version: None,
    };

    if descriptor_is_deleted(resource) {
        return RepoSyncSnapshot {
            local_head_oid: read_current_head_oid(repo_path),
            status: REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
            message: Some(format!(
                "Skipped because this {} is deleted.",
                domain.display_noun()
            )),
            ..default_snapshot()
        };
    }

    if !repo_path.exists() {
        return default_snapshot();
    }

    if git_output(repo_path, &["rev-parse", "--git-dir"], None).is_err() {
        return default_snapshot();
    }

    let local_head_oid = read_current_head_oid(repo_path);
    let dirty = match git_output(repo_path, &["status", "--porcelain"], None) {
        Ok(value) => !value.trim().is_empty(),
        Err(error) => {
            return RepoSyncSnapshot {
                status: REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
                message: Some(error),
                local_head_oid,
                ..default_snapshot()
            };
        }
    };

    if dirty {
        return RepoSyncSnapshot {
            local_head_oid,
            status: REPO_SYNC_STATUS_DIRTY_LOCAL.to_string(),
            message: Some("Local repo has uncommitted changes.".to_string()),
            ..default_snapshot()
        };
    }

    let remote_head_oid = resource.default_branch_head_oid.clone();
    let status = if remote_head_oid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        if local_head_oid.is_some() {
            REPO_SYNC_STATUS_OUT_OF_SYNC
        } else {
            REPO_SYNC_STATUS_UP_TO_DATE
        }
    } else if local_head_oid.as_deref() == remote_head_oid.as_deref() {
        REPO_SYNC_STATUS_UP_TO_DATE
    } else {
        REPO_SYNC_STATUS_OUT_OF_SYNC
    };
    let status = match repo_requires_0810_migration(repo_path) {
        Ok(true) => REPO_SYNC_STATUS_OUT_OF_SYNC,
        Ok(false) => status,
        Err(error) => {
            return RepoSyncSnapshot {
                local_head_oid,
                remote_head_oid,
                status: REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
                message: Some(error),
                ..default_snapshot()
            };
        }
    };

    RepoSyncSnapshot {
        local_head_oid,
        remote_head_oid,
        status: status.to_string(),
        ..default_snapshot()
    }
}

fn repo_matches_identifier(
    repo_path: &Path,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_resource_id = normalized_optional_identifier(resource_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(resource_id) = normalized_resource_id.as_deref() {
        if let Some(state_resource_id) = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return state_resource_id == resource_id;
        }
    }

    if let Some(repo_name) = normalized_repo_name.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.current_repo_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(repo_name)
        {
            return true;
        }

        let folder_name = repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .unwrap_or_default();
        return folder_name == repo_name;
    }

    false
}

pub(crate) fn find_repo_path(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let repo_root = domain.local_repo_root(app, installation_id)?;
    for entry in fs::read_dir(&repo_root).map_err(|error| {
        format!(
            "Could not read the local {} repo folder: {error}",
            domain.display_noun()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read a {} repo entry: {error}",
                domain.display_noun()
            )
        })?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
            continue;
        }
        if repo_matches_identifier(&repo_path, resource_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

fn resolve_or_desired_git_repo_path(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: &str,
) -> Result<PathBuf, String> {
    match find_repo_path(domain, app, installation_id, resource_id, Some(repo_name))? {
        Some(repo_path) => Ok(repo_path),
        None => {
            let repo_root = domain.local_repo_root(app, installation_id)?;
            Ok(repo_root.join(allocate_short_folder_name(
                repo_name.trim(),
                local_folder_names(domain, &repo_root)?,
            )))
        }
    }
}

fn local_folder_names(
    domain: &dyn RepoResourceDomain,
    repo_root: &Path,
) -> Result<Vec<String>, String> {
    if !repo_root.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(repo_root)
        .map_err(|error| {
            format!(
                "Could not read local {} repo folders: {error}",
                domain.display_noun()
            )
        })?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

fn sync_repo(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    if descriptor_is_deleted(resource) {
        return Ok(read_current_head_oid(repo_path));
    }

    if !repo_path.exists() {
        return clone_repo(
            domain,
            app,
            resource,
            repo_path,
            remote_head_oid,
            git_transport_token,
        );
    }

    ensure_origin_remote(domain, resource, repo_path)?;
    ensure_repo_local_git_identity(app, repo_path)?;

    let branch_name = resource
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    let local_head_oid = read_current_head_oid(repo_path);
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    enforce_remote_app_version(
        domain,
        repo_path,
        resource,
        branch_name,
        &git_transport_auth,
    )?;
    if repo_requires_0810_migration(repo_path)? {
        sync_pending_repo_layout_migration(
            app,
            repo_path,
            domain.repo_kind(),
            branch_name,
            remote_head_oid,
        )?;
    }

    if remote_head_oid.trim().is_empty() {
        if local_head_oid.is_some() {
            git_output(
                repo_path,
                &["push", "-u", "origin", branch_name],
                Some(&git_transport_auth),
            )?;
        }
        let current_head_oid = read_current_head_oid(repo_path);
        mark_repo_synced(domain, resource, repo_path)?;
        return Ok(current_head_oid);
    }

    if let Err(error) = git_output(
        repo_path,
        &["pull", "--rebase", "origin", branch_name],
        Some(&git_transport_auth),
    ) {
        return Err(abort_rebase_after_failed_pull(repo_path, error));
    }
    git_output(
        repo_path,
        &["push", "origin", branch_name],
        Some(&git_transport_auth),
    )?;
    let current_head_oid = read_current_head_oid(repo_path);
    mark_repo_synced(domain, resource, repo_path)?;
    Ok(current_head_oid)
}

fn ensure_origin_remote(
    domain: &dyn RepoResourceDomain,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    let full_name = resource.full_name.trim();
    if full_name.is_empty() {
        return Err(format!(
            "Could not determine the remote {} repository.",
            domain.display_noun()
        ));
    }

    let remote_url = format!("https://github.com/{full_name}.git");
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

fn clone_repo(
    domain: &dyn RepoResourceDomain,
    app: &AppHandle,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    let repo_parent = repo_path.parent().ok_or_else(|| {
        format!(
            "Could not resolve the local {} repo folder.",
            domain.display_noun()
        )
    })?;
    fs::create_dir_all(repo_parent).map_err(|error| {
        format!(
            "Could not create the local {} repo folder: {error}",
            domain.display_noun()
        )
    })?;

    let repo_url = format!("https://github.com/{}.git", resource.full_name);
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    let mut clone_args = vec!["clone"];
    if !remote_head_oid.trim().is_empty() {
        if let Some(branch_name) = resource
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            clone_args.extend(["--branch", branch_name, "--single-branch"]);
        }
    }
    clone_args.push(repo_url.as_str());
    let repo_path_string = repo_path.display().to_string();
    clone_args.push(repo_path_string.as_str());
    git_output(repo_parent, &clone_args, Some(&git_transport_auth))?;
    ensure_repo_local_git_identity(app, repo_path)?;
    let branch_name = resource
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    enforce_remote_app_version(
        domain,
        repo_path,
        resource,
        branch_name,
        &git_transport_auth,
    )?;
    if repo_requires_0810_migration(repo_path)? {
        sync_pending_repo_layout_migration(
            app,
            repo_path,
            domain.repo_kind(),
            branch_name,
            remote_head_oid,
        )?;
        if !remote_head_oid.trim().is_empty() {
            git_output(
                repo_path,
                &["push", "origin", branch_name],
                Some(&git_transport_auth),
            )?;
        }
    }

    if remote_head_oid.trim().is_empty() {
        let _ = git_output(repo_path, &["checkout", "-B", branch_name], None);
    }

    let current_head_oid = read_current_head_oid(repo_path);
    mark_repo_synced(domain, resource, repo_path)?;
    Ok(current_head_oid)
}

fn enforce_remote_app_version(
    domain: &dyn RepoResourceDomain,
    repo_path: &Path,
    resource: &RepoResourceSyncDescriptor,
    branch_name: &str,
    git_transport_auth: &GitTransportAuth,
) -> Result<(), String> {
    match git_output(
        repo_path,
        &["fetch", "origin", branch_name],
        Some(git_transport_auth),
    ) {
        Ok(_) => {}
        Err(error) if git_error_indicates_missing_remote_ref(&error) => return Ok(()),
        Err(error) => return Err(error),
    }
    let remote_tracking_ref = format!("origin/{branch_name}");
    let resource_name = if resource.repo_name.trim().is_empty() {
        resource.resource_id.as_deref().unwrap_or_default().trim()
    } else {
        resource.repo_name.trim()
    };
    if let Some(requirement) = remote_ref_requires_newer_app(
        repo_path,
        &remote_tracking_ref,
        domain.state_kind(),
        resource_name,
    )? {
        return Err(encode_repo_app_update_requirement(&requirement));
    }
    Ok(())
}

fn mark_repo_synced(
    domain: &dyn RepoResourceDomain,
    resource: &RepoResourceSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    let resource_id = fs::read(repo_path.join(domain.identity_filename()))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LocalResourceIdentityFile>(&bytes).ok())
        .map(|file| file.resource_id)
        .filter(|value| !value.trim().is_empty());

    upsert_local_repo_sync_state(
        repo_path,
        LocalRepoSyncStateUpdate {
            resource_id,
            current_repo_name: Some(resource.repo_name.clone()),
            kind: Some(domain.state_kind().to_string()),
            has_ever_synced: Some(true),
            last_known_github_repo_id: resource.repo_id,
            last_known_full_name: Some(resource.full_name.clone()),
            touch_success_timestamp: true,
            storage_layout_version: Some(STORAGE_LAYOUT_VERSION_V2),
            local_folder_name: repo_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string),
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        snapshot_from_sync_error, RepoKind, RepoResourceDomain, RepoResourceSyncDescriptor,
        REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES, REPO_SYNC_STATUS_UPDATE_REQUIRED,
    };
    use crate::repo_app_version::{encode_repo_app_update_requirement, RepoAppUpdateRequirement};
    use crate::repo_migrations::REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE;
    use std::path::{Path, PathBuf};
    use tauri::AppHandle;

    /// Minimal domain stub for tests that only exercise descriptor-driven logic.
    struct TestDomain;
    impl RepoResourceDomain for TestDomain {
        fn repo_kind(&self) -> RepoKind {
            RepoKind::Glossary
        }
        fn identity_filename(&self) -> &'static str {
            "glossary.json"
        }
        fn state_kind(&self) -> &'static str {
            "glossary"
        }
        fn display_noun(&self) -> &'static str {
            "glossary"
        }
        fn local_repo_root(
            &self,
            _app: &AppHandle,
            _installation_id: i64,
        ) -> Result<PathBuf, String> {
            Err("not used in tests".to_string())
        }
        fn ensure_installation_allows_writes(
            &self,
            _app: &AppHandle,
            _installation_id: i64,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    fn descriptor() -> RepoResourceSyncDescriptor {
        RepoResourceSyncDescriptor {
            resource_id: Some("resource-1".to_string()),
            repo_name: "resource-repo".to_string(),
            full_name: "org/resource-repo".to_string(),
            repo_id: None,
            default_branch_name: Some("main".to_string()),
            default_branch_head_oid: Some("remote-head".to_string()),
            lifecycle_state: None,
            record_state: None,
            remote_state: None,
            status: None,
        }
    }

    #[test]
    fn sync_error_promotes_update_required_payload_to_snapshot_status() {
        let error = encode_repo_app_update_requirement(&RepoAppUpdateRequirement {
            required_version: "0.1.36".to_string(),
            current_version: "0.1.35".to_string(),
            resource_kind: "glossary".to_string(),
            resource_name: "resource-repo".to_string(),
            message: "Update required.".to_string(),
        });

        let snapshot =
            snapshot_from_sync_error(&TestDomain, &descriptor(), Path::new("/tmp/repo"), error);

        assert_eq!(snapshot.status, REPO_SYNC_STATUS_UPDATE_REQUIRED);
        assert_eq!(snapshot.required_app_version.as_deref(), Some("0.1.36"));
        assert_eq!(snapshot.current_app_version.as_deref(), Some("0.1.35"));
        assert_eq!(snapshot.message.as_deref(), Some("Update required."));
    }

    #[test]
    fn sync_error_hides_remote_migrated_old_layout_marker() {
        let snapshot = snapshot_from_sync_error(
            &TestDomain,
            &descriptor(),
            Path::new("/tmp/repo"),
            REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE.to_string(),
        );

        assert_eq!(
            snapshot.status,
            REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES
        );
        assert!(snapshot
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("new data format"));
        assert!(!snapshot
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES"));
    }

    #[test]
    fn old_layout_discard_keeps_backend_write_access_guard() {
        let source = include_str!("repo_resource_sync.rs");
        let discard_start = source
            .find("fn discard_old_layout_repos")
            .expect("discard function exists");
        let changes_start = source
            .find("fn term_changes_between_commits")
            .expect("next function exists");
        let discard_body = &source[discard_start..changes_start];
        let guard = "domain.ensure_installation_allows_writes(app, input.installation_id)?;";
        let destructive_call = "discard_local_old_layout_changes_and_adopt_remote";
        let guard_index = discard_body
            .find(guard)
            .expect("old-layout discard must verify resource write access");
        let destructive_index = discard_body
            .find(destructive_call)
            .expect("old-layout discard still calls destructive adoption");

        assert!(
            guard_index < destructive_index,
            "resource write access must be verified before destructive adoption"
        );
    }

    #[test]
    fn domain_markers_carry_distinct_per_resource_values() {
        use crate::glossary_repo_sync::GlossaryDomain;
        use crate::qa_list_repo_sync::QaListDomain;

        assert_eq!(GlossaryDomain.identity_filename(), "glossary.json");
        assert_eq!(GlossaryDomain.state_kind(), "glossary");
        assert_eq!(GlossaryDomain.display_noun(), "glossary");

        assert_eq!(QaListDomain.identity_filename(), "qa-list.json");
        assert_eq!(QaListDomain.state_kind(), "qa_list");
        assert_eq!(QaListDomain.display_noun(), "QA list");
    }
}
