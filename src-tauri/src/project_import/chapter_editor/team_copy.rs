use super::*;

use std::collections::BTreeSet;
use std::panic::AssertUnwindSafe;

use tauri::Emitter;
use uuid::Uuid;

use super::super::project_git::ensure_clean_git_repo;
use crate::constants::TEAM_CHAPTER_COPY_PROGRESS_EVENT;
use crate::git_commit::ensure_local_commit_preconditions;
use crate::project_repo_paths::resolve_or_desired_project_git_repo_path;
use crate::project_repo_sync::{sync_project_repo, ProjectRepoSyncDescriptor};
use crate::repo_sync_shared::load_git_transport_token;
use crate::short_path_names::allocate_short_folder_name;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamChapterCopyInput {
    job_id: String,
    /// Title (file name) for the copied chapter; falls back to the source
    /// chapter title when blank.
    #[serde(default)]
    title: String,
    source: TeamChapterCopySource,
    target: TeamChapterCopyTarget,
    /// The target team's default glossary, applied to the copy exactly like a
    /// fresh import would apply it. The source link never survives (its ids
    /// are team-scoped); None leaves the copy without a glossary.
    #[serde(default)]
    default_glossary: Option<TeamCopyDefaultGlossaryInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamCopyDefaultGlossaryInput {
    glossary_id: String,
    repo_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamChapterCopySource {
    installation_id: i64,
    project_id: Option<String>,
    repo_name: String,
    chapter_id: String,
    #[serde(default)]
    project_title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamChapterCopyTarget {
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
    project_title: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamChapterCopyProgressPayload {
    job_id: String,
    status: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chapter_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chapter_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_project_title: Option<String>,
}

struct TeamChapterCopyOutcome {
    chapter_id: String,
    chapter_title: String,
    target_project_title: Option<String>,
}

/// Validates input, then runs the copy in a background task. The IPC call
/// returns immediately; all progress and the final outcome are delivered via
/// `team-chapter-copy-progress` events keyed by `jobId`.
pub(crate) fn start_team_chapter_copy(
    app: AppHandle,
    input: TeamChapterCopyInput,
    session_token: String,
) -> Result<(), String> {
    if input.job_id.trim().is_empty() {
        return Err("The chapter copy is missing a job id.".to_string());
    }
    if input.source.chapter_id.trim().is_empty() || input.source.repo_name.trim().is_empty() {
        return Err("Could not find the open file.".to_string());
    }
    if input.target.project_id.trim().is_empty() || input.target.repo_name.trim().is_empty() {
        return Err("Choose the destination project first.".to_string());
    }
    if session_token.trim().is_empty() {
        return Err("Sign in again to copy chapters between teams.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let job_id = input.job_id.clone();
        // catch_unwind so a panic in the copy still produces a terminal event —
        // otherwise the UI would wait on "exporting" forever.
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
            run_team_chapter_copy(&app, &input, &session_token)
        }))
        .unwrap_or_else(|_| {
            Err("The chapter copy failed unexpectedly. Please try again.".to_string())
        });

        match outcome {
            Ok(outcome) => emit_copy_progress(
                &app,
                TeamChapterCopyProgressPayload {
                    job_id,
                    status: "success",
                    message: format!("Copied \"{}\".", outcome.chapter_title),
                    chapter_id: Some(outcome.chapter_id),
                    chapter_title: Some(outcome.chapter_title),
                    target_project_title: outcome.target_project_title,
                },
            ),
            Err(error) => emit_copy_progress(
                &app,
                TeamChapterCopyProgressPayload {
                    job_id,
                    status: "error",
                    message: error,
                    chapter_id: None,
                    chapter_title: None,
                    target_project_title: None,
                },
            ),
        }
    });

    Ok(())
}

fn run_team_chapter_copy(
    app: &AppHandle,
    input: &TeamChapterCopyInput,
    session_token: &str,
) -> Result<TeamChapterCopyOutcome, String> {
    let source = &input.source;
    let target = &input.target;

    let source_repo_path = resolve_project_git_repo_path(
        app,
        source.installation_id,
        source.project_id.as_deref(),
        Some(&source.repo_name),
    )?;
    ensure_repo_exists(
        &source_repo_path,
        "The local project repo is not available yet.",
    )?;
    ensure_valid_git_repo(
        &source_repo_path,
        "The local project repo is missing or invalid.",
    )?;
    let source_chapter_path =
        find_chapter_path_by_id(app, &source_repo_path.join("chapters"), &source.chapter_id)?;
    let mut chapter_file: StoredChapterFile =
        read_json_file(&source_chapter_path.join("chapter.json"), "chapter.json")?;
    let rows = load_editor_rows(&source_chapter_path.join("rows"))?;

    emit_stage(app, &input.job_id, "Preparing the destination project...");
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
    // The destination may be any writable project — another team, the same
    // team, or even the same project (which duplicates the chapter).
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
        "The destination project has uncommitted changes. Open that team so it can finish syncing first.",
    )?;
    // Same gates content writes get: signed-in session + installation write access.
    ensure_local_commit_preconditions(app, &target_repo_path)?;

    emit_stage(app, &input.job_id, "Copying the chapter...");
    let requested_title = input.title.trim();
    if !requested_title.is_empty() {
        chapter_file.title = requested_title.to_string();
    }
    let chapter_title = chapter_file.title.clone();
    let written = write_chapter_copy(
        &source_repo_path,
        &mut chapter_file,
        &rows,
        &target_repo_path,
        input.default_glossary.as_ref(),
    )?;

    if let Err(error) = commit_chapter_copy(
        app,
        &target_repo_path,
        &written,
        &chapter_title,
        source.project_title.as_deref(),
    ) {
        // Unstage and remove the written chapter so a failed commit cannot strand
        // a dirty destination tree.
        let cleanup = cleanup_chapter_copy(&target_repo_path, &written);
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => {
                format!("{error} Cleaning up the partial copy also failed: {cleanup_error}")
            }
        });
    }

    emit_stage(
        app,
        &input.job_id,
        "Syncing the destination project to GitHub...",
    );
    if let Err(error) = sync_project_repo(app, &descriptor, &target_repo_path, "", &transport_token)
    {
        return Err(format!(
            "The chapter was copied and committed locally, but syncing it to GitHub failed: {error} It will finish syncing the next time the destination team is opened."
        ));
    }

    Ok(TeamChapterCopyOutcome {
        chapter_id: written.chapter_id,
        chapter_title,
        target_project_title: target.project_title.clone(),
    })
}

struct WrittenChapterCopy {
    chapter_id: String,
    relative_chapter_path: String,
    absolute_chapter_path: PathBuf,
    gitattributes_existed: bool,
}

/// Writes a faithful copy of the chapter into the target repo: fresh chapter and
/// row ids, the source's team-scoped glossary link replaced by the target
/// team's default glossary (as an import would), uploaded image assets copied
/// with their row paths rewritten to the new chapter slug. Everything else —
/// languages, content, footnotes, captions, text styles, review states,
/// comments, soft-deleted rows, order keys — carries over verbatim.
fn write_chapter_copy(
    source_repo_path: &Path,
    chapter_file: &mut StoredChapterFile,
    rows: &[StoredRowFile],
    target_repo_path: &Path,
    target_default_glossary: Option<&TeamCopyDefaultGlossaryInput>,
) -> Result<WrittenChapterCopy, String> {
    let chapters_root = target_repo_path.join("chapters");
    let chapter_slug =
        allocate_short_folder_name(&chapter_file.title, existing_folder_names(&chapters_root)?);
    let chapter_path = chapters_root.join(&chapter_slug);
    let rows_path = chapter_path.join("rows");
    let gitattributes_existed = target_repo_path.join(".gitattributes").exists();
    let chapter_id = Uuid::now_v7().to_string();

    let result = (|| -> Result<String, String> {
        fs::create_dir_all(&rows_path)
            .map_err(|error| format!("Could not create the copied rows folder: {error}"))?;
        ensure_gitattributes(&target_repo_path.join(".gitattributes"))?;

        chapter_file.chapter_id = chapter_id.clone();
        // The source glossary link is a team-scoped id that would dangle in
        // the target team; replace it with the target team's default (mirrors
        // how imports assign the team default glossary), or clear it.
        match target_default_glossary {
            Some(link) => {
                let settings = chapter_file
                    .settings
                    .get_or_insert_with(StoredChapterSettings::default);
                settings.linked_glossaries = Some(StoredChapterLinkedGlossaries {
                    glossary: Some(StoredChapterGlossaryLink {
                        glossary_id: link.glossary_id.clone(),
                        repo_name: link.repo_name.clone(),
                    }),
                });
            }
            None => {
                if let Some(settings) = chapter_file.settings.as_mut() {
                    settings.linked_glossaries = None;
                }
            }
        }
        write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

        let mut copied_image_names = BTreeSet::new();
        for row in rows {
            let mut copy = row.clone();
            copy.row_id = Uuid::now_v7().to_string();
            copy_row_images(
                source_repo_path,
                target_repo_path,
                &chapter_slug,
                &mut copy,
                &mut copied_image_names,
            )?;
            write_json_pretty(&rows_path.join(format!("{}.json", copy.row_id)), &copy)?;
        }

        repo_relative_path(target_repo_path, &chapter_path)
    })();

    match result {
        Ok(relative_chapter_path) => Ok(WrittenChapterCopy {
            chapter_id,
            relative_chapter_path,
            absolute_chapter_path: chapter_path,
            gitattributes_existed,
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&chapter_path);
            let gitattributes_path = target_repo_path.join(".gitattributes");
            if !gitattributes_existed && gitattributes_path.exists() {
                let _ = fs::remove_file(gitattributes_path);
            }
            Err(error)
        }
    }
}

/// Copies each uploaded image asset referenced by the row into the new chapter's
/// `images/` folder and rewrites the stored repo-relative path. A missing or
/// unreadable source asset drops the image from the copy (the reference was
/// already broken) rather than failing the whole copy. URL images pass through.
fn copy_row_images(
    source_repo_path: &Path,
    target_repo_path: &Path,
    chapter_slug: &str,
    row: &mut StoredRowFile,
    copied_image_names: &mut BTreeSet<String>,
) -> Result<(), String> {
    for field in row.fields.values_mut() {
        let Some(image) = field.image.as_mut() else {
            continue;
        };
        if image.kind != "upload" {
            continue;
        }
        // Stored paths from earlier Windows sessions may use backslashes.
        let Some(relative_path) = image
            .path
            .as_deref()
            .map(|path| path.replace('\\', "/"))
            .filter(|path| !path.trim().is_empty())
        else {
            field.image = None;
            continue;
        };

        let Ok(bytes) = fs::read(source_repo_path.join(&relative_path)) else {
            field.image = None;
            continue;
        };

        let base_name = relative_path
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_string();
        let file_name = unique_copied_image_name(&base_name, copied_image_names);
        let new_relative_path = format!("chapters/{chapter_slug}/images/{file_name}");
        let absolute_path = target_repo_path.join(&new_relative_path);
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Could not create the copied images folder '{}': {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(&absolute_path, &bytes).map_err(|error| {
            format!(
                "Could not write the copied image '{}': {error}",
                absolute_path.display()
            )
        })?;
        image.path = Some(new_relative_path);
    }

    Ok(())
}

/// Image basenames are unique within a source chapter, but normalized Windows
/// paths or odd history can collide; suffix duplicates instead of overwriting.
fn unique_copied_image_name(base_name: &str, taken: &mut BTreeSet<String>) -> String {
    let fallback = "image".to_string();
    let base_name = if base_name.trim().is_empty() {
        &fallback
    } else {
        base_name
    };
    let (stem, extension) = match base_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), Some(extension)),
        _ => (base_name.to_string(), None),
    };

    let mut candidate = base_name.to_string();
    let mut counter = 1usize;
    while taken.contains(&candidate) {
        counter += 1;
        candidate = match extension {
            Some(extension) => format!("{stem}-{counter}.{extension}"),
            None => format!("{stem}-{counter}"),
        };
    }
    taken.insert(candidate.clone());
    candidate
}

fn existing_folder_names(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Could not read '{}': {error}", path.display()))?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

fn commit_chapter_copy(
    app: &AppHandle,
    target_repo_path: &Path,
    written: &WrittenChapterCopy,
    chapter_title: &str,
    source_project_title: Option<&str>,
) -> Result<(), String> {
    let staged_paths = [
        ".gitattributes".to_string(),
        written.relative_chapter_path.clone(),
    ];
    let mut args = vec!["add"];
    for path in &staged_paths {
        args.push(path.as_str());
    }
    git_output(target_repo_path, &args)?;

    let message = match source_project_title
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        Some(project_title) => format!("Copy {chapter_title} from {project_title}"),
        None => format!("Copy {chapter_title} from another team"),
    };
    let commit_paths = staged_paths.iter().map(String::as_str).collect::<Vec<_>>();
    git_commit_as_signed_in_user_with_metadata(
        app,
        target_repo_path,
        &message,
        &commit_paths,
        CommitMetadata {
            operation: Some("team-chapter-copy"),
            migration: None,
            status_note: None,
            ai_model: None,
        },
    )?;
    Ok(())
}

fn cleanup_chapter_copy(
    target_repo_path: &Path,
    written: &WrittenChapterCopy,
) -> Result<(), String> {
    for path in [".gitattributes", written.relative_chapter_path.as_str()] {
        let _ = git_output(target_repo_path, &["reset", "--", path]);
    }

    let mut cleanup_errors = Vec::new();
    if let Err(error) = fs::remove_dir_all(&written.absolute_chapter_path) {
        if written.absolute_chapter_path.exists() {
            cleanup_errors.push(format!(
                "Could not remove '{}': {error}",
                written.absolute_chapter_path.display()
            ));
        }
    }
    let gitattributes_path = target_repo_path.join(".gitattributes");
    if !written.gitattributes_existed && gitattributes_path.exists() {
        if let Err(error) = fs::remove_file(&gitattributes_path) {
            cleanup_errors.push(format!(
                "Could not remove '{}': {error}",
                gitattributes_path.display()
            ));
        }
    }

    if cleanup_errors.is_empty() {
        Ok(())
    } else {
        Err(cleanup_errors.join(" "))
    }
}

fn emit_stage(app: &AppHandle, job_id: &str, message: &str) {
    emit_copy_progress(
        app,
        TeamChapterCopyProgressPayload {
            job_id: job_id.to_string(),
            status: "progress",
            message: message.to_string(),
            chapter_id: None,
            chapter_title: None,
            target_project_title: None,
        },
    );
}

fn emit_copy_progress(app: &AppHandle, payload: TeamChapterCopyProgressPayload) {
    let _ = app.emit(TEAM_CHAPTER_COPY_PROGRESS_EVENT, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_language(code: &str, role: &str) -> ChapterLanguage {
        ChapterLanguage {
            code: code.to_string(),
            name: code.to_string(),
            role: role.to_string(),
            base_code: None,
        }
    }

    fn test_chapter_file(title: &str) -> StoredChapterFile {
        StoredChapterFile {
            chapter_id: "source-chapter".to_string(),
            title: title.to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: vec![test_language("es", "source"), test_language("en", "target")],
            settings: Some(StoredChapterSettings {
                linked_glossaries: Some(StoredChapterLinkedGlossaries {
                    glossary: Some(StoredChapterGlossaryLink {
                        glossary_id: "glossary-1".to_string(),
                        repo_name: "glossary-repo".to_string(),
                    }),
                }),
                default_source_language: Some("es".to_string()),
                default_target_language: Some("en".to_string()),
                workflow_status: Some("translating".to_string()),
            }),
            source_word_count: Some(2),
        }
    }

    fn test_row(row_id: &str, order_key: &str, text: &str) -> StoredRowFile {
        let mut fields = BTreeMap::new();
        fields.insert(
            "en".to_string(),
            StoredFieldValue {
                plain_text: text.to_string(),
                footnote: "a note".to_string(),
                image_caption: String::new(),
                image: None,
                editor_flags: StoredFieldEditorFlags::default(),
            },
        );
        StoredRowFile {
            row_id: row_id.to_string(),
            external_id: Some("ext-1".to_string()),
            guidance: None,
            lifecycle: active_row_lifecycle_state(),
            structure: StoredRowStructure {
                order_key: order_key.to_string(),
            },
            status: StoredRowStatus {
                review_state: "reviewed".to_string(),
            },
            origin: StoredRowOrigin {
                source_row_number: 1,
            },
            editor_comments_revision: 3,
            editor_comments: Vec::new(),
            text_style: Some("heading1".to_string()),
            fields,
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "gnosis-tms-team-copy-{label}-{}-{}",
            std::process::id(),
            Uuid::now_v7()
        ));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn read_copied_rows(chapter_path: &Path) -> Vec<StoredRowFile> {
        load_editor_rows(&chapter_path.join("rows")).expect("copied rows should load")
    }

    #[test]
    fn chapter_copy_mints_fresh_ids_and_preserves_content() {
        let source_repo = temp_dir("source");
        let target_repo = temp_dir("target");

        let mut chapter_file = test_chapter_file("Chapter One");
        let mut deleted = test_row("row-2", "00000000000000000000000000000002", "Deleted");
        deleted.lifecycle.state = "deleted".to_string();
        let rows = vec![
            test_row("row-1", "00000000000000000000000000000001", "Hello"),
            deleted,
        ];

        let written =
            write_chapter_copy(&source_repo, &mut chapter_file, &rows, &target_repo, None)
                .expect("copy should write");
        let _ = fs::remove_dir_all(&source_repo);

        assert_ne!(written.chapter_id, "source-chapter");
        let copied_chapter: StoredChapterFile = read_json_file(
            &written.absolute_chapter_path.join("chapter.json"),
            "chapter.json",
        )
        .expect("copied chapter.json should read");
        assert_eq!(copied_chapter.chapter_id, written.chapter_id);
        assert_eq!(copied_chapter.title, "Chapter One");
        // Glossary links are team-scoped and must not survive the copy.
        let settings = copied_chapter.settings.expect("settings should carry over");
        assert!(settings.linked_glossaries.is_none());
        assert_eq!(settings.default_target_language.as_deref(), Some("en"));
        assert_eq!(settings.workflow_status.as_deref(), Some("translating"));
        assert_eq!(copied_chapter.languages.len(), 2);

        let copied_rows = read_copied_rows(&written.absolute_chapter_path);
        assert_eq!(copied_rows.len(), 2);
        for (copied, original) in copied_rows.iter().zip(rows.iter()) {
            assert_ne!(copied.row_id, original.row_id);
            assert_eq!(copied.structure.order_key, original.structure.order_key);
            assert_eq!(copied.status.review_state, original.status.review_state);
            assert_eq!(copied.lifecycle.state, original.lifecycle.state);
            assert_eq!(copied.text_style, original.text_style);
            assert_eq!(
                copied
                    .fields
                    .get("en")
                    .map(|field| field.plain_text.clone()),
                original
                    .fields
                    .get("en")
                    .map(|field| field.plain_text.clone()),
            );
            assert_eq!(
                copied.fields.get("en").map(|field| field.footnote.clone()),
                original
                    .fields
                    .get("en")
                    .map(|field| field.footnote.clone()),
            );
        }

        assert!(target_repo.join(".gitattributes").exists());
        let _ = fs::remove_dir_all(&target_repo);
    }

    #[test]
    fn chapter_copy_rewrites_uploaded_image_paths_and_copies_assets() {
        let source_repo = temp_dir("source-images");
        let target_repo = temp_dir("target-images");

        let image_relative = "chapters/old-chapter/images/picture.png";
        let image_absolute = source_repo.join(image_relative);
        fs::create_dir_all(image_absolute.parent().expect("image parent"))
            .expect("source image folder");
        fs::write(&image_absolute, b"png-bytes").expect("source image should write");

        let mut row = test_row("row-1", "00000000000000000000000000000001", "Hello");
        row.fields.get_mut("en").expect("field exists").image = Some(StoredFieldImage {
            kind: "upload".to_string(),
            url: None,
            path: Some(image_relative.to_string()),
        });
        let mut missing_row = test_row("row-2", "00000000000000000000000000000002", "Broken");
        missing_row
            .fields
            .get_mut("en")
            .expect("field exists")
            .image = Some(StoredFieldImage {
            kind: "upload".to_string(),
            url: None,
            path: Some("chapters/old-chapter/images/missing.png".to_string()),
        });

        let mut chapter_file = test_chapter_file("Chapter With Images");
        let written = write_chapter_copy(
            &source_repo,
            &mut chapter_file,
            &[row, missing_row],
            &target_repo,
            None,
        )
        .expect("copy should write");

        let copied_rows = read_copied_rows(&written.absolute_chapter_path);
        let copied_image = copied_rows[0]
            .fields
            .get("en")
            .and_then(|field| field.image.clone())
            .expect("image should carry over");
        let copied_path = copied_image.path.expect("copied image keeps a path");
        assert!(copied_path.ends_with("/images/picture.png"));
        assert!(!copied_path.contains("old-chapter"));
        assert_eq!(
            fs::read(target_repo.join(&copied_path)).expect("copied asset should read"),
            b"png-bytes"
        );
        // A missing source asset drops the image instead of failing the copy.
        assert!(copied_rows[1]
            .fields
            .get("en")
            .map(|field| field.image.is_none())
            .unwrap_or(false));

        let _ = fs::remove_dir_all(&source_repo);
        let _ = fs::remove_dir_all(&target_repo);
    }

    #[test]
    fn chapter_copy_applies_the_target_team_default_glossary() {
        let source_repo = temp_dir("source-default-glossary");
        let target_repo = temp_dir("target-default-glossary");

        let mut chapter_file = test_chapter_file("Chapter One");
        let default_glossary = TeamCopyDefaultGlossaryInput {
            glossary_id: "target-glossary".to_string(),
            repo_name: "target-glossary-repo".to_string(),
        };
        let written = write_chapter_copy(
            &source_repo,
            &mut chapter_file,
            &[test_row("row-1", "00000000000000000000000000000001", "A")],
            &target_repo,
            Some(&default_glossary),
        )
        .expect("copy should write");

        let copied_chapter: StoredChapterFile = read_json_file(
            &written.absolute_chapter_path.join("chapter.json"),
            "chapter.json",
        )
        .expect("copied chapter.json should read");
        let link = copied_chapter
            .settings
            .and_then(|settings| settings.linked_glossaries)
            .and_then(|linked| linked.glossary)
            .expect("target default glossary should be linked");
        // The source's team-scoped link was replaced, not carried over.
        assert_eq!(link.glossary_id, "target-glossary");
        assert_eq!(link.repo_name, "target-glossary-repo");

        let _ = fs::remove_dir_all(&source_repo);
        let _ = fs::remove_dir_all(&target_repo);
    }

    #[test]
    fn chapter_copy_allocates_a_unique_slug_when_the_title_collides() {
        let source_repo = temp_dir("source-slug");
        let target_repo = temp_dir("target-slug");

        let mut first = test_chapter_file("Chapter One");
        let first_written = write_chapter_copy(
            &source_repo,
            &mut first,
            &[test_row("row-1", "00000000000000000000000000000001", "A")],
            &target_repo,
            None,
        )
        .expect("first copy should write");

        let mut second = test_chapter_file("Chapter One");
        let second_written = write_chapter_copy(
            &source_repo,
            &mut second,
            &[test_row("row-1", "00000000000000000000000000000001", "B")],
            &target_repo,
            None,
        )
        .expect("second copy should write");

        assert_ne!(
            first_written.absolute_chapter_path,
            second_written.absolute_chapter_path
        );
        assert!(second_written.absolute_chapter_path.exists());

        let _ = fs::remove_dir_all(&source_repo);
        let _ = fs::remove_dir_all(&target_repo);
    }

    #[test]
    fn copied_image_names_suffix_duplicates() {
        let mut taken = BTreeSet::new();
        assert_eq!(unique_copied_image_name("a.png", &mut taken), "a.png");
        assert_eq!(unique_copied_image_name("a.png", &mut taken), "a-2.png");
        assert_eq!(unique_copied_image_name("a.png", &mut taken), "a-3.png");
        assert_eq!(unique_copied_image_name("", &mut taken), "image");
    }

    #[test]
    fn cleanup_removes_the_written_chapter_directory() {
        let source_repo = temp_dir("source-cleanup");
        let target_repo = temp_dir("target-cleanup");

        let mut chapter_file = test_chapter_file("Chapter One");
        let written = write_chapter_copy(
            &source_repo,
            &mut chapter_file,
            &[test_row("row-1", "00000000000000000000000000000001", "A")],
            &target_repo,
            None,
        )
        .expect("copy should write");
        assert!(written.absolute_chapter_path.exists());

        cleanup_chapter_copy(&target_repo, &written).expect("cleanup should succeed");
        assert!(!written.absolute_chapter_path.exists());
        // The copy created .gitattributes, so cleanup removes it again.
        assert!(!target_repo.join(".gitattributes").exists());

        let _ = fs::remove_dir_all(&source_repo);
        let _ = fs::remove_dir_all(&target_repo);
    }
}
