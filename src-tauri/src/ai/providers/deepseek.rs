use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::ai::{
    providers::shared_http_client,
    types::{AiPromptRequest, AiPromptResponse, AiProviderModel},
};

const DEEPSEEK_MODELS_API_URL: &str = "https://api.deepseek.com/models";
const DEEPSEEK_CHAT_COMPLETIONS_API_URL: &str = "https://api.deepseek.com/chat/completions";

#[derive(Debug, Deserialize)]
struct DeepSeekModelsResponse {
    #[serde(default)]
    data: Vec<DeepSeekModelEntry>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekModelEntry {
    #[serde(default)]
    id: String,
}

#[derive(Debug, Serialize)]
struct DeepSeekChatCompletionsRequest<'a> {
    model: &'a str,
    messages: Vec<DeepSeekMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Serialize)]
struct DeepSeekMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct DeepSeekChatCompletionsResponse {
    #[serde(default)]
    choices: Vec<DeepSeekChoice>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekChoice {
    message: Option<DeepSeekResponseMessage>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekResponseMessage {
    #[serde(default)]
    content: String,
}

#[derive(Debug, Deserialize)]
struct DeepSeekErrorEnvelope {
    error: Option<DeepSeekErrorBody>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekErrorBody {
    #[serde(default)]
    message: String,
}

pub(crate) fn list_models(api_key: &str) -> Result<Vec<AiProviderModel>, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No DeepSeek API key is saved yet.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the DeepSeek models request: {error}"))?;

    let response = client
        .get(DEEPSEEK_MODELS_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the DeepSeek models response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: DeepSeekModelsResponse = serde_json::from_str(&body)
        .map_err(|_| "DeepSeek returned a malformed models response.".to_string())?;
    let models = payload
        .data
        .into_iter()
        .filter_map(|model| {
            let id = model.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(AiProviderModel {
                label: id.clone(),
                id,
            })
        })
        .collect::<Vec<_>>();

    if models.is_empty() {
        return Err("DeepSeek did not return any models for this API key.".to_string());
    }

    Ok(models)
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    if matches!(request.output_format, crate::ai::types::AiPromptOutputFormat::JsonSchema { .. }) {
        return Err("Strict JSON schema output is only available with OpenAI in this version.".to_string());
    }

    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No DeepSeek API key is saved yet.".to_string());
    }

    let model_id = request.model_id.trim();
    if model_id.is_empty() {
        return Err("Select a DeepSeek model before running this AI request.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the DeepSeek request: {error}"))?;

    let response = client
        .post(DEEPSEEK_CHAT_COMPLETIONS_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("Content-Type", "application/json")
        .json(&DeepSeekChatCompletionsRequest {
            model: model_id,
            messages: vec![DeepSeekMessage {
                role: "user",
                content: &request.prompt,
            }],
            stream: false,
            max_tokens: None,
        })
        .send()
        .map_err(normalize_transport_error)?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the DeepSeek response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    let payload: DeepSeekChatCompletionsResponse = serde_json::from_str(&body)
        .map_err(|_| "DeepSeek returned a malformed response.".to_string())?;
    let text = payload
        .choices
        .into_iter()
        .filter_map(|choice| choice.message)
        .map(|message| message.content)
        .collect::<String>();

    if text.trim().is_empty() {
        return Err("DeepSeek returned an empty response.".to_string());
    }

    Ok(AiPromptResponse {
        text,
        provider_response_id: None,
    })
}

pub(crate) fn probe_model(model_id: &str, api_key: &str) -> Result<(), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No DeepSeek API key is saved yet.".to_string());
    }

    let normalized_model_id = model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("Select a DeepSeek model before testing it.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the DeepSeek model test request: {error}"))?;

    let response = client
        .post(DEEPSEEK_CHAT_COMPLETIONS_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("Content-Type", "application/json")
        .json(&DeepSeekChatCompletionsRequest {
            model: normalized_model_id,
            messages: vec![DeepSeekMessage {
                role: "user",
                content: "Reply with OK.",
            }],
            stream: false,
            max_tokens: Some(1),
        })
        .send()
        .map_err(normalize_transport_error)?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the DeepSeek model test response: {error}"))?;

    if !status.is_success() {
        return Err(extract_probe_error_message(status, &body, "DeepSeek"));
    }

    Ok(())
}

fn normalize_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The DeepSeek request timed out. Try again.".to_string();
    }
    if error.is_connect() {
        return "The app could not reach DeepSeek. Check your internet connection and try again."
            .to_string();
    }

    "The app could not complete the DeepSeek request. Try again.".to_string()
}

fn normalize_http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "The saved DeepSeek API key was rejected. Update it in AI Settings and try again."
                .to_string()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "DeepSeek rate limited this request. Wait a moment and try again.".to_string()
        }
        _ if status.is_server_error() => {
            "DeepSeek is temporarily unavailable. Try again in a moment.".to_string()
        }
        _ => extract_api_error_message(body)
            .map(|message| format!("DeepSeek returned an error: {message}"))
            .unwrap_or_else(|| "DeepSeek returned an unexpected error.".to_string()),
    }
}

fn extract_api_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<DeepSeekErrorEnvelope>(body)
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
