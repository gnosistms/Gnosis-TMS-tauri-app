use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::{
    repo_sync_shared::{format_git_spawn_error, git_command},
    storage_paths::local_project_repo_root,
};

const GTMS_GITATTRIBUTES: &str = "*.json text eol=lf\nassets/** binary\n";

pub(super) fn local_repo_root(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
    local_project_repo_root(app, installation_id)
}

pub(super) fn ensure_repo_exists(
    repo_path: &Path,
    unavailable_message: &str,
) -> Result<(), String> {
    if !repo_path.exists() {
        return Err(unavailable_message.to_string());
    }

    Ok(())
}

pub(super) fn ensure_valid_git_repo(repo_path: &Path, invalid_message: &str) -> Result<(), String> {
    if git_output(repo_path, &["rev-parse", "--git-dir"]).is_err() {
        return Err(invalid_message.to_string());
    }

    Ok(())
}

pub(super) fn ensure_clean_git_repo(repo_path: &Path, dirty_message: &str) -> Result<(), String> {
    if !git_output(repo_path, &["status", "--porcelain"])?
        .trim()
        .is_empty()
    {
        return Err(dirty_message.to_string());
    }

    Ok(())
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

pub(super) fn git_output_with_stdin(
    repo_path: &Path,
    args: &[&str],
    stdin_contents: &str,
) -> Result<Vec<u8>, String> {
    let mut child = git_command()?
        .args(args)
        .current_dir(repo_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format_git_spawn_error(args, &error))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| format!("Could not open stdin for git {}.", args.join(" ")))?;
        stdin
            .write_all(stdin_contents.as_bytes())
            .map_err(|error| {
                format!("Could not write stdin for git {}: {error}", args.join(" "))
            })?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for git {}: {error}", args.join(" ")))?;

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

    Ok(output.stdout)
}

pub(super) fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
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

pub(super) fn ensure_gitattributes(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    write_text_file(path, GTMS_GITATTRIBUTES)
}

fn normalize_git_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub(super) fn repo_relative_path(repo_path: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(repo_path)
        .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))
        .map(|relative_path| normalize_git_relative_path(&relative_path.to_string_lossy()))
}

struct ChapterPathScan {
    path: Option<PathBuf>,
    skipped_chapter_files: usize,
}

/// Scan the chapter folders for the chapter with the given id. A chapter.json that
/// cannot be read or parsed is skipped (and counted) instead of failing the scan, so one
/// corrupt chapter cannot wedge every chapter operation in the repo.
fn scan_chapter_path_by_id(
    chapters_root: &Path,
    chapter_id: &str,
) -> Result<ChapterPathScan, String> {
    let entries = fs::read_dir(chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;

    let mut skipped_chapter_files = 0usize;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let chapter_json_path = path.join("chapter.json");
        if !chapter_json_path.exists() {
            continue;
        }

        let Ok(chapter_value) = read_json_file::<Value>(&chapter_json_path, "chapter.json") else {
            skipped_chapter_files += 1;
            continue;
        };
        if chapter_value.get("chapter_id").and_then(Value::as_str) == Some(chapter_id) {
            return Ok(ChapterPathScan {
                path: Some(path),
                skipped_chapter_files,
            });
        }
    }

    Ok(ChapterPathScan {
        path: None,
        skipped_chapter_files,
    })
}

/// A skipped chapter file means a corrupt/unreadable chapter.json degraded to one
/// missing chapter instead of failing the whole scan. Developers still need visibility,
/// so report it through the consent-gated non-fatal telemetry event.
fn report_skipped_chapter_files(app: &AppHandle, skipped_chapter_files: usize) {
    if skipped_chapter_files > 0 {
        crate::github::report_backend_nonfatal_error(
            app,
            "project-import.chapter-scan",
            "chapter_json_read_failed",
        );
    }
}

pub(super) fn find_chapter_path_by_id(
    app: &AppHandle,
    chapters_root: &Path,
    chapter_id: &str,
) -> Result<PathBuf, String> {
    try_find_chapter_path_by_id(app, chapters_root, chapter_id)?
        .ok_or_else(|| format!("Could not find chapter '{chapter_id}' in the local project repo."))
}

pub(super) fn try_find_chapter_path_by_id(
    app: &AppHandle,
    chapters_root: &Path,
    chapter_id: &str,
) -> Result<Option<PathBuf>, String> {
    let scan = scan_chapter_path_by_id(chapters_root, chapter_id)?;
    report_skipped_chapter_files(app, scan.skipped_chapter_files);
    Ok(scan.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn normalize_git_relative_path_uses_forward_slashes_for_windows_paths() {
        assert_eq!(
            normalize_git_relative_path(r"chapters\chapter-1\rows\row-1.json"),
            "chapters/chapter-1/rows/row-1.json"
        );
    }

    fn create_test_chapters_root() -> Result<PathBuf, String> {
        let chapters_root =
            std::env::temp_dir().join(format!("gnosis-tms-chapter-scan-{}", Uuid::now_v7()));
        fs::create_dir_all(&chapters_root)
            .map_err(|error| format!("Could not create test chapters folder: {error}"))?;
        Ok(chapters_root)
    }

    fn write_test_chapter(
        chapters_root: &Path,
        folder: &str,
        chapter_json: &str,
    ) -> Result<(), String> {
        let chapter_path = chapters_root.join(folder);
        fs::create_dir_all(&chapter_path)
            .map_err(|error| format!("Could not create test chapter: {error}"))?;
        write_text_file(&chapter_path.join("chapter.json"), chapter_json)
    }

    #[test]
    fn chapter_scan_skips_corrupt_chapter_files_and_still_finds_the_target() -> Result<(), String> {
        let chapters_root = create_test_chapters_root()?;
        write_test_chapter(&chapters_root, "corrupt", "not json {")?;
        write_test_chapter(
            &chapters_root,
            "target",
            &json!({ "chapter_id": "chapter-1" }).to_string(),
        )?;

        // The corrupt chapter must not fail the scan. The skip count is not asserted
        // here because the scan returns as soon as the target is found and directory
        // iteration order is unspecified.
        let scan = scan_chapter_path_by_id(&chapters_root, "chapter-1")?;
        assert_eq!(scan.path, Some(chapters_root.join("target")));

        let _ = fs::remove_dir_all(&chapters_root);
        Ok(())
    }

    #[test]
    fn chapter_scan_returns_no_path_and_skip_count_when_target_is_missing() -> Result<(), String> {
        let chapters_root = create_test_chapters_root()?;
        write_test_chapter(&chapters_root, "corrupt", "not json {")?;

        let scan = scan_chapter_path_by_id(&chapters_root, "chapter-1")?;
        assert_eq!(scan.path, None);
        assert_eq!(scan.skipped_chapter_files, 1);

        let _ = fs::remove_dir_all(&chapters_root);
        Ok(())
    }
}
