use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::AppHandle;

use crate::{
    local_repo_sync_state::read_local_repo_sync_state, repo_sync_shared::git_output,
    storage_paths::local_project_repo_root,
};

fn normalized_optional_identifier(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn project_repo_matches_identifier(
    repo_path: &Path,
    project_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_project_id = normalized_optional_identifier(project_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(project_id) = normalized_project_id.as_deref() {
        return sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(project_id);
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

pub(crate) fn find_project_repo_path(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let repo_root = local_project_repo_root(app, installation_id)?;
    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local project repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a project repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
            continue;
        }
        if project_repo_matches_identifier(&repo_path, project_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

pub(crate) fn desired_project_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    repo_name: &str,
) -> Result<PathBuf, String> {
    let normalized_repo_name = repo_name.trim();
    if normalized_repo_name.is_empty() {
        return Err("Could not determine which project repo to use.".to_string());
    }

    let repo_root = local_project_repo_root(app, installation_id)?;
    Ok(repo_root.join(normalized_repo_name))
}

pub(crate) fn resolve_project_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(repo_name) = normalized_optional_identifier(repo_name) {
        let repo_root = local_project_repo_root(app, installation_id)?;
        let repo_path = repo_root.join(&repo_name);
        if repo_path.exists() {
            if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
                return Err("The local project repo is missing or invalid.".to_string());
            }
            if project_repo_matches_identifier(&repo_path, project_id, Some(&repo_name)) {
                return Ok(repo_path);
            }
        }
    }

    if let Some(repo_path) = find_project_repo_path(app, installation_id, project_id, repo_name)? {
        return Ok(repo_path);
    }

    Err("The local project repo is not available yet.".to_string())
}

pub(crate) fn resolve_or_desired_project_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
) -> Result<PathBuf, String> {
    match find_project_repo_path(app, installation_id, project_id, Some(repo_name))? {
        Some(repo_path) => Ok(repo_path),
        None => desired_project_git_repo_path(app, installation_id, repo_name),
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::Path, process::Command};

    use uuid::Uuid;

    use crate::local_repo_sync_state::{upsert_local_repo_sync_state, LocalRepoSyncStateUpdate};

    use super::project_repo_matches_identifier;

    fn init_git_repo(path: &Path) {
        fs::create_dir_all(path).expect("create repo dir");
        let output = Command::new("git")
            .args(["init", "--initial-branch", "main"])
            .current_dir(path)
            .output()
            .expect("run git init");
        assert!(output.status.success(), "git init failed");
    }

    #[test]
    fn project_matcher_prefers_resource_id_over_folder_name_match() {
        let repo_root =
            env::temp_dir().join(format!("gnosis-project-repo-paths-{}", Uuid::now_v7()));
        let stray_repo_path = repo_root.join("shared-name");
        init_git_repo(&stray_repo_path);
        upsert_local_repo_sync_state(
            &stray_repo_path,
            LocalRepoSyncStateUpdate {
                resource_id: Some("project-stray".to_string()),
                current_repo_name: Some("shared-name".to_string()),
                kind: Some("project".to_string()),
                ..Default::default()
            },
        )
        .expect("write sync state");

        assert!(!project_repo_matches_identifier(
            &stray_repo_path,
            Some("project-live"),
            Some("shared-name"),
        ));

        let _ = fs::remove_dir_all(&repo_root);
    }
}
