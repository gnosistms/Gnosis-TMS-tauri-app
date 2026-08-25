use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::StatusCode;
use url::Url;

use crate::wordpress::debug::wordpress_debug_log;
use crate::wordpress::storage::{WordPressConnection, WordPressConnectionAuth};

pub(crate) const WORDPRESS_RECONNECT_MESSAGE: &str =
    "Your WordPress connection is no longer valid. Log in again to continue.";

/// Authentication mode for a WordPress site. Self-hosted sites (Application
/// Passwords / Basic auth) are a planned second variant; the wp/v2 request
/// shapes are identical, only the base URL and this header differ.
pub(crate) enum WordPressSiteAuth {
    Bearer(String),
    Basic { username: String, password: String },
}

/// A wp/v2 API target: base URL plus auth mode. Every WordPress HTTP request
/// in the app goes through this descriptor.
pub(crate) struct WordPressSite {
    api_base: Url,
    auth: WordPressSiteAuth,
    rest_route_mode: bool,
}

impl WordPressSite {
    pub(crate) fn from_connection(connection: &WordPressConnection) -> Result<Self, String> {
        let (api_base, auth, rest_route_mode) = match &connection.auth {
            WordPressConnectionAuth::WordPressCom {
                access_token,
                blog_id,
            } => (
                Url::parse(&format!(
                    "https://public-api.wordpress.com/wp/v2/sites/{}/",
                    blog_id.trim()
                )),
                WordPressSiteAuth::Bearer(access_token.clone()),
                false,
            ),
            WordPressConnectionAuth::SelfHosted {
                api_root,
                username,
                password,
            } => (
                Url::parse(&format!("{}/wp/v2/", api_root.trim().trim_end_matches('/'))),
                WordPressSiteAuth::Basic {
                    username: username.clone(),
                    password: password.clone(),
                },
                api_root.contains("rest_route="),
            ),
        };
        Ok(Self {
            api_base: api_base
                .map_err(|error| format!("Could not build the WordPress API URL: {error}"))?,
            auth,
            rest_route_mode,
        })
    }

    fn endpoint(&self, path_and_query: &str) -> Result<Url, String> {
        if self.rest_route_mode {
            let mut endpoint = self.api_base.clone();
            let (path, query) = path_and_query
                .split_once('?')
                .map_or((path_and_query, ""), |parts| parts);
            endpoint.set_query(None);
            endpoint
                .query_pairs_mut()
                .append_pair(
                    "rest_route",
                    &format!("/wp/v2/{}", path.trim_start_matches('/')),
                )
                .extend_pairs(url::form_urlencoded::parse(query.as_bytes()));
            return Ok(endpoint);
        }
        self.api_base
            .join(path_and_query.trim_start_matches('/'))
            .map_err(|error| format!("Could not build the WordPress API URL: {error}"))
    }

    fn authorize(&self, builder: RequestBuilder) -> RequestBuilder {
        match &self.auth {
            WordPressSiteAuth::Bearer(token) => builder.bearer_auth(token),
            WordPressSiteAuth::Basic { username, password } => {
                builder.basic_auth(username, Some(password))
            }
        }
    }

    pub(crate) fn get_json(
        &self,
        client: &Client,
        path_and_query: &str,
    ) -> Result<serde_json::Value, String> {
        let endpoint = self.endpoint(path_and_query)?;
        wordpress_debug_log(&format!("GET {endpoint}"));
        let response = self
            .authorize(client.get(endpoint))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| {
                wordpress_debug_log(&format!("GET send failed: {error}"));
                format!("Could not reach WordPress: {error}")
            })?;
        parse_wordpress_json_response(response, matches!(&self.auth, WordPressSiteAuth::Bearer(_)))
    }

    pub(crate) fn post_json(
        &self,
        client: &Client,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let endpoint = self.endpoint(path)?;
        wordpress_debug_log(&format!("POST {endpoint}"));
        let response = self
            .authorize(client.post(endpoint).json(body))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| {
                wordpress_debug_log(&format!("POST send failed: {error}"));
                format!("Could not reach WordPress: {error}")
            })?;
        parse_wordpress_json_response(response, matches!(&self.auth, WordPressSiteAuth::Bearer(_)))
    }

    /// Uploads a media file with the raw-body protocol the wp/v2 media
    /// endpoint supports (`Content-Disposition: attachment`), which avoids a
    /// multipart dependency.
    pub(crate) fn upload_media(
        &self,
        client: &Client,
        file_name: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<serde_json::Value, String> {
        let sanitized_name: String = file_name
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                    character
                } else {
                    '-'
                }
            })
            .collect();
        let endpoint = self.endpoint("media")?;
        wordpress_debug_log(&format!(
            "POST {endpoint} (media upload, {} bytes, {mime_type})",
            bytes.len()
        ));
        let response = self
            .authorize(client.post(endpoint).body(bytes))
            .header("Accept", "application/json")
            .header("Content-Type", mime_type)
            .header(
                "Content-Disposition",
                format!("attachment; filename=\"{sanitized_name}\""),
            )
            .send()
            .map_err(|error| {
                wordpress_debug_log(&format!("media upload send failed: {error}"));
                format!("Could not reach WordPress: {error}")
            })?;
        parse_wordpress_json_response(response, matches!(&self.auth, WordPressSiteAuth::Bearer(_)))
    }
}

fn parse_wordpress_json_response(
    response: Response,
    reauth_on_forbidden: bool,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the WordPress response: {error}"))?;
    wordpress_debug_log(&format!(
        "response status={status} body[..300]={}",
        body.chars().take(300).collect::<String>()
    ));

    if status == StatusCode::UNAUTHORIZED
        || (status == StatusCode::FORBIDDEN && reauth_on_forbidden)
    {
        return Err(format!(
            "WORDPRESS_REAUTH_REQUIRED: {WORDPRESS_RECONNECT_MESSAGE}"
        ));
    }
    if !status.is_success() {
        return Err(wordpress_error_string(status, &body));
    }

    serde_json::from_str(&body)
        .map_err(|error| format!("Could not parse the WordPress response: {error}"))
}

fn wordpress_error_string(status: StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|item| item.as_str())
                .map(str::to_string)
        });
    match detail {
        Some(message) if !message.trim().is_empty() => {
            format!("WordPress rejected the request: {message}")
        }
        _ => {
            let truncated = body.chars().take(200).collect::<String>();
            format!("WordPress request failed with status {status}: {truncated}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_site() -> WordPressSite {
        WordPressSite::from_connection(&WordPressConnection::wordpress_com(
            "token".to_string(),
            "12345".to_string(),
            "https://example.wordpress.com".to_string(),
            String::new(),
        ))
        .unwrap()
    }

    #[test]
    fn wordpress_com_site_targets_the_wp_v2_proxy() {
        let site = test_site();
        assert_eq!(
            site.endpoint("posts?search=hello").unwrap().to_string(),
            "https://public-api.wordpress.com/wp/v2/sites/12345/posts?search=hello"
        );
        assert_eq!(
            site.endpoint("media").unwrap().to_string(),
            "https://public-api.wordpress.com/wp/v2/sites/12345/media"
        );
    }

    #[test]
    fn self_hosted_site_supports_pretty_and_query_rest_roots() {
        let pretty = WordPressConnection::self_hosted(
            "https://example.com".into(),
            String::new(),
            "https://example.com/wp-json".into(),
            "user".into(),
            "pass".into(),
        );
        let pretty_site = WordPressSite::from_connection(&pretty).unwrap();
        assert_eq!(
            pretty_site.endpoint("posts?search=hello").unwrap().as_str(),
            "https://example.com/wp-json/wp/v2/posts?search=hello"
        );

        let query = WordPressConnection::self_hosted(
            "https://example.com".into(),
            String::new(),
            "https://example.com/?rest_route=/".into(),
            "user".into(),
            "pass".into(),
        );
        let query_site = WordPressSite::from_connection(&query).unwrap();
        let endpoint = query_site.endpoint("posts?search=hello").unwrap();
        assert_eq!(
            endpoint
                .query_pairs()
                .find(|(key, _)| key == "rest_route")
                .unwrap()
                .1,
            "/wp/v2/posts"
        );
        assert_eq!(
            endpoint
                .query_pairs()
                .find(|(key, _)| key == "search")
                .unwrap()
                .1,
            "hello"
        );
    }
}
