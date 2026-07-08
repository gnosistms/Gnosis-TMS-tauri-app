use std::{fs, path::Path};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    broker::{broker_client, broker_get_json_with_session, BROKER_AUTH_REQUIRED_PREFIX},
    broker_auth_storage::load_broker_auth_session_internal,
    github::types::GithubAppInstallationInfo,
    storage_paths::installation_data_dir,
};

const INSTALLATION_ACCESS_FILE: &str = "installation-access.json";
const CONTENT_WRITE_ERROR: &str = "Your account type cannot edit shared content.";
const RESOURCE_MANAGEMENT_ERROR: &str = "Your account type cannot manage shared resources.";
const MEMBER_MANAGEMENT_ERROR: &str = "Your account type cannot manage team members.";
const TEAM_MANAGEMENT_ERROR: &str = "Your account type cannot manage team settings.";
const READ_ONLY_TEAM_AI_ERROR: &str = "Read-only users cannot use shared team AI.";
const UNVERIFIED_ACCESS_ERROR: &str =
    "Could not verify write access for this team. Refresh team access and try again.";
const UNVERIFIED_TEAM_ACCESS_ERROR: &str =
    "Could not verify active access for this team. Refresh team access and try again.";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallationAccessSnapshot {
    pub(crate) installation_id: i64,
    pub(crate) membership_role: Option<String>,
    pub(crate) can_delete: Option<bool>,
    pub(crate) can_manage_members: Option<bool>,
    pub(crate) can_manage_projects: Option<bool>,
    pub(crate) cached_at: Option<String>,
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
        cached_at: Some(Utc::now().to_rfc3339()),
    }
}

// Map an access-snapshot error to a user-facing string, but preserve broker
// AUTH_REQUIRED: errors verbatim. The JS invoke wrapper only triggers a
// transparent re-auth when the message still carries that prefix, so replacing
// it with a generic message breaks silent session refresh.
fn map_access_error(error: String, generic: &str) -> String {
    if error.starts_with(BROKER_AUTH_REQUIRED_PREFIX) {
        error
    } else {
        generic.to_string()
    }
}

// Shared helper: refresh snapshot for an installation, mapping broker errors to
// UNVERIFIED_ACCESS_ERROR (except AUTH_REQUIRED:, preserved for re-auth). Used by
// all ensure_installation_allows_* functions that share that error message.
fn refreshed_snapshot(
    app: &AppHandle,
    installation_id: i64,
) -> Result<InstallationAccessSnapshot, String> {
    refresh_installation_access_snapshot(app, installation_id)
        .map_err(|error| map_access_error(error, UNVERIFIED_ACCESS_ERROR))
}

// Canonical implementation shared by the three identical content-write gates.
pub(crate) fn ensure_installation_allows_content_writes(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_content_writes(&snapshot)
}

pub(crate) fn ensure_installation_allows_chapter_writes(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    ensure_installation_allows_content_writes(app, installation_id)
}

pub(crate) fn ensure_installation_allows_glossary_writes(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    ensure_installation_allows_content_writes(app, installation_id)
}

pub(crate) fn ensure_installation_allows_qa_list_writes(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    ensure_installation_allows_content_writes(app, installation_id)
}

pub(crate) fn ensure_installation_allows_project_management(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_resource_management(&snapshot)
}

pub(crate) fn ensure_installation_allows_glossary_management(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_resource_management(&snapshot)
}

pub(crate) fn ensure_installation_allows_qa_list_management(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_resource_management(&snapshot)
}

pub(crate) fn ensure_installation_allows_member_management(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_member_management(&snapshot)
}

pub(crate) fn ensure_installation_allows_team_management(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    let snapshot = refreshed_snapshot(app, installation_id)?;
    ensure_snapshot_allows_team_management(&snapshot)
}

pub(crate) fn ensure_installation_allows_team_ai_access(
    app: &AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    // Note: team_ai uses UNVERIFIED_TEAM_ACCESS_ERROR (not UNVERIFIED_ACCESS_ERROR),
    // so we do NOT route through refreshed_snapshot() here.
    let snapshot = refresh_installation_access_snapshot(app, installation_id)
        .map_err(|error| map_access_error(error, UNVERIFIED_TEAM_ACCESS_ERROR))?;
    ensure_snapshot_allows_team_ai_access(&snapshot)
}

fn refresh_installation_access_snapshot(
    app: &AppHandle,
    installation_id: i64,
) -> Result<InstallationAccessSnapshot, String> {
    // Try cached snapshot first (TTL = 60 seconds).
    if let Some(cached) = read_cached_installation_access(app, installation_id) {
        if is_installation_snapshot_fresh(&cached) {
            return Ok(cached);
        }
    }
    // Cache is stale or absent — fetch fresh from the broker.
    let snapshot = fetch_installation_access_from_broker(app, installation_id)?;
    write_installation_access_snapshot(app, &snapshot)?;
    Ok(snapshot)
}

fn fetch_installation_access_from_broker(
    app: &AppHandle,
    installation_id: i64,
) -> Result<InstallationAccessSnapshot, String> {
    let session = load_broker_auth_session_internal(app)?
        .ok_or_else(|| UNVERIFIED_ACCESS_ERROR.to_string())?;
    let client = broker_client()?;
    let installation: GithubAppInstallationInfo = broker_get_json_with_session(
        &client,
        &format!("/api/github-app/installations/{installation_id}"),
        &session.session_token,
    )?;
    Ok(installation_access_snapshot(&installation))
}

fn read_cached_installation_access(
    app: &AppHandle,
    installation_id: i64,
) -> Option<InstallationAccessSnapshot> {
    let path = installation_access_path(app, installation_id).ok()?;
    let bytes = fs::read(&path).ok()?;
    // Fail soft: old caches may have a numeric cachedAt field that won't
    // deserialize into Option<String>. Treat any parse failure as a cache miss.
    serde_json::from_slice(&bytes).ok()
}

fn is_installation_snapshot_fresh(snapshot: &InstallationAccessSnapshot) -> bool {
    snapshot
        .cached_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|cached_at| {
            let age = Utc::now().signed_duration_since(cached_at.with_timezone(&Utc));
            age.num_seconds().abs() < 60
        })
        .unwrap_or(false)
}

fn normalized_membership_role(role: Option<&str>) -> Option<&'static str> {
    let normalized = role?.trim().to_lowercase();
    if normalized.is_empty() {
        return None;
    }
    match normalized.as_str() {
        "viewer" | "read_only" | "read-only" | "readonly" => Some("viewer"),
        "translator" | "member" => Some("translator"),
        "admin" => Some("admin"),
        "owner" => Some("owner"),
        _ => Some("unknown"),
    }
}

fn snapshot_has_verified_membership(snapshot: &InstallationAccessSnapshot) -> bool {
    normalized_membership_role(snapshot.membership_role.as_deref()).is_some()
        || snapshot.can_delete == Some(true)
        || snapshot.can_manage_projects == Some(true)
}

fn snapshot_is_owner(snapshot: &InstallationAccessSnapshot) -> bool {
    match normalized_membership_role(snapshot.membership_role.as_deref()) {
        Some("owner") => true,
        Some(_) => false,
        None => snapshot.can_delete == Some(true),
    }
}

fn snapshot_can_write_content(snapshot: &InstallationAccessSnapshot) -> bool {
    matches!(
        normalized_membership_role(snapshot.membership_role.as_deref()),
        Some("translator" | "admin" | "owner")
    )
}

fn snapshot_can_manage_resources(snapshot: &InstallationAccessSnapshot) -> bool {
    match normalized_membership_role(snapshot.membership_role.as_deref()) {
        Some("admin" | "owner") => true,
        Some(_) => false,
        // Legacy fallback: installations without a role field pre-date explicit role assignment.
        // Capability flags (can_manage_projects, can_delete) are the authoritative signal
        // when no role string is present. An explicitly returned but unrecognised role string
        // (Some(_) arm above) does NOT fall back to flags — unknown role means no management access.
        None => snapshot.can_manage_projects == Some(true) || snapshot.can_delete == Some(true),
    }
}

fn ensure_snapshot_allows_content_writes(
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    if !snapshot_has_verified_membership(snapshot) {
        return Err(UNVERIFIED_ACCESS_ERROR.to_string());
    }
    if !snapshot_can_write_content(snapshot) {
        return Err(CONTENT_WRITE_ERROR.to_string());
    }
    Ok(())
}

fn ensure_snapshot_allows_resource_management(
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    if !snapshot_has_verified_membership(snapshot) {
        return Err(UNVERIFIED_ACCESS_ERROR.to_string());
    }
    if !snapshot_can_manage_resources(snapshot) {
        return Err(RESOURCE_MANAGEMENT_ERROR.to_string());
    }
    Ok(())
}

fn ensure_snapshot_allows_member_management(
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    if !snapshot_has_verified_membership(snapshot) {
        return Err(UNVERIFIED_ACCESS_ERROR.to_string());
    }
    if !snapshot_is_owner(snapshot) {
        return Err(MEMBER_MANAGEMENT_ERROR.to_string());
    }
    Ok(())
}

fn ensure_snapshot_allows_team_management(
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    if !snapshot_has_verified_membership(snapshot) {
        return Err(UNVERIFIED_ACCESS_ERROR.to_string());
    }
    if !snapshot_is_owner(snapshot) {
        return Err(TEAM_MANAGEMENT_ERROR.to_string());
    }
    Ok(())
}

fn ensure_snapshot_allows_team_ai_access(
    snapshot: &InstallationAccessSnapshot,
) -> Result<(), String> {
    if !snapshot_has_verified_membership(snapshot) {
        return Err(UNVERIFIED_TEAM_ACCESS_ERROR.to_string());
    }
    match normalized_membership_role(snapshot.membership_role.as_deref()) {
        Some("translator" | "member" | "admin" | "owner") => Ok(()),
        _ => Err(READ_ONLY_TEAM_AI_ERROR.to_string()),
    }
}

pub(crate) fn ensure_repo_allows_writes(app: &AppHandle, repo_path: &Path) -> Result<(), String> {
    let installation_id = installation_id_from_path(repo_path).ok_or_else(|| {
        "Could not determine the GitHub installation for this repository. Write access cannot be verified.".to_string()
    })?;
    ensure_installation_allows_chapter_writes(app, installation_id)
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
    // Atomic write: write to a sibling .tmp file first, then rename into place.
    // This prevents a partial read if the process is interrupted mid-write.
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &bytes).map_err(|error| {
        format!(
            "Could not write the installation access snapshot '{}': {error}",
            tmp_path.display()
        )
    })?;
    crate::util::atomic_replace(&tmp_path, &path).map_err(|error| {
        format!(
            "Could not finalize the installation access snapshot '{}': {error}",
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

#[cfg(test)]
mod tests {
    use super::{
        ensure_snapshot_allows_content_writes, ensure_snapshot_allows_member_management,
        ensure_snapshot_allows_resource_management, ensure_snapshot_allows_team_ai_access,
        installation_id_from_path, map_access_error, InstallationAccessSnapshot,
        UNVERIFIED_ACCESS_ERROR,
    };
    use crate::broker::BROKER_AUTH_REQUIRED_PREFIX;
    use std::path::Path;

    #[test]
    fn map_access_error_preserves_broker_auth_required() {
        // AUTH_REQUIRED: errors must pass through so the JS invoke wrapper can
        // trigger a transparent re-auth instead of showing the generic message.
        let auth = format!("{BROKER_AUTH_REQUIRED_PREFIX}Your GitHub session expired.");
        assert_eq!(
            map_access_error(auth.clone(), UNVERIFIED_ACCESS_ERROR),
            auth
        );
        // Any other error collapses to the generic user-facing message.
        assert_eq!(
            map_access_error("network timeout".to_string(), UNVERIFIED_ACCESS_ERROR),
            UNVERIFIED_ACCESS_ERROR
        );
    }

    #[test]
    fn recognizes_viewer_role_aliases() {
        // Every viewer alias must normalize to read-only and be denied team AI access.
        for role in ["viewer", "read_only", "read-only", "readonly"] {
            let snapshot = InstallationAccessSnapshot {
                membership_role: Some(role.to_string()),
                ..Default::default()
            };
            assert!(
                ensure_snapshot_allows_team_ai_access(&snapshot).is_err(),
                "{role} should be treated as read-only"
            );
        }
        // Non-viewer active roles are not read-only.
        for role in ["admin", "member"] {
            let snapshot = InstallationAccessSnapshot {
                membership_role: Some(role.to_string()),
                ..Default::default()
            };
            assert!(
                ensure_snapshot_allows_team_ai_access(&snapshot).is_ok(),
                "{role} should not be treated as read-only"
            );
        }
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
    fn content_write_access_allows_translators_admins_and_owners() {
        let mut snapshot = InstallationAccessSnapshot {
            installation_id: 1,
            membership_role: Some("translator".to_string()),
            can_manage_projects: Some(false),
            ..InstallationAccessSnapshot::default()
        };
        assert!(ensure_snapshot_allows_content_writes(&snapshot).is_ok());

        snapshot.membership_role = Some("admin".to_string());
        assert!(ensure_snapshot_allows_content_writes(&snapshot).is_ok());

        snapshot.membership_role = Some("owner".to_string());
        assert!(ensure_snapshot_allows_content_writes(&snapshot).is_ok());

        snapshot.membership_role = Some("viewer".to_string());
        assert!(ensure_snapshot_allows_content_writes(&snapshot).is_err());

        snapshot.membership_role = None;
        assert!(ensure_snapshot_allows_content_writes(&snapshot).is_err());
    }

    #[test]
    fn resource_management_allows_admins_and_owners_only() {
        let mut snapshot = InstallationAccessSnapshot {
            installation_id: 1,
            membership_role: Some("admin".to_string()),
            can_manage_projects: Some(true),
            ..InstallationAccessSnapshot::default()
        };
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_ok());

        snapshot.membership_role = Some("owner".to_string());
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_ok());

        snapshot.membership_role = Some("translator".to_string());
        snapshot.can_manage_projects = Some(false);
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_err());

        snapshot.membership_role = Some("viewer".to_string());
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_err());

        snapshot.membership_role = Some("unexpected-role".to_string());
        snapshot.can_manage_projects = Some(true);
        snapshot.can_delete = Some(true);
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_err());

        snapshot.membership_role = None;
        assert!(ensure_snapshot_allows_resource_management(&snapshot).is_ok());
    }

    #[test]
    fn member_management_allows_owners_only() {
        let mut snapshot = InstallationAccessSnapshot {
            installation_id: 1,
            membership_role: Some("owner".to_string()),
            can_delete: Some(true),
            ..InstallationAccessSnapshot::default()
        };
        assert!(ensure_snapshot_allows_member_management(&snapshot).is_ok());

        snapshot.membership_role = Some("admin".to_string());
        snapshot.can_delete = Some(false);
        assert!(ensure_snapshot_allows_member_management(&snapshot).is_err());

        snapshot.can_delete = Some(true);
        assert!(ensure_snapshot_allows_member_management(&snapshot).is_err());

        snapshot.membership_role = Some("unexpected-role".to_string());
        assert!(ensure_snapshot_allows_member_management(&snapshot).is_err());

        snapshot.membership_role = None;
        assert!(ensure_snapshot_allows_member_management(&snapshot).is_ok());
    }

    #[test]
    fn team_ai_access_requires_non_viewer_active_membership() {
        let mut snapshot = InstallationAccessSnapshot {
            installation_id: 1,
            membership_role: Some("member".to_string()),
            can_manage_projects: Some(false),
            ..InstallationAccessSnapshot::default()
        };
        assert!(ensure_snapshot_allows_team_ai_access(&snapshot).is_ok());

        snapshot.membership_role = Some("viewer".to_string());
        assert!(ensure_snapshot_allows_team_ai_access(&snapshot).is_err());

        snapshot.membership_role = None;
        assert!(ensure_snapshot_allows_team_ai_access(&snapshot).is_err());
    }
}
