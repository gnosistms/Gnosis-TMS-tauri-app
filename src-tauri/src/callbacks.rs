use std::{
  io::{Read, Write},
  net::{TcpListener, TcpStream},
};

use tauri::{Emitter, Manager};
use url::Url;

use crate::{
  auth::{emit_auth_event, exchange_github_code, AuthEventPayload},
  constants::{
    GITHUB_APP_CALLBACK_EVENT, GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS,
    GITHUB_CALLBACK_PATH,
  },
  state::AuthState,
  window::focus_main_window,
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubAppInstallEventPayload {
  pub(crate) status: &'static str,
  pub(crate) message: String,
  pub(crate) installation_id: Option<i64>,
}

pub(crate) fn spawn_callback_server(app: tauri::AppHandle) {
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

pub(crate) fn emit_github_app_install_event(
  app: &tauri::AppHandle,
  payload: GithubAppInstallEventPayload,
) {
  let _ = app.emit(GITHUB_APP_CALLBACK_EVENT, payload);
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

  if url.path() == GITHUB_APP_SETUP_PATH {
    handle_github_app_setup_request(app, auth_state, stream, &url);
    return;
  }

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

  let pending = match auth_state.pending_oauth.lock() {
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

fn handle_github_app_setup_request(
  app: &tauri::AppHandle,
  auth_state: &AuthState,
  stream: TcpStream,
  url: &Url,
) {
  let installation_id = url
    .query_pairs()
    .find(|(key, _)| key == "installation_id")
    .and_then(|(_, value)| value.parse::<i64>().ok());
  let returned_state = url
    .query_pairs()
    .find(|(key, _)| key == "state")
    .map(|(_, value)| value.into_owned());

  let pending = match auth_state.pending_github_app_install.lock() {
    Ok(mut pending) => pending.take(),
    Err(_) => None,
  };

  let Some(pending) = pending else {
    emit_github_app_install_event(
      app,
      GithubAppInstallEventPayload {
        status: "error",
        message: "This GitHub App installation request is no longer active. Please try again."
          .into(),
        installation_id: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Installation expired",
      "This GitHub App installation request is no longer active. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  };

  if returned_state.as_deref() != Some(pending.csrf_state.as_str()) {
    emit_github_app_install_event(
      app,
      GithubAppInstallEventPayload {
        status: "error",
        message: "GitHub App installation was rejected because the callback state did not match."
          .into(),
        installation_id: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Installation failed",
      "The GitHub App installation callback state did not match. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  }

  let Some(installation_id) = installation_id else {
    emit_github_app_install_event(
      app,
      GithubAppInstallEventPayload {
        status: "error",
        message: "GitHub did not return an installation ID for the GitHub App.".into(),
        installation_id: None,
      },
    );
    write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Installation failed",
      "GitHub did not return an installation ID. Please return to Gnosis TMS and try again.",
    );
    focus_main_window(app);
    return;
  };

  emit_github_app_install_event(
    app,
    GithubAppInstallEventPayload {
      status: "success",
      message: "GitHub App installation received. Return to Gnosis TMS to finish setup.".into(),
      installation_id: Some(installation_id),
    },
  );
  write_html_response(
    stream,
    "HTTP/1.1 200 OK",
    "GitHub App installation complete",
    "You can return to Gnosis TMS now. Finish setup in the app to connect this organization.",
  );
  focus_main_window(app);
}
