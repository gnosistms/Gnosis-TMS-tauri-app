//! Glossary repo sync — thin per-domain wrappers over the shared engine in
//! `repo_resource_sync.rs`. Glossary and QA-list sync share one implementation; this file
//! only supplies the glossary-specific values ([`GlossaryDomain`]) and the Tauri command
//! entry points (names unchanged for the frontend `invoke` contract).

use std::path::PathBuf;

use tauri::AppHandle;

use crate::{
    installation_access::ensure_installation_allows_glossary_writes,
    repo_layout_metadata::RepoKind,
    repo_resource_sync::{
        discard_old_layout_repos, find_repo_path, sync_editor_repo, sync_repos,
        DiscardOldLayoutReposResponse, EditorRepoSyncResponse, RepoResourceDomain,
        RepoResourceEditorSyncInput, RepoResourceSyncInput, RepoSyncSnapshot,
    },
    storage_paths::local_glossary_repo_root,
};

/// Glossary-specific values for the shared repo-resource sync engine.
pub(crate) struct GlossaryDomain;

impl RepoResourceDomain for GlossaryDomain {
    fn repo_kind(&self) -> RepoKind {
        RepoKind::Glossary
    }
    fn identity_filename(&self) -> &'static str {
        "glossary.json"
    }
    fn state_kind(&self) -> &'static str {
        "glossary"
    }
    fn display_noun(&self) -> &'static str {
        "glossary"
    }
    fn local_repo_root(&self, app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
        local_glossary_repo_root(app, installation_id)
    }
    fn ensure_installation_allows_writes(
        &self,
        app: &AppHandle,
        installation_id: i64,
    ) -> Result<(), String> {
        ensure_installation_allows_glossary_writes(app, installation_id)
    }
}

#[tauri::command]
pub(crate) async fn sync_gtms_glossary_repos(
    app: AppHandle,
    input: RepoResourceSyncInput,
    session_token: String,
) -> Result<Vec<RepoSyncSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_repos(&GlossaryDomain, &app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The glossary repo sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn sync_gtms_glossary_editor_repo(
    app: AppHandle,
    input: RepoResourceEditorSyncInput,
    session_token: String,
) -> Result<EditorRepoSyncResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_editor_repo(&GlossaryDomain, &app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The glossary editor repo sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn discard_old_layout_gtms_glossary_repos(
    app: AppHandle,
    input: RepoResourceSyncInput,
    session_token: String,
) -> Result<DiscardOldLayoutReposResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        discard_old_layout_repos(&GlossaryDomain, &app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The old-layout glossary repo discard task failed: {error}"))?
}

/// Locate the local checkout for a glossary repo. Used by `team_repo_migrations.rs`.
pub(crate) fn find_glossary_repo_path(
    app: &AppHandle,
    installation_id: i64,
    glossary_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    find_repo_path(
        &GlossaryDomain,
        app,
        installation_id,
        glossary_id,
        repo_name,
    )
}
