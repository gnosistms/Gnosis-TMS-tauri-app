use std::{fs, path::Path};

use serde::{de::DeserializeOwned, Serialize};

use crate::{
    repo_sync_shared::{format_git_spawn_error, git_command},
    util::atomic_replace,
};

const QA_LIST_GITATTRIBUTES: &str = "* text=auto eol=lf\n";

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

    write_text_file(path, QA_LIST_GITATTRIBUTES)
}

pub(super) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
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
        let dir = std::env::temp_dir().join(format!("gnosis-qa-list-atomic-{}", Uuid::now_v7()));
        let path = dir.join("qa-list.json");

        write_text_file(&path, "old").expect("write old contents");
        write_text_file(&path, "new").expect("write new contents");

        assert_eq!(fs::read_to_string(&path).expect("read file"), "new");
        assert!(!dir.join("qa-list.json.tmp").exists());

        let _ = fs::remove_dir_all(dir);
    }
}
