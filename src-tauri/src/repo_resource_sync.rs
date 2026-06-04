//! Shared building blocks for glossary and QA-list repo sync.
//!
//! Glossary and QA-list sync are near-mirror images (see the Batch 6 review and
//! `plans/glossary-qa-unification-plan.md`). This module is the home for the logic they
//! share, so a fix lands once instead of twice. It starts with the domain-independent
//! helpers that were byte-duplicated across `glossary_repo_sync.rs` and
//! `qa_list_repo_sync.rs`; the generic, trait-parameterized sync engine will move here in
//! subsequent phases.

use std::path::Path;

use serde::Serialize;

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

// Repo sync status strings shared by glossary and QA-list sync (single source of truth —
// previously duplicated identically in both modules).
pub(crate) const REPO_SYNC_STATUS_NOT_CLONED: &str = "notCloned";
pub(crate) const REPO_SYNC_STATUS_DIRTY_LOCAL: &str = "dirtyLocal";
pub(crate) const REPO_SYNC_STATUS_UP_TO_DATE: &str = "upToDate";
pub(crate) const REPO_SYNC_STATUS_OUT_OF_SYNC: &str = "outOfSync";
pub(crate) const REPO_SYNC_STATUS_SYNC_ERROR: &str = "syncError";
pub(crate) const REPO_SYNC_STATUS_UPDATE_REQUIRED: &str = "updateRequired";
pub(crate) const REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES: &str =
    "remoteMigratedLocalChanges";

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

/// Field-accessor bridge over the per-domain sync descriptors (glossary / QA list), which
/// are structurally identical apart from their resource-id field name. Implementing this
/// lets the shared sync logic operate on either descriptor without unifying their types or
/// changing the frontend JSON contract.
pub(crate) trait RepoSyncDescriptorLike {
    fn lifecycle_state(&self) -> Option<&str>;
    fn record_state(&self) -> Option<&str>;
    fn remote_state(&self) -> Option<&str>;
    fn status(&self) -> Option<&str>;
}

/// Whether a sync descriptor represents a deleted/missing resource (any lifecycle, record,
/// remote, or transport status flags it as deleted).
pub(crate) fn descriptor_is_deleted<D: RepoSyncDescriptorLike>(descriptor: &D) -> bool {
    repo_transport_deleted_state(descriptor.lifecycle_state())
        || repo_transport_deleted_state(descriptor.record_state())
        || repo_transport_deleted_state(descriptor.remote_state())
        || repo_transport_deleted_state(descriptor.status())
}
