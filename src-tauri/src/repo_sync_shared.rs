use std::{
    env, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "macos")]
use flate2::read::GzDecoder;
use serde::Deserialize;
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use std::fs::File;
#[cfg(target_os = "macos")]
use tar::Archive;
use tauri::{AppHandle, Manager, Runtime};
#[cfg(target_os = "macos")]
use uuid::Uuid;

use crate::{
    broker::broker_get_json_with_session, broker_auth_storage::load_broker_auth_session,
    github::github_client,
};

static RESOLVED_GIT_EXECUTABLE: OnceLock<PathBuf> = OnceLock::new();
static APP_GIT_HOME_DIR: OnceLock<PathBuf> = OnceLock::new();
static APP_GIT_XDG_CONFIG_HOME: OnceLock<PathBuf> = OnceLock::new();
static APP_GIT_GLOBAL_CONFIG: OnceLock<PathBuf> = OnceLock::new();
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitTransportTokenResponse {
    token: String,
}

pub(crate) struct GitTransportAuth {
    http_extra_header: String,
}

impl GitTransportAuth {
    pub(crate) fn from_token(token: &str) -> Result<Self, String> {
        let credentials = format!("x-access-token:{token}");
        let encoded_credentials = BASE64_STANDARD.encode(credentials.as_bytes());
        Ok(Self {
            http_extra_header: format!("AUTHORIZATION: basic {encoded_credentials}"),
        })
    }
}

pub(crate) fn initialize_git_runtime<R: Runtime>(app: &AppHandle<R>) {
    let app_config_dir = app.path().app_config_dir().ok();
    if let Some(app_config_dir) = app_config_dir.as_deref() {
        if let Ok(environment) = prepare_app_git_environment(&app_config_dir) {
            let _ = APP_GIT_HOME_DIR.set(environment.home_dir);
            let _ = APP_GIT_XDG_CONFIG_HOME.set(environment.xdg_config_home);
            let _ = APP_GIT_GLOBAL_CONFIG.set(environment.global_config);
        }
    }

    #[cfg(windows)]
    {
        let resource_dir = app.path().resource_dir().ok();
        if let Some(path) = discover_windows_git_executable(resource_dir.as_deref()) {
            let _ = RESOLVED_GIT_EXECUTABLE.set(path);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let resource_dir = app.path().resource_dir().ok();
        if let Some(app_config_dir) = app_config_dir.as_deref() {
            if let Ok(Some(path)) =
                prepare_macos_git_runtime(resource_dir.as_deref(), app_config_dir)
            {
                let _ = RESOLVED_GIT_EXECUTABLE.set(path);
            }
        }
    }
}

pub(crate) fn git_command() -> Command {
    if let Some(executable) = RESOLVED_GIT_EXECUTABLE.get() {
        let mut command = Command::new(executable);
        configure_git_command(&mut command, executable);
        return command;
    }

    #[cfg(windows)]
    {
        let executable = resolved_windows_git_executable();
        let mut command = Command::new(&executable);
        configure_git_command(&mut command, &executable);
        return command;
    }

    #[cfg(not(windows))]
    {
        Command::new("git")
    }
}

pub(crate) fn format_git_spawn_error(args: &[&str], error: &std::io::Error) -> String {
    if error.kind() == ErrorKind::NotFound {
        #[cfg(windows)]
        {
            return format!(
                "Could not run git {}: Git runtime not found. Reinstall Gnosis TMS or install Git for Windows.",
                args.join(" ")
            );
        }

        #[cfg(target_os = "macos")]
        {
            return format!(
                "Could not run git {}: Git runtime not found. Reinstall Gnosis TMS or install Git.",
                args.join(" ")
            );
        }

        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            return format!(
                "Could not run git {}: Git is not installed or not on PATH.",
                args.join(" ")
            );
        }
    }

    format!("Could not run git {}: {error}", args.join(" "))
}

pub(crate) fn git_output(
    repo_path: &Path,
    args: &[&str],
    auth: Option<&GitTransportAuth>,
) -> Result<String, String> {
    let mut command = git_command();
    if let Some(auth) = auth {
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env("GIT_CONFIG_VALUE_0", &auth.http_extra_header);
    }

    let output = command
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|error| format_git_spawn_error(args, &error))?;

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

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub(crate) fn read_current_head_oid(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn load_git_transport_token(
    installation_id: i64,
    session_token: &str,
) -> Result<String, String> {
    let client = github_client()?;
    let response: GitTransportTokenResponse = broker_get_json_with_session(
        &client,
        &format!("/api/github-app/installations/{installation_id}/git-transport-token"),
        session_token,
    )?;
    Ok(response.token)
}

pub(crate) fn ensure_repo_local_git_identity(
    app: &AppHandle,
    repo_path: &Path,
) -> Result<(), String> {
    let identity = signed_in_git_identity(app)?;
    set_local_git_config_if_needed(repo_path, "user.name", &identity.name)?;
    set_local_git_config_if_needed(repo_path, "user.email", &identity.email)?;
    set_local_git_config_if_needed(repo_path, "user.useConfigOnly", "true")?;
    Ok(())
}

pub(crate) fn abort_rebase_after_failed_pull(repo_path: &Path, pull_error: String) -> String {
    if !repo_has_rebase_in_progress(repo_path) {
        return pull_error;
    }

    match git_output(repo_path, &["rebase", "--abort"], None) {
        Ok(_) => format!("{pull_error} The interrupted rebase was aborted automatically."),
        Err(abort_error) => {
            format!("{pull_error} An automatic 'git rebase --abort' also failed: {abort_error}")
        }
    }
}

pub(crate) fn git_error_indicates_missing_remote_ref(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized.contains("couldn't find remote ref")
        || normalized.contains("could not find remote ref")
        || normalized.contains("remote branch")
            && normalized.contains("not found")
        || normalized.contains("no such remote ref")
}

struct SignedInGitIdentity {
    name: String,
    email: String,
}

fn signed_in_git_identity(app: &AppHandle) -> Result<SignedInGitIdentity, String> {
    let session = load_broker_auth_session(app.clone())?
        .ok_or_else(|| "Sign in with GitHub before syncing local repos.".to_string())?;
    let login = session.login.trim().to_lowercase();
    if login.is_empty() {
        return Err("The saved GitHub session is missing a login.".to_string());
    }

    Ok(SignedInGitIdentity {
        name: login.clone(),
        email: format!("{login}@users.noreply.github.com"),
    })
}

fn set_local_git_config_if_needed(repo_path: &Path, key: &str, value: &str) -> Result<(), String> {
    let current_value = git_output(repo_path, &["config", "--local", "--get", key], None)
        .ok()
        .map(|text| text.trim().to_string())
        .unwrap_or_default();
    if current_value == value {
        return Ok(());
    }

    git_output(repo_path, &["config", "--local", key, value], None)?;
    Ok(())
}

fn repo_has_rebase_in_progress(repo_path: &Path) -> bool {
    let rebase_apply = git_output(
        repo_path,
        &["rev-parse", "--git-path", "rebase-apply"],
        None,
    );
    let rebase_merge = git_output(
        repo_path,
        &["rev-parse", "--git-path", "rebase-merge"],
        None,
    );

    rebase_apply
        .ok()
        .map(|path| resolve_git_path(repo_path, &path).exists())
        .unwrap_or(false)
        || rebase_merge
            .ok()
            .map(|path| resolve_git_path(repo_path, &path).exists())
            .unwrap_or(false)
}

fn resolve_git_path(repo_path: &Path, git_path: &str) -> PathBuf {
    let path = PathBuf::from(git_path);
    if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    }
}

#[cfg(windows)]
fn resolved_windows_git_executable() -> PathBuf {
    if let Some(path) = RESOLVED_GIT_EXECUTABLE.get() {
        return path.clone();
    }

    if let Some(path) = discover_windows_git_executable(None) {
        let _ = RESOLVED_GIT_EXECUTABLE.set(path.clone());
        return path;
    }

    PathBuf::from("git")
}

fn configure_git_command(command: &mut Command, executable: &Path) {
    configure_git_isolation(command);

    #[cfg(windows)]
    configure_windows_git_command(command, executable);

    #[cfg(target_os = "macos")]
    configure_macos_git_command(command, executable);
}

fn configure_git_isolation(command: &mut Command) {
    if let Some(home_dir) = APP_GIT_HOME_DIR.get() {
        command.env("HOME", home_dir);
    }
    if let Some(xdg_config_home) = APP_GIT_XDG_CONFIG_HOME.get() {
        command.env("XDG_CONFIG_HOME", xdg_config_home);
    }
    if let Some(global_config) = APP_GIT_GLOBAL_CONFIG.get() {
        command.env("GIT_CONFIG_GLOBAL", global_config);
    }

    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env_remove("SSH_ASKPASS")
        .env_remove("GIT_ASKPASS");
}

#[cfg(windows)]
fn configure_windows_git_command(command: &mut Command, executable: &Path) {
    command.creation_flags(CREATE_NO_WINDOW);

    let Some(root) = git_root_from_executable(executable) else {
        return;
    };

    let mut search_paths = Vec::new();
    for candidate in [
        root.join("cmd"),
        root.join("bin"),
        root.join("mingw64").join("bin"),
        root.join("usr").join("bin"),
    ] {
        if candidate.exists() {
            search_paths.push(candidate);
        }
    }

    if search_paths.is_empty() {
        return;
    }

    if let Some(existing_path) = env::var_os("PATH") {
        search_paths.extend(env::split_paths(&existing_path));
    }

    if let Ok(joined_path) = env::join_paths(search_paths) {
        command.env("PATH", joined_path);
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_git_command(command: &mut Command, executable: &Path) {
    let Some(exec_path) = executable.parent() else {
        return;
    };
    let Some(libexec_dir) = exec_path.parent() else {
        return;
    };
    let Some(root) = libexec_dir.parent() else {
        return;
    };
    if exec_path.file_name().and_then(|value| value.to_str()) != Some("git-core")
        || libexec_dir.file_name().and_then(|value| value.to_str()) != Some("libexec")
    {
        return;
    }

    command.env("GIT_EXEC_PATH", exec_path);
    let template_dir = root.join("share").join("git-core").join("templates");
    if template_dir.exists() {
        command.env("GIT_TEMPLATE_DIR", template_dir);
    }

    let mut search_paths = Vec::new();
    let git_bin_dir = root.join("bin");
    if git_bin_dir.exists() {
        search_paths.push(git_bin_dir);
    }
    search_paths.push(exec_path.to_path_buf());
    if let Some(existing_path) = env::var_os("PATH") {
        search_paths.extend(env::split_paths(&existing_path));
    }
    if let Ok(joined_path) = env::join_paths(search_paths) {
        command.env("PATH", joined_path);
    }
}

#[cfg(windows)]
fn git_root_from_executable(executable: &Path) -> Option<PathBuf> {
    let parent = executable.parent()?;
    let parent_name = parent.file_name()?.to_string_lossy().to_ascii_lowercase();
    if parent_name == "cmd" || parent_name == "bin" {
        return parent.parent().map(PathBuf::from);
    }
    None
}

#[cfg(windows)]
fn discover_windows_git_executable(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(value) = env::var_os("GTMS_GIT_EXECUTABLE") {
        candidates.push(PathBuf::from(value));
    }

    if let Some(resource_dir) = resource_dir {
        candidates.extend(windows_git_paths_for_root(
            &resource_dir.join("git").join("windows"),
        ));
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        candidates.extend(windows_git_paths_for_root(
            &local_app_data.join("Programs").join("Git"),
        ));
        if let Some(github_desktop_git) =
            discover_windows_github_desktop_git(&local_app_data.join("GitHubDesktop"))
        {
            candidates.push(github_desktop_git);
        }
    }

    if let Some(program_files) = env::var_os("ProgramFiles").map(PathBuf::from) {
        candidates.extend(windows_git_paths_for_root(&program_files.join("Git")));
    }

    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)").map(PathBuf::from) {
        candidates.extend(windows_git_paths_for_root(&program_files_x86.join("Git")));
    }

    if let Some(user_profile) = env::var_os("USERPROFILE").map(PathBuf::from) {
        candidates.extend(windows_git_paths_for_root(
            &user_profile
                .join("scoop")
                .join("apps")
                .join("git")
                .join("current"),
        ));
    }

    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(windows)]
fn windows_git_paths_for_root(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join("cmd").join("git.exe"),
        root.join("bin").join("git.exe"),
    ]
}

#[cfg(windows)]
fn discover_windows_github_desktop_git(base_dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(base_dir).ok()?;
    let mut candidates = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.starts_with("app-"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.reverse();

    candidates.into_iter().find_map(|path| {
        let git_path = path
            .join("resources")
            .join("app")
            .join("git")
            .join("cmd")
            .join("git.exe");
        git_path.is_file().then_some(git_path)
    })
}

#[cfg(target_os = "macos")]
fn prepare_macos_git_runtime(
    resource_dir: Option<&Path>,
    app_config_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(resource_dir) = resource_dir else {
        return Ok(None);
    };
    let archive_path = resource_dir
        .join("git")
        .join("macos")
        .join("git-runtime.tar.gz");
    if !archive_path.is_file() {
        return Ok(None);
    }

    let archive_bytes = fs::read(&archive_path).map_err(|error| {
        format!(
            "Could not read the bundled macOS Git runtime archive '{}': {error}",
            archive_path.display()
        )
    })?;
    let archive_hash = format!("{:x}", Sha256::digest(&archive_bytes));
    let runtime_root = app_config_dir.join("git").join("macos-runtime");
    let extracted_root = runtime_root.join(&archive_hash);
    let executable = extracted_root.join("libexec").join("git-core").join("git");
    if executable.is_file() {
        prune_stale_macos_git_runtimes(&runtime_root, &extracted_root);
        return Ok(Some(executable));
    }

    fs::create_dir_all(&runtime_root).map_err(|error| {
        format!(
            "Could not create the macOS Git runtime directory '{}': {error}",
            runtime_root.display()
        )
    })?;

    let staging_root = runtime_root.join(format!(".extract-{}", Uuid::now_v7()));
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root).map_err(|error| {
            format!(
                "Could not clear the temporary macOS Git runtime directory '{}': {error}",
                staging_root.display()
            )
        })?;
    }
    fs::create_dir_all(&staging_root).map_err(|error| {
        format!(
            "Could not create the temporary macOS Git runtime directory '{}': {error}",
            staging_root.display()
        )
    })?;

    let unpack_result = extract_macos_git_runtime_archive(&archive_path, &staging_root);
    if let Err(error) = unpack_result {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }

    let staged_executable = staging_root.join("libexec").join("git-core").join("git");
    if !staged_executable.is_file() {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!(
            "The bundled macOS Git runtime archive '{}' did not contain 'libexec/git-core/git'.",
            archive_path.display()
        ));
    }

    let mut permissions = fs::metadata(&staged_executable)
        .map_err(|error| {
            format!(
                "Could not inspect the extracted macOS Git executable '{}': {error}",
                staged_executable.display()
            )
        })?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&staged_executable, permissions).map_err(|error| {
        format!(
            "Could not mark the extracted macOS Git executable '{}' executable: {error}",
            staged_executable.display()
        )
    })?;

    if extracted_root.exists() {
        fs::remove_dir_all(&extracted_root).map_err(|error| {
            format!(
                "Could not replace the existing macOS Git runtime '{}': {error}",
                extracted_root.display()
            )
        })?;
    }

    match fs::rename(&staging_root, &extracted_root) {
        Ok(()) => {}
        Err(_error) if executable.is_file() => {
            let _ = fs::remove_dir_all(&staging_root);
            return Ok(Some(executable));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(format!(
                "Could not finalize the macOS Git runtime '{}': {error}",
                extracted_root.display()
            ));
        }
    }

    prune_stale_macos_git_runtimes(&runtime_root, &extracted_root);
    Ok(Some(executable))
}

#[cfg(target_os = "macos")]
fn extract_macos_git_runtime_archive(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let archive_file = File::open(archive_path).map_err(|error| {
        format!(
            "Could not open the bundled macOS Git runtime archive '{}': {error}",
            archive_path.display()
        )
    })?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = Archive::new(decoder);
    archive.unpack(target_dir).map_err(|error| {
        format!(
            "Could not extract the bundled macOS Git runtime archive '{}' into '{}': {error}",
            archive_path.display(),
            target_dir.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn prune_stale_macos_git_runtimes(runtime_root: &Path, active_root: &Path) {
    let Ok(entries) = fs::read_dir(runtime_root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path == active_root {
            continue;
        }
        let _ = if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
    }
}

struct AppGitEnvironment {
    home_dir: PathBuf,
    xdg_config_home: PathBuf,
    global_config: PathBuf,
}

fn prepare_app_git_environment(app_config_dir: &Path) -> Result<AppGitEnvironment, String> {
    let git_root = app_config_dir.join("git");
    let home_dir = git_root.join("home");
    let xdg_config_home = git_root.join("xdg");
    let global_config = git_root.join("config");

    fs::create_dir_all(&home_dir).map_err(|error| {
        format!(
            "Could not create the app Git home directory '{}': {error}",
            home_dir.display()
        )
    })?;
    fs::create_dir_all(&xdg_config_home).map_err(|error| {
        format!(
            "Could not create the app Git XDG config directory '{}': {error}",
            xdg_config_home.display()
        )
    })?;

    if !global_config.exists() {
        fs::write(
            &global_config,
            "[init]\n\tdefaultBranch = main\n[credential]\n\thelper =\n",
        )
        .map_err(|error| {
            format!(
                "Could not create the app Git config '{}': {error}",
                global_config.display()
            )
        })?;
    }

    Ok(AppGitEnvironment {
        home_dir,
        xdg_config_home,
        global_config,
    })
}

#[cfg(test)]
mod tests {
    use super::{git_error_indicates_missing_remote_ref, GitTransportAuth};

    #[test]
    fn git_transport_auth_uses_basic_auth_header_with_app_token_identity() {
        let auth = GitTransportAuth::from_token("token-123").expect("build auth header");
        assert_eq!(
            auth.http_extra_header,
            "AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46dG9rZW4tMTIz"
        );
    }

    #[test]
    fn missing_remote_ref_detection_matches_fetch_and_clone_errors() {
        assert!(git_error_indicates_missing_remote_ref(
            "git fetch origin main failed: fatal: couldn't find remote ref main"
        ));
        assert!(git_error_indicates_missing_remote_ref(
            "git fetch origin trunk failed: fatal: Remote branch trunk not found in upstream origin"
        ));
        assert!(!git_error_indicates_missing_remote_ref(
            "git fetch origin main failed: fatal: Authentication failed"
        ));
    }
}
