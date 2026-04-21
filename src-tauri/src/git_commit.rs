use std::path::Path;

use tauri::AppHandle;

use crate::{
    repo_app_version::git_commit_app_version_trailer,
    broker_auth_storage::load_broker_auth_session,
    repo_sync_shared::{ensure_repo_local_git_identity, format_git_spawn_error, git_command},
};

pub(crate) struct GitCommitMetadata<'a> {
    pub(crate) operation: Option<&'a str>,
    pub(crate) status_note: Option<&'a str>,
    pub(crate) ai_model: Option<&'a str>,
}

fn is_nothing_to_commit(detail: &str) -> bool {
    let normalized = detail.trim().to_lowercase();
    normalized.contains("nothing to commit") || normalized.contains("working tree clean")
}

struct SignedInGitAuthor {
    login: String,
    email: String,
}

fn signed_in_git_author(app: &AppHandle) -> Result<SignedInGitAuthor, String> {
    let session = load_broker_auth_session(app.clone())?
        .ok_or_else(|| "Sign in with GitHub before creating local commits.".to_string())?;
    let login = session.login.trim().to_lowercase();
    if login.is_empty() {
        return Err("The saved GitHub session is missing a login.".to_string());
    }

    Ok(SignedInGitAuthor {
        email: format!("{login}@users.noreply.github.com"),
        login,
    })
}

pub(crate) fn git_commit_as_signed_in_user(
    app: &AppHandle,
    repo_path: &Path,
    message: &str,
    paths: &[&str],
) -> Result<String, String> {
    git_commit_as_signed_in_user_with_metadata(
        app,
        repo_path,
        message,
        paths,
        GitCommitMetadata {
            operation: None,
            status_note: None,
            ai_model: None,
        },
    )
}

pub(crate) fn git_commit_as_signed_in_user_with_metadata(
    app: &AppHandle,
    repo_path: &Path,
    message: &str,
    paths: &[&str],
    metadata: GitCommitMetadata<'_>,
) -> Result<String, String> {
    let author = signed_in_git_author(app)?;
    ensure_repo_local_git_identity(app, repo_path)?;
    let mut command = git_command();
    command
        .arg("commit")
        .arg("-m")
        .arg(message)
        .current_dir(repo_path)
        .env("GIT_AUTHOR_NAME", &author.login)
        .env("GIT_AUTHOR_EMAIL", &author.email)
        .env("GIT_COMMITTER_NAME", &author.login)
        .env("GIT_COMMITTER_EMAIL", &author.email);

    if let Some(operation) = metadata
        .operation
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-m")
            .arg(format!("GTMS-Operation: {operation}"));
    }

    if let Some(status_note) = metadata
        .status_note
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command
            .arg("-m")
            .arg(format!("GTMS-Status-Note: {status_note}"));
    }

    if let Some(ai_model) = metadata
        .ai_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("-m").arg(format!("GTMS-AI-Model: {ai_model}"));
    }

    command.arg("-m").arg(git_commit_app_version_trailer());

    if !paths.is_empty() {
        command.arg("--").args(paths);
    }

    let output = command
        .output()
        .map_err(|error| format_git_spawn_error(&["commit"], &error))?;

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
        if is_nothing_to_commit(&detail) {
            return Ok(String::new());
        }
        return Err(format!("git commit failed: {detail}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
