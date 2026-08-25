use std::net::TcpStream;

use tauri::{Emitter, State};
use url::Url;

use crate::{
    broker::broker_base_url,
    callbacks::write_html_response,
    constants::{
        GITHUB_CALLBACK_ADDRESS, WORDPRESS_AUTH_CALLBACK_EVENT, WORDPRESS_AUTH_CALLBACK_PATH,
    },
    state::{AuthState, PendingWordPressAuth},
    util::random_token,
    window::focus_main_window,
    wordpress::storage::{save_wordpress_connection, WordPressConnection, WordPressConnectionInfo},
};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressAuthEventPayload {
    pub(crate) status: &'static str,
    pub(crate) message: String,
    pub(crate) connection: Option<WordPressConnectionInfo>,
    pub(crate) storage_login: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginWordPressAuthResponse {
    pub(crate) auth_url: String,
}

#[tauri::command]
pub(crate) fn begin_wordpress_auth(
    state: State<'_, AuthState>,
    storage_login: String,
    blog: String,
    expected_blog_id: Option<String>,
) -> Result<BeginWordPressAuthResponse, String> {
    let storage_login = storage_login.trim().to_lowercase();
    if storage_login.is_empty() {
        return Err("Sign in to Gnosis TMS before connecting WordPress.".to_string());
    }
    let csrf_state = random_token(32);
    let mut auth_url = broker_base_url()?;
    auth_url.set_path("/auth/wordpress/start");
    auth_url
        .query_pairs_mut()
        .append_pair("state", &csrf_state)
        .append_pair("desktop_redirect_uri", &wordpress_auth_callback_url())
        .append_pair("blog", blog.trim());

    let mut pending = state
        .pending_wordpress_auth
        .lock()
        .map_err(|_| "Could not prepare WordPress.com sign-in.".to_string())?;
    *pending = Some(PendingWordPressAuth {
        csrf_state,
        storage_login,
        expected_blog_id: expected_blog_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    });
    Ok(BeginWordPressAuthResponse {
        auth_url: auth_url.to_string(),
    })
}

fn wordpress_auth_callback_url() -> String {
    format!("http://{GITHUB_CALLBACK_ADDRESS}{WORDPRESS_AUTH_CALLBACK_PATH}")
}

fn emit_wordpress_auth_event(app: &tauri::AppHandle, payload: WordPressAuthEventPayload) {
    let _ = app.emit(WORDPRESS_AUTH_CALLBACK_EVENT, payload);
}

fn fail_wordpress_auth_request(
    app: &tauri::AppHandle,
    stream: TcpStream,
    event_message: &str,
    page_body: &str,
    storage_login: &str,
) {
    emit_wordpress_auth_event(
        app,
        WordPressAuthEventPayload {
            status: "error",
            message: event_message.to_string(),
            connection: None,
            storage_login: storage_login.to_string(),
        },
    );
    write_html_response(
        stream,
        "HTTP/1.1 400 Bad Request",
        "Connection failed",
        page_body,
        "Please return to Gnosis TMS",
    );
    focus_main_window(app);
}

pub(crate) fn handle_wordpress_auth_request(
    app: &tauri::AppHandle,
    auth_state: &AuthState,
    stream: TcpStream,
    url: &Url,
) {
    let query_value = |name| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    let access_token = query_value("wp_access_token");
    let blog_id = query_value("blog_id");
    let blog_url = query_value("blog_url");
    let returned_state = query_value("state");

    let pending = auth_state
        .pending_wordpress_auth
        .lock()
        .ok()
        .and_then(|mut pending| pending.take());
    let Some(pending) = pending else {
        fail_wordpress_auth_request(
            app, stream,
            "This WordPress.com sign-in request is no longer active. Please try again.",
            "This WordPress.com sign-in request is no longer active. Please return to Gnosis TMS and try again.",
            "",
        );
        return;
    };
    if returned_state.as_deref() != Some(pending.csrf_state.as_str()) {
        fail_wordpress_auth_request(
            app, stream,
            "WordPress.com sign-in was rejected because the callback state did not match.",
            "The WordPress.com callback state did not match. Please return to Gnosis TMS and try again.",
            &pending.storage_login,
        );
        return;
    }
    let (Some(access_token), Some(blog_id)) = (access_token, blog_id) else {
        fail_wordpress_auth_request(
            app, stream,
            "The broker did not return a WordPress.com access token.",
            "The broker did not return a WordPress.com access token. Please return to Gnosis TMS and try again.",
            &pending.storage_login,
        );
        return;
    };
    if pending
        .expected_blog_id
        .as_deref()
        .is_some_and(|expected| expected != blog_id.trim())
    {
        fail_wordpress_auth_request(
            app,
            stream,
            "WordPress authorized a different site. Choose the requested site and try again.",
            "WordPress authorized a different site. Please return to Gnosis TMS and try again.",
            &pending.storage_login,
        );
        return;
    }

    let connection = WordPressConnection::wordpress_com(
        access_token,
        blog_id,
        blog_url.unwrap_or_default(),
        String::new(),
    );
    if let Err(error) = save_wordpress_connection(app, &pending.storage_login, &connection) {
        fail_wordpress_auth_request(
            app, stream,
            &format!("Could not save the WordPress.com connection: {error}"),
            "Gnosis TMS could not save the WordPress.com connection. Please return to the app and try again.",
            &pending.storage_login,
        );
        return;
    }

    emit_wordpress_auth_event(
        app,
        WordPressAuthEventPayload {
            status: "success",
            message: format!("Connected to {}.", connection.site_url),
            connection: Some(connection.info()),
            storage_login: pending.storage_login,
        },
    );
    write_html_response(
        stream,
        "HTTP/1.1 200 OK",
        "WordPress.com connected",
        "You can return to Gnosis TMS now.",
        "Reopening Gnosis TMS...",
    );
    focus_main_window(app);
}
