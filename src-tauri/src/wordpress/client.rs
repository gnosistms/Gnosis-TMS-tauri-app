use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::StatusCode;
use url::Url;

use crate::wordpress::storage::WordPressConnection;

pub(crate) const WORDPRESS_RECONNECT_MESSAGE: &str =
    "Your WordPress.com connection is no longer valid. Disconnect and connect again.";

/// Authentication mode for a WordPress site. Self-hosted sites (Application
/// Passwords / Basic auth) are a planned second variant; the wp/v2 request
/// shapes are identical, only the base URL and this header differ.
pub(crate) enum WordPressSiteAuth {
    Bearer(String),
}

/// A wp/v2 API target: base URL plus auth mode. Every WordPress HTTP request
/// in the app goes through this descriptor.
pub(crate) struct WordPressSite {
    api_base: Url,
    auth: WordPressSiteAuth,
}

impl WordPressSite {
    pub(crate) fn wordpress_com(connection: &WordPressConnection) -> Result<Self, String> {
        let api_base = Url::parse(&format!(
            "https://public-api.wordpress.com/wp/v2/sites/{}/",
            connection.blog_id.trim()
        ))
        .map_err(|error| format!("Could not build the WordPress API URL: {error}"))?;
        Ok(Self {
            api_base,
            auth: WordPressSiteAuth::Bearer(connection.access_token.clone()),
        })
    }

    fn endpoint(&self, path_and_query: &str) -> Result<Url, String> {
        self.api_base
            .join(path_and_query.trim_start_matches('/'))
            .map_err(|error| format!("Could not build the WordPress API URL: {error}"))
    }

    fn authorize(&self, builder: RequestBuilder) -> RequestBuilder {
        match &self.auth {
            WordPressSiteAuth::Bearer(token) => builder.bearer_auth(token),
        }
    }

    pub(crate) fn get_json(
        &self,
        client: &Client,
        path_and_query: &str,
    ) -> Result<serde_json::Value, String> {
        let response = self
            .authorize(client.get(self.endpoint(path_and_query)?))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Could not reach WordPress: {error}"))?;
        parse_wordpress_json_response(response)
    }

    pub(crate) fn post_json(
        &self,
        client: &Client,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let response = self
            .authorize(client.post(self.endpoint(path)?).json(body))
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Could not reach WordPress: {error}"))?;
        parse_wordpress_json_response(response)
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
        let response = self
            .authorize(client.post(self.endpoint("media")?).body(bytes))
            .header("Accept", "application/json")
            .header("Content-Type", mime_type)
            .header(
                "Content-Disposition",
                format!("attachment; filename=\"{sanitized_name}\""),
            )
            .send()
            .map_err(|error| format!("Could not reach WordPress: {error}"))?;
        parse_wordpress_json_response(response)
    }
}

fn parse_wordpress_json_response(response: Response) -> Result<serde_json::Value, String> {
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the WordPress response: {error}"))?;

    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(WORDPRESS_RECONNECT_MESSAGE.to_string());
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
        WordPressSite::wordpress_com(&WordPressConnection {
            access_token: "token".to_string(),
            blog_id: "12345".to_string(),
            blog_url: "https://example.wordpress.com".to_string(),
        })
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
}
