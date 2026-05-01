use std::{fs, path::Path};

use serde::{de::DeserializeOwned, Serialize};

use crate::repo_sync_shared::{format_git_spawn_error, git_command};

const GLOSSARY_GITATTRIBUTES: &str = "* text=auto eol=lf\n";

pub(super) fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

pub(super) fn ensure_gitattributes(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    write_text_file(path, GLOSSARY_GITATTRIBUTES)
}

pub(super) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command()
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

pub(super) fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize '{}': {error}", path.display()))?;
    write_text_file(path, &format!("{json}\n"))
}

pub(super) fn write_text_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }
    fs::write(path, contents)
        .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}
