use std::{
  env,
  io::{Read, Write},
  net::{TcpListener, TcpStream},
  sync::Mutex,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager, State};
use url::Url;

const GITHUB_CALLBACK_EVENT: &str = "github-oauth-callback";
const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
const GITHUB_CALLBACK_PATH: &str = "/github/callback";

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
      ("scope", "read:user user:email"),
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
    .invoke_handler(tauri::generate_handler![ping, begin_github_oauth])
    .setup(|app| {
      let app_handle = app.handle().clone();
      std::thread::spawn(move || spawn_callback_server(app_handle));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
