use super::*;

use std::{panic::AssertUnwindSafe, sync::OnceLock};

use tauri::{Emitter, Manager};

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
use crate::util::atomic_replace;

const PROJECT_TRANSFER_JOBS_DIR: &str = "project-transfer-jobs";

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
    org_login: String,
    project_id: String,
    repo_name: String,
    metadata_repo_name: String,
    #[serde(default)]
    previous_repo_names: Vec<String>,
    full_name: String,
    #[serde(default)]
    repo_id: Option<i64>,
    #[serde(default)]
    node_id: Option<String>,
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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectTransferStatus {
    job_id: String,
    status: String,
    message: String,
    copied_chapters: usize,
    total_chapters: usize,
    target_project_title: String,
    runner_id: String,
    recovery: ProjectTransferRecovery,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTransferRecovery {
    target_installation_id: i64,
    target_org_login: String,
    target_project_id: String,
    target_repo_name: String,
    metadata_repo_name: String,
    previous_repo_names: Vec<String>,
    target_full_name: String,
    target_repo_id: Option<i64>,
    target_node_id: Option<String>,
    target_default_branch: String,
    target_lifecycle_state: String,
    target_record_state: String,
    target_remote_state: String,
    source_project_title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectTransferStatusInput {
    job_id: String,
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
        || input.target.org_login.trim().is_empty()
        || input.target.repo_name.trim().is_empty()
        || input.target.metadata_repo_name.trim().is_empty()
        || input.target.full_name.trim().is_empty()
    {
        return Err("Could not determine the destination project.".to_string());
    }
    if session_token.trim().is_empty() {
        return Err("Sign in again to transfer this project.".to_string());
    }

    persist_transfer_status(
        &app,
        transfer_status(&input, "running", "Starting the transfer...", 0, 0),
    )?;

    tauri::async_runtime::spawn_blocking(move || {
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
            run_project_transfer(&app, &input, &session_token)
        }))
        .unwrap_or_else(|_| {
            Err("The project transfer failed unexpectedly. Please try again.".to_string())
        });

        let status = match outcome {
            Ok(outcome) => transfer_status(
                &input,
                "success",
                &format!("Transferred \"{}\".", outcome.target_project_title),
                outcome.copied_chapters,
                outcome.copied_chapters,
            ),
            Err(error) => transfer_status(&input, "error", &error, 0, 0),
        };
        let status = match persist_transfer_status(&app, status.clone()) {
            Ok(()) => status,
            Err(error) => {
                let failure_status = transfer_status(
                    &input,
                    "error",
                    &format!(
                        "{} The durable transfer result could not be recorded: {error}",
                        status.message
                    ),
                    status.copied_chapters,
                    status.total_chapters,
                );
                let _ = persist_transfer_status(&app, failure_status.clone());
                failure_status
            }
        };
        emit_transfer_progress(&app, status);
    });

    Ok(())
}

pub(crate) fn get_project_transfer_status(
    app: &AppHandle,
    input: ProjectTransferStatusInput,
) -> Result<Option<ProjectTransferStatus>, String> {
    let path = project_transfer_status_path(app, &input.job_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let status = read_transfer_status(&path)?;
    Ok(Some(mark_interrupted_transfer_if_needed(app, status)?))
}

pub(crate) fn list_project_transfer_statuses(
    app: &AppHandle,
) -> Result<Vec<ProjectTransferStatus>, String> {
    let jobs_dir = project_transfer_jobs_dir(app)?;
    if !jobs_dir.exists() {
        return Ok(Vec::new());
    }
    let mut statuses = Vec::new();
    for entry in fs::read_dir(&jobs_dir)
        .map_err(|error| format!("Could not read the project transfer journal: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Could not inspect a project transfer journal: {error}"))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Could not inspect a project transfer status: {error}"))?
            .is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        let status = read_transfer_status(&entry.path())?;
        statuses.push(mark_interrupted_transfer_if_needed(app, status)?);
    }
    statuses.sort_by(|left, right| left.job_id.cmp(&right.job_id));
    Ok(statuses)
}

pub(crate) fn acknowledge_project_transfer_status(
    app: &AppHandle,
    input: ProjectTransferStatusInput,
) -> Result<(), String> {
    let path = project_transfer_status_path(app, &input.job_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| {
            format!("Could not acknowledge the project transfer result: {error}")
        })?;
    }
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
    let canonical_repo_path = repo_path
        .canonicalize()
        .map_err(|error| format!("Could not validate the source project folder: {error}"))?;
    let canonical_chapters_root = chapters_root
        .canonicalize()
        .map_err(|error| format!("Could not validate the source project files: {error}"))?;
    if !canonical_chapters_root.starts_with(&canonical_repo_path) {
        return Err(
            "The source project chapters folder resolves outside the project repo.".to_string(),
        );
    }
    let mut chapters = Vec::new();
    for entry in fs::read_dir(&canonical_chapters_root)
        .map_err(|error| format!("Could not read the source project files: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect a source project file: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect a source project file: {error}"))?;
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        let chapter_path = entry
            .path()
            .canonicalize()
            .map_err(|error| format!("Could not validate a source project file: {error}"))?;
        if chapter_path.parent() != Some(canonical_chapters_root.as_path()) {
            return Err(
                "A source chapter resolves outside the project chapters folder.".to_string(),
            );
        }
        let chapter_json = chapter_path.join("chapter.json");
        if !chapter_json.exists() {
            continue;
        }
        reject_symlink(&chapter_json, "source chapter metadata")?;
        let rows_path = chapter_path.join("rows");
        reject_symlink(&rows_path, "source chapter rows folder")?;
        reject_symlinked_row_files(&rows_path)?;
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

fn reject_symlink(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect the {label}: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("The {label} cannot be a symbolic link."));
    }
    Ok(())
}

fn reject_symlinked_row_files(rows_path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(rows_path)
        .map_err(|error| format!("Could not read the source chapter rows: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect a source chapter row: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("Could not inspect a source chapter row: {error}"))?
            .is_symlink()
        {
            return Err("Source chapter row files cannot be symbolic links.".to_string());
        }
    }
    Ok(())
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
    let status = transfer_status(input, "progress", message, copied_chapters, total_chapters);
    let _ = persist_transfer_status(app, status.clone());
    emit_transfer_progress(app, status);
}

fn emit_transfer_progress(app: &AppHandle, payload: ProjectTransferStatus) {
    let _ = app.emit(TEAM_PROJECT_TRANSFER_PROGRESS_EVENT, payload);
}

fn transfer_status(
    input: &ProjectTransferInput,
    status: &str,
    message: &str,
    copied_chapters: usize,
    total_chapters: usize,
) -> ProjectTransferStatus {
    ProjectTransferStatus {
        job_id: input.job_id.clone(),
        status: status.to_string(),
        message: message.to_string(),
        copied_chapters,
        total_chapters,
        target_project_title: input.target.project_title.clone(),
        runner_id: project_transfer_runner_id().to_string(),
        recovery: ProjectTransferRecovery {
            target_installation_id: input.target.installation_id,
            target_org_login: input.target.org_login.clone(),
            target_project_id: input.target.project_id.clone(),
            target_repo_name: input.target.repo_name.clone(),
            metadata_repo_name: input.target.metadata_repo_name.clone(),
            previous_repo_names: input.target.previous_repo_names.clone(),
            target_full_name: input.target.full_name.clone(),
            target_repo_id: input.target.repo_id,
            target_node_id: input.target.node_id.clone(),
            target_default_branch: input
                .target
                .default_branch_name
                .clone()
                .unwrap_or_else(|| "main".to_string()),
            target_lifecycle_state: input
                .target
                .lifecycle_state
                .clone()
                .unwrap_or_else(|| "active".to_string()),
            target_record_state: input
                .target
                .record_state
                .clone()
                .unwrap_or_else(|| "live".to_string()),
            target_remote_state: input
                .target
                .remote_state
                .clone()
                .unwrap_or_else(|| "linked".to_string()),
            source_project_title: input.source.project_title.clone(),
        },
    }
}

fn project_transfer_runner_id() -> &'static str {
    static RUNNER_ID: OnceLock<String> = OnceLock::new();
    RUNNER_ID
        .get_or_init(|| uuid::Uuid::now_v7().to_string())
        .as_str()
}

fn project_transfer_jobs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(PROJECT_TRANSFER_JOBS_DIR))
        .map_err(|error| format!("Could not locate the project transfer journal: {error}"))
}

fn project_transfer_status_path(app: &AppHandle, job_id: &str) -> Result<PathBuf, String> {
    let normalized = job_id.trim();
    if normalized.is_empty()
        || normalized.len() > 128
        || !normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("The project transfer job id is invalid.".to_string());
    }
    Ok(project_transfer_jobs_dir(app)?.join(format!("{normalized}.json")))
}

fn persist_transfer_status(app: &AppHandle, status: ProjectTransferStatus) -> Result<(), String> {
    let path = project_transfer_status_path(app, &status.job_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Could not locate the project transfer journal folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the project transfer journal: {error}"))?;
    let bytes = serde_json::to_vec_pretty(&status)
        .map_err(|error| format!("Could not serialize the project transfer status: {error}"))?;
    write_transfer_status_file(&path, &bytes)
}

fn write_transfer_status_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, bytes)
        .map_err(|error| format!("Could not write the project transfer status: {error}"))?;
    atomic_replace(&temporary_path, path)
        .map_err(|error| format!("Could not publish the project transfer status: {error}"))
}

fn read_transfer_status(path: &Path) -> Result<ProjectTransferStatus, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read the project transfer status: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse the project transfer status: {error}"))
}

fn mark_interrupted_transfer_if_needed(
    app: &AppHandle,
    mut status: ProjectTransferStatus,
) -> Result<ProjectTransferStatus, String> {
    if matches!(status.status.as_str(), "running" | "progress")
        && status.runner_id != project_transfer_runner_id()
    {
        status.status = "error".to_string();
        status.message =
            "The app closed before the project transfer finished. The destination will be rolled back."
                .to_string();
        persist_transfer_status(app, status.clone())?;
    }
    Ok(status)
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
    fn transfer_status_file_replaces_an_existing_journal() {
        let journal_dir = temp_dir("journal-replacement");
        let journal_path = journal_dir.join("job.json");
        fs::write(&journal_path, b"running").expect("initial journal should write");

        write_transfer_status_file(&journal_path, b"success")
            .expect("existing journal should be replaced");

        assert_eq!(
            fs::read(&journal_path).expect("replacement journal should read"),
            b"success"
        );
        assert!(!journal_path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(journal_dir);
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

    #[cfg(unix)]
    #[test]
    fn source_enumeration_does_not_follow_symlinked_chapter_directories() {
        use std::os::unix::fs::symlink;

        let repo_path = temp_dir("symlinked-chapter");
        write_chapter(&repo_path, "inside", "chapter-inside", "Inside", "active");
        let outside_path = temp_dir("outside-chapter");
        write_chapter(
            &outside_path,
            "outside",
            "chapter-outside",
            "Outside",
            "active",
        );
        symlink(
            outside_path.join("chapters/outside"),
            repo_path.join("chapters/outside-link"),
        )
        .expect("chapter symlink should be created");

        let chapters = load_active_source_chapters(&repo_path).expect("safe chapters should load");
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].chapter_file.chapter_id, "chapter-inside");

        let _ = fs::remove_dir_all(repo_path);
        let _ = fs::remove_dir_all(outside_path);
    }

    #[cfg(unix)]
    #[test]
    fn source_enumeration_rejects_symlinked_metadata_and_rows() {
        use std::os::unix::fs::symlink;

        let metadata_repo = temp_dir("symlinked-metadata");
        let metadata_chapter = metadata_repo.join("chapters/chapter");
        fs::create_dir_all(metadata_chapter.join("rows")).expect("chapter rows should be created");
        let outside_metadata = metadata_repo.join("outside.json");
        fs::write(
            &outside_metadata,
            r#"{"chapter_id":"outside","title":"Outside","lifecycle":{"state":"active"},"languages":[]}"#,
        )
        .expect("outside metadata should write");
        symlink(&outside_metadata, metadata_chapter.join("chapter.json"))
            .expect("metadata symlink should be created");
        let metadata_error = match load_active_source_chapters(&metadata_repo) {
            Ok(_) => panic!("symlinked metadata must be rejected"),
            Err(error) => error,
        };
        assert!(metadata_error.contains("symbolic link"));
        let _ = fs::remove_dir_all(metadata_repo);

        let rows_repo = temp_dir("symlinked-row");
        write_chapter(&rows_repo, "chapter", "chapter-1", "Chapter", "active");
        let outside_row = rows_repo.join("outside-row.json");
        fs::write(&outside_row, "{}").expect("outside row should write");
        symlink(
            &outside_row,
            rows_repo.join("chapters/chapter/rows/row.json"),
        )
        .expect("row symlink should be created");
        let rows_error = match load_active_source_chapters(&rows_repo) {
            Ok(_) => panic!("symlinked row files must be rejected"),
            Err(error) => error,
        };
        assert!(rows_error.contains("symbolic links"));
        let _ = fs::remove_dir_all(rows_repo);
    }
}
