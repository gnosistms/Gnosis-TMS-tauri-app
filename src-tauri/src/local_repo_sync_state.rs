use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    repo_layout_metadata::normalize_repo_kind,
    repo_sync_shared::{format_git_spawn_error, git_command},
    util::{atomic_replace, random_token},
};

const LOCAL_REPO_SYNC_STATE_FILE_NAME: &str = "gnosis-sync-state.json";
static LOCAL_REPO_SYNC_STATE_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    OnceLock::new();

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoSyncState {
    #[serde(default)]
    pub(crate) resource_id: Option<String>,
    #[serde(default)]
    pub(crate) current_repo_name: Option<String>,
    #[serde(default)]
    pub(crate) kind: Option<String>,
    #[serde(default)]
    pub(crate) has_ever_synced: bool,
    #[serde(default)]
    pub(crate) last_known_github_repo_id: Option<i64>,
    #[serde(default)]
    pub(crate) last_known_full_name: Option<String>,
    #[serde(default)]
    pub(crate) last_successful_sync_at: Option<u64>,
    #[serde(default)]
    pub(crate) storage_layout_version: Option<u32>,
    #[serde(default)]
    pub(crate) local_folder_name: Option<String>,
}

#[derive(Default)]
pub(crate) struct LocalRepoSyncStateUpdate {
    pub(crate) resource_id: Option<String>,
    pub(crate) current_repo_name: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) has_ever_synced: Option<bool>,
    pub(crate) last_known_github_repo_id: Option<i64>,
    pub(crate) last_known_full_name: Option<String>,
    pub(crate) touch_success_timestamp: bool,
    pub(crate) storage_layout_version: Option<u32>,
    pub(crate) local_folder_name: Option<String>,
}

pub(crate) enum LocalRepoSyncStateInspection {
    NotRepository,
    Repository(Option<LocalRepoSyncState>),
}

#[derive(Debug)]
enum GitDirResolutionError {
    NotRepository(String),
    GitRuntime(String),
}

impl GitDirResolutionError {
    fn into_message(self) -> String {
        match self {
            Self::NotRepository(message) | Self::GitRuntime(message) => message,
        }
    }
}

fn classify_git_dir_resolution_failure(repo_path: &Path, message: String) -> GitDirResolutionError {
    if repo_path.join(".git").try_exists().unwrap_or(true) {
        GitDirResolutionError::GitRuntime(message)
    } else {
        GitDirResolutionError::NotRepository(message)
    }
}

pub(crate) fn upsert_local_repo_sync_state(
    repo_path: &Path,
    update: LocalRepoSyncStateUpdate,
) -> Result<LocalRepoSyncState, String> {
    let state_path = local_repo_sync_state_path(repo_path)?;
    let state_lock = local_repo_sync_state_lock(&state_path);
    let _state_lock_guard = state_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut state = if state_path.exists() {
        let bytes = fs::read(&state_path).map_err(|error| {
            format!(
                "Could not read local repo sync state '{}': {error}",
                state_path.display()
            )
        })?;
        serde_json::from_slice::<LocalRepoSyncState>(&bytes).map_err(|error| {
            format!(
                "Could not parse local repo sync state '{}': {error}",
                state_path.display()
            )
        })?
    } else {
        LocalRepoSyncState::default()
    };

    if let Some(resource_id) = update
        .resource_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        state.resource_id = Some(resource_id.to_string());
    }

    if let Some(current_repo_name) = update
        .current_repo_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        state.current_repo_name = Some(current_repo_name.to_string());
    }

    if let Some(kind) = update
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        state.kind = Some(normalize_repo_kind(kind).unwrap_or(kind).to_string());
    }

    if let Some(has_ever_synced) = update.has_ever_synced {
        state.has_ever_synced = has_ever_synced;
    }

    if let Some(repo_id) = update.last_known_github_repo_id {
        state.last_known_github_repo_id = Some(repo_id);
    }

    if let Some(full_name) = update
        .last_known_full_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        state.last_known_full_name = Some(full_name.to_string());
    }

    if let Some(storage_layout_version) = update.storage_layout_version {
        state.storage_layout_version = Some(storage_layout_version);
    }

    if let Some(local_folder_name) = update
        .local_folder_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        state.local_folder_name = Some(local_folder_name.to_string());
    }

    if update.touch_success_timestamp {
        state.last_successful_sync_at = current_unix_timestamp();
    }

    if state.local_folder_name.is_none() {
        state.local_folder_name = repo_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }

    let bytes = serde_json::to_vec_pretty(&state)
        .map_err(|error| format!("Could not serialize local repo sync state: {error}"))?;
    let tmp_path = state_path.with_extension(format!("json.{}.tmp", random_token(16)));
    fs::write(&tmp_path, bytes).map_err(|error| {
        format!(
            "Could not write local repo sync state temp file '{}': {error}",
            tmp_path.display()
        )
    })?;
    atomic_replace(&tmp_path, &state_path).map_err(|error| {
        format!(
            "Could not write local repo sync state '{}': {error}",
            state_path.display()
        )
    })?;

    Ok(state)
}

fn local_repo_sync_state_lock(state_path: &Path) -> Arc<Mutex<()>> {
    let locks = LOCAL_REPO_SYNC_STATE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.entry(state_path.to_path_buf()).or_default().clone()
}

pub(crate) fn read_local_repo_sync_state(
    repo_path: &Path,
) -> Result<Option<LocalRepoSyncState>, String> {
    let state_path = local_repo_sync_state_path(repo_path)?;
    read_local_repo_sync_state_path(&state_path)
}

/// Inspects a discovery candidate without probing it once and then resolving its git
/// directory a second time. A folder that is not (or is no longer) a repository is
/// expected discovery control flow; Git runtime failures and corrupt state remain
/// actionable errors.
pub(crate) fn inspect_local_repo_sync_state(
    repo_path: &Path,
) -> Result<LocalRepoSyncStateInspection, String> {
    let git_dir = match resolve_git_dir(repo_path) {
        Ok(git_dir) => git_dir,
        Err(GitDirResolutionError::NotRepository(_)) => {
            return Ok(LocalRepoSyncStateInspection::NotRepository)
        }
        Err(GitDirResolutionError::GitRuntime(message)) => return Err(message),
    };

    inspect_resolved_local_repo_sync_state(repo_path, &git_dir)
}

fn inspect_resolved_local_repo_sync_state(
    repo_path: &Path,
    git_dir: &Path,
) -> Result<LocalRepoSyncStateInspection, String> {
    // The checkout or its .git directory can disappear after rev-parse exits. Do
    // not turn that benign discovery race into a failed scan.
    if !repo_path.is_dir() || !git_dir.is_dir() {
        return Ok(LocalRepoSyncStateInspection::NotRepository);
    }

    let state_path = git_dir.join(LOCAL_REPO_SYNC_STATE_FILE_NAME);
    match read_local_repo_sync_state_path(&state_path) {
        Ok(state) => Ok(LocalRepoSyncStateInspection::Repository(state)),
        Err(_error) if !repo_path.is_dir() || !git_dir.is_dir() => {
            Ok(LocalRepoSyncStateInspection::NotRepository)
        }
        Err(error) => Err(error),
    }
}

fn read_local_repo_sync_state_path(
    state_path: &Path,
) -> Result<Option<LocalRepoSyncState>, String> {
    if !state_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(state_path).map_err(|error| {
        format!(
            "Could not read local repo sync state '{}': {error}",
            state_path.display()
        )
    })?;
    let state = serde_json::from_slice::<LocalRepoSyncState>(&bytes).map_err(|error| {
        format!(
            "Could not parse local repo sync state '{}': {error}",
            state_path.display()
        )
    })?;
    Ok(Some(state))
}

fn local_repo_sync_state_path(repo_path: &Path) -> Result<PathBuf, String> {
    Ok(resolve_git_dir(repo_path)
        .map_err(GitDirResolutionError::into_message)?
        .join(LOCAL_REPO_SYNC_STATE_FILE_NAME))
}

fn resolve_git_dir(repo_path: &Path) -> Result<PathBuf, GitDirResolutionError> {
    let output = git_command()
        .map_err(|error| {
            GitDirResolutionError::GitRuntime(format!(
                "Could not inspect the git directory for '{}': {error}",
                repo_path.display()
            ))
        })?
        .args(["rev-parse", "--git-dir"])
        .current_dir(repo_path)
        .output()
        .map_err(|error| {
            let message = format!(
                "Could not inspect the git directory for '{}': {}",
                repo_path.display(),
                format_git_spawn_error(&["rev-parse", "--git-dir"], &error)
            );
            classify_git_dir_resolution_failure(repo_path, message)
        })?;

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
        return Err(classify_git_dir_resolution_failure(
            repo_path,
            format!(
                "Could not resolve the git directory for '{}': {detail}",
                repo_path.display()
            ),
        ));
    }

    let git_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if git_dir.is_empty() {
        return Err(classify_git_dir_resolution_failure(
            repo_path,
            format!(
                "Could not resolve the git directory for '{}': git rev-parse returned an empty path.",
                repo_path.display()
            ),
        ));
    }

    let git_dir_path = PathBuf::from(git_dir);
    Ok(if git_dir_path.is_absolute() {
        git_dir_path
    } else {
        repo_path.join(git_dir_path)
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
    use std::{fs, sync::Arc, thread};

    use super::{
        inspect_local_repo_sync_state, inspect_resolved_local_repo_sync_state,
        read_local_repo_sync_state, resolve_git_dir, upsert_local_repo_sync_state,
        LocalRepoSyncStateInspection, LocalRepoSyncStateUpdate,
    };
    use crate::{repo_sync_shared::git_command, util::random_token};

    fn init_test_repo(label: &str) -> std::path::PathBuf {
        let repo_path = std::env::temp_dir().join(format!("gnosis-{label}-{}", random_token(16)));
        fs::create_dir_all(&repo_path).expect("create test repo directory");
        let init_status = git_command()
            .expect("resolve git")
            .args(["init", "--quiet"])
            .current_dir(&repo_path)
            .status()
            .expect("run git init");
        assert!(init_status.success());
        repo_path
    }

    #[test]
    fn discovery_skips_plain_and_disappeared_folders() {
        let plain_path =
            std::env::temp_dir().join(format!("gnosis-plain-folder-{}", random_token(16)));
        fs::create_dir_all(&plain_path).expect("create plain folder");
        assert!(matches!(
            inspect_local_repo_sync_state(&plain_path).expect("inspect plain folder"),
            LocalRepoSyncStateInspection::NotRepository
        ));

        let disappeared_path = init_test_repo("disappeared-repo");
        fs::remove_dir_all(&disappeared_path).expect("remove discovered repo");
        assert!(matches!(
            inspect_local_repo_sync_state(&disappeared_path).expect("inspect disappeared repo"),
            LocalRepoSyncStateInspection::NotRepository
        ));

        let _ = fs::remove_dir_all(&plain_path);
    }

    #[test]
    fn discovery_skips_repo_that_becomes_invalid_after_git_resolution() {
        let repo_path = init_test_repo("invalidated-repo");
        let git_dir = resolve_git_dir(&repo_path).expect("resolve git dir before invalidation");
        fs::remove_dir_all(&git_dir).expect("remove git dir");

        assert!(matches!(
            inspect_resolved_local_repo_sync_state(&repo_path, &git_dir)
                .expect("inspect invalidated repo"),
            LocalRepoSyncStateInspection::NotRepository
        ));

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn discovery_reports_rev_parse_failure_when_git_metadata_remains() {
        let repo_path =
            std::env::temp_dir().join(format!("gnosis-broken-git-{}", random_token(16)));
        fs::create_dir_all(repo_path.join(".git")).expect("create git metadata marker");

        let error = match inspect_local_repo_sync_state(&repo_path) {
            Err(error) => error,
            Ok(_) => panic!("git metadata inspection failure must remain actionable"),
        };
        assert!(error.contains("Could not resolve the git directory"));

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn discovery_still_reports_corrupt_sync_state() {
        let repo_path = init_test_repo("corrupt-sync-state");
        let git_dir = resolve_git_dir(&repo_path).expect("resolve git dir");
        fs::write(git_dir.join("gnosis-sync-state.json"), b"{not valid json")
            .expect("write corrupt sync state");

        let error = match inspect_local_repo_sync_state(&repo_path) {
            Err(error) => error,
            Ok(_) => panic!("corrupt sync state must remain actionable"),
        };
        assert!(error.contains("Could not parse local repo sync state"));

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn concurrent_upserts_preserve_both_updates_and_valid_json() {
        let repo_path = init_test_repo("local-sync-state-test");

        let repo_path = Arc::new(repo_path);
        let first_repo_path = Arc::clone(&repo_path);
        let first = thread::spawn(move || {
            upsert_local_repo_sync_state(
                &first_repo_path,
                LocalRepoSyncStateUpdate {
                    resource_id: Some("resource-1".to_string()),
                    ..Default::default()
                },
            )
        });
        let second_repo_path = Arc::clone(&repo_path);
        let second = thread::spawn(move || {
            upsert_local_repo_sync_state(
                &second_repo_path,
                LocalRepoSyncStateUpdate {
                    current_repo_name: Some("renamed-repo".to_string()),
                    ..Default::default()
                },
            )
        });

        first
            .join()
            .expect("first writer panicked")
            .expect("first upsert failed");
        second
            .join()
            .expect("second writer panicked")
            .expect("second upsert failed");

        let state = read_local_repo_sync_state(&repo_path)
            .expect("read state")
            .expect("state exists");
        assert_eq!(state.resource_id.as_deref(), Some("resource-1"));
        assert_eq!(state.current_repo_name.as_deref(), Some("renamed-repo"));

        fs::remove_dir_all(repo_path.as_ref()).expect("remove test repo");
    }
}
