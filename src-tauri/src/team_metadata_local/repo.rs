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
    let clone_result = git_output(
        repo_parent,
        &["clone", repo_url.as_str(), repo_path_string.as_str()],
        Some(&git_transport_auth),
    );
    if let Err(error) = clone_result {
        // git removes its own target on most failures, but an interrupted
        // transfer/checkout can leave a partial clone behind. If it stays, every
        // retry sees a git dir without manifest.json and cascades "missing
        // manifest.json" / "not available yet" errors instead of re-cloning.
        if repo_path.exists() {
            let _ = fs::remove_dir_all(repo_path);
        }
        return Err(error);
    }
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

/// Resource ids come straight from IPC input and end up in `Path::join`, `fs::write`,
/// and `fs::remove_file`. `Path::strip_prefix` is lexical, so a `..` component would
/// survive the repo-relative check downstream — reject anything outside a plain
/// single-component file name here.
fn validated_resource_id(resource_id: &str) -> Result<String, String> {
    let normalized = resource_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || !normalized
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(format!(
            "'{normalized}' is not a valid team-metadata resource id."
        ));
    }
    Ok(normalized.to_string())
}

pub(super) fn resource_record_path(
    repo_path: &Path,
    kind: &str,
    resource_id: &str,
) -> Result<PathBuf, String> {
    let resource_id = validated_resource_id(resource_id)?;
    Ok(resource_directory_path(repo_path, kind).join(format!("{resource_id}.json")))
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

/// When a clone is interrupted during checkout, the object data is intact but the
/// working tree (including manifest.json) is incomplete. Restore tracked files from
/// HEAD. Returns true when the manifest is available afterwards.
fn restore_partial_metadata_checkout(repo_path: &Path) -> bool {
    if git_output(repo_path, &["cat-file", "-e", "HEAD:manifest.json"], None).is_err() {
        return false;
    }
    git_output(repo_path, &["checkout", "HEAD", "--", "."], None).is_ok()
        && manifest_path(repo_path).exists()
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
            // The manifest only ever comes from the remote, so a git dir without
            // manifest.json is partial-clone damage. Repair it here instead of
            // letting every later read fail "missing manifest.json".
            let manifest_available =
                manifest_path(&repo_path).exists() || restore_partial_metadata_checkout(&repo_path);
            if manifest_available || read_current_head_oid(&repo_path).is_some() {
                // Keep repos that have commits even without a manifest, so the
                // downstream "missing manifest.json" handling can report them.
                ensure_origin_remote(&repo_path, org_login)?;
                return Ok(repo_path);
            }
            // No manifest and no commits at all — partial clone residue with
            // nothing local to preserve. Remove it and re-clone below.
            fs::remove_dir_all(&repo_path).map_err(|error| {
                format!(
                    "Could not reset the partially cloned team-metadata repo '{}': {error}",
                    repo_path.display()
                )
            })?;
        } else if repo_dir_is_empty(&repo_path)? {
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
    let branch_name = current_branch_name(repo_path);
    let Err(first_error) = attempt_metadata_pull(repo_path, &branch_name, &git_transport_auth)
    else {
        return Ok(());
    };
    // Untracked record files are residue of an interrupted mutation (written, but the
    // commit never landed, so the command failed and the write was never acknowledged
    // as durable). The remote copy is authoritative for them — clear the specific
    // files git refused to overwrite and retry once.
    if remove_untracked_files_blocking_pull(repo_path, &first_error) {
        return attempt_metadata_pull(repo_path, &branch_name, &git_transport_auth);
    }
    Err(first_error)
}

fn attempt_metadata_pull(
    repo_path: &Path,
    branch_name: &str,
    git_transport_auth: &GitTransportAuth,
) -> Result<(), String> {
    // Pull the current branch explicitly. A bare `git pull --ff-only` relies on local
    // upstream tracking; when that is missing or ambiguous, git tries to merge every
    // fetched head and fails with "Cannot fast-forward to multiple branches." Naming the
    // branch resolves to a single merge target.
    let pull_result = git_output(
        repo_path,
        &["pull", "--ff-only", "origin", branch_name],
        Some(git_transport_auth),
    );
    match pull_result {
        Ok(_) => Ok(()),
        Err(error) if git_error_indicates_diverged(&error) => {
            rebase_diverged_metadata_repo(repo_path, branch_name, error)
        }
        Err(error) => Err(abort_rebase_after_failed_pull(repo_path, error)),
    }
}

const UNTRACKED_OVERWRITE_MARKER: &str = "untracked working tree files would be overwritten by";

/// Parse the repo-relative paths git lists under an untracked-overwrite error header
/// (one per indented line, ending at the first non-indented line).
fn untracked_paths_blocking_pull(error: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut in_file_list = false;
    for line in error.lines() {
        if line
            .to_ascii_lowercase()
            .contains(UNTRACKED_OVERWRITE_MARKER)
        {
            in_file_list = true;
            continue;
        }
        if !in_file_list {
            continue;
        }
        if line.starts_with('\t') || line.starts_with("    ") {
            let path = line.trim();
            if !path.is_empty() {
                paths.push(path.to_string());
            }
        } else {
            in_file_list = false;
        }
    }
    paths
}

/// Remove the untracked files git refused to overwrite during a pull. Returns true
/// only when every listed file was verified untracked (`??` in porcelain status) and
/// removed — any anomaly leaves the working tree alone so the original error surfaces.
fn remove_untracked_files_blocking_pull(repo_path: &Path, error: &str) -> bool {
    let relative_paths = untracked_paths_blocking_pull(error);
    if relative_paths.is_empty() {
        return false;
    }

    for relative_path in &relative_paths {
        let path = Path::new(relative_path);
        let is_plain_relative = !path.is_absolute()
            && path
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)));
        if !is_plain_relative {
            return false;
        }
        let is_untracked = git_output(
            repo_path,
            &["status", "--porcelain", "--", relative_path],
            None,
        )
        .is_ok_and(|status| status.starts_with("??"));
        if !is_untracked {
            return false;
        }
    }

    for relative_path in &relative_paths {
        if fs::remove_file(repo_path.join(relative_path)).is_err() {
            return false;
        }
    }
    true
}

/// The metadata repo is multi-writer (every manager on the team), so a teammate pushing
/// in the window between our pull and push leaves this clone diverged — and a
/// `--ff-only` pull can never recover from that on its own. Records live one file per
/// resource, so concurrent edits to *different* resources rebase cleanly; only
/// same-record edits conflict, and then we abort and surface a distinct error.
fn rebase_diverged_metadata_repo(
    repo_path: &Path,
    branch_name: &str,
    pull_error: String,
) -> Result<(), String> {
    // The failed `pull --ff-only` already fetched, so origin/<branch> is current and
    // the rebase needs no network access.
    match git_output(
        repo_path,
        &["rebase", &format!("origin/{branch_name}")],
        None,
    ) {
        Ok(_) => Ok(()),
        Err(rebase_error) => Err(abort_rebase_after_failed_pull(
            repo_path,
            format!(
                "The local team-metadata repo has diverged from GitHub and could not be \
                 rebased automatically: {rebase_error} (fast-forward pull failed first: \
                 {pull_error})"
            ),
        )),
    }
}

fn git_error_indicates_diverged(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized.contains("not possible to fast-forward")
        || normalized.contains("diverging branches")
        || normalized.contains("have diverged")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_record_path_accepts_plain_ids_and_trims() {
        let repo = Path::new("/repos/team-metadata");
        let path = resource_record_path(repo, "project", " 0196a7e2-aa11-7def-8000-1234abcd5678 ")
            .expect("plain id should resolve");
        assert_eq!(
            path,
            repo.join("resources")
                .join("projects")
                .join("0196a7e2-aa11-7def-8000-1234abcd5678.json")
        );
        assert!(resource_record_path(repo, "glossary", "Glossary_1.v2").is_ok());
    }

    #[test]
    fn diverged_pull_errors_are_classified() {
        assert!(git_error_indicates_diverged(
            "fatal: Not possible to fast-forward, aborting."
        ));
        assert!(git_error_indicates_diverged(
            "hint: Diverging branches can't be fast-forwarded, you need to either:"
        ));
        assert!(!git_error_indicates_diverged(
            "fatal: unable to access 'https://github.com/org/team-metadata.git/': Could not resolve host"
        ));
        assert!(!git_error_indicates_diverged(
            "fatal: couldn't find remote ref main"
        ));
    }

    #[test]
    fn untracked_overwrite_paths_are_parsed_from_pull_errors() {
        let error = "git pull --ff-only origin main failed: error: The following untracked working tree files would be overwritten by merge:\n\tresources/projects/0196a7e2.json\n\tresources/glossaries/team-glossary.json\nPlease move or remove them before you merge.\nAborting";
        assert_eq!(
            untracked_paths_blocking_pull(error),
            vec![
                "resources/projects/0196a7e2.json".to_string(),
                "resources/glossaries/team-glossary.json".to_string(),
            ],
        );
    }

    #[test]
    fn unrelated_pull_errors_yield_no_untracked_paths() {
        assert!(untracked_paths_blocking_pull(
            "git pull --ff-only origin main failed: fatal: Not possible to fast-forward, aborting."
        )
        .is_empty());
        assert!(untracked_paths_blocking_pull(
            "error: Your local changes to the following files would be overwritten by merge:\n\tmanifest.json"
        )
        .is_empty());
    }

    #[test]
    fn resource_record_path_rejects_traversal_and_empty_ids() {
        let repo = Path::new("/repos/team-metadata");
        for invalid in [
            "",
            "   ",
            ".",
            "..",
            "../../manifest",
            "../../../../etc/target",
            "nested/record",
            "nested\\record",
        ] {
            assert!(
                resource_record_path(repo, "project", invalid).is_err(),
                "id '{invalid}' should be rejected"
            );
        }
    }
}
