use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;
use tauri::AppHandle;

use crate::{
    git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata},
    project_import::normalize_chapter_settings_value,
    repo_layout_metadata::{
        new_v2_repo_layout_metadata, parse_repo_layout_metadata_bytes,
        read_repo_layout_metadata_state, write_repo_layout_metadata, RepoKind, RepoLayoutMetadata,
        RepoLayoutMetadataState, MIGRATION_0810, MIGRATION_0856, REPO_METADATA_RELATIVE_PATH,
    },
    repo_sync_shared::{format_git_spawn_error, git_command, git_output},
    short_path_names::{allocate_short_folder_name, allocate_short_image_filename},
};

/// How a migration executes. Layout migrations rewrite the storage layout and
/// need the bespoke orchestration in `sync_pending_repo_layout_migration`
/// (adopt-remote, discard flow, migration modal). Content migrations are
/// ordinary git-mergeable edits that run inline during sync.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RepoMigrationKind {
    Layout,
    Content,
}

type RepoMigrationRunFn = fn(&AppHandle, &Path) -> Result<(), String>;

/// One entry in the ordered migration registry. Adding a migration means
/// adding a descriptor here plus its run function — every dispatch site
/// (sync, clone, status snapshots, the modal scan) derives its behavior from
/// `pending_repo_migrations`, so nothing else needs wiring.
#[derive(Debug)]
pub(crate) struct RepoMigrationDescriptor {
    pub(crate) id: &'static str,
    pub(crate) kind: RepoMigrationKind,
    applies_to: &'static [RepoKind],
    /// Noun phrase for "This repo needs {pending_description}." status lines.
    pub(crate) pending_description: &'static str,
    /// Inline entry point for content migrations; layout migrations use the
    /// bespoke orchestration instead.
    run_content: Option<RepoMigrationRunFn>,
}

const REPO_MIGRATION_REGISTRY: &[RepoMigrationDescriptor] = &[
    RepoMigrationDescriptor {
        id: MIGRATION_0810,
        kind: RepoMigrationKind::Layout,
        applies_to: &[RepoKind::Project, RepoKind::Glossary, RepoKind::QaList],
        pending_description: "a local layout migration",
        run_content: None,
    },
    RepoMigrationDescriptor {
        id: MIGRATION_0856,
        kind: RepoMigrationKind::Content,
        applies_to: &[RepoKind::Project],
        pending_description: "the chapter settings migration",
        run_content: Some(migrate_project_repo_to_0856),
    },
];

/// The migrations still pending for this repo, in registry order. Missing
/// metadata means a legacy repo: only the layout migration pends there — it
/// writes the metadata the content checks read. Unreadable metadata is an
/// error; see `read_repo_layout_metadata_state`.
pub(crate) fn pending_repo_migrations(
    repo_path: &Path,
    repo_kind: &RepoKind,
) -> Result<Vec<&'static RepoMigrationDescriptor>, String> {
    let metadata = match read_repo_layout_metadata_state(repo_path) {
        RepoLayoutMetadataState::Readable(metadata) => Some(metadata),
        RepoLayoutMetadataState::Missing => None,
        RepoLayoutMetadataState::Unreadable(detail) => {
            return Err(unreadable_repo_metadata_error(&detail));
        }
    };
    Ok(REPO_MIGRATION_REGISTRY
        .iter()
        .filter(|descriptor| {
            if !descriptor.applies_to.contains(repo_kind) {
                return false;
            }
            match &metadata {
                Some(metadata) => !applied_migration(metadata, descriptor.id),
                None => descriptor.kind == RepoMigrationKind::Layout,
            }
        })
        .collect())
}

/// Run every pending migration for this repo in registry order. A pending
/// layout migration goes through its adopt-remote orchestration first; the
/// pending list is then recomputed — the layout step writes the metadata the
/// content checks read — and content migrations run inline.
pub(crate) fn run_pending_repo_migrations(
    app: &AppHandle,
    repo_path: &Path,
    repo_kind: RepoKind,
    branch_name: &str,
    remote_head_oid: &str,
) -> Result<(), String> {
    if pending_repo_migrations(repo_path, &repo_kind)?
        .iter()
        .any(|descriptor| descriptor.kind == RepoMigrationKind::Layout)
    {
        sync_pending_repo_layout_migration(
            app,
            repo_path,
            repo_kind.clone(),
            branch_name,
            remote_head_oid,
        )?;
    }
    for descriptor in pending_repo_migrations(repo_path, &repo_kind)? {
        if let Some(run) = descriptor.run_content {
            run(app, repo_path)?;
        }
    }
    Ok(())
}

/// The newest layout migration id — the version the modal migration flow
/// reports as its target.
pub(crate) fn latest_layout_migration_id() -> &'static str {
    REPO_MIGRATION_REGISTRY
        .iter()
        .rev()
        .find(|descriptor| descriptor.kind == RepoMigrationKind::Layout)
        .map(|descriptor| descriptor.id)
        .unwrap_or(MIGRATION_0810)
}

pub(crate) const REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE: &str =
    "REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES: The remote repo was already migrated, but this local repo has old-layout changes that must be discarded before syncing.";

pub(crate) fn is_remote_migrated_local_old_layout_changes_error(error: &str) -> bool {
    error
        .trim()
        .starts_with("REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES:")
}

fn migrate_repo_to_0810(
    app: &AppHandle,
    repo_path: &Path,
    repo_kind: RepoKind,
) -> Result<(), String> {
    run_layout_migration_with_recovery(repo_path, || match repo_kind {
        RepoKind::Project => migrate_project_repo_to_0810(app, repo_path),
        RepoKind::Glossary | RepoKind::QaList => {
            migrate_simple_repo_to_0810(app, repo_path, repo_kind)
        }
    })
}

/// Run an in-place layout migration and restore the pre-migration state if it
/// fails partway. A partial migration (some chapter folders renamed, nothing
/// committed) would otherwise leave a dirty worktree that blocks the retry
/// with "save or discard your changes" — advice the user cannot follow for
/// half-renamed folders. The worktree is verified clean (including untracked
/// files) before the migration starts, so `reset --hard` + `clean -fd`
/// provably restores the starting state.
fn run_layout_migration_with_recovery(
    repo_path: &Path,
    migrate: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    ensure_clean_repo(repo_path)?;
    if let Err(error) = migrate() {
        let reset_error = git_output(repo_path, &["reset", "--hard", "HEAD"], None).err();
        let clean_error = git_output(repo_path, &["clean", "-fd"], None).err();
        return Err(migration_error_with_recovery_failures(
            error,
            reset_error,
            clean_error,
        ));
    }
    Ok(())
}

fn migration_error_with_recovery_failures(
    migration_error: String,
    reset_error: Option<String>,
    clean_error: Option<String>,
) -> String {
    let mut recovery_failures = Vec::new();
    if let Some(error) = reset_error {
        recovery_failures.push(format!("reset failed: {error}"));
    }
    if let Some(error) = clean_error {
        recovery_failures.push(format!("clean failed: {error}"));
    }
    if recovery_failures.is_empty() {
        return migration_error;
    }

    format!(
        "{migration_error} Migration recovery also failed ({}). The repository may still contain partial migration changes.",
        recovery_failures.join("; ")
    )
}

fn sync_pending_repo_layout_migration(
    app: &AppHandle,
    repo_path: &Path,
    repo_kind: RepoKind,
    branch_name: &str,
    remote_head_oid: &str,
) -> Result<(), String> {
    let remote_tracking_ref = format!("origin/{branch_name}");
    if !remote_head_oid.trim().is_empty()
        && !ref_requires_0810_migration(repo_path, &remote_tracking_ref)?
    {
        adopt_remote_migrated_layout(repo_path, branch_name, &remote_tracking_ref)?;
        return Ok(());
    }

    ensure_clean_repo_for_layout_migration(repo_path)?;
    migrate_repo_to_0810(app, repo_path, repo_kind)
}

pub(crate) fn discard_local_old_layout_changes_and_adopt_remote(
    repo_path: &Path,
    branch_name: &str,
    remote_tracking_ref: &str,
) -> Result<(), String> {
    // Only a readable, already-migrated local repo short-circuits. Unreadable
    // local metadata is one of the states this user-confirmed discard heals —
    // the remote must still prove readable and migrated below before anything
    // destructive runs.
    if let RepoLayoutMetadataState::Readable(metadata) = read_repo_layout_metadata_state(repo_path)
    {
        if applied_migration(&metadata, MIGRATION_0810) {
            return Ok(());
        }
    }
    if ref_requires_0810_migration(repo_path, remote_tracking_ref)? {
        return Err(
            "The server repo is not migrated yet; local changes were not discarded.".to_string(),
        );
    }
    force_adopt_remote_migrated_layout(repo_path, branch_name, remote_tracking_ref)
}

fn applied_migration(metadata: &RepoLayoutMetadata, migration: &str) -> bool {
    metadata
        .applied_migrations
        .iter()
        .any(|applied| applied == migration)
}

fn unreadable_repo_metadata_error(detail: &str) -> String {
    format!(
        "This repo's metadata file ({REPO_METADATA_RELATIVE_PATH}) could not be used: {detail} \
         Update Gnosis TMS if a newer version wrote this repo; otherwise restore the file before syncing."
    )
}

/// Whether the 0.8.10 layout migration still pends. Missing metadata means a
/// legacy repo (migrate); unreadable metadata means data this app version must
/// not touch, so it surfaces as an error instead of a migration.
pub(crate) fn repo_requires_0810_migration(repo_path: &Path) -> Result<bool, String> {
    match read_repo_layout_metadata_state(repo_path) {
        RepoLayoutMetadataState::Readable(metadata) => {
            Ok(!applied_migration(&metadata, MIGRATION_0810))
        }
        RepoLayoutMetadataState::Missing => Ok(true),
        RepoLayoutMetadataState::Unreadable(detail) => Err(unreadable_repo_metadata_error(&detail)),
    }
}

pub(crate) fn head_requires_0810_migration(repo_path: &Path) -> Result<bool, String> {
    ref_requires_0810_migration(repo_path, "HEAD")
}

pub(crate) fn ref_requires_0810_migration(repo_path: &Path, git_ref: &str) -> Result<bool, String> {
    match git_blob_bytes(
        repo_path,
        &format!("{git_ref}:{REPO_METADATA_RELATIVE_PATH}"),
    ) {
        Ok(bytes) => match parse_repo_layout_metadata_bytes(&bytes) {
            Ok(metadata) => Ok(!applied_migration(&metadata, MIGRATION_0810)),
            Err(detail) => Err(unreadable_repo_metadata_error(&detail)),
        },
        // The ref has no metadata blob — a pre-0.8.10 layout.
        Err(_) => Ok(true),
    }
}

pub(crate) fn migrate_no_checkout_project_repo_to_0810(
    app: &AppHandle,
    repo_path: &Path,
) -> Result<(), String> {
    let head = git_output(repo_path, &["rev-parse", "--verify", "HEAD"], None)?;
    let head = head.trim();
    if head.is_empty() {
        return Ok(());
    }

    let tree_paths = git_tree_paths(repo_path, head)?;
    let chapter_map = allocate_tree_chapter_migrations(repo_path, head, &tree_paths)?;
    let image_path_map = allocate_tree_image_migrations(&tree_paths, &chapter_map);

    git_output(repo_path, &["read-tree", "--empty"], None)?;
    for path in tree_paths {
        if path == REPO_METADATA_RELATIVE_PATH {
            continue;
        }
        let Some(target_path) = migrated_tree_target_path(&path, &chapter_map, &image_path_map)
        else {
            continue;
        };
        let mut bytes = git_blob_bytes(repo_path, &format!("{head}:{path}"))?;
        if is_chapter_json_path(&path) {
            bytes = migrated_chapter_json_bytes(&bytes, &target_path)?;
        } else if is_row_json_path(&path) {
            bytes = migrated_row_json_bytes(&bytes, &chapter_map, &image_path_map)?;
        }
        write_worktree_bytes(repo_path, &target_path, &bytes)?;
    }

    write_repo_layout_metadata(repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))?;
    git_output(repo_path, &["add", "-A"], None)?;
    commit_migration_if_dirty(
        app,
        repo_path,
        MIGRATION_0810,
        "Migrate repo layout to 0.8.10",
    )
}

fn migrate_simple_repo_to_0810(
    app: &AppHandle,
    repo_path: &Path,
    repo_kind: RepoKind,
) -> Result<(), String> {
    write_repo_layout_metadata(repo_path, &new_v2_repo_layout_metadata(repo_kind))?;
    git_output(repo_path, &["add", REPO_METADATA_RELATIVE_PATH], None)?;
    commit_migration_if_dirty(
        app,
        repo_path,
        MIGRATION_0810,
        "Migrate repo layout to 0.8.10",
    )
}

fn migrate_project_repo_to_0810(app: &AppHandle, repo_path: &Path) -> Result<(), String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        write_repo_layout_metadata(repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))?;
        git_output(repo_path, &["add", REPO_METADATA_RELATIVE_PATH], None)?;
        return commit_migration_if_dirty(
            app,
            repo_path,
            MIGRATION_0810,
            "Migrate repo layout to 0.8.10",
        );
    }

    let mut chapters = list_project_chapters(&chapters_root)?;
    allocate_chapter_folder_names(&mut chapters);

    for chapter in &chapters {
        if chapter.old_folder == chapter.new_folder {
            continue;
        }
        let old_path = chapters_root.join(&chapter.old_folder);
        let new_path = chapters_root.join(&chapter.new_folder);
        if new_path.exists() {
            return Err(format!(
                "Could not migrate chapter '{}': target folder '{}' already exists.",
                chapter.old_folder, chapter.new_folder
            ));
        }
        fs::rename(&old_path, &new_path).map_err(|error| {
            format!(
                "Could not rename chapter folder '{}' to '{}': {error}",
                old_path.display(),
                new_path.display()
            )
        })?;
    }

    for chapter in &chapters {
        migrate_project_chapter(repo_path, chapter)?;
    }

    write_repo_layout_metadata(repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))?;
    git_output(repo_path, &["add", "-A"], None)?;
    commit_migration_if_dirty(
        app,
        repo_path,
        MIGRATION_0810,
        "Migrate repo layout to 0.8.10",
    )
}

#[derive(Debug)]
struct ProjectChapterMigration {
    old_folder: String,
    new_folder: String,
    title: Option<String>,
}

/// Allocate a short, unique target folder name for every chapter.
///
/// Each new name is deduplicated against both the names already allocated and the
/// existing folder names of all *other* chapters. Seeding with the sibling folders
/// is essential: when many titles share a long common prefix, truncation collapses
/// them to the same base and the disambiguating `-N` suffix can otherwise reproduce
/// a folder name that still belongs to a different chapter (e.g. `…-part-10` being
/// renamed to `…-part-2`), which made the in-place migration abort. Excluding only
/// the chapter's own folder still lets a chapter keep its current name when nothing
/// else claims it.
fn allocate_chapter_folder_names(chapters: &mut [ProjectChapterMigration]) {
    let old_folders: Vec<String> = chapters
        .iter()
        .map(|chapter| chapter.old_folder.clone())
        .collect();
    let mut allocated = Vec::<String>::new();
    for (index, chapter) in chapters.iter_mut().enumerate() {
        let title = chapter
            .title
            .clone()
            .unwrap_or_else(|| chapter.old_folder.clone());
        let sibling_old_folders = old_folders
            .iter()
            .enumerate()
            .filter(move |(other_index, _)| *other_index != index)
            .map(|(_, folder)| folder.as_str());
        let existing = allocated
            .iter()
            .map(String::as_str)
            .chain(sibling_old_folders);
        chapter.new_folder = allocate_short_folder_name(&title, existing);
        allocated.push(chapter.new_folder.clone());
    }
}

fn allocate_tree_chapter_migrations(
    repo_path: &Path,
    head: &str,
    tree_paths: &[String],
) -> Result<BTreeMap<String, ProjectChapterMigration>, String> {
    let mut chapters = Vec::new();
    for path in tree_paths {
        if !is_chapter_json_path(path) {
            continue;
        }
        let Some(old_folder) = path.split('/').nth(1).map(str::to_string) else {
            continue;
        };
        let bytes = git_blob_bytes(repo_path, &format!("{head}:{path}"))?;
        let title = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        chapters.push(ProjectChapterMigration {
            old_folder,
            new_folder: String::new(),
            title,
        });
    }
    chapters.sort_by(|left, right| left.old_folder.cmp(&right.old_folder));
    allocate_chapter_folder_names(&mut chapters);

    let mut chapter_map = BTreeMap::new();
    for chapter in chapters {
        chapter_map.insert(chapter.old_folder.clone(), chapter);
    }

    Ok(chapter_map)
}

fn allocate_tree_image_migrations(
    tree_paths: &[String],
    chapter_map: &BTreeMap<String, ProjectChapterMigration>,
) -> BTreeMap<String, String> {
    let mut image_path_map = BTreeMap::new();
    let mut image_names_by_chapter = BTreeMap::<String, Vec<String>>::new();

    for path in tree_paths {
        let Some((old_chapter, file_name)) = old_nested_image_path_parts(path) else {
            continue;
        };
        let Some(chapter) = chapter_map.get(old_chapter) else {
            continue;
        };
        let names = image_names_by_chapter
            .entry(chapter.new_folder.clone())
            .or_default();
        let extension = Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let allocated_name =
            allocate_short_image_filename(file_name, extension, names.iter().map(String::as_str));
        names.push(allocated_name.clone());
        image_path_map.insert(
            path.clone(),
            format!("chapters/{}/images/{allocated_name}", chapter.new_folder),
        );
    }

    image_path_map
}

fn migrated_tree_target_path(
    path: &str,
    chapter_map: &BTreeMap<String, ProjectChapterMigration>,
    image_path_map: &BTreeMap<String, String>,
) -> Option<String> {
    if let Some(target_path) = image_path_map.get(path) {
        return Some(target_path.clone());
    }
    let mut parts = path.split('/').collect::<Vec<_>>();
    if parts.first().copied() != Some("chapters") {
        return Some(path.to_string());
    }
    let old_chapter = parts.get(1).copied()?;
    let Some(chapter) = chapter_map.get(old_chapter) else {
        return Some(path.to_string());
    };
    parts[1] = &chapter.new_folder;
    Some(parts.join("/"))
}

fn is_chapter_json_path(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    parts.len() == 3 && parts[0] == "chapters" && parts[2] == "chapter.json"
}

fn is_row_json_path(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    parts.len() == 4 && parts[0] == "chapters" && parts[2] == "rows" && parts[3].ends_with(".json")
}

fn old_nested_image_path_parts(path: &str) -> Option<(&str, &str)> {
    let parts = path.split('/').collect::<Vec<_>>();
    if parts.len() < 6 || parts[0] != "chapters" || parts[2] != "images" {
        return None;
    }
    if !parts[3].starts_with("row-") {
        return None;
    }
    Some((parts[1], parts.last().copied()?))
}

fn migrated_chapter_json_bytes(bytes: &[u8], target_path: &str) -> Result<Vec<u8>, String> {
    let mut value = serde_json::from_slice::<Value>(bytes)
        .map_err(|error| format!("Could not parse chapter metadata during migration: {error}"))?;
    if let Some(object) = value.as_object_mut() {
        if let Some(folder) = target_path.split('/').nth(1) {
            object.insert("slug".to_string(), Value::String(folder.to_string()));
        }
    }
    serde_json::to_vec_pretty(&value)
        .map(|mut bytes| {
            bytes.push(b'\n');
            bytes
        })
        .map_err(|error| format!("Could not serialize chapter metadata during migration: {error}"))
}

fn migrated_row_json_bytes(
    bytes: &[u8],
    chapter_map: &BTreeMap<String, ProjectChapterMigration>,
    image_path_map: &BTreeMap<String, String>,
) -> Result<Vec<u8>, String> {
    let mut value = serde_json::from_slice::<Value>(bytes)
        .map_err(|error| format!("Could not parse row file during migration: {error}"))?;
    if let Some(fields) = value.get_mut("fields").and_then(Value::as_object_mut) {
        for field in fields.values_mut() {
            let Some(image) = field.get_mut("image").and_then(Value::as_object_mut) else {
                continue;
            };
            if image.get("kind").and_then(Value::as_str) != Some("upload") {
                continue;
            }
            let Some(path_value) = image.get_mut("path") else {
                continue;
            };
            let Some(current_path) = path_value.as_str() else {
                continue;
            };
            let normalized = current_path.trim().replace('\\', "/");
            if let Some(next_path) = image_path_map
                .get(&normalized)
                .cloned()
                .or_else(|| migrated_tree_target_path(&normalized, chapter_map, image_path_map))
            {
                *path_value = Value::String(next_path.clone());
            }
        }
    }
    serde_json::to_vec_pretty(&value)
        .map(|mut bytes| {
            bytes.push(b'\n');
            bytes
        })
        .map_err(|error| format!("Could not serialize row file during migration: {error}"))
}

fn list_project_chapters(chapters_root: &Path) -> Result<Vec<ProjectChapterMigration>, String> {
    let mut chapters = Vec::new();
    for entry in fs::read_dir(chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Could not read chapter folder: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(folder) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let chapter_json_path = path.join("chapter.json");
        let title = fs::read(&chapter_json_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| {
                value
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            });
        chapters.push(ProjectChapterMigration {
            old_folder: folder,
            new_folder: String::new(),
            title,
        });
    }
    chapters.sort_by(|left, right| left.old_folder.cmp(&right.old_folder));
    Ok(chapters)
}

fn migrate_project_chapter(
    repo_path: &Path,
    chapter: &ProjectChapterMigration,
) -> Result<(), String> {
    let chapter_path = repo_path.join("chapters").join(&chapter.new_folder);
    let chapter_json_path = chapter_path.join("chapter.json");
    if chapter_json_path.exists() {
        let mut chapter_value = read_json_value(&chapter_json_path, "chapter.json")?;
        if let Some(object) = chapter_value.as_object_mut() {
            object.insert(
                "slug".to_string(),
                Value::String(chapter.new_folder.clone()),
            );
            write_json_value(&chapter_json_path, &chapter_value)?;
        }
    }

    let rows_path = chapter_path.join("rows");
    if !rows_path.exists() {
        return Ok(());
    }

    let mut image_name_cache = local_file_names(&chapter_path.join("images"))?;
    for entry in fs::read_dir(&rows_path).map_err(|error| {
        format!(
            "Could not read rows folder '{}': {error}",
            rows_path.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Could not read row file entry: {error}"))?;
        let row_path = entry.path();
        if !row_path.is_file()
            || row_path.extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        migrate_row_image_paths(repo_path, &row_path, chapter, &mut image_name_cache)?;
    }

    Ok(())
}

fn migrate_row_image_paths(
    repo_path: &Path,
    row_path: &Path,
    chapter: &ProjectChapterMigration,
    image_name_cache: &mut Vec<String>,
) -> Result<(), String> {
    let mut row_value = read_json_value(row_path, "row file")?;
    let Some(fields) = row_value.get_mut("fields").and_then(Value::as_object_mut) else {
        return Ok(());
    };

    let mut changed = false;
    for field in fields.values_mut() {
        let Some(image) = field.get_mut("image").and_then(Value::as_object_mut) else {
            continue;
        };
        if image.get("kind").and_then(Value::as_str) != Some("upload") {
            continue;
        }
        let Some(path_value) = image.get_mut("path") else {
            continue;
        };
        let Some(current_path) = path_value.as_str().map(str::to_string) else {
            continue;
        };
        let Some(next_path) =
            migrate_uploaded_image_path(repo_path, &current_path, chapter, image_name_cache)?
        else {
            continue;
        };
        if next_path != current_path {
            *path_value = Value::String(next_path);
            changed = true;
        }
    }

    if changed {
        write_json_value(row_path, &row_value)?;
    }
    Ok(())
}

fn migrate_uploaded_image_path(
    repo_path: &Path,
    current_path: &str,
    chapter: &ProjectChapterMigration,
    image_name_cache: &mut Vec<String>,
) -> Result<Option<String>, String> {
    let normalized = current_path.trim().replace('\\', "/");
    let old_prefix = format!("chapters/{}/", chapter.old_folder);
    let new_prefix = format!("chapters/{}/", chapter.new_folder);
    let path_in_new_chapter = if let Some(rest) = normalized.strip_prefix(&old_prefix) {
        format!("{new_prefix}{rest}")
    } else if normalized.starts_with(&new_prefix) {
        normalized.clone()
    } else {
        return Ok(None);
    };

    let Some((before_file, file_name)) = path_in_new_chapter.rsplit_once('/') else {
        return Ok(Some(path_in_new_chapter));
    };

    if !before_file.contains("/images/row-") {
        return Ok(Some(path_in_new_chapter));
    }

    let source_path = repo_path.join(&normalized);
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let allocated_name = allocate_short_image_filename(
        file_name,
        extension,
        image_name_cache.iter().map(String::as_str),
    );
    image_name_cache.push(allocated_name.clone());
    let next_path = format!("chapters/{}/images/{allocated_name}", chapter.new_folder);
    let target_path = repo_path.join(&next_path);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create migrated image folder '{}': {error}",
                parent.display()
            )
        })?;
    }
    if source_path.exists() && source_path != target_path {
        fs::rename(&source_path, &target_path).map_err(|error| {
            format!(
                "Could not move image '{}' to '{}': {error}",
                source_path.display(),
                target_path.display()
            )
        })?;
        remove_empty_parents(source_path.parent(), repo_path);
    }
    Ok(Some(next_path))
}

fn remove_empty_parents(mut path: Option<&Path>, repo_path: &Path) {
    while let Some(current) = path {
        if current == repo_path
            || current.file_name().and_then(|value| value.to_str()) == Some("images")
        {
            break;
        }
        if fs::remove_dir(current).is_err() {
            break;
        }
        path = current.parent();
    }
}

fn read_json_value(path: &Path, label: &str) -> Result<Value, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read {label} '{}': {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse {label} '{}': {error}", path.display()))
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize JSON '{}': {error}", path.display()))?;
    fs::write(path, format!("{json}\n"))
        .map_err(|error| format!("Could not write JSON '{}': {error}", path.display()))
}

fn local_file_names(path: &Path) -> Result<Vec<String>, String> {
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

fn git_tree_paths(repo_path: &Path, treeish: &str) -> Result<Vec<String>, String> {
    let output = git_output(
        repo_path,
        &["ls-tree", "-r", "-z", "--name-only", treeish],
        None,
    )?;
    Ok(output
        .split('\0')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect())
}

fn git_blob_bytes(repo_path: &Path, object: &str) -> Result<Vec<u8>, String> {
    let args = ["show", object];
    let output = git_command()?
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format_git_spawn_error(&args, &error))?;
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

fn write_worktree_bytes(repo_path: &Path, relative_path: &str, bytes: &[u8]) -> Result<(), String> {
    let path = repo_path.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }
    fs::write(&path, bytes)
        .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

fn ensure_clean_repo(repo_path: &Path) -> Result<(), String> {
    let status = git_output(repo_path, &["status", "--porcelain"], None)?;
    if status.trim().is_empty() {
        Ok(())
    } else {
        Err("Local repo has uncommitted changes; sync or save them before migration.".to_string())
    }
}

fn ensure_clean_repo_for_layout_migration(repo_path: &Path) -> Result<(), String> {
    let status = git_output(repo_path, &["status", "--porcelain"], None)?;
    if status.trim().is_empty() {
        Ok(())
    } else {
        Err("Local repo has uncommitted changes. Save or discard them before the 0.8.10 layout migration can run.".to_string())
    }
}

fn adopt_remote_migrated_layout(
    repo_path: &Path,
    branch_name: &str,
    remote_tracking_ref: &str,
) -> Result<(), String> {
    let status = git_output(repo_path, &["status", "--porcelain"], None)
        .map_err(|_| REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE.to_string())?;
    if !status.trim().is_empty() {
        return Err(REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE.to_string());
    }

    if git_output(
        repo_path,
        &["merge-base", "--is-ancestor", "HEAD", remote_tracking_ref],
        None,
    )
    .is_err()
    {
        return Err(REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE.to_string());
    }

    force_adopt_remote_migrated_layout(repo_path, branch_name, remote_tracking_ref)
}

fn force_adopt_remote_migrated_layout(
    repo_path: &Path,
    branch_name: &str,
    remote_tracking_ref: &str,
) -> Result<(), String> {
    let _ = git_output(
        repo_path,
        &["config", "--local", "core.longpaths", "true"],
        None,
    );

    let _ = git_output(repo_path, &["reset", "--hard"], None);
    let _ = git_output(repo_path, &["clean", "-fd"], None);
    git_output(
        repo_path,
        &["checkout", "-B", branch_name, remote_tracking_ref],
        None,
    )?;
    git_output(repo_path, &["reset", "--hard", remote_tracking_ref], None)?;
    git_output(repo_path, &["clean", "-fd"], None)?;
    Ok(())
}

fn commit_migration_if_dirty(
    app: &AppHandle,
    repo_path: &Path,
    migration: &'static str,
    message: &str,
) -> Result<(), String> {
    let status = git_output(repo_path, &["status", "--porcelain"], None)?;
    if status.trim().is_empty() {
        return Ok(());
    }
    git_commit_as_signed_in_user_with_metadata(
        app,
        repo_path,
        message,
        &[],
        GitCommitMetadata {
            operation: Some("repo.migrate"),
            migration: Some(migration),
            status_note: None,
            ai_model: None,
        },
    )?;
    Ok(())
}

/// Normalize every parseable chapter's `chapter.json` under `chapters_root`.
/// Returns how many chapter files were skipped because they could not be
/// parsed — a file the parser rejects is also one the normalizer has nothing
/// to fix, and failing the whole sync over it would brick the repo on one
/// corrupt file. Write failures still propagate.
fn normalize_chapter_settings_files(chapters_root: &Path) -> Result<usize, String> {
    let entries = fs::read_dir(chapters_root).map_err(|error| {
        format!(
            "Could not list the chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;
    let mut skipped_unreadable = 0usize;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapters folder entry: {error}"))?;
        let chapter_json_path = entry.path().join("chapter.json");
        if !chapter_json_path.is_file() {
            continue;
        }
        let mut chapter_value = match read_json_value(&chapter_json_path, "chapter.json") {
            Ok(value) => value,
            Err(_) => {
                skipped_unreadable += 1;
                continue;
            }
        };
        if normalize_chapter_settings_value(&mut chapter_value) {
            write_json_value(&chapter_json_path, &chapter_value)?;
        }
    }
    Ok(skipped_unreadable)
}

/// Content-only migration: normalize every chapter's `chapter.json` and record
/// the marker. Runs inline during project repo sync — the edits are ordinary
/// git-mergeable content, so no modal and no remote adoption/discard flow is
/// needed (both sides may run it independently and merge cleanly). A dirty
/// worktree skips the run; the next sync retries.
fn migrate_project_repo_to_0856(app: &AppHandle, repo_path: &Path) -> Result<(), String> {
    let status = git_output(repo_path, &["status", "--porcelain"], None)?;
    if !status.trim().is_empty() {
        return Ok(());
    }

    let chapters_root = repo_path.join("chapters");
    if chapters_root.exists() {
        let skipped_unreadable = normalize_chapter_settings_files(&chapters_root)?;
        if skipped_unreadable > 0 {
            crate::github::report_backend_nonfatal_error(
                app,
                "repo.migrate.chapter_settings",
                "chapter_json_unreadable_skipped",
            );
        }
    }

    let mut metadata = match read_repo_layout_metadata_state(repo_path) {
        RepoLayoutMetadataState::Readable(metadata) => metadata,
        RepoLayoutMetadataState::Missing => new_v2_repo_layout_metadata(RepoKind::Project),
        RepoLayoutMetadataState::Unreadable(detail) => {
            return Err(unreadable_repo_metadata_error(&detail));
        }
    };
    if !metadata
        .applied_migrations
        .iter()
        .any(|migration| migration == MIGRATION_0856)
    {
        metadata.applied_migrations.push(MIGRATION_0856.to_string());
    }
    write_repo_layout_metadata(repo_path, &metadata)?;
    git_output(repo_path, &["add", "-A"], None)?;
    commit_migration_if_dirty(
        app,
        repo_path,
        MIGRATION_0856,
        "Normalize chapter settings (0.8.56 migration)",
    )
}

#[cfg(test)]
mod tests {
    use std::{env, process::Command};

    use crate::repo_layout_metadata::{new_v2_repo_layout_metadata, RepoKind};
    use uuid::Uuid;

    use super::*;

    fn temp_repo(name: &str) -> std::path::PathBuf {
        let repo_path = env::temp_dir().join(format!("gnosis-tms-{name}-{}", Uuid::now_v7()));
        fs::create_dir_all(&repo_path).expect("create temp repo");
        run_git(&repo_path, &["init", "--initial-branch", "main"]);
        run_git(&repo_path, &["config", "user.email", "test@example.com"]);
        run_git(&repo_path, &["config", "user.name", "Test User"]);
        repo_path
    }

    fn run_git(repo_path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .unwrap_or_else(|error| panic!("failed to run git {}: {error}", args.join(" ")));
        assert!(
            output.status.success(),
            "git {} failed: {}{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout),
        );
    }

    fn git_stdout(repo_path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .unwrap_or_else(|error| panic!("failed to run git {}: {error}", args.join(" ")));
        assert!(
            output.status.success(),
            "git {} failed: {}{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout),
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn pending_ids(repo_path: &Path, repo_kind: &RepoKind) -> Vec<&'static str> {
        pending_repo_migrations(repo_path, repo_kind)
            .expect("pending migrations")
            .iter()
            .map(|descriptor| descriptor.id)
            .collect()
    }

    #[test]
    fn registry_orders_layout_before_content_and_wires_run_entry_points() {
        let first_content = REPO_MIGRATION_REGISTRY
            .iter()
            .position(|descriptor| descriptor.kind == RepoMigrationKind::Content)
            .unwrap_or(REPO_MIGRATION_REGISTRY.len());
        assert!(
            REPO_MIGRATION_REGISTRY[first_content..]
                .iter()
                .all(|descriptor| descriptor.kind == RepoMigrationKind::Content),
            "layout migrations must precede content migrations"
        );
        for descriptor in REPO_MIGRATION_REGISTRY {
            assert_eq!(
                descriptor.run_content.is_some(),
                descriptor.kind == RepoMigrationKind::Content,
                "content migrations run inline; layout migrations use the bespoke orchestration"
            );
        }
        assert_eq!(latest_layout_migration_id(), MIGRATION_0810);
    }

    #[test]
    fn pending_migrations_follow_metadata_state() {
        let repo_path = temp_repo("pending-migrations-state");

        // Missing metadata = legacy repo: only the layout migration pends —
        // it writes the metadata the content checks read.
        assert_eq!(
            pending_ids(&repo_path, &RepoKind::Project),
            vec![MIGRATION_0810]
        );

        // Metadata recording only 0.8.10 pends the project content migration,
        // but not for glossaries, which 0.8.56 does not apply to.
        write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))
            .expect("write metadata");
        assert_eq!(
            pending_ids(&repo_path, &RepoKind::Project),
            vec![MIGRATION_0856]
        );
        assert!(pending_ids(&repo_path, &RepoKind::Glossary).is_empty());

        // Both markers recorded → nothing pends.
        let mut metadata = new_v2_repo_layout_metadata(RepoKind::Project);
        metadata.applied_migrations.push(MIGRATION_0856.to_string());
        write_repo_layout_metadata(&repo_path, &metadata).expect("write migrated metadata");
        assert!(pending_ids(&repo_path, &RepoKind::Project).is_empty());

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn chapter_name_allocation_never_collides_with_sibling_folders() {
        // Reproduces the Tarot & Kabbalah failure: every title shares the same
        // 22-char prefix, so truncation collapses them to one base and the `-N`
        // suffix would otherwise reproduce a sibling's existing folder name.
        let titles = [
            (
                "tarot-y-kabbahlah-part",
                "Tarot y Kabbahlah  Part 1 Chap 6-10",
            ),
            (
                "tarot-y-kabbahlah-part-2",
                "Tarot y Kabbahlah  Part 1 Chap 11-15",
            ),
            (
                "tarot-y-kabbahlah-part-3",
                "Tarot y Kabbahlah  Part 1 Chap 16-20",
            ),
            (
                "tarot-y-kabbahlah-part-10",
                "Tarot y Kabbahlah Part 3 Chap 49-55",
            ),
            (
                "tarot-y-kabbahlah-part-11",
                "Tarot y Kabbahlah Part 3 Chap 56-60",
            ),
            (
                "tarot-y-kabbahlah-part-14",
                "Tarot y Kabbahlah Part 4 Chap 71-75",
            ),
            ("tarot-y-kabbahlah-prol", "Tarot y Kabbahlah prologue"),
        ];
        let mut chapters = titles
            .iter()
            .map(|(folder, title)| ProjectChapterMigration {
                old_folder: (*folder).to_string(),
                new_folder: String::new(),
                title: Some((*title).to_string()),
            })
            .collect::<Vec<_>>();
        chapters.sort_by(|left, right| left.old_folder.cmp(&right.old_folder));

        allocate_chapter_folder_names(&mut chapters);

        // No new name may equal any *other* chapter's existing folder — that is the
        // exact condition the in-place rename guard rejected.
        for (index, chapter) in chapters.iter().enumerate() {
            for (other_index, other) in chapters.iter().enumerate() {
                if index != other_index {
                    assert_ne!(
                        chapter.new_folder, other.old_folder,
                        "new folder '{}' collides with sibling folder '{}'",
                        chapter.new_folder, other.old_folder
                    );
                }
            }
        }

        // Every new name must also be unique among the new names.
        let unique = chapters
            .iter()
            .map(|chapter| chapter.new_folder.clone())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), chapters.len());

        // A chapter whose short name does not clash keeps its current folder.
        let prologue = chapters
            .iter()
            .find(|chapter| chapter.old_folder == "tarot-y-kabbahlah-prol")
            .expect("prologue chapter present");
        assert_eq!(prologue.new_folder, "tarot-y-kabbahlah-prol");
    }

    #[test]
    fn tree_migration_preserves_unmapped_chapter_paths() {
        let chapter_map = BTreeMap::new();
        let image_path_map = BTreeMap::new();

        assert_eq!(
            migrated_tree_target_path(
                "chapters/orphan/assets/cover.png",
                &chapter_map,
                &image_path_map,
            ),
            Some("chapters/orphan/assets/cover.png".to_string())
        );
    }

    #[test]
    fn tree_image_migration_resolves_duplicate_image_names() {
        let mut chapter_map = BTreeMap::new();
        chapter_map.insert(
            "long-chapter-name".to_string(),
            ProjectChapterMigration {
                old_folder: "long-chapter-name".to_string(),
                new_folder: "long-chapter-name".to_string(),
                title: None,
            },
        );
        let tree_paths = vec![
            "chapters/long-chapter-name/images/row-a/en/photo.png".to_string(),
            "chapters/long-chapter-name/images/row-b/en/photo.png".to_string(),
        ];

        let image_path_map = allocate_tree_image_migrations(&tree_paths, &chapter_map);

        assert_eq!(
            image_path_map.get("chapters/long-chapter-name/images/row-a/en/photo.png"),
            Some(&"chapters/long-chapter-name/images/photo.png".to_string())
        );
        assert_eq!(
            image_path_map.get("chapters/long-chapter-name/images/row-b/en/photo.png"),
            Some(&"chapters/long-chapter-name/images/photo-2.png".to_string())
        );
    }

    #[test]
    fn row_migration_rewrites_nested_uploaded_image_paths() {
        let mut chapter_map = BTreeMap::new();
        chapter_map.insert(
            "long-old-folder-name".to_string(),
            ProjectChapterMigration {
                old_folder: "long-old-folder-name".to_string(),
                new_folder: "short-folder".to_string(),
                title: None,
            },
        );
        let mut image_path_map = BTreeMap::new();
        image_path_map.insert(
            "chapters/long-old-folder-name/images/row-1/en/photo.png".to_string(),
            "chapters/short-folder/images/photo.png".to_string(),
        );
        let row = br#"{
          "fields": {
            "en": {
              "text": "Hello",
              "image": {
                "kind": "upload",
                "path": "chapters/long-old-folder-name/images/row-1/en/photo.png"
              }
            }
          },
          "unknownFutureField": true
        }"#;

        let migrated =
            migrated_row_json_bytes(row, &chapter_map, &image_path_map).expect("migrate row");
        let value: Value = serde_json::from_slice(&migrated).expect("parse migrated row");

        assert_eq!(
            value["fields"]["en"]["image"]["path"],
            "chapters/short-folder/images/photo.png"
        );
        assert_eq!(value["unknownFutureField"], true);
    }

    #[test]
    fn migration_recovery_error_reports_dirty_postcondition() {
        let error = migration_error_with_recovery_failures(
            "Migration failed.".to_string(),
            Some("index is locked".to_string()),
            Some("working tree cleanup was denied".to_string()),
        );

        assert!(error.contains("Migration failed."));
        assert!(error.contains("reset failed: index is locked"));
        assert!(error.contains("clean failed: working tree cleanup was denied"));
        assert!(error.contains("may still contain partial migration changes"));
    }

    #[test]
    fn failed_layout_migration_restores_the_pre_migration_worktree() {
        let repo_path = temp_repo("layout-migration-recovery");
        fs::create_dir_all(repo_path.join("chapters/original-folder")).expect("create chapter");
        fs::write(
            repo_path.join("chapters/original-folder/chapter.json"),
            "{}\n",
        )
        .expect("write chapter");
        run_git(&repo_path, &["add", "-A"]);
        run_git(&repo_path, &["commit", "-m", "Initial"]);

        // Simulate a migration failing after a partial folder rename.
        let error = run_layout_migration_with_recovery(&repo_path, || {
            fs::rename(
                repo_path.join("chapters/original-folder"),
                repo_path.join("chapters/renamed"),
            )
            .map_err(|error| error.to_string())?;
            Err("simulated mid-migration failure".to_string())
        })
        .expect_err("migration failure must propagate");
        assert!(error.contains("simulated"));

        // Recovery must restore the original layout and a clean worktree, so
        // the retry is not blocked by the clean-repo guard.
        assert!(repo_path.join("chapters/original-folder").exists());
        assert!(!repo_path.join("chapters/renamed").exists());
        assert_eq!(git_stdout(&repo_path, &["status", "--porcelain"]), "");

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn chapter_settings_normalization_skips_unreadable_files() {
        let root = env::temp_dir().join(format!("gnosis-tms-normalize-skip-{}", Uuid::now_v7()));
        let chapters_root = root.join("chapters");
        fs::create_dir_all(chapters_root.join("good")).expect("create good chapter");
        fs::create_dir_all(chapters_root.join("corrupt")).expect("create corrupt chapter");
        fs::write(
            chapters_root.join("good/chapter.json"),
            br#"{"settings": null}"#,
        )
        .expect("write good chapter");
        fs::write(chapters_root.join("corrupt/chapter.json"), b"{not json")
            .expect("write corrupt chapter");

        let skipped = normalize_chapter_settings_files(&chapters_root).expect("normalization runs");

        // One corrupt file must not brick the migration — it is skipped and
        // counted, while parseable files still normalize.
        assert_eq!(skipped, 1);
        let good = fs::read_to_string(chapters_root.join("good/chapter.json"))
            .expect("read normalized chapter");
        assert!(!good.contains("settings"));
        let corrupt = fs::read_to_string(chapters_root.join("corrupt/chapter.json"))
            .expect("read corrupt chapter");
        assert_eq!(corrupt, "{not json");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unreadable_metadata_errors_instead_of_migrating() {
        let repo_path = temp_repo("unreadable-metadata-checks");
        let metadata_path = repo_path.join(REPO_METADATA_RELATIVE_PATH);
        fs::create_dir_all(metadata_path.parent().expect("metadata parent"))
            .expect("create metadata folder");
        // A future app bumping the schema version must produce an error — an
        // older client treating this as "needs the 0.8.10 layout rewrite"
        // would rename folders in data it cannot read.
        fs::write(
            &metadata_path,
            br#"{"schemaVersion":2,"repoKind":"project","storageLayoutVersion":3}"#,
        )
        .expect("write future metadata");

        let error_0810 = repo_requires_0810_migration(&repo_path)
            .expect_err("unreadable metadata must not schedule the layout migration");
        assert!(error_0810.contains(".gtms/repo.json"));
        let pending_error = pending_repo_migrations(&repo_path, &RepoKind::Project)
            .expect_err("unreadable metadata must not schedule any migration");
        assert!(pending_error.contains("Update Gnosis TMS"));

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn unreadable_remote_metadata_blocks_adoption_paths() {
        let repo_path = temp_repo("unreadable-remote-metadata");
        let metadata_path = repo_path.join(REPO_METADATA_RELATIVE_PATH);
        fs::create_dir_all(metadata_path.parent().expect("metadata parent"))
            .expect("create metadata folder");
        fs::write(
            &metadata_path,
            br#"{"schemaVersion":2,"repoKind":"project","storageLayoutVersion":3}"#,
        )
        .expect("write future metadata");
        run_git(&repo_path, &["add", REPO_METADATA_RELATIVE_PATH]);
        run_git(&repo_path, &["commit", "-m", "Future metadata"]);
        let head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        run_git(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", &head],
        );

        // Discarding local changes to adopt an unreadable remote would hand
        // the checkout to a layout this app cannot verify — it must error.
        let error =
            discard_local_old_layout_changes_and_adopt_remote(&repo_path, "main", "origin/main")
                .expect_err("unreadable remote metadata must block adoption");
        assert!(error.contains(".gtms/repo.json"));

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn dirty_repo_blocks_layout_migration_before_backup() {
        let repo_path = temp_repo("dirty-layout-migration");
        fs::write(repo_path.join("file.txt"), "one").expect("write file");
        run_git(&repo_path, &["add", "file.txt"]);
        run_git(&repo_path, &["commit", "-m", "Initial"]);
        fs::write(repo_path.join("file.txt"), "dirty").expect("dirty file");

        let error = ensure_clean_repo_for_layout_migration(&repo_path)
            .expect_err("dirty repo should block migration");

        assert!(error.contains("uncommitted changes"));
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn remote_migrated_layout_is_adopted_without_local_migration_commit() {
        let repo_path = temp_repo("adopt-remote-migrated-layout");
        fs::write(repo_path.join("project.json"), "{}\n").expect("write project");
        run_git(&repo_path, &["add", "project.json"]);
        run_git(&repo_path, &["commit", "-m", "Initial"]);
        let old_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))
            .expect("write metadata");
        run_git(&repo_path, &["add", REPO_METADATA_RELATIVE_PATH]);
        run_git(&repo_path, &["commit", "-m", "Remote migration"]);
        let remote_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        run_git(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", &remote_head],
        );
        run_git(&repo_path, &["reset", "--hard", &old_head]);

        adopt_remote_migrated_layout(&repo_path, "main", "origin/main")
            .expect("adopt remote layout");

        assert_eq!(git_stdout(&repo_path, &["rev-parse", "HEAD"]), remote_head);
        assert!(repo_path.join(REPO_METADATA_RELATIVE_PATH).exists());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn discard_old_layout_changes_force_adopts_remote_migrated_layout() {
        let repo_path = temp_repo("discard-old-layout-adopt-remote");
        fs::write(repo_path.join("project.json"), "{}\n").expect("write project");
        run_git(&repo_path, &["add", "project.json"]);
        run_git(&repo_path, &["commit", "-m", "Initial"]);
        let old_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);

        write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))
            .expect("write metadata");
        run_git(&repo_path, &["add", REPO_METADATA_RELATIVE_PATH]);
        run_git(&repo_path, &["commit", "-m", "Remote migration"]);
        let remote_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        run_git(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", &remote_head],
        );
        run_git(&repo_path, &["reset", "--hard", &old_head]);
        fs::write(repo_path.join("project.json"), "{\"title\":\"local\"}\n")
            .expect("write old-layout local change");
        run_git(&repo_path, &["add", "project.json"]);
        run_git(&repo_path, &["commit", "-m", "Local old layout change"]);

        let error = adopt_remote_migrated_layout(&repo_path, "main", "origin/main")
            .expect_err("local old-layout commits should require explicit discard");
        assert!(is_remote_migrated_local_old_layout_changes_error(&error));

        discard_local_old_layout_changes_and_adopt_remote(&repo_path, "main", "origin/main")
            .expect("discard and adopt remote layout");

        assert_eq!(git_stdout(&repo_path, &["rev-parse", "HEAD"]), remote_head);
        assert!(repo_path.join(REPO_METADATA_RELATIVE_PATH).exists());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn discard_old_layout_changes_clears_dirty_worktree_before_adopting_remote() {
        let repo_path = temp_repo("discard-old-layout-dirty-adopt-remote");
        fs::write(repo_path.join("project.json"), "{}\n").expect("write project");
        run_git(&repo_path, &["add", "project.json"]);
        run_git(&repo_path, &["commit", "-m", "Initial"]);
        let old_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);

        write_repo_layout_metadata(&repo_path, &new_v2_repo_layout_metadata(RepoKind::Project))
            .expect("write metadata");
        run_git(&repo_path, &["add", REPO_METADATA_RELATIVE_PATH]);
        run_git(&repo_path, &["commit", "-m", "Remote migration"]);
        let remote_head = git_stdout(&repo_path, &["rev-parse", "HEAD"]);
        run_git(
            &repo_path,
            &["update-ref", "refs/remotes/origin/main", &remote_head],
        );
        run_git(&repo_path, &["reset", "--hard", &old_head]);
        fs::write(repo_path.join("project.json"), "{\"title\":\"dirty\"}\n")
            .expect("write dirty file");
        fs::write(repo_path.join("stray.txt"), "untracked\n").expect("write untracked file");

        let error = adopt_remote_migrated_layout(&repo_path, "main", "origin/main")
            .expect_err("dirty worktree should require explicit discard");
        assert!(is_remote_migrated_local_old_layout_changes_error(&error));

        discard_local_old_layout_changes_and_adopt_remote(&repo_path, "main", "origin/main")
            .expect("discard dirty worktree and adopt remote layout");

        assert_eq!(git_stdout(&repo_path, &["rev-parse", "HEAD"]), remote_head);
        assert!(repo_path.join(REPO_METADATA_RELATIVE_PATH).exists());
        assert!(!repo_path.join("stray.txt").exists());
        let _ = fs::remove_dir_all(repo_path);
    }
}
