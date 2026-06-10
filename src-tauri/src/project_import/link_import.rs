use std::io::Read as _;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use reqwest::{
    blocking::Client,
    header::{CONTENT_DISPOSITION, CONTENT_TYPE, USER_AGENT},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::constants::{ensure_within_import_size_limit, MAX_IMPORT_FILE_BYTES};

const ACCESS_DENIED_PREFIX: &str = "PROJECT_IMPORT_LINK_ACCESS_DENIED:";
const INVALID_LINK_PREFIX: &str = "PROJECT_IMPORT_LINK_INVALID:";
const USER_AGENT_VALUE: &str = "GnosisTMS/0.7";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolveProjectImportLinkInput {
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolveProjectImportLinkResponse {
    file_type: String,
    file_name: String,
    data_base64: String,
    source_url: String,
}

pub(crate) fn resolve_project_import_link_sync(
    input: ResolveProjectImportLinkInput,
) -> Result<ResolveProjectImportLinkResponse, String> {
    let parsed_url =
        Url::parse(input.url.trim()).map_err(|_| invalid_link("This link is not a valid URL."))?;
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err(invalid_link("Only HTTP and HTTPS links are supported."));
    }

    if is_google_docs_host(&parsed_url) {
        if let Some(document_id) = google_file_id(&parsed_url, "document") {
            return resolve_google_export(
                &parsed_url,
                &format!("https://docs.google.com/document/d/{document_id}/export?format=docx"),
                "docx",
                "google-doc.docx",
            );
        }

        if let Some(spreadsheet_id) = google_file_id(&parsed_url, "spreadsheets") {
            return resolve_google_export(
                &parsed_url,
                &format!(
                    "https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=xlsx"
                ),
                "xlsx",
                "google-sheet.xlsx",
            );
        }

        return Err(invalid_link(
            "Only Google Docs and Google Sheets links are supported from docs.google.com.",
        ));
    }

    resolve_html_link(&parsed_url)
}

fn resolve_google_export(
    source_url: &Url,
    export_url: &str,
    file_type: &str,
    fallback_file_name: &str,
) -> Result<ResolveProjectImportLinkResponse, String> {
    let response = http_client()
        .get(export_url)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .map_err(|error| invalid_link(&format!("Could not open the Google file: {error}")))?;
    let final_url = response.url().clone();
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let file_name = response
        .headers()
        .get(CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .and_then(content_disposition_file_name)
        .map(|value| ensure_extension(&value, file_type))
        .unwrap_or_else(|| fallback_file_name.to_string());
    // Read at most one byte past the import limit so a huge (or endless) response is
    // rejected without buffering it all into memory; the size check below still fires.
    let mut data = Vec::new();
    response
        .take(MAX_IMPORT_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|error| invalid_link(&format!("Could not read the Google file: {error}")))?;

    if google_response_is_access_denied(status, &final_url, &content_type, &data) {
        return Err(access_denied());
    }
    if !status.is_success() {
        return Err(invalid_link(&format!(
            "Google returned HTTP status {}.",
            status.as_u16()
        )));
    }
    if data.is_empty() {
        return Err(invalid_link("Google returned an empty file."));
    }
    ensure_within_import_size_limit(data.len() as u64, &file_name)
        .map_err(|error| invalid_link(&error))?;
    if !data.starts_with(b"PK") {
        return Err(invalid_link(
            "Google did not return an exportable DOCX or XLSX file.",
        ));
    }

    Ok(ResolveProjectImportLinkResponse {
        file_type: file_type.to_string(),
        file_name,
        data_base64: general_purpose::STANDARD.encode(data),
        source_url: source_url.as_str().to_string(),
    })
}

fn resolve_html_link(url: &Url) -> Result<ResolveProjectImportLinkResponse, String> {
    let response = http_client()
        .get(url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .map_err(|error| invalid_link(&format!("Could not open the website: {error}")))?;
    let status = response.status();
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    // Read at most one byte past the import limit so a huge (or endless) response is
    // rejected without buffering it all into memory; the size check below still fires.
    let mut data = Vec::new();
    response
        .take(MAX_IMPORT_FILE_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|error| invalid_link(&format!("Could not read the website: {error}")))?;

    if !status.is_success() {
        return Err(invalid_link(&format!(
            "The website returned HTTP status {}.",
            status.as_u16()
        )));
    }
    if data.is_empty() {
        return Err(invalid_link("The website returned an empty response."));
    }
    if !content_type_is_html(&content_type) && !body_looks_like_html(&data) {
        return Err(invalid_link("The website did not return an HTML page."));
    }
    let file_name = html_file_name(&final_url, &data);
    ensure_within_import_size_limit(data.len() as u64, &file_name)
        .map_err(|error| invalid_link(&error))?;

    Ok(ResolveProjectImportLinkResponse {
        file_type: "html".to_string(),
        file_name,
        data_base64: general_purpose::STANDARD.encode(data),
        source_url: final_url.as_str().to_string(),
    })
}

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn is_google_docs_host(url: &Url) -> bool {
    url.host_str()
        .map(|host| host.eq_ignore_ascii_case("docs.google.com"))
        .unwrap_or(false)
}

fn google_file_id(url: &Url, kind: &str) -> Option<String> {
    let mut segments = url.path_segments()?;
    if segments.next()? != kind {
        return None;
    }
    if segments.next()? != "d" {
        return None;
    }
    let id = segments.next()?.trim();
    if id.is_empty() {
        return None;
    }
    Some(id.to_string())
}

fn google_response_is_access_denied(
    status: StatusCode,
    final_url: &Url,
    content_type: &str,
    data: &[u8],
) -> bool {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return true;
    }
    if final_url
        .host_str()
        .map(|host| host.eq_ignore_ascii_case("accounts.google.com"))
        .unwrap_or(false)
    {
        return true;
    }
    if content_type_is_html(content_type) || body_looks_like_html(data) {
        let body = String::from_utf8_lossy(data).to_ascii_lowercase();
        return body.contains("you need access")
            || body.contains("request access")
            || body.contains("sign in")
            || body.contains("signin")
            || body.contains("accounts.google.com");
    }
    false
}

fn content_type_is_html(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "text/html" || normalized == "application/xhtml+xml"
        })
        .unwrap_or(false)
}

fn body_looks_like_html(data: &[u8]) -> bool {
    let prefix = String::from_utf8_lossy(&data[..data.len().min(4096)]).to_ascii_lowercase();
    let trimmed = prefix.trim_start();
    trimmed.starts_with("<!doctype html")
        || trimmed.starts_with("<html")
        || trimmed.contains("<body")
}

fn html_file_name(url: &Url, data: &[u8]) -> String {
    let title = html_title(data)
        .or_else(|| {
            url.path_segments()
                .and_then(|mut segments| segments.rfind(|segment| !segment.trim().is_empty()))
                .map(|segment| segment.trim().to_string())
        })
        .unwrap_or_else(|| "web-page".to_string());
    let slug = slugify_file_stem(&title);
    format!("{slug}.html")
}

fn html_title(data: &[u8]) -> Option<String> {
    let body = String::from_utf8_lossy(data);
    let lower = body.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let after_start = lower[start..].find('>')? + start + 1;
    let end = lower[after_start..].find("</title>")? + after_start;
    let title = decode_basic_html_entities(body[after_start..end].trim());
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn content_disposition_file_name(value: &str) -> Option<String> {
    let mut fallback = None;
    for part in value.split(';').map(str::trim) {
        let Some((key, raw_value)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let file_name = raw_value.trim().trim_matches('"').trim();
        if file_name.is_empty() {
            continue;
        }
        if key.eq_ignore_ascii_case("filename*") {
            return Some(sanitize_file_name(&decode_rfc5987_file_name(file_name)));
        }
        if key.eq_ignore_ascii_case("filename") {
            fallback = Some(sanitize_file_name(file_name));
        }
    }
    fallback
}

fn decode_rfc5987_file_name(value: &str) -> String {
    let encoded = value
        .split_once("''")
        .map(|(_, encoded)| encoded)
        .unwrap_or(value);
    percent_decode_utf8_lossy(encoded)
}

fn percent_decode_utf8_lossy(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                decoded.push(hex);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn sanitize_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect::<String>();
    let trimmed = sanitized.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "linked-file".to_string()
    } else {
        trimmed
    }
}

fn ensure_extension(value: &str, extension: &str) -> String {
    let expected = format!(".{}", extension.trim_start_matches('.'));
    if value.to_ascii_lowercase().ends_with(&expected) {
        value.to_string()
    } else {
        format!("{value}{expected}")
    }
}

fn slugify_file_stem(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "web-page".to_string()
    } else {
        trimmed.to_string()
    }
}

fn access_denied() -> String {
    format!("{ACCESS_DENIED_PREFIX}The linked Google file is not shared publicly.")
}

fn invalid_link(message: &str) -> String {
    format!("{INVALID_LINK_PREFIX}{message}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_google_document_ids() {
        let url = Url::parse("https://docs.google.com/document/d/doc-id/edit").unwrap();
        assert_eq!(google_file_id(&url, "document").as_deref(), Some("doc-id"));
        assert_eq!(google_file_id(&url, "spreadsheets"), None);
    }

    #[test]
    fn detects_google_spreadsheet_ids() {
        let url = Url::parse("https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=0").unwrap();
        assert_eq!(
            google_file_id(&url, "spreadsheets").as_deref(),
            Some("sheet-id")
        );
        assert_eq!(google_file_id(&url, "document"), None);
    }

    #[test]
    fn detects_google_access_denied_html() {
        let url =
            Url::parse("https://docs.google.com/document/d/doc-id/export?format=docx").unwrap();
        assert!(google_response_is_access_denied(
            StatusCode::OK,
            &url,
            "text/html; charset=utf-8",
            b"<html><body>You need access</body></html>",
        ));
    }

    #[test]
    fn builds_html_file_name_from_title() {
        let url = Url::parse("https://example.com/articles/one").unwrap();
        assert_eq!(
            html_file_name(
                &url,
                b"<html><head><title>Chapter One</title></head></html>"
            ),
            "chapter-one.html",
        );
    }

    #[test]
    fn reads_google_export_file_name_from_content_disposition() {
        assert_eq!(
            content_disposition_file_name("attachment; filename=\"Shared Doc.docx\"").as_deref(),
            Some("Shared Doc.docx"),
        );
        assert_eq!(
            content_disposition_file_name("attachment; filename*=UTF-8''Shared%20Sheet.xlsx")
                .as_deref(),
            Some("Shared Sheet.xlsx"),
        );
    }
}
