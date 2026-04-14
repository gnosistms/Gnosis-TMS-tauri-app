use std::time::Duration;

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::ai::types::{AiReviewRequest, AiReviewResponse};

const OPENAI_RESPONSES_API_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_REVIEW_MODEL: &str = "gpt-5.4-mini";

#[derive(Debug, Serialize)]
struct OpenAiResponsesRequest<'a> {
    model: &'a str,
    input: String,
    store: bool,
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

pub(crate) fn run_review(
    request: &AiReviewRequest,
    api_key: &str,
) -> Result<AiReviewResponse, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not start the AI review request: {error}"))?;

    let response = client
        .post(OPENAI_RESPONSES_API_URL)
        .header("Authorization", format!("Bearer {normalized_key}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "gnosis-tms")
        .json(&OpenAiResponsesRequest {
            model: OPENAI_REVIEW_MODEL,
            input: build_review_prompt(request),
            store: false,
            text: OpenAiTextConfig {
                format: OpenAiTextFormat { kind: "text" },
            },
        })
        .send()
        .map_err(normalize_transport_error)?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read the AI review response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    normalize_review_response(&body)
}

fn build_review_prompt(request: &AiReviewRequest) -> String {
    let language_code = request.language_code.trim();
    if language_code.is_empty() {
        format!(
            "Check spelling and grammar on the following text. Output only your suggested revised version of the text. Do not explain what you changed and why.\n\nText to review:\n{}",
            request.text
        )
    } else {
        format!(
            "Check spelling and grammar on the following text. Output only your suggested revised version of the text. Do not explain what you changed and why.\n\nLanguage code: {language_code}\n\nText to review:\n{}",
            request.text
        )
    }
}

fn normalize_transport_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return "The AI review request timed out. Try again.".to_string();
    }
    if error.is_connect() {
        return "The app could not reach OpenAI. Check your internet connection and try again."
            .to_string();
    }

    "The app could not complete the AI review request. Try again.".to_string()
}

fn normalize_http_error(status: StatusCode, body: &str) -> String {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            "The saved OpenAI API key was rejected. Update it on the AI Key page and try again."
                .to_string()
        }
        StatusCode::TOO_MANY_REQUESTS => {
            "OpenAI rate limited this request. Wait a moment and try again.".to_string()
        }
        StatusCode::BAD_REQUEST => extract_api_error_message(body)
            .map(|message| format!("OpenAI rejected the AI review request: {message}"))
            .unwrap_or_else(|| "OpenAI rejected the AI review request.".to_string()),
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

pub(crate) fn normalize_review_response(body: &str) -> Result<AiReviewResponse, String> {
    let payload: OpenAiResponsesCreateResponse = serde_json::from_str(body)
        .map_err(|_| "OpenAI returned a malformed AI review response.".to_string())?;
    let suggested_text = extract_suggested_text(payload)?;

    Ok(AiReviewResponse { suggested_text })
}

fn extract_suggested_text(payload: OpenAiResponsesCreateResponse) -> Result<String, String> {
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
        return Err("OpenAI returned an empty AI review response.".to_string());
    }

    Ok(fallback_text)
}

#[cfg(test)]
mod tests {
    use super::normalize_review_response;

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
}
