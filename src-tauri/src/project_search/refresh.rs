use std::collections::HashSet;

use super::discovery::{IndexedRepoState, RepoRecord};
use crate::repo_sync_shared::git_output;

#[derive(Default)]
pub(super) struct RepoRefreshPlan {
    pub(super) project_metadata_changed: bool,
    pub(super) touched_chapter_dirs: HashSet<String>,
    pub(super) requires_full_reindex: bool,
}

pub(super) fn plan_repo_refresh(
    repo: &RepoRecord,
    indexed_state: Option<&IndexedRepoState>,
) -> Result<RepoRefreshPlan, String> {
    let mut plan = RepoRefreshPlan::default();
    let Some(indexed_state) = indexed_state else {
        plan.requires_full_reindex = true;
        return Ok(plan);
    };

    let indexed_head = indexed_state.head_sha.trim();
    let current_head = repo.head_sha.trim();
    if indexed_head.is_empty() || current_head.is_empty() {
        plan.requires_full_reindex = true;
        return Ok(plan);
    }

    if indexed_head != current_head {
        let diff_range = format!("{indexed_head}..{current_head}");
        match git_output(
            &repo.repo_path,
            &[
                "diff",
                "--name-status",
                "--find-renames",
                &diff_range,
                "--",
                "project.json",
                "chapters",
            ],
            None,
        ) {
            Ok(output) => append_diff_name_status_changes(&mut plan, &output)?,
            Err(_) => {
                plan.requires_full_reindex = true;
                return Ok(plan);
            }
        }
    }

    match git_output(
        &repo.repo_path,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            "project.json",
            "chapters",
        ],
        None,
    ) {
        Ok(output) => append_status_porcelain_changes(&mut plan, &output)?,
        Err(_) => {
            plan.requires_full_reindex = true;
        }
    }

    Ok(plan)
}

pub(super) fn append_diff_name_status_changes(
    plan: &mut RepoRefreshPlan,
    output: &str,
) -> Result<(), String> {
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let columns = line.split('\t').collect::<Vec<_>>();
        if columns.is_empty() {
            continue;
        }

        let status = columns[0];
        let is_rename_or_copy = matches!(status.chars().next(), Some('R' | 'C'));
        if is_rename_or_copy {
            if columns.len() < 3 {
                return Err(format!(
                    "Could not parse a project search rename diff row: '{line}'"
                ));
            }
            record_repo_relative_path_change(plan, columns[1]);
            record_repo_relative_path_change(plan, columns[2]);
            continue;
        }

        if columns.len() < 2 {
            return Err(format!(
                "Could not parse a project search diff row: '{line}'"
            ));
        }
        record_repo_relative_path_change(plan, columns[1]);
    }

    Ok(())
}

pub(super) fn append_status_porcelain_changes(
    plan: &mut RepoRefreshPlan,
    output: &str,
) -> Result<(), String> {
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        if line.len() < 4 {
            return Err(format!(
                "Could not parse a project search git status row: '{line}'"
            ));
        }
        let path_value = line[3..].trim();
        if path_value.is_empty() {
            continue;
        }

        if let Some((left, right)) = path_value.split_once(" -> ") {
            record_repo_relative_path_change(plan, left);
            record_repo_relative_path_change(plan, right);
            continue;
        }

        record_repo_relative_path_change(plan, path_value);
    }

    Ok(())
}

fn record_repo_relative_path_change(plan: &mut RepoRefreshPlan, path: &str) {
    let normalized_path = path.trim().replace('\\', "/");
    if normalized_path.is_empty() {
        return;
    }
    if normalized_path == "project.json" {
        plan.project_metadata_changed = true;
        return;
    }
    if let Some(chapter_dir) = extract_chapter_dir_from_repo_path(&normalized_path) {
        plan.touched_chapter_dirs.insert(chapter_dir);
    }
}

pub(super) fn extract_chapter_dir_from_repo_path(path: &str) -> Option<String> {
    let mut segments = path.split('/');
    match (segments.next(), segments.next()) {
        (Some("chapters"), Some(chapter_dir)) if !chapter_dir.trim().is_empty() => {
            Some(chapter_dir.trim().to_string())
        }
        _ => None,
    }
}
