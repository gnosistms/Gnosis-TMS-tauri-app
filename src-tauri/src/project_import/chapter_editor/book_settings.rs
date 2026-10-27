use super::*;
use crate::{
    broker_auth_storage::load_broker_auth_session_internal,
    git_commit::ensure_local_commit_preconditions,
    project_repo_sync::{
        prepare_export_settings_origin, sync_export_settings_repo, ProjectRepoSyncDescriptor,
    },
    repo_sync_shared::{
        acquire_repo_sync_lock, git_command, git_output as transport_git, load_git_transport_token,
        repo_sync_lock, GitTransportAuth,
    },
};
use tauri::Manager;

mod assets;
mod document;
pub(crate) use document::resolve_conflict as resolve_export_settings_git_conflict;
pub(crate) const EXPORT_SETTINGS_PATH: &str = document::SETTINGS_PATH;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectExportSettingsInput {
    #[serde(default)]
    pub(crate) request_id: String,
    login: String,
    pub(crate) installation_id: i64,
    project: ProjectRepoSyncDescriptor,
    pub(crate) settings: Option<Value>,
    base: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportSettingsSnapshot {
    settings: Option<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsEvent {
    request_id: String,
    settings: Option<Value>,
    error: String,
}

fn repo_path(app: &AppHandle, input: &ProjectExportSettingsInput) -> Result<PathBuf, String> {
    resolve_project_git_repo_path(
        app,
        input.installation_id,
        Some(&input.project.project_id),
        Some(&input.project.repo_name),
    )
}

fn check_account(app: &AppHandle, input: &ProjectExportSettingsInput) -> Result<(), String> {
    if !load_broker_auth_session_internal(app)?.is_some_and(|session| {
        !input.login.is_empty() && session.login.eq_ignore_ascii_case(&input.login)
    }) {
        return Err("The signed-in account changed while synchronizing export settings.".into());
    }
    Ok(())
}

fn cache_path(app: &AppHandle, input: &ProjectExportSettingsInput) -> Result<PathBuf, String> {
    check_account(app, input)?;
    let login = input.login.to_lowercase();
    let key = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{login}\n{}\n{}",
                input.installation_id, input.project.project_id
            )
            .as_bytes()
        )
    );
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "The export settings folder is unavailable.")?
        .join("book-export-settings")
        .join(format!("{key}.json")))
}

fn read_settings(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > document::MAX_SETTINGS_BYTES as u64 {
        return Err("The saved export settings are too large.".into());
    }
    let value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The saved export settings JSON is invalid.")?;
    document::normalize(value).map(Some)
}

fn cache_settings(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("The export settings folder is unavailable.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".{}.tmp", uuid::Uuid::now_v7()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn load_project_export_settings_sync(
    app: &AppHandle,
    input: ProjectExportSettingsInput,
) -> Result<ExportSettingsSnapshot, String> {
    let repo = repo_path(app, &input)?;
    let settings = match read_settings(&cache_path(app, &input)?)? {
        Some(settings) => Some(settings),
        None => read_settings(&assets::safe_repo_file(&repo, EXPORT_SETTINGS_PATH)?)?,
    };
    let settings = settings
        .map(|settings| assets::hydrate(app, &settings, |id| assets::read_working_image(&repo, id)))
        .transpose()?;
    Ok(ExportSettingsSnapshot { settings })
}

fn git_bytes(
    repo: &Path,
    reference: &str,
    path: &str,
    limit: u64,
) -> Result<Option<Vec<u8>>, String> {
    let object = format!("{reference}:{path}");
    if transport_git(
        repo,
        &["ls-tree", "--name-only", reference, "--", path],
        None,
    )?
    .is_empty()
    {
        return Ok(None);
    }
    let size: u64 = transport_git(repo, &["cat-file", "-s", &object], None)?
        .parse()
        .map_err(|_| "Could not read the saved export file size.")?;
    if size > limit {
        return Err("A saved export file is too large.".into());
    }
    let output = git_command()?
        .current_dir(repo)
        .args(["show", &object])
        .output()
        .map_err(|_| "Could not read saved export settings from Git.")?;
    if !output.status.success() {
        return Err("Could not read saved export settings from Git.".into());
    }
    Ok(Some(output.stdout))
}

fn remote_settings(repo: &Path, reference: &str) -> Result<Option<Value>, String> {
    git_bytes(
        repo,
        reference,
        EXPORT_SETTINGS_PATH,
        document::MAX_SETTINGS_BYTES as u64,
    )?
    .map(|bytes| {
        document::normalize(
            serde_json::from_slice(&bytes)
                .map_err(|_| "The saved export settings JSON is invalid.")?,
        )
    })
    .transpose()
}

// A missing file in a repository that previously saved settings is a remote
// deletion. Return an empty document so callers can distinguish it from a
// project that has never opted into shared settings.
fn remote_document(repo: &Path, reference: &str) -> Result<Option<Value>, String> {
    let settings = remote_settings(repo, reference)?;
    if settings.is_some() {
        return Ok(settings);
    }
    let history = transport_git(
        repo,
        &[
            "log",
            "-1",
            "--format=%H",
            reference,
            "--",
            EXPORT_SETTINGS_PATH,
        ],
        None,
    )?;
    Ok((!history.is_empty()).then(|| serde_json::json!({"version": 1, "layouts": {}})))
}

fn hydrate_git(
    app: &AppHandle,
    repo: &Path,
    reference: &str,
    settings: &Value,
) -> Result<Value, String> {
    assets::hydrate(app, settings, |id| {
        git_bytes(
            repo,
            reference,
            &format!("{}/{id}", document::IMAGE_ROOT),
            crate::constants::MAX_IMPORT_FILE_BYTES,
        )?
        .ok_or_else(|| "A saved export image is missing from GitHub.".into())
    })
}

fn save_files(app: &AppHandle, repo: &Path, settings: &Value) -> Result<(), String> {
    ensure_local_commit_preconditions(app, repo)?;
    let files = assets::repo_files(app, settings)?;
    write_settings_files(repo, &files, |paths| {
        git_commit_as_signed_in_user_with_metadata(
            app,
            repo,
            "Save project export settings",
            paths,
            CommitMetadata {
                operation: Some("save-project-export-settings"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )
        .map(|_| ())
    })
}

fn write_settings_files(
    repo: &Path,
    files: &[(String, Vec<u8>)],
    commit: impl FnOnce(&[&str]) -> Result<(), String>,
) -> Result<(), String> {
    let mut snapshots = Vec::new();
    for (path, _) in files {
        assets::safe_repo_file(repo, path)?;
        push_repo_file_snapshot(&mut snapshots, repo, path)?;
    }
    with_repo_file_rollback(repo, &snapshots, || {
        for (path, bytes) in files {
            let path = assets::safe_repo_file(repo, path)?;
            fs::create_dir_all(path.parent().ok_or("An export file path is invalid.")?)
                .map_err(|e| e.to_string())?;
            fs::write(path, bytes).map_err(|e| e.to_string())?;
        }
        let paths = files
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>();
        let mut args = vec!["add", "--"];
        args.extend(&paths);
        transport_git(repo, &args, None)?;
        commit(&paths)
    })
}

fn synchronize_project_export_settings(
    app: &AppHandle,
    input: &ProjectExportSettingsInput,
) -> Result<Option<Value>, String> {
    let repo = repo_path(app, input)?;
    let cache = cache_path(app, input)?;
    let base = input.base.clone().map(document::normalize).transpose()?;
    let local = input
        .settings
        .clone()
        .map(document::normalize)
        .transpose()?;
    if let Some(local) = &local {
        cache_settings(&cache, local)?;
    }
    let lock = repo_sync_lock(&repo);
    let _guard = acquire_repo_sync_lock(&lock);
    check_account(app, input)?;
    let session = load_broker_auth_session_internal(app)?
        .ok_or("Sign in with GitHub to synchronize export settings.")?;
    let token = match load_git_transport_token(input.installation_id, &session.session_token) {
        Ok(token) => token,
        Err(error) => {
            if let Some(local) = &local {
                check_account(app, input)?;
                save_files(app, &repo, local)?;
            }
            return Err(error);
        }
    };
    let auth = GitTransportAuth::from_token(&token)?;
    prepare_export_settings_origin(&input.project, &repo)?;
    let branch = input
        .project
        .default_branch_name
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    transport_git(&repo, &["check-ref-format", "--branch", branch], None)?;
    if let Err(error) = transport_git(
        &repo,
        &[
            "fetch",
            "--no-tags",
            "origin",
            &format!("+refs/heads/{branch}:refs/remotes/origin/{branch}"),
        ],
        Some(&auth),
    ) {
        if let Some(local) = &local {
            check_account(app, input)?;
            save_files(app, &repo, local)?;
        }
        return Err(error);
    }
    let reference = format!("refs/remotes/origin/{branch}");
    let remote = remote_document(&repo, &reference)?;
    if let Some(remote) = &remote {
        let _ = hydrate_git(app, &repo, &reference, remote)?;
    }
    let current = load_broker_auth_session_internal(app)?;
    if !current.is_some_and(|current| {
        current.login == session.login && current.session_token == session.session_token
    }) {
        return Err("The signed-in account changed while synchronizing export settings.".into());
    }
    let settings = if let Some(local) = local {
        // Bring the Git parent current before committing the UI draft. Settings
        // use one canonical line so any concurrent edits reach our semantic
        // resolver rather than Git silently combining fields in one language.
        let head = transport_git(&repo, &["rev-parse", &reference], None)?;
        sync_export_settings_repo(app, &input.project, &repo, &head, &token)?;
        let remote = remote_document(&repo, "HEAD")?;
        let settings = if remote.is_some() {
            document::merge(base.as_ref(), &local, remote.as_ref())
        } else {
            local
        };
        check_account(app, input)?;
        save_files(app, &repo, &settings)?;
        sync_export_settings_repo(app, &input.project, &repo, &head, &token)?;
        remote_document(&repo, "HEAD")?.or(Some(settings))
    } else {
        remote
    };
    check_account(app, input)?;
    if let Some(settings) = &settings {
        cache_settings(&cache, settings)?;
    }
    settings
        .map(|settings| {
            hydrate_git(
                app,
                &repo,
                if input.settings.is_some() {
                    "HEAD"
                } else {
                    &reference
                },
                &settings,
            )
        })
        .transpose()
}

pub(crate) fn synchronize_export_settings_event(
    app: &AppHandle,
    input: ProjectExportSettingsInput,
    preflight: Result<(), String>,
) -> SettingsEvent {
    let result = preflight.and_then(|()| synchronize_project_export_settings(app, &input));
    let (settings, error) = match result {
        Ok(settings) => (settings, String::new()),
        Err(error) => (None, error),
    };
    SettingsEvent {
        request_id: input.request_id,
        settings,
        error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_transaction_stages_new_files_and_rolls_back_failed_commits() {
        let repo =
            std::env::temp_dir().join(format!("gnosis-settings-write-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&repo).unwrap();
        transport_git(&repo, &["init", "--initial-branch", "main"], None).unwrap();
        transport_git(&repo, &["config", "user.name", "Test"], None).unwrap();
        transport_git(&repo, &["config", "user.email", "test@example.com"], None).unwrap();
        assert!(remote_document(&repo, "HEAD").is_err()); // no commits yet
        let files = vec![
            (
                EXPORT_SETTINGS_PATH.into(),
                br#"{"version":1,"layouts":{}}"#.to_vec(),
            ),
            (
                format!("{}/.gitattributes", document::IMAGE_ROOT),
                b"* -text\n".to_vec(),
            ),
        ];
        write_settings_files(&repo, &files, |paths| {
            let mut args = vec!["commit", "-m", "Settings", "--"];
            args.extend(paths);
            transport_git(&repo, &args, None).map(|_| ())
        })
        .unwrap();
        assert_eq!(
            remote_document(&repo, "HEAD").unwrap().unwrap()["version"],
            1
        );
        assert!(transport_git(&repo, &["status", "--porcelain"], None)
            .unwrap()
            .is_empty());
        let failed = vec![
            (EXPORT_SETTINGS_PATH.into(), b"changed".to_vec()),
            (".gtms/new.json".into(), b"new".to_vec()),
        ];
        assert!(write_settings_files(&repo, &failed, |_| Err(
            "Simulated permission failure".into()
        ))
        .is_err());
        assert_eq!(
            fs::read(repo.join(EXPORT_SETTINGS_PATH)).unwrap(),
            files[0].1
        );
        assert!(!repo.join(".gtms/new.json").exists());
        assert!(transport_git(&repo, &["status", "--porcelain"], None)
            .unwrap()
            .is_empty());
        transport_git(&repo, &["rm", EXPORT_SETTINGS_PATH], None).unwrap();
        transport_git(&repo, &["commit", "-m", "Delete settings"], None).unwrap();
        assert_eq!(
            remote_document(&repo, "HEAD").unwrap().unwrap(),
            serde_json::json!({"version":1,"layouts":{}})
        );
        fs::remove_dir_all(repo).unwrap();
    }
}
