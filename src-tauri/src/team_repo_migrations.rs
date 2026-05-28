use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    glossary_repo_sync::find_glossary_repo_path, project_repo_paths::find_project_repo_path,
    qa_list_repo_sync::find_qa_list_repo_path, repo_layout_metadata::MIGRATION_0810,
    repo_migrations::repo_requires_0810_migration,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceMigrationCandidate {
    resource_id: Option<String>,
    repo_name: String,
    title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingTeamRepoMigration {
    resource_type: String,
    resource_id: Option<String>,
    repo_name: String,
    title: String,
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
) -> PendingTeamRepoMigration {
    PendingTeamRepoMigration {
        resource_type: resource_type.to_string(),
        resource_id,
        title: resource_title(title.as_deref(), &repo_name),
        repo_name,
    }
}

fn list_pending_team_repo_layout_migrations_sync(
    app: &AppHandle,
    input: TeamRepoMigrationScanInput,
) -> Result<Vec<PendingTeamRepoMigration>, String> {
    let mut pending = Vec::new();

    for project in input.projects {
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
            if repo_requires_0810_migration(&repo_path) {
                pending.push(pending_migration(
                    "project",
                    project_id,
                    repo_name,
                    project.title,
                ));
            }
        }
    }

    for glossary in input.glossaries {
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
            if repo_requires_0810_migration(&repo_path) {
                pending.push(pending_migration(
                    "glossary",
                    resource_id,
                    repo_name,
                    glossary.title,
                ));
            }
        }
    }

    for qa_list in input.qa_lists {
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
            if repo_requires_0810_migration(&repo_path) {
                pending.push(pending_migration(
                    "qaList",
                    resource_id,
                    repo_name,
                    qa_list.title,
                ));
            }
        }
    }

    Ok(pending)
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
        target_version: MIGRATION_0810.to_string(),
        migrations,
    })
}
