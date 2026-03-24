use std::{
  collections::HashSet,
  env,
  fs,
  io::{Read, Write},
  net::{TcpListener, TcpStream},
  path::PathBuf,
  process::Command,
  sync::Mutex,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{window::Color, Emitter, Manager, State};
use url::Url;

const GITHUB_CALLBACK_EVENT: &str = "github-oauth-callback";
const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
const GITHUB_CALLBACK_PATH: &str = "/github/callback";
const GNOSIS_TMS_ORG_DESCRIPTION: &str = "[Gnosis TMS Translation Team]";
const MAIN_WINDOW_BACKGROUND: Color = Color(247, 236, 213, 255);

struct AuthState {
  pending: Mutex<Option<PendingOauth>>,
}

struct PendingOauth {
  csrf_state: String,
  pkce_verifier: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BeginOauthResponse {
  auth_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GithubSession {
  access_token: String,
  login: String,
  name: Option<String>,
  avatar_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthEventPayload {
  status: &'static str,
  message: String,
  session: Option<GithubSession>,
}

#[derive(Serialize)]
struct TokenExchangeRequest<'a> {
  client_id: &'a str,
  client_secret: &'a str,
  code: &'a str,
  redirect_uri: &'a str,
  code_verifier: &'a str,
}

#[derive(serde::Deserialize)]
struct TokenExchangeResponse {
  access_token: Option<String>,
  error: Option<String>,
  error_description: Option<String>,
}

#[derive(serde::Deserialize)]
struct GithubUserResponse {
  login: String,
  name: Option<String>,
  avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamSetupDraftInput {
  name: String,
  slug: String,
  contact_email: String,
  owner_login: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamSetupDraftResponse {
  draft_path: String,
  commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamSetupDraftFile {
  format: &'static str,
  format_version: u32,
  team_name: String,
  github_org_slug: String,
  contact_email: String,
  owner_login: String,
  status: &'static str,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GithubOrganization {
  login: String,
  name: Option<String>,
  description: Option<String>,
  avatar_url: Option<String>,
  html_url: Option<String>,
}

#[derive(Deserialize)]
struct GithubOrganizationMembership {
  state: String,
  organization: GithubOrganizationMembershipOrg,
}

#[derive(Deserialize)]
struct GithubOrganizationMembershipOrg {
  login: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct GithubOrgDiagnostics {
  oauth_scopes: Vec<String>,
  accepted_oauth_scopes: Vec<String>,
  user_org_logins: Vec<String>,
  membership_org_logins: Vec<String>,
}

#[tauri::command]
fn ping() -> &'static str {
  "pong"
}

#[tauri::command]
fn begin_github_oauth(state: State<'_, AuthState>) -> Result<BeginOauthResponse, String> {
  let client_id = github_client_id()?;
  let csrf_state = random_token(32);
  let pkce_verifier = random_token(96);
  let code_challenge = pkce_challenge(&pkce_verifier);
  let redirect_uri = github_redirect_uri();

  let auth_url = Url::parse_with_params(
    "https://github.com/login/oauth/authorize",
    &[
      ("client_id", client_id.as_str()),
      ("redirect_uri", redirect_uri.as_str()),
      ("scope", "read:user user:email read:org admin:org"),
      ("state", csrf_state.as_str()),
      ("code_challenge", code_challenge.as_str()),
      ("code_challenge_method", "S256"),
    ],
  )
  .map_err(|error| error.to_string())?;

  let mut pending = state
    .pending
    .lock()
    .map_err(|_| "Could not prepare GitHub sign-in.".to_string())?;
  *pending = Some(PendingOauth {
    csrf_state,
    pkce_verifier,
  });

  Ok(BeginOauthResponse {
    auth_url: auth_url.into(),
  })
}

#[tauri::command]
fn create_team_setup_draft(input: TeamSetupDraftInput) -> Result<TeamSetupDraftResponse, String> {
  let repo_root = repository_root()?;
  let draft_dir = repo_root
    .join(".gnosis-tms")
    .join("team-setups")
    .join(&input.slug);
  fs::create_dir_all(&draft_dir)
    .map_err(|error| format!("Could not create the team setup folder: {error}"))?;

  let draft_path = draft_dir.join("team-setup.json");
  let draft = TeamSetupDraftFile {
    format: "gnosis-tms-team-setup",
    format_version: 1,
    team_name: input.name,
    github_org_slug: input.slug.clone(),
    contact_email: input.contact_email,
    owner_login: input.owner_login,
    status: "draft",
  };

  let json = serde_json::to_string_pretty(&draft)
    .map_err(|error| format!("Could not serialize the team setup draft: {error}"))?;
  fs::write(&draft_path, format!("{json}\n"))
    .map_err(|error| format!("Could not write the team setup draft: {error}"))?;

  let relative_path = draft_path
    .strip_prefix(&repo_root)
    .map_err(|error| format!("Could not stage the team setup draft: {error}"))?
    .to_string_lossy()
    .to_string();

  git_in_repo(&repo_root, &["add", relative_path.as_str()])?;
  git_in_repo(
    &repo_root,
    &["commit", "-m", &format!("chore: save team setup draft for {}", input.slug)],
  )?;
  let commit_sha = git_output(&repo_root, &["rev-parse", "--short", "HEAD"])?;

  Ok(TeamSetupDraftResponse {
    draft_path: draft_path.display().to_string(),
    commit_sha,
  })
}

#[tauri::command]
fn list_user_organizations(access_token: String) -> Result<Vec<GithubOrganization>, String> {
  let client = github_client()?;
  let organizations = client
    .get("https://api.github.com/user/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organizations: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization list request: {error}"))?
    .json::<Vec<GithubOrganization>>()
    .map_err(|error| format!("Could not parse your GitHub organizations: {error}"))?;

  let memberships = client
    .get("https://api.github.com/user/memberships/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("state", "active"), ("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organization memberships: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization membership request: {error}"))?
    .json::<Vec<GithubOrganizationMembership>>()
    .map_err(|error| format!("Could not parse your GitHub organization memberships: {error}"))?;

  let mut seen = HashSet::new();
  let mut org_logins = Vec::new();

  for organization in organizations {
    if seen.insert(organization.login.clone()) {
      org_logins.push(organization.login);
    }
  }

  for membership in memberships {
    if membership.state == "active" && seen.insert(membership.organization.login.clone()) {
      org_logins.push(membership.organization.login);
    }
  }

  org_logins
    .into_iter()
    .map(|organization_login| get_organization_details(&client, &access_token, &organization_login))
    .collect()
}

#[tauri::command]
fn inspect_github_organization_access(access_token: String) -> Result<GithubOrgDiagnostics, String> {
  let client = github_client()?;
  let user_orgs_response = client
    .get("https://api.github.com/user/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not inspect your GitHub organizations: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization inspection request: {error}"))?;

  let oauth_scopes = parse_scope_header(user_orgs_response.headers().get("x-oauth-scopes"));
  let accepted_oauth_scopes =
    parse_scope_header(user_orgs_response.headers().get("x-accepted-oauth-scopes"));
  let user_org_logins = user_orgs_response
    .json::<Vec<GithubOrganization>>()
    .map_err(|error| format!("Could not parse your GitHub organizations: {error}"))?
    .into_iter()
    .map(|organization| organization.login)
    .collect();

  let membership_org_logins = client
    .get("https://api.github.com/user/memberships/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("state", "active"), ("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not inspect your GitHub organization memberships: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization membership inspection request: {error}"))?
    .json::<Vec<GithubOrganizationMembership>>()
    .map_err(|error| format!("Could not parse your GitHub organization memberships: {error}"))?
    .into_iter()
    .filter(|membership| membership.state == "active")
    .map(|membership| membership.organization.login)
    .collect();

  Ok(GithubOrgDiagnostics {
    oauth_scopes,
    accepted_oauth_scopes,
    user_org_logins,
    membership_org_logins,
  })
}

#[tauri::command]
fn mark_gnosis_tms_organization(
  access_token: String,
  org_login: String,
  description: String,
) -> Result<GithubOrganization, String> {
  let client = github_client()?;
  let normalized_description = if description.trim().is_empty() {
    GNOSIS_TMS_ORG_DESCRIPTION.to_string()
  } else {
    description
  };

  client
    .patch(format!("https://api.github.com/orgs/{org_login}"))
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .json(&serde_json::json!({
      "description": normalized_description,
    }))
    .send()
    .map_err(|error| format!("Could not update the GitHub organization description: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization update: {error}"))?;

  get_organization_details(&client, &access_token, &org_login)
}

fn github_client_id() -> Result<String, String> {
  env::var("GITHUB_CLIENT_ID")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| {
      "Missing GitHub OAuth client ID. Set GITHUB_CLIENT_ID before starting Gnosis TMS."
        .to_string()
    })
}

fn github_client_secret() -> Result<String, String> {
  env::var("GITHUB_CLIENT_SECRET")
    .ok()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| {
      "Missing GitHub OAuth client secret. Set GITHUB_CLIENT_SECRET before starting Gnosis TMS."
        .to_string()
    })
}

fn github_client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .user_agent("GnosisTMS")
    .build()
    .map_err(|error| error.to_string())
}

fn repository_root() -> Result<PathBuf, String> {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(PathBuf::from)
    .ok_or_else(|| "Could not determine the Gnosis TMS repository root.".to_string())
}

fn git_in_repo(repo_root: &PathBuf, args: &[&str]) -> Result<(), String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_root)
    .output()
    .map_err(|error| format!("Could not run git: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  Err(if stderr.is_empty() {
    "Git command failed.".to_string()
  } else {
    stderr
  })
}

fn git_output(repo_root: &PathBuf, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_root)
    .output()
    .map_err(|error| format!("Could not run git: {error}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Git command failed.".to_string()
    } else {
      stderr
    });
  }

  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn get_organization_details(
  client: &reqwest::blocking::Client,
  access_token: &str,
  org_login: &str,
) -> Result<GithubOrganization, String> {
  client
    .get(format!("https://api.github.com/orgs/{org_login}"))
    .bearer_auth(access_token)
    .header("Accept", "application/vnd.github+json")
    .send()
    .map_err(|error| format!("Could not load details for GitHub organization @{org_login}: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization lookup for @{org_login}: {error}"))?
    .json::<GithubOrganization>()
    .map_err(|error| format!("Could not parse the details for GitHub organization @{org_login}: {error}"))
}

fn parse_scope_header(header_value: Option<&reqwest::header::HeaderValue>) -> Vec<String> {
  header_value
    .and_then(|value| value.to_str().ok())
    .map(|value| {
      value
        .split(',')
        .map(|scope| scope.trim())
        .filter(|scope| !scope.is_empty())
        .map(ToString::to_string)
        .collect()
    })
    .unwrap_or_default()
}

fn github_redirect_uri() -> String {
  format!("http://{GITHUB_CALLBACK_ADDRESS}{GITHUB_CALLBACK_PATH}")
}

fn random_token(length: usize) -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(length)
    .map(char::from)
    .collect()
}

fn pkce_challenge(verifier: &str) -> String {
  let digest = Sha256::digest(verifier.as_bytes());
  URL_SAFE_NO_PAD.encode(digest)
}

fn emit_auth_event(app: &tauri::AppHandle, payload: AuthEventPayload) {
  let _ = app.emit(GITHUB_CALLBACK_EVENT, payload);
}

fn focus_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn write_html_response(mut stream: TcpStream, status_line: &str, title: &str, body: &str) {
  let html = format!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title><style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7ecd5;color:#3f2610;padding:48px;}}main{{max-width:640px;margin:0 auto;background:#fffaf4;border:1px solid rgba(164,112,41,.16);border-radius:24px;padding:32px;box-shadow:0 18px 40px rgba(131,82,22,.14);}}h1{{margin-top:0;font-size:2rem;}}p{{line-height:1.6;}}</style></head><body><main><h1>{title}</h1><p>{body}</p></main></body></html>"
  );
  let response = format!(
    "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    html.len(),
    html
  );
  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}

fn extract_request_target(stream: &mut TcpStream) -> Option<String> {
  let mut buffer = [0_u8; 8192];
  let bytes_read = stream.read(&mut buffer).ok()?;
  let request = String::from_utf8_lossy(&buffer[..bytes_read]);
  let line = request.lines().next()?;
  let mut parts = line.split_whitespace();
  let method = parts.next()?;
  let target = parts.next()?;
  if method != "GET" {
    return None;
  }
  Some(target.to_string())
}

fn handle_callback_request(
  app: &tauri::AppHandle,
  auth_state: &AuthState,
  stream: TcpStream,
  target: &str,
) {
  let url = match Url::parse(&format!("http://localhost{target}")) {
    Ok(url) => url,
    Err(_) => {
      write_html_response(
        stream,
        "HTTP/1.1 400 Bad Request",
        "Sign-in failed",
        "Gnosis TMS could not read the GitHub callback URL.",
      );
      return;
    }
  };

  if url.path() != GITHUB_CALLBACK_PATH {
    write_html_response(
      stream,
      "HTTP/1.1 404 Not Found",
      "Not found",
      "This callback URL is not used by Gnosis TMS.",
    );
    return;
  }

  let code = url
    .query_pairs()
    .find(|(key, _)| key == "code")
    .map(|(_, value)| value.into_owned());
  let returned_state = url
    .query_pairs()
    .find(|(key, _)| key == "state")
    .map(|(_, value)| value.into_owned());

  let pending = match auth_state.pending.lock() {
    Ok(mut pending) => pending.take(),
    Err(_) => None,
  };

  let Some(pending) = pending else {
    emit_auth_event(
      app,
      AuthEventPayload {
        status: "error",
        message: "This GitHub sign-in request is no longer active. Please try again.".into(),
        session: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Sign-in expired",
      "This sign-in request is no longer active. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  };

  if returned_state.as_deref() != Some(pending.csrf_state.as_str()) {
    emit_auth_event(
      app,
      AuthEventPayload {
        status: "error",
        message: "GitHub sign-in was rejected because the callback state did not match.".into(),
        session: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Sign-in failed",
      "The GitHub callback state did not match. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  }

  let Some(code) = code else {
    emit_auth_event(
      app,
      AuthEventPayload {
        status: "error",
        message: "GitHub did not return an authorization code.".into(),
        session: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Sign-in failed",
      "GitHub did not return an authorization code. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  };

  match exchange_github_code(&code, &pending.pkce_verifier) {
    Ok(session) => {
      emit_auth_event(
        app,
        AuthEventPayload {
          status: "success",
          message: format!("Signed in as @{}.", session.login),
          session: Some(session.clone()),
        },
      );
      write_html_response(
        stream,
        "HTTP/1.1 200 OK",
        "GitHub sign-in complete",
        "You can return to Gnosis TMS now. The Teams page is ready.",
      );
      focus_main_window(app);
    }
    Err(message) => {
      emit_auth_event(
        app,
        AuthEventPayload {
          status: "error",
          message: message.clone(),
          session: None,
        },
      );
      write_html_response(
        stream,
        "HTTP/1.1 500 Internal Server Error",
        "Sign-in failed",
        "GitHub sign-in could not be completed. Please return to Gnosis TMS and try again.",
      );
      focus_main_window(app);
    }
  }
}

fn exchange_github_code(code: &str, pkce_verifier: &str) -> Result<GithubSession, String> {
  let client_id = github_client_id()?;
  let client_secret = github_client_secret()?;
  let client = reqwest::blocking::Client::builder()
    .user_agent("GnosisTMS")
    .build()
    .map_err(|error| error.to_string())?;

  let token_response = client
    .post("https://github.com/login/oauth/access_token")
    .header("Accept", "application/json")
    .json(&TokenExchangeRequest {
      client_id: client_id.as_str(),
      client_secret: client_secret.as_str(),
      code,
      redirect_uri: github_redirect_uri().as_str(),
      code_verifier: pkce_verifier,
    })
    .send()
    .map_err(|error| format!("GitHub token exchange failed: {error}"))?;

  let token_payload: TokenExchangeResponse = token_response
    .json()
    .map_err(|error| format!("Could not read the GitHub token response: {error}"))?;

  let access_token = match token_payload.access_token {
    Some(token) => token,
    None => {
      return Err(
        token_payload
          .error_description
          .or(token_payload.error)
          .unwrap_or_else(|| "GitHub did not return an access token.".to_string()),
      )
    }
  };

  let user = client
    .get("https://api.github.com/user")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .send()
    .map_err(|error| format!("Could not fetch the GitHub user profile: {error}"))?
    .json::<GithubUserResponse>()
    .map_err(|error| format!("Could not read the GitHub user profile: {error}"))?;

  Ok(GithubSession {
    access_token,
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
  })
}

fn spawn_callback_server(app: tauri::AppHandle) {
  let listener = match TcpListener::bind(GITHUB_CALLBACK_ADDRESS) {
    Ok(listener) => listener,
    Err(error) => {
      emit_auth_event(
        &app,
        AuthEventPayload {
          status: "error",
          message: format!(
            "GitHub sign-in is unavailable because the callback server could not start on {GITHUB_CALLBACK_ADDRESS}: {error}"
          ),
          session: None,
        },
      );
      return;
    }
  };

  for stream in listener.incoming() {
    let Ok(mut stream) = stream else {
      continue;
    };
    let Some(target) = extract_request_target(&mut stream) else {
      write_html_response(
        stream,
        "HTTP/1.1 400 Bad Request",
        "Bad request",
        "Gnosis TMS only accepts GitHub sign-in callback requests here.",
      );
      continue;
    };
    handle_callback_request(&app, app.state::<AuthState>().inner(), stream, &target);
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(AuthState {
      pending: Mutex::new(None),
    })
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      ping,
      begin_github_oauth,
      create_team_setup_draft,
      list_user_organizations,
      mark_gnosis_tms_organization,
      inspect_github_organization_access
    ])
    .setup(|app| {
      #[cfg(target_os = "macos")]
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(MAIN_WINDOW_BACKGROUND));
      }

      let app_handle = app.handle().clone();
      std::thread::spawn(move || spawn_callback_server(app_handle));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
