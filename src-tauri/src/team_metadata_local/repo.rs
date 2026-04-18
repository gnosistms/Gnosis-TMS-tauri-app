use super::*;

pub(super) fn metadata_repo_full_name(org_login: &str) -> Result<String, String> {
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

pub(super) fn expected_repo_url_from_full_name(full_name: &str) -> Result<String, String> {
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

pub(super) fn ensure_repo_origin_remote(repo_path: &Path, remote_url: &str) -> Result<(), String> {
    match git_output(repo_path, &["remote", "get-url", "origin"], None) {
        Ok(existing_url) => {
            if existing_url.trim() != remote_url {
                git_output(
                    repo_path,
                    &["remote", "set-url", "origin", remote_url],
                    None,
                )?;
            }
        }
        Err(_) => {
            git_output(repo_path, &["remote", "add", "origin", remote_url], None)?;
        }
    }
    Ok(())
}

pub(super) fn current_origin_remote_url(repo_path: &Path) -> Option<String> {
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

pub(super) fn manifest_path(repo_path: &Path) -> PathBuf {
    repo_path.join("manifest.json")
}

pub(super) fn resource_directory_path(repo_path: &Path, kind: &str) -> PathBuf {
    match kind {
        "project" => repo_path.join("resources").join("projects"),
        "glossary" => repo_path.join("resources").join("glossaries"),
        _ => repo_path.join("resources").join(kind),
    }
}

pub(super) fn resource_record_path(repo_path: &Path, kind: &str, resource_id: &str) -> PathBuf {
    resource_directory_path(repo_path, kind).join(format!("{resource_id}.json"))
}

pub(super) fn build_local_team_metadata_repo_info(
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

pub(super) fn ensure_local_repo_exists(
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

pub(super) fn require_local_metadata_repo(
    app: &AppHandle,
    installation_id: i64,
) -> Result<PathBuf, String> {
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

pub(super) fn pull_local_metadata_repo(
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

fn current_branch_name(repo_path: &Path) -> String {
    git_output(repo_path, &["branch", "--show-current"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "main".to_string())
}

pub(super) fn push_local_metadata_repo(
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
