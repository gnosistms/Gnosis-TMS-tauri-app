use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::ai::{
    types::{AiPromptRequest, AiPromptResponse, AiProviderModel, AiReviewResponse},
};

const OPENAI_RESPONSES_API_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_MODELS_API_URL: &str = "https://api.openai.com/v1/models";
const OPENAI_PROBE_MAX_OUTPUT_TOKENS: u32 = 16;

#[derive(Debug, Serialize)]
struct OpenAiResponsesRequest<'a> {
    model: &'a str,
    input: String,
    store: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    text: OpenAiTextConfig<'a>,
}

#[derive(Debug, Serialize)]
struct OpenAiTextConfig<'a> {
    format: OpenAiTextFormat<'a>,
}

#[derive(Debug, Serialize)]
struct OpenAiTextFormat<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponsesCreateResponse {
    #[serde(default)]
    output_text: String,
    #[serde(default)]
    output: Vec<OpenAiOutputItem>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelsListResponse {
    #[serde(default)]
    data: Vec<OpenAiModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelEntry {
    #[serde(default)]
    id: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputItem {
    #[serde(default)]
    content: Vec<OpenAiOutputContent>,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputContent {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorEnvelope {
    error: Option<OpenAiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    #[serde(default)]
    message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct OpenAiModelVersion {
    major: u32,
    minor: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenAiModelFamily {
    General,
    Mini,
    Nano,
}

impl OpenAiModelFamily {
    fn recommended_ordered() -> [Self; 3] {
        [Self::General, Self::Mini, Self::Nano]
    }

    fn suffix(self) -> Option<&'static str> {
        match self {
            Self::General => None,
            Self::Mini => Some("-mini"),
            Self::Nano => Some("-nano"),
        }
    }
}

pub(crate) fn list_models(api_key: &str) -> Result<Vec<AiProviderModel>, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not start the OpenAI models request: {error}"))?;

    let response = client
        .get(OPENAI_MODELS_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("User-Agent", "gnosis-tms")
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the OpenAI models response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: OpenAiModelsListResponse = serde_json::from_str(&body)
        .map_err(|_| "OpenAI returned a malformed models response.".to_string())?;
    let mut models = payload
        .data
        .into_iter()
        .filter_map(|model| {
            let id = model.id.trim().to_string();
            if id.is_empty() || !model_supports_text_review(&id) {
                return None;
            }
            Some(AiProviderModel {
                label: id.clone(),
                id,
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.label.cmp(&right.label));
    models.dedup_by(|left, right| left.id == right.id);
    let recommended_models = shortlist_recommended_models(&models);
    let models = if recommended_models.is_empty() {
        models
    } else {
        recommended_models
    };

    if models.is_empty() {
        return Err("OpenAI did not return any compatible text models for this API key.".to_string());
    }

    Ok(models)
}

pub(crate) fn probe_model(model_id: &str, api_key: &str) -> Result<(), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("Select an OpenAI model before testing it.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not start the OpenAI model test request: {error}"))?;

    let response = client
        .post(OPENAI_RESPONSES_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "gnosis-tms")
        .json(&build_probe_request(normalized_model_id))
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the OpenAI model test response: {error}"))?;

    if !status.is_success() {
        return Err(extract_probe_error_message(status, &body, "OpenAI"));
    }

    Ok(())
}

fn build_probe_request(model_id: &str) -> OpenAiResponsesRequest<'_> {
    OpenAiResponsesRequest {
        model: model_id,
        input: "Reply with OK.".to_string(),
        store: false,
        max_output_tokens: Some(OPENAI_PROBE_MAX_OUTPUT_TOKENS),
        text: OpenAiTextConfig {
            format: OpenAiTextFormat { kind: "text" },
        },
    }
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not start the OpenAI request: {error}"))?;

    let response = client
        .post(OPENAI_RESPONSES_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "gnosis-tms")
        .json(&OpenAiResponsesRequest {
            model: request.model_id.trim(),
            input: request.prompt.clone(),
            store: false,
            max_output_tokens: None,
            text: OpenAiTextConfig {
                format: OpenAiTextFormat { kind: "text" },
            },
        })
        .send()
        .map_err(normalize_transport_error)?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the OpenAI response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let text = normalize_text_response(
        &body,
        "OpenAI returned a malformed response.",
        "OpenAI returned an empty response.",
    )?;

    Ok(AiPromptResponse { text })
}

fn normalize_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The OpenAI request timed out. Try again.".to_string();
    }
    if error.is_connect() {
        return "The app could not reach OpenAI. Check your internet connection and try again."
            .to_string();
    }

    "The app could not complete the OpenAI request. Try again.".to_string()
}

fn model_supports_text_review(model_id: &str) -> bool {
    let normalized = model_id.trim().to_lowercase();
    !normalized.is_empty()
        && !is_hidden_gpt_pro_model(&normalized)
        && ![
            "embedding",
            "moderation",
            "whisper",
            "tts",
            "transcribe",
            "gpt-image",
            "dall-e",
            "realtime",
            "omni-moderation",
            "search",
        ]
        .iter()
        .any(|blocked| normalized.contains(blocked))
}

fn is_hidden_gpt_pro_model(model_id: &str) -> bool {
    model_id.starts_with("gpt-") && model_id.ends_with("-pro")
}

fn shortlist_recommended_models(models: &[AiProviderModel]) -> Vec<AiProviderModel> {
    OpenAiModelFamily::recommended_ordered()
        .into_iter()
        .filter_map(|family| latest_openai_model_for_family(models, family))
        .collect()
}

fn latest_openai_model_for_family(
    models: &[AiProviderModel],
    family: OpenAiModelFamily,
) -> Option<AiProviderModel> {
    models
        .iter()
        .filter_map(|model| {
            parse_openai_model_version_for_family(&model.id, family).map(|version| (version, model))
        })
        .max_by_key(|(version, _model)| *version)
        .map(|(_version, model)| model.clone())
}

fn parse_openai_model_version_for_family(
    model_id: &str,
    family: OpenAiModelFamily,
) -> Option<OpenAiModelVersion> {
    let normalized_model_id = model_id.trim().strip_prefix("gpt-")?;
    let version_text = match family.suffix() {
        Some(suffix) => normalized_model_id.strip_suffix(suffix)?,
        None => normalized_model_id,
    };
    if version_text.contains('-') {
        return None;
    }

    parse_openai_model_version(version_text)
}

fn parse_openai_model_version(version_text: &str) -> Option<OpenAiModelVersion> {
    let trimmed = version_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = match parts.next() {
        Some(value) => Some(value.parse::<u32>().ok()?),
        None => None,
    };
    if parts.next().is_some() {
        return None;
    }

    Some(OpenAiModelVersion { major, minor })
}

fn normalize_http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "The saved OpenAI API key was rejected. Update it in AI Settings and try again."
                .to_string()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "OpenAI rate limited this request. Wait a moment and try again.".to_string()
        }
        StatusCode::BAD_REQUEST => extract_api_error_message(body)
            .map(|message| format!("OpenAI rejected the request: {message}"))
            .unwrap_or_else(|| "OpenAI rejected the request.".to_string()),
        _ if status.is_server_error() => {
            "OpenAI is temporarily unavailable. Try again in a moment.".to_string()
        }
        _ => extract_api_error_message(body)
            .map(|message| format!("OpenAI returned an error: {message}"))
            .unwrap_or_else(|| "OpenAI returned an unexpected error.".to_string()),
    }
}

fn extract_api_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<OpenAiErrorEnvelope>(body)
        .ok()
        .and_then(|payload| payload.error)
        .map(|error| error.message.trim().to_string())
        .filter(|message| !message.is_empty())
}

fn extract_probe_error_message(status: StatusCode, body: &str, provider_name: &str) -> String {
    extract_api_error_message(body).unwrap_or_else(|| {
        format!("{provider_name} returned {status} while testing the selected model.")
    })
}

fn normalize_text_response(
    body: &str,
    malformed_message: &str,
    empty_message: &str,
) -> Result<String, String> {
    let payload: OpenAiResponsesCreateResponse =
        serde_json::from_str(body).map_err(|_| malformed_message.to_string())?;
    extract_suggested_text(payload, empty_message)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn normalize_review_response(body: &str) -> Result<AiReviewResponse, String> {
    let suggested_text = normalize_text_response(
        body,
        "OpenAI returned a malformed AI review response.",
        "OpenAI returned an empty AI review response.",
    )?;

    Ok(AiReviewResponse { suggested_text })
}

fn extract_suggested_text(
    payload: OpenAiResponsesCreateResponse,
    empty_message: &str,
) -> Result<String, String> {
    let direct_text = payload.output_text;
    if !direct_text.trim().is_empty() {
        return Ok(direct_text);
    }

    let fallback_text = payload
        .output
        .into_iter()
        .flat_map(|item| item.content.into_iter())
        .filter(|content| content.kind == "output_text")
        .map(|content| content.text)
        .collect::<String>();

    if fallback_text.trim().is_empty() {
        return Err(empty_message.to_string());
    }

    Ok(fallback_text)
}

#[cfg(test)]
mod tests {
    use super::{
        build_probe_request, is_hidden_gpt_pro_model, normalize_review_response,
        shortlist_recommended_models, OPENAI_PROBE_MAX_OUTPUT_TOKENS,
    };
    use crate::ai::types::AiProviderModel;

    #[test]
    fn normalize_review_response_prefers_top_level_output_text() {
        let body = r#"{
            "output_text": "Fixed sentence.",
            "output": []
        }"#;

        let result = normalize_review_response(body).unwrap();

        assert_eq!(result.suggested_text, "Fixed sentence.");
    }

    #[test]
    fn normalize_review_response_falls_back_to_output_items() {
        let body = r#"{
            "output_text": "",
            "output": [
                {
                    "content": [
                        { "type": "output_text", "text": "Fixed " },
                        { "type": "output_text", "text": "sentence." }
                    ]
                }
            ]
        }"#;

        let result = normalize_review_response(body).unwrap();

        assert_eq!(result.suggested_text, "Fixed sentence.");
    }

    #[test]
    fn normalize_review_response_rejects_empty_output() {
        let body = r#"{
            "output_text": "   ",
            "output": []
        }"#;

        let error = normalize_review_response(body).unwrap_err();

        assert_eq!(error, "OpenAI returned an empty AI review response.");
    }

    #[test]
    fn openai_probe_request_uses_responses_minimum_output_tokens() {
        let payload = serde_json::to_value(build_probe_request("gpt-5.4")).unwrap();

        assert_eq!(
            payload.get("max_output_tokens").and_then(serde_json::Value::as_u64),
            Some(OPENAI_PROBE_MAX_OUTPUT_TOKENS as u64)
        );
    }

    #[test]
    fn shortlist_recommended_models_keeps_only_latest_model_per_family() {
        let models = vec![
            AiProviderModel {
                id: "gpt-5".to_string(),
                label: "gpt-5".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.2-pro".to_string(),
                label: "gpt-5.2-pro".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.3-mini".to_string(),
                label: "gpt-5.3-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.1-nano".to_string(),
                label: "gpt-5.1-nano".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4".to_string(),
                label: "gpt-5.4".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-pro".to_string(),
                label: "gpt-5.4-pro".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-mini".to_string(),
                label: "gpt-5.4-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-nano".to_string(),
                label: "gpt-5.4-nano".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-2026-01-15".to_string(),
                label: "gpt-5.4-2026-01-15".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-mini-2026-01-15".to_string(),
                label: "gpt-5.4-mini-2026-01-15".to_string(),
            },
        ];

        let recommended = shortlist_recommended_models(&models);
        let ids = recommended
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]);
    }

    #[test]
    fn shortlist_recommended_models_prefers_newer_major_family_when_present() {
        let models = vec![
            AiProviderModel {
                id: "gpt-5.5".to_string(),
                label: "gpt-5.5".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-mini".to_string(),
                label: "gpt-5.5-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-pro".to_string(),
                label: "gpt-5.5-pro".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-nano".to_string(),
                label: "gpt-5.5-nano".to_string(),
            },
            AiProviderModel {
                id: "gpt-6".to_string(),
                label: "gpt-6".to_string(),
            },
            AiProviderModel {
                id: "gpt-6-pro".to_string(),
                label: "gpt-6-pro".to_string(),
            },
            AiProviderModel {
                id: "gpt-6-mini".to_string(),
                label: "gpt-6-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-6-nano".to_string(),
                label: "gpt-6-nano".to_string(),
            },
        ];

        let recommended = shortlist_recommended_models(&models);
        let ids = recommended
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["gpt-6", "gpt-6-mini", "gpt-6-nano"]);
    }

    #[test]
    fn hidden_gpt_pro_models_are_excluded_from_picker() {
        assert!(is_hidden_gpt_pro_model("gpt-5.4-pro"));
        assert!(!is_hidden_gpt_pro_model("gpt-5.4"));
        assert!(!is_hidden_gpt_pro_model("o3-pro"));
    }
}
