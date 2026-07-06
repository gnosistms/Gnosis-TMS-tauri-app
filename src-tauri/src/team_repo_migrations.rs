use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    glossary_repo_sync::find_glossary_repo_path,
    project_repo_paths::find_project_repo_path,
    qa_list_repo_sync::find_qa_list_repo_path,
    repo_layout_metadata::RepoKind,
    repo_migrations::{latest_layout_migration_id, pending_repo_migrations, RepoMigrationKind},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamRepoMigrationScanInput {
    installation_id: i64,
    projects: Vec<ProjectMigrationCandidate>,
    glossaries: Vec<ResourceMigrationCandidate>,
    qa_lists: Vec<ResourceMigrationCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMigrationCandidate {
    project_id: Option<String>,
    repo_name: String,
    title: Option<String>,
    lifecycle_state: Option<String>,
    record_state: Option<String>,
    remote_state: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceMigrationCandidate {
    resource_id: Option<String>,
    repo_name: String,
    title: Option<String>,
    lifecycle_state: Option<String>,
    record_state: Option<String>,
    remote_state: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingTeamRepoMigration {
    resource_type: String,
    resource_id: Option<String>,
    repo_name: String,
    title: String,
    migration_reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingTeamRepoMigrationScan {
    target_version: String,
    migrations: Vec<PendingTeamRepoMigration>,
}

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn resource_title(title: Option<&str>, repo_name: &str) -> String {
    normalized(title)
        .unwrap_or_else(|| repo_name.trim())
        .to_string()
}

fn pending_migration(
    resource_type: &str,
    resource_id: Option<String>,
    repo_name: String,
    title: Option<String>,
    migration_reason: &str,
) -> PendingTeamRepoMigration {
    PendingTeamRepoMigration {
        resource_type: resource_type.to_string(),
        resource_id,
        title: resource_title(title.as_deref(), &repo_name),
        repo_name,
        migration_reason: migration_reason.to_string(),
    }
}

fn is_deleted_state(value: Option<&str>) -> bool {
    normalized(value)
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "deleted" | "softdeleted" | "tombstone"
            )
        })
        .unwrap_or(false)
}

fn is_deleted_project_candidate(project: &ProjectMigrationCandidate) -> bool {
    is_deleted_state(project.lifecycle_state.as_deref())
        || is_deleted_state(project.record_state.as_deref())
        || is_deleted_state(project.remote_state.as_deref())
}

fn is_deleted_resource_candidate(resource: &ResourceMigrationCandidate) -> bool {
    is_deleted_state(resource.lifecycle_state.as_deref())
        || is_deleted_state(resource.record_state.as_deref())
        || is_deleted_state(resource.remote_state.as_deref())
}

/// Only a definitive "a layout migration pends" verdict may enqueue the
/// modal migration. Content migrations run inline during sync, and unreadable
/// metadata (corrupt, or written by a future app) is skipped here — the sync
/// paths surface it as a per-repo sync error, and migrating would rewrite
/// data this app version cannot read.
fn repo_pends_layout_migration_for_scan(repo_path: &std::path::Path, repo_kind: &RepoKind) -> bool {
    matches!(
        pending_repo_migrations(repo_path, repo_kind),
        Ok(pending) if pending
            .iter()
            .any(|descriptor| descriptor.kind == RepoMigrationKind::Layout)
    )
}

fn list_pending_team_repo_layout_migrations_sync(
    app: &AppHandle,
    input: TeamRepoMigrationScanInput,
) -> Result<Vec<PendingTeamRepoMigration>, String> {
    let mut pending = Vec::new();

    for project in input.projects {
        if is_deleted_project_candidate(&project) {
            continue;
        }
        let repo_name = match normalized(Some(project.repo_name.as_str())) {
            Some(repo_name) => repo_name.to_string(),
            None => continue,
        };
        let project_id = normalized(project.project_id.as_deref()).map(str::to_string);
        if let Some(repo_path) = find_project_repo_path(
            app,
            input.installation_id,
            project_id.as_deref(),
            Some(&repo_name),
        )? {
            if repo_pends_layout_migration_for_scan(&repo_path, &RepoKind::Project) {
                pending.push(pending_migration(
                    "project",
                    project_id,
                    repo_name,
                    project.title,
                    "pendingMigration",
                ));
            }
        }
    }

    for glossary in input.glossaries {
        if is_deleted_resource_candidate(&glossary) {
            continue;
        }
        let repo_name = match normalized(Some(glossary.repo_name.as_str())) {
            Some(repo_name) => repo_name.to_string(),
            None => continue,
        };
        let resource_id = normalized(glossary.resource_id.as_deref()).map(str::to_string);
        if let Some(repo_path) = find_glossary_repo_path(
            app,
            input.installation_id,
            resource_id.as_deref(),
            Some(&repo_name),
        )? {
            if repo_pends_layout_migration_for_scan(&repo_path, &RepoKind::Glossary) {
                pending.push(pending_migration(
                    "glossary",
                    resource_id,
                    repo_name,
                    glossary.title,
                    "pendingMigration",
                ));
            }
        }
    }

    for qa_list in input.qa_lists {
        if is_deleted_resource_candidate(&qa_list) {
            continue;
        }
        let repo_name = match normalized(Some(qa_list.repo_name.as_str())) {
            Some(repo_name) => repo_name.to_string(),
            None => continue,
        };
        let resource_id = normalized(qa_list.resource_id.as_deref()).map(str::to_string);
        if let Some(repo_path) = find_qa_list_repo_path(
            app,
            input.installation_id,
            resource_id.as_deref(),
            Some(&repo_name),
        )? {
            if repo_pends_layout_migration_for_scan(&repo_path, &RepoKind::QaList) {
                pending.push(pending_migration(
                    "qaList",
                    resource_id,
                    repo_name,
                    qa_list.title,
                    "pendingMigration",
                ));
            }
        }
    }

    Ok(pending)
}

/// The version the frontend's clean-verdict cache keys on. Served from the
/// backend registry so a future layout migration invalidates stored verdicts
/// without a lockstep constant bump in JS.
#[tauri::command]
pub(crate) fn team_repo_migration_target_version() -> String {
    latest_layout_migration_id().to_string()
}

#[tauri::command]
pub(crate) async fn list_pending_team_repo_layout_migrations(
    app: AppHandle,
    input: TeamRepoMigrationScanInput,
) -> Result<PendingTeamRepoMigrationScan, String> {
    let migrations = tauri::async_runtime::spawn_blocking(move || {
        list_pending_team_repo_layout_migrations_sync(&app, input)
    })
    .await
    .map_err(|error| format!("Could not inspect pending repo migrations: {error}"))??;

    Ok(PendingTeamRepoMigrationScan {
        target_version: latest_layout_migration_id().to_string(),
        migrations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleted_project_candidates_are_not_migration_candidates() {
        let active = ProjectMigrationCandidate {
            project_id: Some("project-active".to_string()),
            repo_name: "project-active".to_string(),
            title: None,
            lifecycle_state: Some("active".to_string()),
            record_state: Some("live".to_string()),
            remote_state: None,
        };
        let soft_deleted = ProjectMigrationCandidate {
            project_id: Some("project-deleted".to_string()),
            repo_name: "project-deleted".to_string(),
            title: None,
            lifecycle_state: Some("softDeleted".to_string()),
            record_state: Some("tombstone".to_string()),
            remote_state: Some("deleted".to_string()),
        };

        assert!(!is_deleted_project_candidate(&active));
        assert!(is_deleted_project_candidate(&soft_deleted));
    }

    #[test]
    fn deleted_resource_candidates_are_not_migration_candidates() {
        let active = ResourceMigrationCandidate {
            resource_id: Some("glossary-active".to_string()),
            repo_name: "glossary-active".to_string(),
            title: None,
            lifecycle_state: Some("active".to_string()),
            record_state: Some("live".to_string()),
            remote_state: None,
        };
        let tombstone = ResourceMigrationCandidate {
            resource_id: Some("glossary-deleted".to_string()),
            repo_name: "glossary-deleted".to_string(),
            title: None,
            lifecycle_state: None,
            record_state: Some("tombstone".to_string()),
            remote_state: None,
        };

        assert!(!is_deleted_resource_candidate(&active));
        assert!(is_deleted_resource_candidate(&tombstone));
    }
}
