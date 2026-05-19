use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    broker::broker_get_json_with_session,
    broker_auth_storage::load_broker_auth_session,
    github::{github_client, types::GithubAppInstallationInfo},
    storage_paths::installation_data_dir,
};

const INSTALLATION_ACCESS_FILE: &str = "installation-access.json";
const READ_ONLY_ERROR: &str = "Read-only users cannot modify projects.";
const UNVERIFIED_ACCESS_ERROR: &str =
    "Could not verify write access for this team. Refresh team access and try again.";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallationAccessSnapshot {
    pub(crate) installation_id: i64,
    pub(crate) membership_role: Option<String>,
    pub(crate) can_delete: Option<bool>,
    pub(crate) can_manage_members: Option<bool>,
    pub(crate) can_manage_projects: Option<bool>,
    pub(crate) cached_at: Option<u64>,
}

pub(crate) fn is_read_only_membership_role(role: Option<&str>) -> bool {
    let normalized = role.unwrap_or_default().trim().to_lowercase();
    matches!(
        normalized.as_str(),
        "viewer" | "read_only" | "read-only" | "readonly"
    )
}

pub(crate) fn cache_installation_access(
    app: &AppHandle,
    installation: &GithubAppInstallationInfo,
) -> Result<(), String> {
    let snapshot = installation_access_snapshot(installation);
    write_installation_access_snapshot(app, &snapshot)
}

fn installation_access_snapshot(
    installation: &GithubAppInstallationInfo,
) -> InstallationAccessSnapshot {
    InstallationAccessSnapshot {
        installation_id: installation.installation_id,
        membership_role: installation.membership_role.clone(),
        can_delete: installation.can_delete,
        can_manage_members: installation.can_manage_members,
        can_manage_projects: installation.can_manage_projects,
        cached_at: current_unix_timestamp(),
    }
}

pub(crate) fn ensure_installation_allows_writes(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refresh_installation_access_snapshot(app, installation_id)
        .map_err(|_| UNVERIFIED_ACCESS_ERROR.to_string())?;
    ensure_snapshot_allows_writes(&snapshot)
}

fn refresh_installation_access_snapshot(
    app: &AppHandle,
    installation_id: i64,
) -> Result<InstallationAccessSnapshot, String> {
    let session = load_broker_auth_session(app.clone())?
        .ok_or_else(|| UNVERIFIED_ACCESS_ERROR.to_string())?;
    let client = github_client()?;
    let installation: GithubAppInstallationInfo = broker_get_json_with_session(
        &client,
        &format!("/api/github-app/installations/{installation_id}"),
        &session.session_token,
    )?;
    let snapshot = installation_access_snapshot(&installation);
    write_installation_access_snapshot(app, &snapshot)?;
    Ok(snapshot)
}

fn ensure_snapshot_allows_writes(snapshot: &InstallationAccessSnapshot) -> Result<(), String> {
    if is_read_only_membership_role(snapshot.membership_role.as_deref()) {
        return Err(READ_ONLY_ERROR.to_string());
    }
    if snapshot
        .membership_role
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
        || snapshot.can_manage_projects != Some(true)
    {
        return Err(UNVERIFIED_ACCESS_ERROR.to_string());
    }
    Ok(())
}

pub(crate) fn ensure_repo_allows_writes(app: &AppHandle, repo_path: &Path) -> Result<(), String> {
    if let Some(installation_id) = installation_id_from_path(repo_path) {
        ensure_installation_allows_writes(app, installation_id)?;
    }
    Ok(())
}

fn write_installation_access_snapshot(
    app: &AppHandle,
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    let path = installation_access_path(app, snapshot.installation_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Could not resolve the installation access folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the installation access folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| format!("Could not encode the installation access snapshot: {error}"))?;
    fs::write(&path, bytes).map_err(|error| {
        format!(
            "Could not write the installation access snapshot '{}': {error}",
            path.display()
        )
    })
}

fn installation_access_path(
    app: &AppHandle,
    installation_id: i64,
) -> Result<std::path::PathBuf, String> {
    Ok(installation_data_dir(app, installation_id)?.join(INSTALLATION_ACCESS_FILE))
}

fn installation_id_from_path(path: &Path) -> Option<i64> {
    path.components().find_map(|component| {
        let text = component.as_os_str().to_str()?;
        text.strip_prefix("installation-")?.parse::<i64>().ok()
    })
}

fn current_unix_timestamp() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|value| value.as_secs())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_snapshot_allows_writes, installation_id_from_path, is_read_only_membership_role,
        InstallationAccessSnapshot,
    };
    use std::path::Path;

    #[test]
    fn recognizes_viewer_role_aliases() {
        assert!(is_read_only_membership_role(Some("viewer")));
        assert!(is_read_only_membership_role(Some("read_only")));
        assert!(is_read_only_membership_role(Some("read-only")));
        assert!(is_read_only_membership_role(Some("readonly")));
        assert!(!is_read_only_membership_role(Some("admin")));
        assert!(!is_read_only_membership_role(Some("member")));
    }

    #[test]
    fn extracts_installation_id_from_repo_paths() {
        assert_eq!(
            installation_id_from_path(Path::new(
                "/tmp/installations/installation-42/projects/repo"
            )),
            Some(42),
        );
        assert_eq!(
            installation_id_from_path(Path::new("/tmp/no-installation/repo")),
            None
        );
    }

    #[test]
    fn write_access_requires_verified_manager_role() {
        let mut snapshot = InstallationAccessSnapshot {
            installation_id: 1,
            membership_role: Some("owner".to_string()),
            can_manage_projects: Some(true),
            ..InstallationAccessSnapshot::default()
        };
        assert!(ensure_snapshot_allows_writes(&snapshot).is_ok());

        snapshot.membership_role = Some("viewer".to_string());
        assert!(ensure_snapshot_allows_writes(&snapshot).is_err());

        snapshot.membership_role = None;
        assert!(ensure_snapshot_allows_writes(&snapshot).is_err());

        snapshot.membership_role = Some("owner".to_string());
        snapshot.can_manage_projects = Some(false);
        assert!(ensure_snapshot_allows_writes(&snapshot).is_err());
    }
}
