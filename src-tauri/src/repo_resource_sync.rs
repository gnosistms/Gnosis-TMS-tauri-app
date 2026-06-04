//! Shared building blocks for glossary and QA-list repo sync.
//!
//! Glossary and QA-list sync are near-mirror images (see the Batch 6 review and
//! `plans/glossary-qa-unification-plan.md`). This module is the home for the logic they
//! share, so a fix lands once instead of twice. It starts with the domain-independent
//! helpers that were byte-duplicated across `glossary_repo_sync.rs` and
//! `qa_list_repo_sync.rs`; the generic, trait-parameterized sync engine will move here in
//! subsequent phases.

use std::path::Path;

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
