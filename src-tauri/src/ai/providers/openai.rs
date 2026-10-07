use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ai::{
    providers::{log_prompt_cache_usage, shared_http_client, sse},
    types::{
        AiPromptOutputFormat, AiPromptRequest, AiPromptResponse, AiProviderModel, AiReviewResponse,
    },
};

const OPENAI_RESPONSES_API_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_MODELS_API_URL: &str = "https://api.openai.com/v1/models";
const OPENAI_PROBE_MAX_OUTPUT_TOKENS: u32 = 16;
const MIN_RECOMMENDED_OPENAI_MODEL_VERSION: OpenAiModelVersion = OpenAiModelVersion {
    major: 5,
    minor: Some(4),
};
const RECOMMENDED_OPENAI_MODEL_VERSION_COUNT: usize = 2;

#[derive(Debug, Serialize)]
struct OpenAiResponsesRequest<'a> {
    model: &'a str,
    input: String,
    store: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    // Unset in the app: models run at their default reasoning effort
    // (`none` on gpt-5.4). The effort-calibration harness sets it.
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<Value>,
    text: OpenAiTextConfig,
}

#[derive(Debug, Serialize)]
struct OpenAiTextConfig {
    // Structured output is generated in schema order, so the schema is sent
    // in the order it was written, not serde_json's sorted order.
    #[serde(serialize_with = "serialize_format_in_authored_order")]
    format: Value,
}

fn serialize_format_in_authored_order<S: serde::Serializer>(
    format: &Value,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    super::schemas::InAuthoredOrder(format).serialize(serializer)
}

#[derive(Debug, Deserialize)]
struct OpenAiResponsesCreateResponse {
    #[serde(default)]
    output_text: String,
    #[serde(default)]
    output: Vec<OpenAiOutputItem>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    incomplete_details: Option<Value>,
}

/// Optional provider-reported counts. Missing fields are unavailable, not zero.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct OpenAiUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub input_tokens_details: Option<OpenAiInputTokenDetails>,
    pub output_tokens_details: Option<OpenAiOutputTokenDetails>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct OpenAiInputTokenDetails {
    pub cached_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct OpenAiOutputTokenDetails {
    pub reasoning_tokens: Option<u64>,
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
    #[serde(default)]
    refusal: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorEnvelope {
    error: Option<OpenAiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    #[serde(default)]
    message: String,
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct OpenAiModelVersion {
    major: u32,
    minor: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenAiModelFamily {
    General,
    Astra,
    Sol,
    Terra,
    Luna,
    Mini,
    Nano,
}

impl OpenAiModelFamily {
    fn recommended_ordered() -> [Self; 7] {
        [
            Self::General,
            Self::Astra,
            Self::Sol,
            Self::Terra,
            Self::Luna,
            Self::Mini,
            Self::Nano,
        ]
    }

    fn suffix(self) -> Option<&'static str> {
        match self {
            Self::General => None,
            Self::Astra => Some("-astra"),
            Self::Sol => Some("-sol"),
            Self::Terra => Some("-terra"),
            Self::Luna => Some("-luna"),
            Self::Mini => Some("-mini"),
            Self::Nano => Some("-nano"),
        }
    }

    fn picker_rank(self) -> u8 {
        match self {
            Self::General => 0,
            Self::Astra => 1,
            Self::Sol => 2,
            Self::Terra => 3,
            Self::Luna => 4,
            Self::Mini => 5,
            Self::Nano => 6,
        }
    }
}

pub(crate) fn list_models(api_key: &str) -> Result<Vec<AiProviderModel>, String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let client = shared_http_client()
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
        return Err(
            "OpenAI did not return any compatible text models for this API key.".to_string(),
        );
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

    let client = shared_http_client()
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
        reasoning: None,
        text: OpenAiTextConfig {
            format: openai_text_format(AiPromptOutputFormat::Text),
        },
    }
}

fn build_prompt_request(request: &AiPromptRequest) -> OpenAiResponsesRequest<'_> {
    OpenAiResponsesRequest {
        model: request.model_id.trim(),
        input: request.prompt.clone(),
        store: false,
        max_output_tokens: None,
        reasoning: None,
        text: OpenAiTextConfig {
            format: openai_text_format(request.output_format.clone()),
        },
    }
}

fn openai_text_format(output_format: AiPromptOutputFormat) -> Value {
    match super::schemas::output_schema(&output_format) {
        None => json!({ "type": "text" }),
        Some(output) => json!({
            "type": "json_schema",
            "name": output.name,
            "strict": true,
            "schema": output.schema
        }),
    }
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    let (response, usage) = run_prompt_with_usage(request, api_key)?;
    log_prompt_cache_usage(
        "OpenAI",
        request,
        usage.as_ref().and_then(|usage| usage.input_tokens),
        usage
            .as_ref()
            .and_then(|usage| usage.input_tokens_details.as_ref())
            .and_then(|details| details.cached_tokens),
        None,
    );
    Ok(response)
}

pub(crate) fn run_prompt_with_usage(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<(AiPromptResponse, Option<OpenAiUsage>), String> {
    send_prompt_request(&build_prompt_request(request), api_key)
}

/// Runs a prompt at a forced reasoning effort. Used by the effort-calibration
/// harness (`ai::effort_eval`).
#[cfg(test)]
pub(crate) fn run_prompt_with_reasoning_effort(
    request: &AiPromptRequest,
    api_key: &str,
    effort: &str,
) -> Result<(AiPromptResponse, Option<OpenAiUsage>), String> {
    let mut body = build_prompt_request(request);
    if effort != "default" {
        body.reasoning = Some(json!({ "effort": effort }));
    }
    send_prompt_request(&body, api_key)
}

fn send_prompt_request(
    body: &OpenAiResponsesRequest<'_>,
    api_key: &str,
) -> Result<(AiPromptResponse, Option<OpenAiUsage>), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return Err("No OpenAI API key is saved yet.".to_string());
    }

    let client = shared_http_client()
        .map_err(|error| format!("Could not start the OpenAI request: {error}"))?;

    let payload = post_prompt(client, normalized_key, body)?;
    if let Some(error) = incomplete_response_error(&payload) {
        return Err(error);
    }
    let usage = payload.usage.clone();
    let text = extract_suggested_text(payload, "OpenAI returned an empty response.")?;

    Ok((AiPromptResponse { text }, usage))
}

/// A response that stopped early carries partial output; returning it would
/// hand the user a truncated translation (or unparsable JSON).
fn incomplete_response_error(payload: &OpenAiResponsesCreateResponse) -> Option<String> {
    if payload.status.as_deref() != Some("incomplete") {
        return None;
    }
    let reason = payload
        .incomplete_details
        .as_ref()
        .and_then(|details| details.get("reason"))
        .and_then(Value::as_str);
    Some(match reason {
        Some("content_filter") => {
            "OpenAI's content filter stopped this response before it was complete.".to_string()
        }
        _ => "OpenAI stopped before finishing because the response hit the output limit. \
              Try a shorter text."
            .to_string(),
    })
}

// (API key, model) pairs OpenAI declined to stream (e.g. an organization
// verification rule, which depends on the account); they use plain requests
// for the rest of the session. Keys are stored only as hashes.
static NON_STREAMING_MODELS: OnceLock<Mutex<HashSet<(u64, String)>>> = OnceLock::new();

fn non_streaming_key(api_key: &str, model_id: &str) -> (u64, String) {
    let mut hasher = DefaultHasher::new();
    api_key.hash(&mut hasher);
    (hasher.finish(), model_id.to_string())
}

fn refuses_streaming(api_key: &str, model_id: &str) -> bool {
    NON_STREAMING_MODELS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|models| models.contains(&non_streaming_key(api_key, model_id)))
        .unwrap_or(false)
}

fn remember_refuses_streaming(api_key: &str, model_id: &str) {
    if let Ok(mut models) = NON_STREAMING_MODELS
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
    {
        models.insert(non_streaming_key(api_key, model_id));
    }
}

/// Sends a prompt, streaming unless this account refused to stream the model,
/// so response bytes keep flowing; a connection that receives nothing for 60 s
/// can be cut off (plans/ai-prompt-streaming.md). A refusal to stream retries
/// once as a plain request.
fn post_prompt(
    client: &reqwest::blocking::Client,
    api_key: &str,
    body: &OpenAiResponsesRequest<'_>,
) -> Result<OpenAiResponsesCreateResponse, String> {
    if !refuses_streaming(api_key, body.model) {
        if let Some(payload) = post_prompt_once(client, api_key, body, true)? {
            return Ok(payload);
        }
        remember_refuses_streaming(api_key, body.model);
    }
    post_prompt_once(client, api_key, body, false)?
        .ok_or_else(|| "OpenAI returned an unexpected error.".to_string())
}

/// One request. `Ok(None)` means OpenAI refused to stream (only when `stream`).
fn post_prompt_once(
    client: &reqwest::blocking::Client,
    api_key: &str,
    body: &OpenAiResponsesRequest<'_>,
    stream: bool,
) -> Result<Option<OpenAiResponsesCreateResponse>, String> {
    let mut payload = serde_json::to_value(body)
        .map_err(|error| format!("Could not prepare the OpenAI request: {error}"))?;
    if stream {
        payload["stream"] = json!(true);
    }

    let started = std::time::Instant::now();
    let response = client
        .post(OPENAI_RESPONSES_API_URL)
        .timeout(super::AI_PROMPT_TIMEOUT)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "gnosis-tms")
        .json(&payload)
        .send()
        .map_err(|error| {
            super::prompt_send_error(
                "OpenAI",
                error,
                started.elapsed(),
                normalize_transport_error,
            )
        })?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|error| super::prompt_read_error("OpenAI", &error))?;

    if !status.is_success() {
        if stream && status == StatusCode::BAD_REQUEST && is_stream_refusal(&text) {
            return Ok(None);
        }
        return Err(normalize_http_error(status, &text));
    }
    let malformed = |_| "OpenAI returned a malformed response.".to_string();
    // A plain JSON body means the stream was not honored; parse it as-is.
    if !stream || text.trim_start().starts_with('{') {
        return serde_json::from_str(&text).map(Some).map_err(malformed);
    }
    serde_json::from_value(completed_response_from_stream(&text)?)
        .map(Some)
        .map_err(malformed)
}

/// The terminal event of a Responses stream carries the full response object.
fn completed_response_from_stream(body: &str) -> Result<Value, String> {
    let mut completed = None;
    for event in sse::parse_events(body) {
        let Ok(mut data) = serde_json::from_str::<Value>(&event.data) else {
            continue;
        };
        match data.get("type").and_then(Value::as_str).unwrap_or_default() {
            "response.completed" | "response.incomplete" => {
                completed = data.get_mut("response").map(Value::take);
            }
            "response.failed" => {
                return Err(stream_error_message(
                    data.pointer("/response/error/message"),
                ));
            }
            "error" => return Err(stream_error_message(data.get("message"))),
            _ => {}
        }
    }
    completed
        .ok_or_else(|| "OpenAI's response ended before it was complete. Try again.".to_string())
}

fn stream_error_message(message: Option<&Value>) -> String {
    message
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| format!("OpenAI returned an error: {message}"))
        .unwrap_or_else(|| "OpenAI returned an unexpected error.".to_string())
}

fn is_stream_refusal(body: &str) -> bool {
    let message = extract_api_error_message(body)
        .unwrap_or_default()
        .to_ascii_lowercase();
    message.contains("stream")
        && ["verif", "not supported", "unsupported", "not allowed"]
            .iter()
            .any(|marker| message.contains(marker))
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
    let mut recommended_models = models
        .iter()
        .filter_map(|model| {
            parse_recommended_openai_model(&model.id)
                .map(|(version, family)| (version, family, model.clone()))
        })
        .filter(|(version, _family, _model)| *version >= MIN_RECOMMENDED_OPENAI_MODEL_VERSION)
        .collect::<Vec<_>>();

    recommended_models.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.picker_rank().cmp(&right.1.picker_rank()))
            .then_with(|| left.2.label.cmp(&right.2.label))
    });

    let mut recent_versions = recommended_models
        .iter()
        .map(|(version, _family, _model)| *version)
        .collect::<Vec<_>>();
    recent_versions.dedup();
    recent_versions.truncate(RECOMMENDED_OPENAI_MODEL_VERSION_COUNT);
    recommended_models.retain(|(version, _family, _model)| recent_versions.contains(version));

    recommended_models
        .into_iter()
        .map(|(_version, _family, model)| model)
        .collect()
}

fn parse_recommended_openai_model(
    model_id: &str,
) -> Option<(OpenAiModelVersion, OpenAiModelFamily)> {
    OpenAiModelFamily::recommended_ordered()
        .into_iter()
        .find_map(|family| {
            parse_openai_model_version_for_family(model_id, family).map(|version| (version, family))
        })
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
        StatusCode::TOO_MANY_REQUESTS => normalize_rate_limit_error(body),
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

fn normalize_rate_limit_error(body: &str) -> String {
    let Some(error) = extract_api_error(body) else {
        return "OpenAI temporarily rate limited this request. Wait a moment and try again."
            .to_string();
    };
    let message = error.message.trim();
    let classification = format!(
        "{} {} {}",
        error.kind.as_deref().unwrap_or_default(),
        error.code.as_deref().unwrap_or_default(),
        message,
    )
    .to_lowercase();
    let is_no_credits_error = classification.contains("no credits remaining")
        || classification.contains("run out of credits")
        || classification.contains("add credits to continue");
    let is_quota_or_billing_error = classification.contains("insufficient_quota")
        || classification.contains("billing_hard_limit")
        || classification.contains("current quota")
        || classification.contains("exceeded your quota");

    if is_no_credits_error {
        return "Your OpenAI account has run out of credits. Add credits at https://platform.openai.com/settings/organization/billing/ and try again."
            .to_string();
    }

    if is_quota_or_billing_error {
        if message.is_empty() {
            return "OpenAI reported that this API account has no available quota or billing capacity. Check its OpenAI Platform billing and usage settings."
                .to_string();
        }
        return format!("OpenAI reported an API quota or billing problem: {message}");
    }

    if message.is_empty() {
        "OpenAI temporarily rate limited this request. Wait a moment and try again.".to_string()
    } else {
        format!(
            "OpenAI temporarily rate limited this request: {message} Wait a moment and try again."
        )
    }
}

fn extract_api_error(body: &str) -> Option<OpenAiErrorBody> {
    serde_json::from_str::<OpenAiErrorEnvelope>(body)
        .ok()
        .and_then(|payload| payload.error)
}

fn extract_api_error_message(body: &str) -> Option<String> {
    extract_api_error(body)
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

    Ok(AiReviewResponse {
        suggested_text,
        suggested_footnotes: Vec::new(),
        suggested_image_caption: String::new(),
        reviewed: None,
        prompt_text: String::new(),
    })
}

fn extract_suggested_text(
    payload: OpenAiResponsesCreateResponse,
    empty_message: &str,
) -> Result<String, String> {
    let direct_text = payload.output_text;
    if !direct_text.trim().is_empty() {
        return Ok(direct_text);
    }

    let mut refusal_text = String::new();
    let mut fallback_text = String::new();
    for content in payload
        .output
        .into_iter()
        .flat_map(|item| item.content.into_iter())
    {
        match content.kind.as_str() {
            "output_text" => fallback_text.push_str(&content.text),
            "refusal" => {
                refusal_text.push_str(&content.refusal);
                refusal_text.push_str(&content.text);
            }
            _ => {}
        }
    }

    if fallback_text.trim().is_empty() {
        if !refusal_text.trim().is_empty() {
            return Err("OpenAI refused this request.".to_string());
        }
        return Err(empty_message.to_string());
    }

    Ok(fallback_text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn response_usage_keeps_reported_counts_and_missing_values_distinct() {
        let response: super::OpenAiResponsesCreateResponse = serde_json::from_value(serde_json::json!({
            "output_text":"ok", "usage":{"input_tokens":123,"output_tokens":45,"total_tokens":168,
            "input_tokens_details":{"cached_tokens":64},"output_tokens_details":{"reasoning_tokens":10}}
        })).unwrap();
        let usage = response.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(123));
        assert_eq!(usage.output_tokens, Some(45));
        assert_eq!(usage.total_tokens, Some(168));
        assert_eq!(usage.input_tokens_details.unwrap().cached_tokens, Some(64));
        assert_eq!(
            usage.output_tokens_details.unwrap().reasoning_tokens,
            Some(10)
        );
        let response: super::OpenAiResponsesCreateResponse =
            serde_json::from_value(serde_json::json!({"output_text":"ok"})).unwrap();
        assert!(response.usage.is_none());
        let usage: super::OpenAiUsage =
            serde_json::from_value(serde_json::json!({"output_tokens":0})).unwrap();
        assert_eq!(usage.output_tokens, Some(0));
        assert!(usage.input_tokens.is_none());
    }

    use super::{
        build_probe_request, build_prompt_request, completed_response_from_stream,
        extract_suggested_text, incomplete_response_error, is_hidden_gpt_pro_model,
        is_stream_refusal, normalize_http_error, normalize_review_response, refuses_streaming,
        remember_refuses_streaming, shortlist_recommended_models, OpenAiResponsesCreateResponse,
        OPENAI_PROBE_MAX_OUTPUT_TOKENS,
    };
    use crate::ai::types::{AiPromptOutputFormat, AiPromptRequest, AiProviderId, AiProviderModel};
    use reqwest::StatusCode;

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
    fn normalize_review_response_reports_refusals() {
        let body = r#"{
            "output_text": "",
            "output": [
                {
                    "content": [
                        { "type": "refusal", "refusal": "I can't help with that." }
                    ]
                }
            ]
        }"#;

        let error = normalize_review_response(body).unwrap_err();

        assert_eq!(error, "OpenAI refused this request.");
    }

    #[test]
    fn openai_429_reports_quota_and_billing_errors_without_calling_them_transient() {
        let body = r#"{
            "error": {
                "message": "You exceeded your current quota, please check your plan and billing details.",
                "type": "insufficient_quota",
                "code": "insufficient_quota"
            }
        }"#;

        let error = normalize_http_error(StatusCode::TOO_MANY_REQUESTS, body);

        assert_eq!(
            error,
            "OpenAI reported an API quota or billing problem: You exceeded your current quota, please check your plan and billing details."
        );
        assert!(!error.to_lowercase().contains("rate limit"));
    }

    #[test]
    fn openai_429_reports_no_credits_with_direct_billing_guidance() {
        let body = r#"{
            "error": {
                "message": "You have no credits remaining. Add credits to continue using the API.",
                "type": "insufficient_quota",
                "code": "insufficient_quota"
            }
        }"#;

        let error = normalize_http_error(StatusCode::TOO_MANY_REQUESTS, body);

        assert_eq!(
            error,
            "Your OpenAI account has run out of credits. Add credits at https://platform.openai.com/settings/organization/billing/ and try again."
        );
        assert!(!error.to_lowercase().contains("rate limit"));
        assert!(!error.to_lowercase().contains("different model"));
    }

    #[test]
    fn openai_429_preserves_temporary_rate_limit_details() {
        let body = r#"{
            "error": {
                "message": "Rate limit reached for tokens per minute. Limit 30000, Used 29000, Requested 4000.",
                "type": "tokens",
                "code": "rate_limit_exceeded"
            }
        }"#;

        let error = normalize_http_error(StatusCode::TOO_MANY_REQUESTS, body);

        assert_eq!(
            error,
            "OpenAI temporarily rate limited this request: Rate limit reached for tokens per minute. Limit 30000, Used 29000, Requested 4000. Wait a moment and try again."
        );
    }

    #[test]
    fn openai_429_without_a_valid_error_body_keeps_safe_fallback_message() {
        let error = normalize_http_error(StatusCode::TOO_MANY_REQUESTS, "not json");

        assert_eq!(
            error,
            "OpenAI temporarily rate limited this request. Wait a moment and try again."
        );
    }

    #[test]
    fn openai_probe_request_uses_responses_minimum_output_tokens() {
        let payload = serde_json::to_value(build_probe_request("gpt-5.4")).unwrap();

        assert_eq!(
            payload
                .get("max_output_tokens")
                .and_then(serde_json::Value::as_u64),
            Some(OPENAI_PROBE_MAX_OUTPUT_TOKENS as u64)
        );
    }

    #[test]
    fn openai_probe_request_uses_text_output_format() {
        let payload = serde_json::to_value(build_probe_request("gpt-5.4")).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/type")
                .and_then(serde_json::Value::as_str),
            Some("text")
        );
    }

    #[test]
    fn openai_plain_prompt_request_uses_text_output_format() {
        let request = AiPromptRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            prompt: "Translate this.".to_string(),
            output_format: AiPromptOutputFormat::Text,
            prompt_blocks: None,
        };
        let payload = serde_json::to_value(build_prompt_request(&request)).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/type")
                .and_then(serde_json::Value::as_str),
            Some("text")
        );
        assert!(payload.pointer("/text/format/schema").is_none());
    }

    #[test]
    fn structured_output_schemas_keep_their_written_field_order() {
        let body = |output_format: AiPromptOutputFormat| {
            let request = AiPromptRequest {
                provider_id: AiProviderId::OpenAi,
                model_id: "gpt-6-astra".to_string(),
                prompt: "Review these rows.".to_string(),
                output_format,
                prompt_blocks: None,
            };
            serde_json::to_string(&build_prompt_request(&request)).unwrap()
        };
        let in_order = |text: &str, names: &[&str]| {
            let positions = names
                .iter()
                .map(|name| text.find(&format!("\"{name}\":{{")).unwrap())
                .collect::<Vec<_>>();
            positions.windows(2).all(|pair| pair[0] < pair[1])
        };

        let review = body(AiPromptOutputFormat::ReviewBatchJson);
        assert!(in_order(
            &review,
            &["rowId", "suggestedText", "suggestedFootnotes", "reviewed"]
        ));
        let translation = body(AiPromptOutputFormat::TranslationBatchJson);
        assert!(in_order(
            &translation,
            &["rowId", "translatedText", "translatedFootnote"]
        ));
    }

    #[test]
    fn openai_assistant_prompt_request_uses_strict_json_schema_output_format() {
        let request = AiPromptRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            prompt: "Return assistant JSON.".to_string(),
            output_format: AiPromptOutputFormat::AssistantTurnJson,
            prompt_blocks: None,
        };
        let payload = serde_json::to_value(build_prompt_request(&request)).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/type")
                .and_then(serde_json::Value::as_str),
            Some("json_schema")
        );
        assert_eq!(
            payload
                .pointer("/text/format/name")
                .and_then(serde_json::Value::as_str),
            Some("assistant_turn_response")
        );
        assert_eq!(
            payload
                .pointer("/text/format/strict")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/required")
                .and_then(serde_json::Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .collect::<Vec<_>>()
                }),
            Some(vec![
                "responseKind",
                "assistantText",
                "draftTranslationText"
            ])
        );
        assert!(payload.get("previous_response_id").is_none());
    }

    #[test]
    fn openai_glossary_alignment_prompt_request_uses_strict_json_schema_output_format() {
        let request = AiPromptRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            prompt: "Return glossary alignment JSON.".to_string(),
            output_format: AiPromptOutputFormat::GlossaryAlignmentJson,
            prompt_blocks: None,
        };
        let payload = serde_json::to_value(build_prompt_request(&request)).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/type")
                .and_then(serde_json::Value::as_str),
            Some("json_schema")
        );
        assert_eq!(
            payload
                .pointer("/text/format/name")
                .and_then(serde_json::Value::as_str),
            Some("glossary_alignment_response")
        );
        assert_eq!(
            payload
                .pointer("/text/format/strict")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/required/0")
                .and_then(serde_json::Value::as_str),
            Some("mappings")
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/properties/mappings/items/required")
                .and_then(serde_json::Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .collect::<Vec<_>>()
                }),
            Some(vec!["id", "translationSourceTerm"])
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/properties/mappings/items/properties/translationSourceTerm/anyOf/1/type")
                .and_then(serde_json::Value::as_str),
            Some("null")
        );
    }

    #[test]
    fn openai_translation_batch_prompt_request_uses_strict_rows_schema() {
        let request = AiPromptRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.5".to_string(),
            prompt: "Return batch translation JSON.".to_string(),
            output_format: AiPromptOutputFormat::TranslationBatchJson,
            prompt_blocks: None,
        };
        let payload = serde_json::to_value(build_prompt_request(&request)).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/type")
                .and_then(serde_json::Value::as_str),
            Some("json_schema")
        );
        assert_eq!(
            payload
                .pointer("/text/format/name")
                .and_then(serde_json::Value::as_str),
            Some("ai_translation_batch_response")
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/properties/rows/items/required")
                .and_then(serde_json::Value::as_array)
                .map(|values| values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .collect::<Vec<_>>()),
            Some(vec![
                "rowId",
                "translatedText",
                "translatedFootnote",
                "translatedImageCaption"
            ])
        );
    }

    #[test]
    fn openai_review_batch_prompt_request_uses_strict_rows_schema() {
        let request = AiPromptRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.5".to_string(),
            prompt: "Return batch review JSON.".to_string(),
            output_format: AiPromptOutputFormat::ReviewBatchJson,
            prompt_blocks: None,
        };
        let payload = serde_json::to_value(build_prompt_request(&request)).unwrap();

        assert_eq!(
            payload
                .pointer("/text/format/name")
                .and_then(serde_json::Value::as_str),
            Some("ai_review_batch_response")
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/properties/rows/items/properties/reviewed/type")
                .and_then(serde_json::Value::as_str),
            Some("boolean")
        );
        assert_eq!(
            payload
                .pointer("/text/format/schema/properties/rows/items/properties/suggestedFootnotes/items/properties/marker/minimum")
                .and_then(serde_json::Value::as_i64),
            Some(1)
        );
    }

    #[test]
    fn shortlist_recommended_models_keeps_recent_general_mini_nano_families() {
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
                id: "gpt-5.5".to_string(),
                label: "gpt-5.5".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-mini".to_string(),
                label: "gpt-5.5-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-nano".to_string(),
                label: "gpt-5.5-nano".to_string(),
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

        assert_eq!(
            ids,
            vec![
                "gpt-5.5",
                "gpt-5.5-mini",
                "gpt-5.5-nano",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.4-nano",
            ]
        );
    }

    #[test]
    fn shortlist_recommended_models_keeps_only_two_most_recent_versions() {
        let models = vec![
            AiProviderModel {
                id: "gpt-5.4".to_string(),
                label: "gpt-5.4".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-mini".to_string(),
                label: "gpt-5.4-mini".to_string(),
            },
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

        assert_eq!(
            ids,
            vec![
                "gpt-6",
                "gpt-6-mini",
                "gpt-6-nano",
                "gpt-5.5",
                "gpt-5.5-mini",
                "gpt-5.5-nano",
            ]
        );
    }

    #[test]
    fn shortlist_recommended_models_recognizes_sol_terra_luna_families() {
        let models = vec![
            AiProviderModel {
                id: "gpt-5.4".to_string(),
                label: "gpt-5.4".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.4-mini".to_string(),
                label: "gpt-5.4-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5".to_string(),
                label: "gpt-5.5".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-mini".to_string(),
                label: "gpt-5.5-mini".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.5-nano".to_string(),
                label: "gpt-5.5-nano".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.6-luna".to_string(),
                label: "gpt-5.6-luna".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.6-sol".to_string(),
                label: "gpt-5.6-sol".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.6-terra".to_string(),
                label: "gpt-5.6-terra".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.6-sol-2026-07-09".to_string(),
                label: "gpt-5.6-sol-2026-07-09".to_string(),
            },
        ];

        let recommended = shortlist_recommended_models(&models);
        let ids = recommended
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.5-mini",
                "gpt-5.5-nano",
            ]
        );
    }

    #[test]
    fn shortlist_recommended_models_orders_version_alias_before_sol() {
        let models = vec![
            AiProviderModel {
                id: "gpt-5.6-sol".to_string(),
                label: "gpt-5.6-sol".to_string(),
            },
            AiProviderModel {
                id: "gpt-5.6".to_string(),
                label: "gpt-5.6".to_string(),
            },
        ];

        let recommended = shortlist_recommended_models(&models);
        let ids = recommended
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["gpt-5.6", "gpt-5.6-sol"]);
    }

    #[test]
    fn shortlist_recommended_models_includes_astra_as_newest_version() {
        let models = [
            "gpt-5.5",
            "gpt-5.6-luna",
            "gpt-6-astra",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-6-astra-2026-09-01",
        ]
        .into_iter()
        .map(|id| AiProviderModel {
            id: id.to_string(),
            label: id.to_string(),
        })
        .collect::<Vec<_>>();

        let ids = shortlist_recommended_models(&models)
            .into_iter()
            .map(|model| model.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "gpt-6-astra",
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna"
            ]
        );
    }

    #[test]
    fn hidden_gpt_pro_models_are_excluded_from_picker() {
        assert!(is_hidden_gpt_pro_model("gpt-5.4-pro"));
        assert!(!is_hidden_gpt_pro_model("gpt-5.4"));
        assert!(!is_hidden_gpt_pro_model("o3-pro"));
    }

    fn sse(events: &[serde_json::Value]) -> String {
        events
            .iter()
            .map(|event| {
                format!(
                    "event: {}\ndata: {}\n\n",
                    event["type"].as_str().unwrap(),
                    event
                )
            })
            .collect()
    }

    #[test]
    fn streamed_response_yields_the_completed_response_object() {
        let completed = serde_json::json!({
            "id": "resp_1",
            "status": "completed",
            "output": [{"type": "message", "content": [
                {"type": "output_text", "text": "{\"translatedText\":\"Ánh sáng.\"}"}
            ]}],
            "usage": {"input_tokens": 37, "output_tokens": 18,
                      "input_tokens_details": {"cached_tokens": 0},
                      "output_tokens_details": {"reasoning_tokens": 0}}
        });
        let body = sse(&[
            serde_json::json!({"type": "response.created", "response": {"id": "resp_1", "status": "in_progress"}}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "{\"translated"}),
            serde_json::json!({"type": "response.completed", "response": completed}),
        ]);

        let payload: OpenAiResponsesCreateResponse =
            serde_json::from_value(completed_response_from_stream(&body).unwrap()).unwrap();

        assert_eq!(payload.usage.as_ref().unwrap().output_tokens, Some(18));
        assert_eq!(
            extract_suggested_text(payload, "empty").unwrap(),
            "{\"translatedText\":\"Ánh sáng.\"}"
        );
    }

    #[test]
    fn streamed_failures_and_cut_off_streams_are_errors() {
        let failed = sse(&[serde_json::json!({
            "type": "response.failed",
            "response": {"status": "failed", "error": {"code": "server_error", "message": "The server had an error."}}
        })]);
        assert_eq!(
            completed_response_from_stream(&failed).unwrap_err(),
            "OpenAI returned an error: The server had an error."
        );

        let error =
            sse(&[serde_json::json!({"type": "error", "code": "x", "message": "Bad things."})]);
        assert_eq!(
            completed_response_from_stream(&error).unwrap_err(),
            "OpenAI returned an error: Bad things."
        );

        let cut_off =
            sse(&[serde_json::json!({"type": "response.output_text.delta", "delta": "par"})]);
        assert!(completed_response_from_stream(&cut_off)
            .unwrap_err()
            .contains("ended before it was complete"));
    }

    #[test]
    fn stream_refusals_are_recognised_but_other_bad_requests_are_not() {
        let verification = r#"{"error":{"message":"Your organization must be verified to stream this model. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization.","type":"invalid_request_error","param":"stream","code":"unsupported_value"}}"#;
        assert!(is_stream_refusal(verification));

        let other = r#"{"error":{"message":"Invalid schema for response_format 't'.","type":"invalid_request_error"}}"#;
        assert!(!is_stream_refusal(other));
    }

    #[test]
    fn incomplete_responses_are_errors_not_truncated_text() {
        let incomplete = |reason: &str| -> OpenAiResponsesCreateResponse {
            serde_json::from_value(serde_json::json!({
                "status": "incomplete",
                "incomplete_details": {"reason": reason},
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "Half a transl"}]}]
            }))
            .unwrap()
        };

        assert!(incomplete_response_error(&incomplete("max_output_tokens"))
            .unwrap()
            .contains("output limit"));
        assert!(incomplete_response_error(&incomplete("content_filter"))
            .unwrap()
            .contains("content filter"));

        let completed: OpenAiResponsesCreateResponse =
            serde_json::from_value(serde_json::json!({"status": "completed"})).unwrap();
        assert!(incomplete_response_error(&completed).is_none());
        let unknown: OpenAiResponsesCreateResponse =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(incomplete_response_error(&unknown).is_none());
    }

    #[test]
    fn stream_refusals_are_remembered_per_api_key_and_model() {
        remember_refuses_streaming("sk-team-a", "gpt-test-refusal-memory");

        assert!(refuses_streaming("sk-team-a", "gpt-test-refusal-memory"));
        assert!(!refuses_streaming("sk-team-b", "gpt-test-refusal-memory"));
        assert!(!refuses_streaming("sk-team-a", "gpt-test-other-model"));
    }
}
