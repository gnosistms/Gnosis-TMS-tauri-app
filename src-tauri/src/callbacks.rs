use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
};

use tauri::{Emitter, Manager};
use url::Url;

use crate::{
    broker_auth::BrokerSession,
    constants::{
        BROKER_AUTH_CALLBACK_EVENT, BROKER_AUTH_CALLBACK_PATH, GITHUB_APP_CALLBACK_EVENT,
        GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS,
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerAuthEventPayload {
    pub(crate) status: &'static str,
    pub(crate) message: String,
    pub(crate) session: Option<BrokerSession>,
}

pub(crate) fn spawn_callback_server(app: tauri::AppHandle) {
    let listener = match TcpListener::bind(GITHUB_CALLBACK_ADDRESS) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "Gnosis TMS callback server could not start on {GITHUB_CALLBACK_ADDRESS}: {error}"
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
                "Request could not be completed",
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

pub(crate) fn emit_broker_auth_event(app: &tauri::AppHandle, payload: BrokerAuthEventPayload) {
    let _ = app.emit(BROKER_AUTH_CALLBACK_EVENT, payload);
}

fn write_html_response(
    mut stream: TcpStream,
    status_line: &str,
    title: &str,
    body: &str,
    status_text: &str,
) {
    let html = format!(
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{title}</title><style>:root{{color-scheme:light;--bg:#f7ecd5;--panel:#fffaf4;--text:#3f2610;--muted:#9c6a33;--accent:#ec9827;}}*{{box-sizing:border-box;}}body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top, rgba(236, 152, 39, 0.24), transparent 42%),linear-gradient(180deg, #f3d389 0%, var(--bg) 100%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}}main{{width:min(100%,760px);background:rgba(255,250,244,.96);border:1px solid rgba(164,112,41,.14);border-radius:28px;padding:40px;box-shadow:0 24px 60px rgba(131,82,22,.14);}}.eyebrow{{margin:0 0 12px;color:var(--muted);font-size:.95rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;}}h1{{margin:0;font-size:clamp(2.25rem,5vw,4rem);line-height:.95;}}p{{margin:20px 0 0;font-size:1.15rem;line-height:1.65;}}.status{{display:inline-flex;align-items:center;gap:12px;margin-top:28px;padding:14px 18px;border-radius:999px;background:rgba(236,152,39,.12);color:var(--muted);font-weight:700;}}.dot{{width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 rgba(236,152,39,.45);animation:pulse 1.4s infinite;}}@keyframes pulse{{0%{{box-shadow:0 0 0 0 rgba(236,152,39,.45);}}70%{{box-shadow:0 0 0 14px rgba(236,152,39,0);}}100%{{box-shadow:0 0 0 0 rgba(236,152,39,0);}}}}</style></head><body><main><p class=\"eyebrow\">Gnosis TMS</p><h1>{title}</h1><p>{body}</p><div class=\"status\"><span class=\"dot\"></span>{status_text}</div></main></body></html>"
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
                "Request could not be completed",
            );
            return;
        }
    };

    if url.path() == GITHUB_APP_SETUP_PATH {
        handle_github_app_setup_request(app, auth_state, stream, &url);
        return;
    }

    if url.path() == BROKER_AUTH_CALLBACK_PATH {
        handle_broker_auth_request(app, auth_state, stream, &url);
        return;
    }

    write_html_response(
        stream,
        "HTTP/1.1 404 Not Found",
        "Not found",
        "This callback URL is not used by Gnosis TMS.",
        "Request could not be completed",
    );
}

fn handle_broker_auth_request(
    app: &tauri::AppHandle,
    auth_state: &AuthState,
    stream: TcpStream,
    url: &Url,
) {
    let session_token = url
        .query_pairs()
        .find(|(key, _)| key == "broker_session_token")
        .map(|(_, value)| value.into_owned());
    let returned_state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned());
    let login = url
        .query_pairs()
        .find(|(key, _)| key == "login")
        .map(|(_, value)| value.into_owned());
    let name = url
        .query_pairs()
        .find(|(key, _)| key == "name")
        .map(|(_, value)| value.into_owned());
    let avatar_url = url
        .query_pairs()
        .find(|(key, _)| key == "avatar_url")
        .map(|(_, value)| value.into_owned());

    let pending = match auth_state.pending_broker_auth.lock() {
        Ok(mut pending) => pending.take(),
        Err(_) => None,
    };

    let Some(pending) = pending else {
        emit_broker_auth_event(
            app,
            BrokerAuthEventPayload {
                status: "error",
                message: "This broker sign-in request is no longer active. Please try again."
                    .into(),
                session: None,
            },
        );
        write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Sign-in expired",
      "This broker sign-in request is no longer active. Please return to Gnosis TMS and try again.",
      "Please return to Gnosis TMS",
    );
        focus_main_window(app);
        return;
    };

    if returned_state.as_deref() != Some(pending.csrf_state.as_str()) {
        emit_broker_auth_event(
            app,
            BrokerAuthEventPayload {
                status: "error",
                message: "Broker sign-in was rejected because the callback state did not match."
                    .into(),
                session: None,
            },
        );
        write_html_response(
            stream,
            "HTTP/1.1 400 Bad Request",
            "Sign-in failed",
            "The broker callback state did not match. Please return to Gnosis TMS and try again.",
            "Please return to Gnosis TMS",
        );
        focus_main_window(app);
        return;
    }

    let Some(session_token) = session_token else {
        emit_broker_auth_event(
            app,
            BrokerAuthEventPayload {
                status: "error",
                message: "The broker did not return a session token.".into(),
                session: None,
            },
        );
        write_html_response(
            stream,
            "HTTP/1.1 400 Bad Request",
            "Sign-in failed",
            "The broker did not return a session token. Please return to Gnosis TMS and try again.",
            "Please return to Gnosis TMS",
        );
        focus_main_window(app);
        return;
    };

    let Some(login) = login else {
        emit_broker_auth_event(
            app,
            BrokerAuthEventPayload {
                status: "error",
                message: "The broker did not return a GitHub login.".into(),
                session: None,
            },
        );
        write_html_response(
            stream,
            "HTTP/1.1 400 Bad Request",
            "Sign-in failed",
            "The broker did not return a GitHub login. Please return to Gnosis TMS and try again.",
            "Please return to Gnosis TMS",
        );
        focus_main_window(app);
        return;
    };

    let session = BrokerSession {
        session_token,
        login: login.clone(),
        name,
        avatar_url,
    };

    emit_broker_auth_event(
        app,
        BrokerAuthEventPayload {
            status: "success",
            message: format!("Signed in to the broker as @{}.", login),
            session: Some(session),
        },
    );
    write_html_response(
        stream,
        "HTTP/1.1 200 OK",
        "Sign-in complete",
        "You can return to Gnosis TMS now.",
        "Reopening Gnosis TMS...",
    );
    focus_main_window(app);
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
                message:
                    "This GitHub App installation request is no longer active. Please try again."
                        .into(),
                installation_id: None,
            },
        );
        write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Installation expired",
      "This GitHub App installation request is no longer active. Please return to Gnosis TMS and try again.",
      "Please return to Gnosis TMS",
    );
        focus_main_window(app);
        return;
    };

    if returned_state.as_deref() != Some(pending.csrf_state.as_str()) {
        emit_github_app_install_event(
            app,
            GithubAppInstallEventPayload {
                status: "error",
                message:
                    "GitHub App installation was rejected because the callback state did not match."
                        .into(),
                installation_id: None,
            },
        );
        write_html_response(
      stream,
      "HTTP/1.1 400 Bad Request",
      "Installation failed",
      "The GitHub App installation callback state did not match. Please return to Gnosis TMS and try again.",
      "Please return to Gnosis TMS",
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
            "Please return to Gnosis TMS",
        );
        focus_main_window(app);
        return;
    };

    emit_github_app_install_event(
        app,
        GithubAppInstallEventPayload {
            status: "success",
            message: "GitHub App installation received. Return to Gnosis TMS to finish setup."
                .into(),
            installation_id: Some(installation_id),
        },
    );
    write_html_response(
        stream,
        "HTTP/1.1 200 OK",
        "GitHub App installation complete",
        "You can return to Gnosis TMS now. Finish setup in the app to connect this organization.",
        "Reopening Gnosis TMS...",
    );
    focus_main_window(app);
}
