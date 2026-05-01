use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use super::read_project_title;
use crate::{
    local_repo_sync_state::read_local_repo_sync_state,
    repo_sync_shared::{git_output, read_current_head_oid},
};

#[derive(Clone)]
pub(super) struct RepoRecord {
    pub(super) repo_key: String,
    pub(super) project_id: String,
    pub(super) repo_name: String,
    pub(super) project_title: String,
    pub(super) repo_path: PathBuf,
    pub(super) head_sha: String,
}

#[derive(Clone)]
pub(super) struct IndexedRepoState {
    pub(super) project_id: String,
    pub(super) repo_name: String,
    pub(super) project_title: String,
    pub(super) head_sha: String,
}

pub(super) fn discover_project_repos(repo_root: &Path) -> Result<Vec<RepoRecord>, String> {
    let mut repos = Vec::new();
    if !repo_root.exists() {
        return Ok(repos);
    }

    for entry in fs::read_dir(repo_root).map_err(|error| {
        format!(
            "Could not read the local project repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a local project repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
            continue;
        }
        let project_json_path = repo_path.join("project.json");
        if !project_json_path.exists() {
            continue;
        }

        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        if sync_state
            .as_ref()
            .and_then(|state| state.kind.as_deref())
            .map(str::trim)
            .filter(|kind| !kind.is_empty() && *kind != "project")
            .is_some()
        {
            continue;
        }

        let repo_name = sync_state
            .as_ref()
            .and_then(|state| state.current_repo_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                repo_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("project")
                    .to_string()
            });
        let project_id = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| repo_name.clone());
        let repo_key = project_id.clone();
        let project_title =
            read_project_title(&project_json_path)?.unwrap_or_else(|| repo_name.clone());
        let head_sha = read_current_head_oid(&repo_path).unwrap_or_default();
        repos.push(RepoRecord {
            repo_key,
            project_id,
            repo_name,
            project_title,
            repo_path,
            head_sha,
        });
    }

    Ok(repos)
}

pub(super) fn load_indexed_repo_states(
    connection: &Connection,
) -> Result<HashMap<String, IndexedRepoState>, String> {
    let mut indexed_repos = HashMap::<String, IndexedRepoState>::new();
    let mut statement = connection
        .prepare(
            "SELECT repo_key, project_id, repo_name, project_title, head_sha FROM indexed_repos",
        )
        .map_err(|error| format!("Could not prepare indexed repo scan: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                IndexedRepoState {
                    project_id: row.get(1)?,
                    repo_name: row.get(2)?,
                    project_title: row.get(3)?,
                    head_sha: row.get(4)?,
                },
            ))
        })
        .map_err(|error| format!("Could not load indexed repo state: {error}"))?;
    for row in rows {
        let (repo_key, state) =
            row.map_err(|error| format!("Could not decode indexed repo state: {error}"))?;
        indexed_repos.insert(repo_key, state);
    }
    Ok(indexed_repos)
}
