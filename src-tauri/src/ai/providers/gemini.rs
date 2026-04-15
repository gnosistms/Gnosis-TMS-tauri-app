use std::collections::BTreeMap;
use std::thread;
use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::ai::{
    providers::shared_http_client,
    types::{AiPromptRequest, AiPromptResponse, AiProviderModel},
};

const GEMINI_MODELS_API_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MAX_RETRIES: usize = 2;

#[derive(Debug, Deserialize)]
struct GeminiModelsResponse {
    #[serde(default)]
    models: Vec<GeminiModelEntry>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: String,
}

#[derive(Debug, Deserialize)]
struct GeminiModelEntry {
    #[serde(default)]
    name: String,
    #[serde(default, rename = "baseModelId")]
    base_model_id: String,
    #[serde(default, rename = "displayName")]
    display_name: String,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_generation_methods: Vec<String>,
}

#[derive(Debug, Serialize)]
struct GeminiGenerateContentRequest<'a> {
    contents: Vec<GeminiContent<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiContent<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateContentResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiCandidateContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidateContent {
    #[serde(default)]
    parts: Vec<GeminiCandidatePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidatePart {
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorEnvelope {
    error: Option<GeminiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorBody {
    #[serde(default)]
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum GeminiModelFamily {
    Pro,
    Flash,
    FlashLite,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct GeminiModelVersion {
    major: u32,
    minor: u32,
    preview_rank: u8,
    preview_year: u32,
    preview_month: u32,
}

pub(crate) fn list_models(api_key: &str) -> Result<Vec<AiProviderModel>, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Gemini API key is saved yet.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the Gemini models request: {error}"))?;

    let mut models_by_id = BTreeMap::new();
    let mut next_page_token = String::new();

    loop {
        let mut request = client
            .get(GEMINI_MODELS_API_URL)
            .query(&[("key", normalized_key), ("pageSize", "1000")]);
        if !next_page_token.is_empty() {
            request = request.query(&[("pageToken", next_page_token.as_str())]);
        }

        let response = request
            .send()
            .map_err(normalize_transport_error)?;
        let status = response.status();
        let body = response
            .text()
            .map_err(|error| format!("Could not read the Gemini models response: {error}"))?;

        if !status.is_success() {
            return Err(normalize_http_error(status, &body));
        }

        let payload: GeminiModelsResponse = serde_json::from_str(&body)
            .map_err(|_| "Gemini returned a malformed models response.".to_string())?;
        for model in payload.models {
            if !model_supports_generate_content(&model) {
                continue;
            }

            let id = model_id_for_model(&model);
            if id.is_empty() {
                continue;
            }

            let label = if model.display_name.trim().is_empty() {
                id.clone()
            } else {
                format!("{} ({})", model.display_name.trim(), id)
            };
            models_by_id.entry(id.clone()).or_insert(AiProviderModel { id, label });
        }

        if payload.next_page_token.trim().is_empty() {
            break;
        }
        next_page_token = payload.next_page_token;
    }

    let models = models_by_id.into_values().collect::<Vec<_>>();
    let shortlisted_models = shortlist_recommended_models(&models);
    let models = if shortlisted_models.is_empty() {
        models
    } else {
        shortlisted_models
    };

    if models.is_empty() {
        return Err("Gemini did not return any text generation models for this API key.".to_string());
    }

    Ok(models)
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Gemini API key is saved yet.".to_string());
    }

    let model_id = request.model_id.trim();
    if model_id.is_empty() {
        return Err("Select a Gemini model before running this AI request.".to_string());
    }

    let client =
        shared_http_client().map_err(|error| format!("Could not start the Gemini request: {error}"))?;
    let (status, body) =
        send_generate_content_request(&client, normalized_key, model_id, &request.prompt)
            .map_err(|error| format!("Could not complete the Gemini request: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: GeminiGenerateContentResponse = serde_json::from_str(&body)
        .map_err(|_| "Gemini returned a malformed response.".to_string())?;
    let text = payload
        .candidates
        .into_iter()
        .filter_map(|candidate| candidate.content)
        .flat_map(|content| content.parts.into_iter())
        .map(|part| part.text)
        .collect::<String>();

    if text.trim().is_empty() {
        return Err("Gemini returned an empty response.".to_string());
    }

    Ok(AiPromptResponse { text })
}

pub(crate) fn probe_model(model_id: &str, api_key: &str) -> Result<(), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Gemini API key is saved yet.".to_string());
    }

    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("Select a Gemini model before testing it.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the Gemini model test request: {error}"))?;
    let (status, body) =
        send_generate_content_request(&client, normalized_key, normalized_model_id, "Reply with OK.")
            .map_err(|error| format!("Could not complete the Gemini model test request: {error}"))?;

    if !status.is_success() {
        return Err(extract_probe_error_message(status, &body, "Gemini"));
    }

    Ok(())
}

fn send_generate_content_request(
    client: &reqwest::blocking::Client,
    api_key: &str,
    model_id: &str,
    text: &str,
) -> Result<(StatusCode, String), String> {
    let mut attempt = 0;

    loop {
        let response = client
            .post(format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
            ))
            .query(&[("key", api_key)])
            .header("Content-Type", "application/json")
            .json(&GeminiGenerateContentRequest {
                contents: vec![GeminiContent {
                    parts: vec![GeminiPart { text }],
                }],
            })
            .send()
            .map_err(normalize_transport_error)?;
        let status = response.status();
        let body = response
            .text()
            .map_err(|error| format!("Could not read the Gemini response: {error}"))?;

        if status.is_success() || !should_retry_request(status) || attempt >= GEMINI_MAX_RETRIES {
            return Ok((status, body));
        }

        thread::sleep(retry_delay_for_attempt(attempt));
        attempt += 1;
    }
}

fn model_supports_generate_content(model: &GeminiModelEntry) -> bool {
    model
        .supported_generation_methods
        .iter()
        .any(|method| method == "generateContent")
}

fn model_id_for_model(model: &GeminiModelEntry) -> String {
    if !model.base_model_id.trim().is_empty() {
        return model.base_model_id.trim().to_string();
    }

    model
        .name
        .trim()
        .strip_prefix("models/")
        .unwrap_or(model.name.trim())
        .to_string()
}

fn shortlist_recommended_models(models: &[AiProviderModel]) -> Vec<AiProviderModel> {
    let best_pro = latest_gemini_model_for_family(models, GeminiModelFamily::Pro);
    let best_flash = latest_gemini_model_for_family(models, GeminiModelFamily::Flash);
    let best_flash_lite = latest_gemini_model_for_family(models, GeminiModelFamily::FlashLite);

    let mut shortlisted = Vec::new();
    if let Some(model) = best_pro {
        shortlisted.push(model);
    }
    if let Some(model) = best_flash {
        shortlisted.push(model);
    }
    if let Some(model) = best_flash_lite {
        shortlisted.push(model);
    }

    shortlisted
}

fn latest_gemini_model_for_family(
    models: &[AiProviderModel],
    family: GeminiModelFamily,
) -> Option<AiProviderModel> {
    models
        .iter()
        .filter_map(|model| {
            parse_gemini_model_version(&model.id).and_then(|(parsed_family, version)| {
                if parsed_family == family {
                    Some((version, model))
                } else {
                    None
                }
            })
        })
        .max_by_key(|(version, _model)| *version)
        .map(|(_version, model)| model.clone())
}

fn parse_gemini_model_version(model_id: &str) -> Option<(GeminiModelFamily, GeminiModelVersion)> {
    let normalized_model_id = model_id.trim();
    let without_prefix = normalized_model_id.strip_prefix("gemini-")?;
    let segments = without_prefix.split('-').collect::<Vec<_>>();
    if segments.len() < 2 {
        return None;
    }

    let (family, preview_segments) = match segments.as_slice() {
        [version, "pro", rest @ ..] => {
            let _ = version;
            (GeminiModelFamily::Pro, rest)
        }
        [version, "flash", "lite", rest @ ..] => {
            let _ = version;
            (GeminiModelFamily::FlashLite, rest)
        }
        [version, "flash", rest @ ..] => {
            let _ = version;
            (GeminiModelFamily::Flash, rest)
        }
        _ => return None,
    };

    let version_segment = segments[0];
    let mut version_parts = version_segment.split('.');
    let major = version_parts.next()?.parse::<u32>().ok()?;
    let minor = match version_parts.next() {
        Some(value) => value.parse::<u32>().ok()?,
        None => 0,
    };
    if version_parts.next().is_some() {
        return None;
    }

    let (preview_rank, preview_month, preview_year) = match preview_segments {
        [] => (0, 0, 0),
        ["preview"] => (1, 0, 0),
        ["preview", month, year] => (
            2,
            month.parse::<u32>().ok()?,
            year.parse::<u32>().ok()?,
        ),
        _ => return None,
    };

    Some((
        family,
        GeminiModelVersion {
            major,
            minor,
            preview_rank,
            preview_year,
            preview_month,
        },
    ))
}

fn normalize_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The Gemini request timed out. Try again.".to_string();
    }
    if error.is_connect() {
        return "The app could not reach Gemini. Check your internet connection and try again."
            .to_string();
    }

    "The app could not complete the Gemini request. Try again.".to_string()
}

fn normalize_http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "The saved Gemini API key was rejected. Update it in AI Settings and try again."
                .to_string()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "Gemini rate limited this request. Wait a moment and try again.".to_string()
        }
        StatusCode::INTERNAL_SERVER_ERROR => extract_api_error_message(body)
            .map(|message| format!("Gemini had an internal error: {message}"))
            .unwrap_or_else(|| "Gemini had an internal error. Try again in a moment.".to_string()),
        StatusCode::SERVICE_UNAVAILABLE => extract_api_error_message(body)
            .map(|message| format!("Gemini is temporarily unavailable: {message}"))
            .unwrap_or_else(|| "Gemini is temporarily unavailable. Try again in a moment.".to_string()),
        _ if status.is_server_error() => extract_api_error_message(body)
            .map(|message| format!("Gemini is temporarily unavailable: {message}"))
            .unwrap_or_else(|| "Gemini is temporarily unavailable. Try again in a moment.".to_string()),
        _ => extract_api_error_message(body)
            .map(|message| format!("Gemini returned an error: {message}"))
            .unwrap_or_else(|| "Gemini returned an unexpected error.".to_string()),
    }
}

fn should_retry_request(status: StatusCode) -> bool {
    matches!(status, StatusCode::INTERNAL_SERVER_ERROR | StatusCode::SERVICE_UNAVAILABLE)
}

fn retry_delay_for_attempt(attempt: usize) -> Duration {
    match attempt {
        0 => Duration::from_millis(400),
        1 => Duration::from_millis(1_200),
        _ => Duration::from_millis(2_500),
    }
}

fn extract_probe_error_message(status: StatusCode, body: &str, provider_name: &str) -> String {
    extract_api_error_message(body).unwrap_or_else(|| {
        format!("{provider_name} returned {status} while testing the selected model.")
    })
}

fn extract_api_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<GeminiErrorEnvelope>(body)
        .ok()
        .and_then(|payload| payload.error)
        .map(|error| error.message.trim().to_string())
        .filter(|message| !message.is_empty())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{normalize_http_error, retry_delay_for_attempt, shortlist_recommended_models};
    use crate::ai::types::AiProviderModel;
    use reqwest::StatusCode;

    #[test]
    fn shortlist_recommended_models_keeps_latest_pro_flash_and_flash_lite() {
        let models = vec![
            AiProviderModel {
                id: "gemini-2.5-pro".to_string(),
                label: "gemini-2.5-pro".to_string(),
            },
            AiProviderModel {
                id: "gemini-3-pro-preview".to_string(),
                label: "gemini-3-pro-preview".to_string(),
            },
            AiProviderModel {
                id: "gemini-2.5-flash".to_string(),
                label: "gemini-2.5-flash".to_string(),
            },
            AiProviderModel {
                id: "gemini-3-flash-preview".to_string(),
                label: "gemini-3-flash-preview".to_string(),
            },
            AiProviderModel {
                id: "gemini-2.5-flash-lite".to_string(),
                label: "gemini-2.5-flash-lite".to_string(),
            },
            AiProviderModel {
                id: "gemini-2.5-flash-lite-preview-09-2025".to_string(),
                label: "gemini-2.5-flash-lite-preview-09-2025".to_string(),
            },
        ];

        let shortlisted = shortlist_recommended_models(&models)
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(
            shortlisted,
            vec![
                "gemini-3-pro-preview",
                "gemini-3-flash-preview",
                "gemini-2.5-flash-lite-preview-09-2025",
            ]
        );
    }

    #[test]
    fn shortlist_recommended_models_prefers_dated_preview_over_stable_within_same_family() {
        let models = vec![
            AiProviderModel {
                id: "gemini-2.5-flash".to_string(),
                label: "gemini-2.5-flash".to_string(),
            },
            AiProviderModel {
                id: "gemini-2.5-flash-preview-09-2025".to_string(),
                label: "gemini-2.5-flash-preview-09-2025".to_string(),
            },
        ];

        let shortlisted = shortlist_recommended_models(&models)
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(shortlisted, vec!["gemini-2.5-flash-preview-09-2025"]);
    }

    #[test]
    fn normalize_http_error_keeps_gemini_service_unavailable_message() {
        let body = r#"{
            "error": {
                "message": "The model is overloaded. Please try again later."
            }
        }"#;

        let error = normalize_http_error(StatusCode::SERVICE_UNAVAILABLE, body);

        assert_eq!(
            error,
            "Gemini is temporarily unavailable: The model is overloaded. Please try again later."
        );
    }

    #[test]
    fn retry_delay_for_attempt_uses_backoff() {
        assert_eq!(retry_delay_for_attempt(0), Duration::from_millis(400));
        assert_eq!(retry_delay_for_attempt(1), Duration::from_millis(1_200));
        assert_eq!(retry_delay_for_attempt(2), Duration::from_millis(2_500));
    }
}
