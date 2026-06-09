//! Shared storage scaffolding for glossary and QA-list repos.
//!
//! Glossary and QA-list storage (`glossary_storage/mod.rs`, `qa_list_storage/mod.rs`) are
//! ~67% identical: low-level I/O, local-repo path/identity resolution, and lifecycle
//! plumbing (rename / soft-delete / restore / purge / prepare / term-rollback) are the same
//! apart from per-domain values. That shared two-thirds lives here so a fix lands once and the
//! parity rule no longer applies to it.
//!
//! The remaining one-third — the bilingual (glossary) vs monolingual (QA list) **term model**:
//! the `Stored*TermFile` types, `map_term_record`, term-write logic, language setup, summary
//! shapes, and TMX — stays in each domain module. The per-domain values the shared code needs
//! are supplied through [`RepoResourceStorageDomain`].

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    git_commit::git_commit_as_signed_in_user,
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_sync_shared::{format_git_spawn_error, git_command},
    short_path_names::allocate_short_folder_name,
    util::atomic_replace,
};

const GITATTRIBUTES: &str = "* text=auto eol=lf\n";

/// Per-domain values the shared storage scaffolding needs to operate on either a glossary or a
/// QA-list repo. Everything term-model-specific stays in the domain module. Implemented by a
/// zero-sized marker type in each (`GlossaryStorageDomain` / `QaListStorageDomain`).
pub(crate) trait RepoResourceStorageDomain {
    /// On-disk resource file name (`glossary.json` / `qa-list.json`).
    fn resource_file_name(&self) -> &'static str;
    /// Stable internal kind label persisted in local sync state (`glossary` / `qa_list`).
    fn state_kind(&self) -> &'static str;
    /// User-facing noun for messages (`glossary` / `QA list`).
    fn display_noun(&self) -> &'static str;
    /// Local checkout root for this resource's repos.
    fn local_repo_root(&self, app: &AppHandle, installation_id: i64) -> Result<PathBuf, String>;
    /// Read the resource id from the on-disk resource file, or `None` if it can't be read.
    fn read_resource_id(&self, repo_path: &Path) -> Option<String>;
}

/// Trim an optional identifier, returning `None` when it is missing or blank.
pub(crate) fn normalized_optional_identifier(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Whether the repo at `repo_path` matches the given resource id (preferred) or repo name.
pub(crate) fn repo_matches_identifier(
    domain: &dyn RepoResourceStorageDomain,
    repo_path: &Path,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_resource_id = normalized_optional_identifier(resource_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(resource_id) = normalized_resource_id.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(resource_id)
        {
            return true;
        }

        return match domain.read_resource_id(repo_path) {
            Some(file_resource_id) => file_resource_id.trim() == resource_id,
            None => false,
        };
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

/// Find the local checkout for a resource by id (preferred) or repo name.
pub(crate) fn find_repo_path(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let repo_root = domain.local_repo_root(app, installation_id)?;
    if !repo_root.exists() {
        return Ok(None);
    }

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
        if !repo_path.is_dir() || !repo_path.join(domain.resource_file_name()).exists() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
            continue;
        }
        if repo_matches_identifier(domain, &repo_path, resource_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

/// Resolve the git checkout for a resource, falling back to `<root>/<repo_name>` if it exists
/// and matches. Errors if no matching local repo is available.
pub(crate) fn resolve_git_repo_path(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(repo_path) = find_repo_path(domain, app, installation_id, resource_id, repo_name)? {
        return Ok(repo_path);
    }

    if let Some(repo_name) = normalized_optional_identifier(repo_name) {
        let repo_root = domain.local_repo_root(app, installation_id)?;
        let repo_path = repo_root.join(&repo_name);
        if repo_path.exists() {
            if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
                return Err(format!(
                    "The local {} repo is missing or invalid.",
                    domain.display_noun()
                ));
            }
            if repo_matches_identifier(domain, &repo_path, resource_id, Some(&repo_name)) {
                return Ok(repo_path);
            }
        }
    }

    Err(format!(
        "The local {} repo is not available yet.",
        domain.display_noun()
    ))
}

/// Like [`resolve_git_repo_path`], but additionally requires the resource file to exist
/// (i.e. the repo is initialized).
pub(crate) fn resolve_initialized_repo_path(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    let repo_path = resolve_git_repo_path(domain, app, installation_id, resource_id, repo_name)?;
    if !repo_path.join(domain.resource_file_name()).exists() {
        return Err(format!(
            "The local {} repo is missing {}.",
            domain.display_noun(),
            domain.resource_file_name()
        ));
    }
    Ok(repo_path)
}

/// The desired local folder path for a (possibly not-yet-created) resource repo.
pub(crate) fn desired_git_repo_path(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    repo_name: &str,
) -> Result<PathBuf, String> {
    let normalized_repo_name = repo_name.trim();
    if normalized_repo_name.is_empty() {
        return Err(format!(
            "Could not determine which {} repo to use.",
            domain.display_noun()
        ));
    }

    let repo_root = domain.local_repo_root(app, installation_id)?;
    Ok(repo_root.join(allocate_short_folder_name(
        normalized_repo_name,
        local_folder_names(domain, &repo_root)?,
    )))
}

/// The folder names directly under the resource repo root.
pub(crate) fn local_folder_names(
    domain: &dyn RepoResourceStorageDomain,
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

/// Read the resource file (`glossary.json` / `qa-list.json`) as a raw JSON value.
pub(crate) fn read_resource_value(
    domain: &dyn RepoResourceStorageDomain,
    repo_path: &Path,
) -> Result<Value, String> {
    read_json_file(
        &repo_path.join(domain.resource_file_name()),
        domain.resource_file_name(),
    )
}

/// Set the resource title and commit. No-op (no commit) if the title is unchanged.
pub(crate) fn write_resource_title(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    repo_path: &Path,
    next_title: &str,
) -> Result<(), String> {
    let mut value = read_resource_value(domain, repo_path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| format!("{} is not a JSON object.", domain.resource_file_name()))?;
    let current_title = object
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if current_title == next_title {
        return Ok(());
    }

    object.insert("title".to_string(), Value::String(next_title.to_string()));
    let file_name = domain.resource_file_name();
    write_json_pretty(&repo_path.join(file_name), &value)?;
    git_output(repo_path, &["add", file_name])?;
    git_commit_as_signed_in_user(
        app,
        repo_path,
        &format!("Rename {}", domain.display_noun()),
        &[file_name],
    )?;
    Ok(())
}

/// Set the resource lifecycle state and commit. No-op (no commit) if already in `next_state`.
pub(crate) fn write_resource_lifecycle(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    repo_path: &Path,
    next_state: &str,
) -> Result<(), String> {
    let mut value = read_resource_value(domain, repo_path)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| format!("{} is not a JSON object.", domain.resource_file_name()))?;
    let lifecycle_value = object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value.as_object_mut().ok_or_else(|| {
        format!(
            "The {} lifecycle is not a JSON object.",
            domain.display_noun()
        )
    })?;
    let current_state = lifecycle_object
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("active");
    if current_state == next_state {
        return Ok(());
    }

    lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
    let file_name = domain.resource_file_name();
    write_json_pretty(&repo_path.join(file_name), &value)?;
    git_output(repo_path, &["add", file_name])?;
    let commit_message = if next_state == "deleted" {
        format!("Mark {} deleted", domain.display_noun())
    } else {
        format!("Restore {}", domain.display_noun())
    };
    git_commit_as_signed_in_user(app, repo_path, &commit_message, &[file_name])?;
    Ok(())
}

/// Remove the local checkout for a resource (no-op if it does not exist).
///
/// Purge is a cleanup/rollback operation, so an absent local repo is already the
/// desired end state and must succeed, not error. This deliberately does NOT use
/// [`resolve_git_repo_path`]: that helper errors with "not available yet" before its
/// own `exists()` guard can run, which turned never-created (or already-purged) repos
/// into failed commands — and, on rollback paths, masked the original failure.
pub(crate) fn purge_repo(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<(), String> {
    let Some(repo_path) =
        find_purgeable_repo_path(domain, app, installation_id, resource_id, repo_name)?
    else {
        return Ok(());
    };

    fs::remove_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not remove the local {} repo '{}': {error}",
            domain.display_noun(),
            repo_path.display()
        )
    })
}

/// Locate the local checkout to purge, or `None` when there is nothing to remove.
///
/// Mirrors [`resolve_git_repo_path`]'s resolution (id-based discovery, then the
/// `<root>/<repo_name>` fallback) but never errors: a missing root, an unmatched
/// resource, or a non-git directory at the fallback path all resolve to `None`. A
/// non-git directory is intentionally left untouched rather than removed, so purge
/// can never delete a folder it does not recognize as this resource's repo.
fn find_purgeable_repo_path(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if let Some(repo_path) = find_repo_path(domain, app, installation_id, resource_id, repo_name)? {
        return Ok(Some(repo_path));
    }

    if let Some(repo_name) = normalized_optional_identifier(repo_name) {
        let repo_root = domain.local_repo_root(app, installation_id)?;
        let repo_path = repo_root.join(&repo_name);
        if repo_path.exists()
            && git_output(&repo_path, &["rev-parse", "--git-dir"]).is_ok()
            && repo_matches_identifier(domain, &repo_path, resource_id, Some(&repo_name))
        {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

/// Create (and minimally configure) a local checkout for a resource repo: init if needed,
/// record sync state, checkout the branch, and wire the origin remote when provided.
pub(crate) fn prepare_repo(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: &str,
    remote_url: Option<&str>,
    default_branch_name: Option<&str>,
) -> Result<(), String> {
    let repo_path = desired_git_repo_path(domain, app, installation_id, repo_name)?;
    fs::create_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not create the local {} repo '{}': {error}",
            domain.display_noun(),
            repo_path.display()
        )
    })?;

    let branch_name = default_branch_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
        git_output(&repo_path, &["init", "--initial-branch", branch_name])?;
    }

    let _ = upsert_local_repo_sync_state(
        &repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: normalized_optional_identifier(resource_id),
            current_repo_name: Some(repo_name.to_string()),
            kind: Some(domain.state_kind().to_string()),
            ..Default::default()
        },
    );

    let _ = git_output(&repo_path, &["checkout", "-B", branch_name]);

    if let Some(remote_url) = remote_url.map(str::trim).filter(|value| !value.is_empty()) {
        match git_output(&repo_path, &["remote", "get-url", "origin"]) {
            Ok(existing_url) => {
                if existing_url.trim() != remote_url {
                    git_output(&repo_path, &["remote", "set-url", "origin", remote_url])?;
                }
            }
            Err(_) => {
                git_output(&repo_path, &["remote", "add", "origin", remote_url])?;
            }
        }
    }

    Ok(())
}

/// Hard-reset the resource repo to a prior head (undo a term upsert).
pub(crate) fn rollback_term_upsert(
    domain: &dyn RepoResourceStorageDomain,
    app: &AppHandle,
    installation_id: i64,
    resource_id: Option<&str>,
    repo_name: Option<&str>,
    previous_head_sha: &str,
) -> Result<(), String> {
    let repo_path =
        resolve_initialized_repo_path(domain, app, installation_id, resource_id, repo_name)?;
    let previous_head_sha = previous_head_sha.trim();
    if previous_head_sha.is_empty() {
        return Err(format!(
            "The previous {} repo head is missing.",
            domain.display_noun()
        ));
    }

    git_output(&repo_path, &["reset", "--hard", previous_head_sha])?;
    Ok(())
}

pub(crate) fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

pub(crate) fn ensure_gitattributes(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    write_text_file(path, GITATTRIBUTES)
}

pub(crate) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command()?
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format_git_spawn_error(args, &error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        return Err(format!("git {} failed: {detail}", args.join(" ")));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize '{}': {error}", path.display()))?;
    write_text_file(path, &format!("{json}\n"))
}

pub(crate) fn write_text_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }
    let tmp_path = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!(
                "Could not determine a temporary path for '{}'.",
                path.display()
            ))?
    ));
    fs::write(&tmp_path, contents)
        .map_err(|error| format!("Could not write '{}': {error}", tmp_path.display()))?;
    atomic_replace(&tmp_path, path)
        .map_err(|error| format!("Could not finalize '{}': {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::write_text_file;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn write_text_file_replaces_contents_and_removes_temp_file() {
        let dir =
            std::env::temp_dir().join(format!("gnosis-repo-resource-atomic-{}", Uuid::now_v7()));
        let path = dir.join("resource.json");

        write_text_file(&path, "old").expect("write old contents");
        write_text_file(&path, "new").expect("write new contents");

        assert_eq!(fs::read_to_string(&path).expect("read file"), "new");
        assert!(!dir.join("resource.json.tmp").exists());

        let _ = fs::remove_dir_all(dir);
    }
}
