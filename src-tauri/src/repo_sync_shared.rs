use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::Deserialize;
use uuid::Uuid;

use crate::{broker::broker_get_json_with_session, github::github_client};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitTransportTokenResponse {
    token: String,
}

pub(crate) struct GitTransportAuth {
    askpass_path: PathBuf,
    username: String,
    password: String,
}

impl GitTransportAuth {
    pub(crate) fn from_token(token: &str) -> Result<Self, String> {
        Ok(Self {
            askpass_path: write_git_askpass_script()?,
            username: "x-access-token".to_string(),
            password: token.to_string(),
        })
    }
}

impl Drop for GitTransportAuth {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.askpass_path);
    }
}

pub(crate) fn git_output(
    repo_path: &Path,
    args: &[&str],
    auth: Option<&GitTransportAuth>,
) -> Result<String, String> {
    let mut command = Command::new("git");
    if let Some(auth) = auth {
        command
            .env("GIT_ASKPASS", &auth.askpass_path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GTMS_GIT_USERNAME", &auth.username)
            .env("GTMS_GIT_PASSWORD", &auth.password);
    }

    let output = command
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format!("Could not run git {}: {error}", args.join(" ")))?;

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

pub(crate) fn read_current_head_oid(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn load_git_transport_token(
    installation_id: i64,
    session_token: &str,
) -> Result<String, String> {
    let client = github_client()?;
    let response: GitTransportTokenResponse = broker_get_json_with_session(
        &client,
        &format!("/api/github-app/installations/{installation_id}/git-transport-token"),
        session_token,
    )?;
    Ok(response.token)
}

pub(crate) fn abort_rebase_after_failed_pull(repo_path: &Path, pull_error: String) -> String {
    if !repo_has_rebase_in_progress(repo_path) {
        return pull_error;
    }

    match git_output(repo_path, &["rebase", "--abort"], None) {
        Ok(_) => format!("{pull_error} The interrupted rebase was aborted automatically."),
        Err(abort_error) => {
            format!("{pull_error} An automatic 'git rebase --abort' also failed: {abort_error}")
        }
    }
}

fn write_git_askpass_script() -> Result<PathBuf, String> {
    let extension = if cfg!(windows) { "cmd" } else { "sh" };
    let script_path = env::temp_dir().join(format!(
        "gnosis-tms-repo-sync-git-askpass-{}.{}",
        Uuid::now_v7(),
        extension
    ));
    let script_contents = if cfg!(windows) {
        "@echo off\r\nset PROMPT=%~1\r\necho %PROMPT% | findstr /I \"Username\" >nul\r\nif not errorlevel 1 (\r\n  <nul set /p =%GTMS_GIT_USERNAME%\r\n) else (\r\n  <nul set /p =%GTMS_GIT_PASSWORD%\r\n)\r\n"
    } else {
        "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s' \"$GTMS_GIT_USERNAME\" ;;\n  *) printf '%s' \"$GTMS_GIT_PASSWORD\" ;;\nesac\n"
    };

    fs::write(&script_path, script_contents).map_err(|error| {
        format!(
            "Could not create the temporary git credential helper '{}': {error}",
            script_path.display()
        )
    })?;

    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(&script_path)
            .map_err(|error| format!("Could not inspect '{}': {error}", script_path.display()))?
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script_path, permissions).map_err(|error| {
            format!(
                "Could not mark '{}' executable: {error}",
                script_path.display()
            )
        })?;
    }

    Ok(script_path)
}

fn repo_has_rebase_in_progress(repo_path: &Path) -> bool {
    let rebase_apply = git_output(
        repo_path,
        &["rev-parse", "--git-path", "rebase-apply"],
        None,
    );
    let rebase_merge = git_output(
        repo_path,
        &["rev-parse", "--git-path", "rebase-merge"],
        None,
    );

    rebase_apply
        .ok()
        .map(|path| resolve_git_path(repo_path, &path).exists())
        .unwrap_or(false)
        || rebase_merge
            .ok()
            .map(|path| resolve_git_path(repo_path, &path).exists())
            .unwrap_or(false)
}

fn resolve_git_path(repo_path: &Path, git_path: &str) -> PathBuf {
    let path = PathBuf::from(git_path);
    if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    }
}
