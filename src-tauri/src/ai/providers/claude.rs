use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::ai::{
    providers::shared_http_client,
    types::{AiPromptRequest, AiPromptResponse, AiProviderModel},
};

const CLAUDE_API_VERSION: &str = "2023-06-01";
const CLAUDE_MODELS_API_URL: &str = "https://api.anthropic.com/v1/models";
const CLAUDE_MESSAGES_API_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Debug, Deserialize)]
struct ClaudeModelsResponse {
    #[serde(default)]
    data: Vec<ClaudeModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ClaudeModelEntry {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "display_name")]
    display_name: String,
}

#[derive(Debug, Serialize)]
struct ClaudeMessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ClaudeMessage<'a>>,
}

#[derive(Debug, Serialize)]
struct ClaudeMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct ClaudeMessagesResponse {
    #[serde(default)]
    content: Vec<ClaudeContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContentBlock {
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize)]
struct ClaudeErrorEnvelope {
    error: Option<ClaudeErrorBody>,
}

#[derive(Debug, Deserialize)]
struct ClaudeErrorBody {
    #[serde(default)]
    message: String,
}

pub(crate) fn list_models(api_key: &str) -> Result<Vec<AiProviderModel>, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Claude API key is saved yet.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the Claude models request: {error}"))?;

    let response = client
        .get(CLAUDE_MODELS_API_URL)
        .header("x-api-key", normalized_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the Claude models response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: ClaudeModelsResponse = serde_json::from_str(&body)
        .map_err(|_| "Claude returned a malformed models response.".to_string())?;
    let models = payload
        .data
        .into_iter()
        .filter_map(|model| {
            let id = model.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let label = if model.display_name.trim().is_empty() {
                id.clone()
            } else {
                format!("{} ({})", model.display_name.trim(), id)
            };
            Some(AiProviderModel { id, label })
        })
        .collect::<Vec<_>>();

    if models.is_empty() {
        return Err("Claude did not return any models for this API key.".to_string());
    }

    Ok(models)
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Claude API key is saved yet.".to_string());
    }

    let model_id = request.model_id.trim();
    if model_id.is_empty() {
        return Err("Select a Claude model before running this AI request.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the Claude request: {error}"))?;

    let response = client
        .post(CLAUDE_MESSAGES_API_URL)
        .header("x-api-key", normalized_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .header("content-type", "application/json")
        .json(&ClaudeMessagesRequest {
            model: model_id,
            max_tokens: 1024,
            messages: vec![ClaudeMessage {
                role: "user",
                content: &request.prompt,
            }],
        })
        .send()
        .map_err(normalize_transport_error)?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the Claude response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: ClaudeMessagesResponse = serde_json::from_str(&body)
        .map_err(|_| "Claude returned a malformed response.".to_string())?;
    let text = payload
        .content
        .into_iter()
        .filter(|block| block.kind == "text")
        .map(|block| block.text)
        .collect::<String>();

    if text.trim().is_empty() {
        return Err("Claude returned an empty response.".to_string());
    }

    Ok(AiPromptResponse {
        text,
        provider_response_id: None,
    })
}

pub(crate) fn probe_model(model_id: &str, api_key: &str) -> Result<(), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No Claude API key is saved yet.".to_string());
    }

    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("Select a Claude model before testing it.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the Claude model test request: {error}"))?;

    let response = client
        .post(CLAUDE_MESSAGES_API_URL)
        .header("x-api-key", normalized_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .header("content-type", "application/json")
        .json(&ClaudeMessagesRequest {
            model: normalized_model_id,
            max_tokens: 1,
            messages: vec![ClaudeMessage {
                role: "user",
                content: "Reply with OK.",
            }],
        })
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the Claude model test response: {error}"))?;

    if !status.is_success() {
        return Err(extract_probe_error_message(status, &body, "Claude"));
    }

    Ok(())
}

fn normalize_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The Claude request timed out. Try again.".to_string();
    }
    if error.is_connect() {
        return "The app could not reach Claude. Check your internet connection and try again."
            .to_string();
    }

    "The app could not complete the Claude request. Try again.".to_string()
}

fn normalize_http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "The saved Claude API key was rejected. Update it in AI Settings and try again."
                .to_string()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "Claude rate limited this request. Wait a moment and try again.".to_string()
        }
        _ if status.is_server_error() => {
            "Claude is temporarily unavailable. Try again in a moment.".to_string()
        }
        _ => extract_api_error_message(body)
            .map(|message| format!("Claude returned an error: {message}"))
            .unwrap_or_else(|| "Claude returned an unexpected error.".to_string()),
    }
}

fn extract_api_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<ClaudeErrorEnvelope>(body)
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
