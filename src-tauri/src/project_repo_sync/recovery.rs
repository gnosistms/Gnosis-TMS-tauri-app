//! Shared by automatic reconciliation and the Projects screen's recovery action.
use super::{
    ensure_project_origin_remote, find_editor_chapter_path_by_id, git_output,
    is_editor_row_conflict_path, load_unmerged_git_stage_sets, mark_project_repo_synced,
    pending_repo_migrations, persist_imported_editor_conflict_entries, read_git_stage_text,
    repo_has_rebase_in_progress_local, resolve_row_git_conflict_from_stage_texts,
    ProjectRepoSyncDescriptor, ProjectRepoSyncOutcome, RepoKind,
    PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS, PROJECT_REPO_SYNC_STATUS_UP_TO_DATE,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

/// Returns true when the expected branch is at the fetched revision.
pub(super) fn fast_forward_clean_project(
    repo: &Path,
    branch: &str,
    target: &str,
) -> Result<bool, String> {
    let current = git_output(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"], None).ok();
    if current.as_deref() != Some(branch) {
        return Ok(false);
    }
    if git_output(repo, &["rev-parse", "--verify", "HEAD"], None).as_deref() == Ok(target) {
        return Ok(true);
    }
    if git_output(repo, &["merge-base", "--is-ancestor", "HEAD", target], None).is_err() {
        return Ok(false);
    }
    // Old Windows clones may still use long chapter and image names.
    git_output(
        repo,
        &[
            "-c",
            "core.longpaths=true",
            "merge",
            "--ff-only",
            "--no-overwrite-ignore",
            target,
        ],
        None,
    )?;
    Ok(true)
}

fn recovery_root(repo: &Path, project_id: &str) -> Option<PathBuf> {
    let projects = repo.parent()?;
    if projects.file_name()? != "projects" {
        return None;
    }
    // Folder names can change on rename or when a legacy long name is shortened.
    let key = format!("{:x}", Sha256::digest(project_id.as_bytes()));
    Some(projects.parent()?.join("project-recovery").join(&key[..32]))
}

pub(super) fn latest_saved_checkout(repo: &Path, project_id: &str) -> Option<PathBuf> {
    fs::read_dir(recovery_root(repo, project_id)?)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join("original"))
        .filter(|path| path.is_dir())
        .max()
}

fn prepared_path(saved: &Path, repo: &Path) -> Result<PathBuf, String> {
    let folder = repo.file_name().ok_or("Invalid local project folder.")?;
    Ok(saved.with_file_name("ready").join(folder))
}

/// A process can exit between the two directory renames. The prepared checkout
/// already contains its binding and editor journal, so the next sync can finish offline.
pub(super) fn finish_interrupted_replacement(
    project: &ProjectRepoSyncDescriptor,
    repo: &Path,
) -> Result<(), String> {
    if repo.exists() {
        return Ok(());
    }
    if let Some(saved) = latest_saved_checkout(repo, &project.project_id) {
        // Each prepared directory contains exactly one project. Its old name
        // can differ from the folder selected for a missing checkout today.
        let entries = match fs::read_dir(saved.with_file_name("ready")) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("Could not inspect the prepared checkout: {e}")),
        };
        if let Some(entry) = entries
            .into_iter()
            .next()
            .transpose()
            .map_err(|e| e.to_string())?
        {
            fs::rename(entry.path(), repo)
                .map_err(|e| format!("Could not finish restoring the project: {e}"))?;
            mark_project_repo_synced(project, repo)?;
        }
    }
    Ok(())
}

pub(super) fn recover_project(
    project: &ProjectRepoSyncDescriptor,
    repo: &Path,
    branch: &str,
    head: &str,
) -> Result<ProjectRepoSyncOutcome, String> {
    // The app owns ordinary standalone clones. Moving a linked worktree would
    // break its external Git directory.
    if !fs::symlink_metadata(repo).is_ok_and(|m| m.is_dir())
        || !fs::symlink_metadata(repo.join(".git")).is_ok_and(|m| m.is_dir())
    {
        return Err("Project recovery requires a standalone local Git checkout.".into());
    }
    let root = recovery_root(repo, &project.project_id)
        .ok_or("Could not locate the project's recovery folder.")?;
    fs::create_dir_all(&root)
        .map_err(|e| format!("Could not create the project recovery folder: {e}"))?;
    let attempt = root.join(Uuid::now_v7().simple().to_string());
    fs::create_dir(&attempt).map_err(|e| format!("Could not prepare project recovery: {e}"))?;
    let saved = attempt.join("original");
    let prepared = prepared_path(&saved, repo)?;
    let prepare = || -> Result<_, String> {
        fs::create_dir_all(&prepared)
            .map_err(|e| format!("Could not create the replacement folder: {e}"))?;
        // Fetch exactly the commit whose app version the caller checked. The
        // file transport copies reachable Git objects without sharing an index,
        // alternates or packfiles with the checkout that is about to be saved.
        git_output(&prepared, &["init", "--quiet"], None)?;
        git_output(&prepared, &["config", "core.longpaths", "true"], None)?;
        let source = repo
            .to_str()
            .ok_or("Could not read the local project path.")?;
        // An open editor diffs its previous HEAD against the new checkout.
        let previous = git_output(repo, &["rev-parse", "HEAD"], None)?;
        git_output(
            &prepared,
            &["fetch", "--no-tags", "--", source, head, &previous],
            None,
        )?;
        git_output(&prepared, &["checkout", "-B", branch, head], None)?;
        ensure_project_origin_remote(project, &prepared)?;
        let tracking = format!("refs/remotes/origin/{branch}");
        git_output(&prepared, &["update-ref", &tracking, head], None)?;
        git_output(
            &prepared,
            &[
                "branch",
                "--set-upstream-to",
                &format!("origin/{branch}"),
                branch,
            ],
            None,
        )?;
        let manifest = fs::read(prepared.join("project.json"))
            .map_err(|e| format!("Could not read the server project: {e}"))?;
        let manifest: Value = serde_json::from_slice(&manifest)
            .map_err(|e| format!("Could not read the server project: {e}"))?;
        if !manifest["title"].is_string() {
            return Err("The server project is missing its title.".into());
        }
        pending_repo_migrations(&prepared, &RepoKind::Project)?;
        mark_project_repo_synced(project, &prepared)?;
        import_conflicted_rows(repo, &prepared, head)
    };
    let conflicts = match prepare() {
        Ok(conflicts) => conflicts,
        Err(error) => {
            let _ = fs::remove_dir_all(&attempt);
            return Err(error);
        }
    };
    if let Err(error) = fs::rename(repo, &saved) {
        let _ = fs::remove_dir_all(&attempt);
        return Err(format!(
            "Could not save the existing project checkout: {error}"
        ));
    }
    if let Err(error) = fs::rename(&prepared, repo) {
        // Keep both directories if another process or Windows file handle
        // prevents rollback. The next launch can finish the prepared switch.
        if fs::rename(&saved, repo).is_ok() {
            let _ = fs::remove_dir_all(&attempt);
        }
        return Err(format!("Could not activate the recovered project: {error}"));
    }
    let status = if conflicts.is_empty() {
        PROJECT_REPO_SYNC_STATUS_UP_TO_DATE
    } else {
        PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS
    };
    Ok(ProjectRepoSyncOutcome {
        current_head_oid: Some(head.to_owned()),
        repo_sync_status: status.into(),
        message: Some(
            "Recovered the project from GitHub and saved the previous local checkout.".into(),
        ),
        imported_conflicts: conflicts,
    })
}

fn import_conflicted_rows(
    repo: &Path,
    prepared: &Path,
    head: &str,
) -> Result<Vec<super::ImportedEditorConflictRef>, String> {
    let mut pending = Vec::new();
    let rebasing = repo_has_rebase_in_progress_local(repo);
    for (path, stages) in load_unmerged_git_stage_sets(repo)? {
        let relative = Path::new(&path);
        if !is_editor_row_conflict_path(&path)
            || !relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            continue;
        }
        // Git calls the incoming commit "theirs" during a merge, but "theirs"
        // is the replayed local commit during a rebase.
        let local_oid = if rebasing {
            stages.local_oid
        } else {
            stages.remote_oid
        };
        let Some(local) = read_git_stage_text(repo, local_oid.as_deref())? else {
            continue;
        };
        let Some(remote_path) = recovered_row_path(repo, prepared, relative) else {
            continue;
        };
        let Ok(remote) = fs::read_to_string(prepared.join(&remote_path)) else {
            continue;
        };
        // The editor can compare supported rows on the verified server checkout.
        // Other files and manually edited conflict markers remain in the saved original.
        let Ok(merged) = resolve_row_git_conflict_from_stage_texts(
            &remote_path,
            None,
            Some(&remote),
            Some(&local),
        ) else {
            continue;
        };
        if let Some(entry) = merged.imported_conflict {
            pending.push(entry);
        }
    }
    persist_imported_editor_conflict_entries(prepared, pending, Some(head))
}

fn recovered_row_path(repo: &Path, prepared: &Path, relative: &Path) -> Option<String> {
    if prepared.join(relative).is_file() {
        return relative.to_str().map(str::to_owned);
    }
    let rows = relative.parent()?;
    if rows.file_name()? != OsStr::new("rows") {
        return None;
    }
    let chapter = repo.join(rows.parent()?).join("chapter.json");
    let old: Value = serde_json::from_slice(&fs::read(chapter).ok()?).ok()?;
    let target = find_editor_chapter_path_by_id(prepared, old["chapter_id"].as_str()?).ok()?;
    let rel = target
        .strip_prefix(prepared)
        .ok()?
        .join("rows")
        .join(relative.file_name()?);
    Some(rel.to_str()?.replace('\\', "/"))
}
