use super::*;

use std::panic::AssertUnwindSafe;

use tauri::Emitter;

use super::super::project_git::{ensure_clean_git_repo, ensure_repo_exists, ensure_valid_git_repo};
use super::team_copy::{
    cleanup_chapter_copy, write_chapter_copy, TeamCopyDefaultGlossaryInput, WrittenChapterCopy,
};
use crate::constants::TEAM_PROJECT_TRANSFER_PROGRESS_EVENT;
use crate::git_commit::ensure_local_commit_preconditions;
use crate::project_repo_paths::resolve_or_desired_project_git_repo_path;
use crate::project_repo_sync::{sync_project_repo, ProjectRepoSyncDescriptor};
use crate::repo_layout_metadata::{
    read_repo_layout_metadata_state, RepoKind, RepoLayoutMetadataState, STORAGE_LAYOUT_VERSION_V2,
};
use crate::repo_sync_shared::load_git_transport_token;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectTransferInput {
    job_id: String,
    source: ProjectTransferSource,
    target: ProjectTransferTarget,
    #[serde(default)]
    glossary: Option<TeamCopyDefaultGlossaryInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTransferSource {
    installation_id: i64,
    project_id: Option<String>,
    repo_name: String,
    #[serde(default)]
    project_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTransferTarget {
    installation_id: i64,
    project_id: String,
    repo_name: String,
    full_name: String,
    #[serde(default)]
    repo_id: Option<i64>,
    #[serde(default)]
    default_branch_name: Option<String>,
    #[serde(default)]
    default_branch_head_oid: Option<String>,
    #[serde(default)]
    lifecycle_state: Option<String>,
    #[serde(default)]
    record_state: Option<String>,
    #[serde(default)]
    remote_state: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    project_title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTransferProgressPayload {
    job_id: String,
    status: &'static str,
    message: String,
    copied_chapters: usize,
    total_chapters: usize,
    target_project_title: String,
}

struct SourceChapter {
    chapter_path: PathBuf,
    chapter_file: StoredChapterFile,
    rows: Vec<StoredRowFile>,
}

struct ProjectTransferOutcome {
    copied_chapters: usize,
    target_project_title: String,
}

/// Validates input and starts a background transfer. Terminal results are
/// delivered through `team-project-transfer-progress`, keyed by `jobId`.
pub(crate) fn start_project_transfer(
    app: AppHandle,
    input: ProjectTransferInput,
    session_token: String,
) -> Result<(), String> {
    if input.job_id.trim().is_empty() {
        return Err("The project transfer is missing a job id.".to_string());
    }
    if input.source.repo_name.trim().is_empty() {
        return Err("Could not find the source project.".to_string());
    }
    if input.target.project_id.trim().is_empty()
        || input.target.repo_name.trim().is_empty()
        || input.target.full_name.trim().is_empty()
    {
        return Err("Could not determine the destination project.".to_string());
    }
    if session_token.trim().is_empty() {
        return Err("Sign in again to transfer this project.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let job_id = input.job_id.clone();
        let target_project_title = input.target.project_title.clone();
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
            run_project_transfer(&app, &input, &session_token)
        }))
        .unwrap_or_else(|_| {
            Err("The project transfer failed unexpectedly. Please try again.".to_string())
        });

        match outcome {
            Ok(outcome) => emit_transfer_progress(
                &app,
                ProjectTransferProgressPayload {
                    job_id,
                    status: "success",
                    message: format!("Transferred \"{}\".", outcome.target_project_title),
                    copied_chapters: outcome.copied_chapters,
                    total_chapters: outcome.copied_chapters,
                    target_project_title: outcome.target_project_title,
                },
            ),
            Err(error) => emit_transfer_progress(
                &app,
                ProjectTransferProgressPayload {
                    job_id,
                    status: "error",
                    message: error,
                    copied_chapters: 0,
                    total_chapters: 0,
                    target_project_title,
                },
            ),
        }
    });

    Ok(())
}

fn run_project_transfer(
    app: &AppHandle,
    input: &ProjectTransferInput,
    session_token: &str,
) -> Result<ProjectTransferOutcome, String> {
    let source_repo_path = resolve_project_git_repo_path(
        app,
        input.source.installation_id,
        input.source.project_id.as_deref(),
        Some(&input.source.repo_name),
    )?;
    ensure_repo_exists(
        &source_repo_path,
        "Open this project first so its files finish downloading.",
    )?;
    ensure_valid_git_repo(
        &source_repo_path,
        "The source project repo is missing or invalid.",
    )?;
    ensure_clean_git_repo(
        &source_repo_path,
        "The source project has uncommitted changes. Wait for its current save or sync to finish, then try again.",
    )?;
    ensure_current_project_layout(&source_repo_path)?;
    let source_chapters = load_active_source_chapters(&source_repo_path)?;
    let total_chapters = source_chapters.len();

    emit_stage(
        app,
        input,
        "Preparing the destination project...",
        0,
        total_chapters,
    );
    let target = &input.target;
    let descriptor = ProjectRepoSyncDescriptor {
        project_id: target.project_id.clone(),
        repo_name: target.repo_name.clone(),
        full_name: target.full_name.clone(),
        repo_id: target.repo_id,
        default_branch_name: target.default_branch_name.clone(),
        default_branch_head_oid: target.default_branch_head_oid.clone(),
        lifecycle_state: target.lifecycle_state.clone(),
        record_state: target.record_state.clone(),
        remote_state: target.remote_state.clone(),
        status: target.status.clone(),
    };
    let target_repo_path = resolve_or_desired_project_git_repo_path(
        app,
        target.installation_id,
        Some(&target.project_id),
        &target.repo_name,
    )?;
    let transport_token = load_git_transport_token(target.installation_id, session_token)?;
    sync_project_repo(
        app,
        &descriptor,
        &target_repo_path,
        target
            .default_branch_head_oid
            .as_deref()
            .unwrap_or_default(),
        &transport_token,
    )?;
    ensure_valid_git_repo(
        &target_repo_path,
        "The destination project repo is missing or invalid.",
    )?;
    ensure_clean_git_repo(
        &target_repo_path,
        "The destination project has uncommitted changes.",
    )?;
    ensure_local_commit_preconditions(app, &target_repo_path)?;

    let mut written = Vec::new();
    for (index, mut source_chapter) in source_chapters.into_iter().enumerate() {
        emit_stage(
            app,
            input,
            &format!("Copying file {} of {}…", index + 1, total_chapters),
            index,
            total_chapters,
        );
        match write_chapter_copy(
            &source_repo_path,
            &source_chapter.chapter_path,
            &mut source_chapter.chapter_file,
            &source_chapter.rows,
            &target_repo_path,
            input.glossary.as_ref(),
            true,
        ) {
            Ok(copy) => written.push(copy),
            Err(error) => {
                return Err(combine_cleanup_error(&target_repo_path, &written, error));
            }
        }
    }

    if let Err(error) = commit_project_transfer(app, input, &target_repo_path) {
        return Err(combine_cleanup_error(&target_repo_path, &written, error));
    }

    emit_stage(
        app,
        input,
        "Syncing the transferred project to GitHub...",
        total_chapters,
        total_chapters,
    );
    sync_project_repo(app, &descriptor, &target_repo_path, "", &transport_token).map_err(
        |error| {
            format!(
                "The transferred content was committed locally, but could not be pushed to GitHub: {error}"
            )
        },
    )?;

    Ok(ProjectTransferOutcome {
        copied_chapters: total_chapters,
        target_project_title: target.project_title.clone(),
    })
}

fn ensure_current_project_layout(repo_path: &Path) -> Result<(), String> {
    match read_repo_layout_metadata_state(repo_path) {
        RepoLayoutMetadataState::Readable(metadata)
            if metadata.repo_kind == RepoKind::Project
                && metadata.storage_layout_version == STORAGE_LAYOUT_VERSION_V2 =>
        {
            Ok(())
        }
        RepoLayoutMetadataState::Unreadable(detail) => Err(format!(
            "The source project layout metadata could not be read: {detail}"
        )),
        _ => Err(
            "Open this project once so Gnosis TMS can finish migrating its local files, then try the transfer again."
                .to_string(),
        ),
    }
}

fn load_active_source_chapters(repo_path: &Path) -> Result<Vec<SourceChapter>, String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Err("The source project has no active files to transfer.".to_string());
    }
    let mut chapters = Vec::new();
    for entry in fs::read_dir(&chapters_root)
        .map_err(|error| format!("Could not read the source project files: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect a source project file: {error}"))?;
        let chapter_path = entry.path();
        let chapter_json = chapter_path.join("chapter.json");
        if !chapter_path.is_dir() || !chapter_json.exists() {
            continue;
        }
        let chapter_file: StoredChapterFile = read_json_file(&chapter_json, "chapter.json")?;
        if chapter_file.lifecycle.state == "deleted" {
            continue;
        }
        let rows = load_editor_rows(&chapter_path.join("rows"))?;
        chapters.push(SourceChapter {
            chapter_path,
            chapter_file,
            rows,
        });
    }
    chapters.sort_by(|left, right| {
        left.chapter_file
            .title
            .to_lowercase()
            .cmp(&right.chapter_file.title.to_lowercase())
            .then_with(|| {
                left.chapter_file
                    .chapter_id
                    .cmp(&right.chapter_file.chapter_id)
            })
    });
    if chapters.is_empty() {
        return Err("The source project has no active files to transfer.".to_string());
    }
    Ok(chapters)
}

fn commit_project_transfer(
    app: &AppHandle,
    input: &ProjectTransferInput,
    target_repo_path: &Path,
) -> Result<(), String> {
    let staged_paths = [".gitattributes", "chapters"];
    git_output(target_repo_path, &["add", staged_paths[0], staged_paths[1]])?;
    let target_title = input.target.project_title.trim();
    let source_title = input.source.project_title.trim();
    let message = match (target_title.is_empty(), source_title.is_empty()) {
        (false, false) => format!("Transfer {target_title} from {source_title}"),
        (false, true) => format!("Transfer {target_title} from another team"),
        (true, false) => format!("Transfer project from {source_title}"),
        (true, true) => "Transfer project from another team".to_string(),
    };
    git_commit_as_signed_in_user_with_metadata(
        app,
        target_repo_path,
        &message,
        &staged_paths,
        CommitMetadata {
            operation: Some("team-project-transfer"),
            migration: None,
            status_note: None,
            ai_model: None,
        },
    )?;
    Ok(())
}

fn combine_cleanup_error(
    target_repo_path: &Path,
    written: &[WrittenChapterCopy],
    error: String,
) -> String {
    let mut cleanup_errors = Vec::new();
    for copy in written.iter().rev() {
        if let Err(cleanup_error) = cleanup_chapter_copy(target_repo_path, copy) {
            cleanup_errors.push(cleanup_error);
        }
    }
    if cleanup_errors.is_empty() {
        error
    } else {
        format!(
            "{error} Cleaning up the partial transfer also failed: {}",
            cleanup_errors.join(" ")
        )
    }
}

fn emit_stage(
    app: &AppHandle,
    input: &ProjectTransferInput,
    message: &str,
    copied_chapters: usize,
    total_chapters: usize,
) {
    emit_transfer_progress(
        app,
        ProjectTransferProgressPayload {
            job_id: input.job_id.clone(),
            status: "progress",
            message: message.to_string(),
            copied_chapters,
            total_chapters,
            target_project_title: input.target.project_title.clone(),
        },
    );
}

fn emit_transfer_progress(app: &AppHandle, payload: ProjectTransferProgressPayload) {
    let _ = app.emit(TEAM_PROJECT_TRANSFER_PROGRESS_EVENT, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "gnosis-tms-project-transfer-{label}-{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn write_chapter(repo_path: &Path, slug: &str, id: &str, title: &str, state: &str) {
        let chapter_path = repo_path.join("chapters").join(slug);
        fs::create_dir_all(chapter_path.join("rows")).expect("chapter folders should be created");
        write_json_pretty(
            &chapter_path.join("chapter.json"),
            &serde_json::json!({
                "chapter_id": id,
                "title": title,
                "lifecycle": { "state": state },
                "languages": []
            }),
        )
        .expect("chapter should be written");
    }

    #[test]
    fn current_layout_validation_rejects_missing_metadata() {
        let repo_path = temp_dir("layout");
        assert!(ensure_current_project_layout(&repo_path).is_err());
        write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))
            .expect("layout metadata should write");
        assert!(ensure_current_project_layout(&repo_path).is_ok());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn source_enumeration_skips_deleted_chapters_and_sorts_titles() {
        let repo_path = temp_dir("chapters");
        write_chapter(&repo_path, "zulu", "chapter-z", "Zulu", "active");
        write_chapter(&repo_path, "alpha", "chapter-a", "Alpha", "active");
        write_chapter(
            &repo_path,
            "deleted",
            "chapter-deleted",
            "Deleted",
            "deleted",
        );

        let chapters =
            load_active_source_chapters(&repo_path).expect("active chapters should load");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].chapter_file.title, "Alpha");
        assert_eq!(chapters[1].chapter_file.title, "Zulu");
        let _ = fs::remove_dir_all(repo_path);
    }
}
