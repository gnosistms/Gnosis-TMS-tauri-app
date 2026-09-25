use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::ai::{
    providers::{schemas, shared_http_client, sse},
    types::{AiPromptOutputFormat, AiPromptRequest, AiPromptResponse, AiProviderModel},
};

const CLAUDE_API_VERSION: &str = "2023-06-01";
const CLAUDE_MODELS_API_URL: &str = "https://api.anthropic.com/v1/models";
const CLAUDE_MESSAGES_API_URL: &str = "https://api.anthropic.com/v1/messages";
// The Messages API requires max_tokens, and on current models (Opus 5.5 cannot
// disable thinking) the model's thinking counts against it. 32K leaves room for
// thinking plus a full batch; only generated tokens are billed.
const CLAUDE_MAX_OUTPUT_TOKENS: u32 = 32_000;
// The probe is judged by HTTP status only; a little headroom avoids any edge
// case with always-on thinking and a 1-token budget.
const CLAUDE_PROBE_MAX_OUTPUT_TOKENS: u32 = 16;
// Server-side refusal fallback: when a safety classifier declines a request
// (a false positive on, say, a medical text), the API reruns it on Anthropic's
// recommended fallback model inside the same call instead of failing.
const CLAUDE_FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const CLAUDE_FALLBACK_MODE: &str = "default";
// Structured outputs reject numeric, string-length, and complex array
// constraints; the app's parsers validate these values after the response.
const UNSUPPORTED_SCHEMA_KEYWORDS: [&str; 8] = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
];

/// Thinking depth per AI action, sent explicitly (Opus 5.5 defaults to
/// `medium`). Calibrated on HNHH ch. 3, es→vi (plans/claude-opus-5-5-support.md):
/// translation at `low`/`medium` did no thinking and ranked below `high` in a
/// blind comparison; review at `low` skipped thinking and missed 8 of 9 planted
/// errors, while `medium` fixed all 9 at lower cost than `high`. `Text` covers
/// plain translation, plain-mode review, and glossary preparation. The
/// assistant and glossary alignment were not calibrated.
fn effort_for(output_format: &AiPromptOutputFormat) -> &'static str {
    match output_format {
        AiPromptOutputFormat::Text
        | AiPromptOutputFormat::TranslationSectionsJson
        | AiPromptOutputFormat::TranslationBatchJson => "high",
        AiPromptOutputFormat::ReviewJson
        | AiPromptOutputFormat::ReviewBatchJson
        | AiPromptOutputFormat::AssistantTurnJson
        | AiPromptOutputFormat::GlossaryAlignmentJson
        | AiPromptOutputFormat::JsonSchema { .. } => "medium",
    }
}

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
    #[serde(default)]
    capabilities: Option<Value>,
}

/// What a model accepts. Older models reject `effort` (Haiku 4.5, Sonnet 4.5)
/// or lack structured outputs, and the model picker lists every model the key
/// can use, so request fields are gated per model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ClaudeModelCapabilities {
    effort: bool,
    structured_outputs: bool,
}

impl ClaudeModelCapabilities {
    // Current models support both; a model entry without a capability tree is
    // treated as current.
    const CURRENT: Self = Self {
        effort: true,
        structured_outputs: true,
    };
    // Used when the capability lookup fails: a plain request every Claude model
    // accepts. Built-in JSON formats still work through the prompt's JSON
    // instructions and the tolerant parsers.
    const BASIC: Self = Self {
        effort: false,
        structured_outputs: false,
    };

    fn from_capabilities(capabilities: Option<&Value>) -> Self {
        let Some(capabilities) = capabilities else {
            return Self::CURRENT;
        };
        let supported = |pointer: &str| {
            capabilities
                .pointer(pointer)
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };
        Self {
            effort: supported("/effort/supported"),
            structured_outputs: supported("/structured_outputs/supported"),
        }
    }
}

static MODEL_CAPABILITIES: OnceLock<Mutex<HashMap<String, ClaudeModelCapabilities>>> =
    OnceLock::new();
// Serializes cache-miss lookups so concurrent batch calls fetch a model's
// capabilities once instead of each issuing the same request.
static CAPABILITY_LOOKUP: Mutex<()> = Mutex::new(());

fn capability_cache() -> &'static Mutex<HashMap<String, ClaudeModelCapabilities>> {
    MODEL_CAPABILITIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_capabilities(model_id: &str, capabilities: ClaudeModelCapabilities) {
    if let Ok(mut cache) = capability_cache().lock() {
        cache.insert(model_id.to_string(), capabilities);
    }
}

fn cached_capabilities(model_id: &str) -> Option<ClaudeModelCapabilities> {
    capability_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(model_id).copied())
}

fn model_capabilities(
    client: &reqwest::blocking::Client,
    api_key: &str,
    model_id: &str,
) -> ClaudeModelCapabilities {
    if let Some(capabilities) = cached_capabilities(model_id) {
        return capabilities;
    }
    let _lookup_guard = CAPABILITY_LOOKUP
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(capabilities) = cached_capabilities(model_id) {
        return capabilities;
    }

    let lookup = client
        .get(format!("{CLAUDE_MODELS_API_URL}/{model_id}"))
        .header("x-api-key", api_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .send()
        .ok()
        .filter(|response| response.status().is_success())
        .and_then(|response| response.json::<ClaudeModelEntry>().ok());

    match lookup {
        Some(entry) => {
            let capabilities =
                ClaudeModelCapabilities::from_capabilities(entry.capabilities.as_ref());
            remember_capabilities(model_id, capabilities);
            capabilities
        }
        // A failed lookup is not cached, so the next request retries it. Until
        // then, send only what every model accepts rather than risk a 400 on an
        // older model; the prompt request itself reports any real connectivity
        // or key problem.
        None => ClaudeModelCapabilities::BASIC,
    }
}

/// Models whose safety classifiers can return `stop_reason: "refusal"` and that
/// accept the server-side fallback parameter.
fn supports_refusal_fallback(model_id: &str) -> bool {
    model_id.starts_with("claude-opus-5") || model_id.starts_with("claude-fable-5")
}

#[derive(Debug, Serialize)]
struct ClaudeMessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ClaudeMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_config: Option<ClaudeOutputConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fallbacks: Option<&'static str>,
    // Prompt runs stream so response bytes keep flowing; a connection that
    // receives nothing for 60 s can be cut off (plans/ai-prompt-streaming.md).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ClaudeOutputConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ClaudeMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Default, Deserialize)]
struct ClaudeMessagesResponse {
    #[serde(default)]
    content: Vec<ClaudeContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    stop_details: Option<ClaudeStopDetails>,
    #[serde(default)]
    usage: Option<Value>,
}

#[derive(Debug, Default, Deserialize)]
struct ClaudeContentBlock {
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Default, Deserialize)]
struct ClaudeStopDetails {
    #[serde(default)]
    category: Option<String>,
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
        // The default page is 20 models; ask for all of them in one page.
        .query(&[("limit", "1000")])
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
            remember_capabilities(
                &id,
                ClaudeModelCapabilities::from_capabilities(model.capabilities.as_ref()),
            );
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

/// Removes schema keywords Claude's structured outputs reject. Keys of a
/// `properties` map are field names, not keywords, so they are never stripped.
fn claude_compatible_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(object) => {
            let mut cleaned = Map::new();
            for (key, value) in object {
                if UNSUPPORTED_SCHEMA_KEYWORDS.contains(&key.as_str()) {
                    continue;
                }
                if key == "minItems" && value.as_u64().is_some_and(|count| count > 1) {
                    continue;
                }
                let cleaned_value = match (key.as_str(), value) {
                    ("properties" | "$defs" | "definitions", Value::Object(fields)) => {
                        Value::Object(
                            fields
                                .iter()
                                .map(|(name, field)| {
                                    (name.clone(), claude_compatible_schema(field))
                                })
                                .collect(),
                        )
                    }
                    _ => claude_compatible_schema(value),
                };
                cleaned.insert(key.clone(), cleaned_value);
            }
            Value::Object(cleaned)
        }
        Value::Array(items) => Value::Array(items.iter().map(claude_compatible_schema).collect()),
        other => other.clone(),
    }
}

fn build_prompt_request<'a>(
    request: &'a AiPromptRequest,
    model_id: &'a str,
    capabilities: ClaudeModelCapabilities,
    effort_override: Option<&'static str>,
) -> Result<ClaudeMessagesRequest<'a>, String> {
    let format = match schemas::output_schema(&request.output_format) {
        Some(output) if capabilities.structured_outputs => Some(json!({
            "type": "json_schema",
            "schema": claude_compatible_schema(&output.schema),
        })),
        // Built-in JSON formats fall back to the prompt's JSON instructions and
        // the tolerant parsers; a caller-supplied schema has no such fallback.
        Some(_)
            if matches!(
                request.output_format,
                AiPromptOutputFormat::JsonSchema { .. }
            ) =>
        {
            return Err(format!(
                "The Claude model {model_id} does not support structured JSON output. \
                 Choose a newer Claude model in AI Settings."
            ));
        }
        _ => None,
    };
    let effort = capabilities
        .effort
        .then(|| effort_override.unwrap_or_else(|| effort_for(&request.output_format)));
    let output_config =
        (effort.is_some() || format.is_some()).then_some(ClaudeOutputConfig { effort, format });

    Ok(ClaudeMessagesRequest {
        model: model_id,
        max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
        messages: vec![ClaudeMessage {
            role: "user",
            content: &request.prompt,
        }],
        output_config,
        fallbacks: supports_refusal_fallback(model_id).then_some(CLAUDE_FALLBACK_MODE),
        stream: true,
    })
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    let (text, _usage) = execute_prompt(request, api_key, None)?;

    Ok(AiPromptResponse { text })
}

/// Runs a prompt at a forced effort level and returns the provider's usage
/// report. Used by the effort-calibration harness (`ai::effort_eval`).
#[cfg(test)]
pub(crate) fn run_prompt_with_effort(
    request: &AiPromptRequest,
    api_key: &str,
    effort: &'static str,
) -> Result<(String, Option<Value>), String> {
    execute_prompt(request, api_key, Some(effort))
}

fn execute_prompt(
    request: &AiPromptRequest,
    api_key: &str,
    effort_override: Option<&'static str>,
) -> Result<(String, Option<Value>), String> {
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
    let capabilities = model_capabilities(client, normalized_key, model_id);
    let body = build_prompt_request(request, model_id, capabilities, effort_override)?;

    let mut http_request = client
        .post(CLAUDE_MESSAGES_API_URL)
        .timeout(super::AI_PROMPT_TIMEOUT)
        .header("x-api-key", normalized_key)
        .header("anthropic-version", CLAUDE_API_VERSION)
        .header("content-type", "application/json");
    if body.fallbacks.is_some() {
        http_request = http_request.header("anthropic-beta", CLAUDE_FALLBACK_BETA);
    }
    let started = std::time::Instant::now();
    let response = http_request.json(&body).send().map_err(|error| {
        super::prompt_send_error(
            "Claude",
            error,
            started.elapsed(),
            normalize_transport_error,
        )
    })?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| super::prompt_read_error("Claude", &error))?;

    if !status.is_success() {
        return Err(normalize_http_error(status, &body));
    }

    // A plain JSON body means the stream was not honored; parse it as-is.
    if body.trim_start().starts_with('{') {
        return normalize_messages_response(&body);
    }
    interpret_messages_response(assemble_streamed_response(&body)?)
}

/// Rebuilds the response a non-streaming call would return from the event
/// stream: text per content block (thinking and fallback blocks keep their
/// type and no text), stop reason and details, and the final usage report.
/// After a mid-answer safety decline with server-side fallback, the stream
/// keeps the partial text and the fallback model continues it, so the text
/// blocks joined in order are the complete answer.
fn assemble_streamed_response(body: &str) -> Result<ClaudeMessagesResponse, String> {
    let mut response = ClaudeMessagesResponse::default();
    let mut blocks: Vec<ClaudeContentBlock> = Vec::new();
    let mut finished = false;

    for event in sse::parse_events(body) {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else {
            continue;
        };
        match data.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message_start" => {
                response.usage = data.pointer("/message/usage").cloned();
            }
            "content_block_start" => {
                let index = data.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if blocks.len() <= index {
                    blocks.resize_with(index + 1, ClaudeContentBlock::default);
                }
                blocks[index].kind = data
                    .pointer("/content_block/type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
            }
            "content_block_delta" => {
                let index = data.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if data.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    if let (Some(block), Some(text)) = (
                        blocks.get_mut(index),
                        data.pointer("/delta/text").and_then(Value::as_str),
                    ) {
                        block.text.push_str(text);
                    }
                }
            }
            "message_delta" => {
                response.stop_reason = data
                    .pointer("/delta/stop_reason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                response.stop_details = data
                    .pointer("/delta/stop_details")
                    .filter(|details| !details.is_null())
                    .and_then(|details| serde_json::from_value(details.clone()).ok());
                if let Some(usage) = data.get("usage").filter(|usage| !usage.is_null()) {
                    response.usage = Some(usage.clone());
                }
            }
            "message_stop" => finished = true,
            "error" => {
                let kind = data.pointer("/error/type").and_then(Value::as_str);
                let message = data
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim();
                return Err(match kind {
                    Some("overloaded_error") | Some("api_error") => {
                        "Claude is temporarily unavailable. Try again in a moment.".to_string()
                    }
                    _ if !message.is_empty() => format!("Claude returned an error: {message}"),
                    _ => "Claude returned an unexpected error.".to_string(),
                });
            }
            _ => {}
        }
    }

    if !finished {
        return Err("Claude's response ended before it was complete. Try again.".to_string());
    }
    response.content = blocks;
    Ok(response)
}

fn normalize_messages_response(body: &str) -> Result<(String, Option<Value>), String> {
    let payload: ClaudeMessagesResponse = serde_json::from_str(body)
        .map_err(|_| "Claude returned a malformed response.".to_string())?;
    interpret_messages_response(payload)
}

fn interpret_messages_response(
    payload: ClaudeMessagesResponse,
) -> Result<(String, Option<Value>), String> {
    // A safety-classifier decline is an HTTP 200; any content is partial and
    // will not match the requested format.
    if payload.stop_reason.as_deref() == Some("refusal") {
        let category = payload
            .stop_details
            .and_then(|details| details.category)
            .map(|category| category.trim().to_string())
            .filter(|category| !category.is_empty());
        return Err(match category {
            Some(category) => format!(
                "Claude's safety filter declined this request (category: {category}). \
                 Try again, or choose a different AI model for this text."
            ),
            None => "Claude's safety filter declined this request. \
                     Try again, or choose a different AI model for this text."
                .to_string(),
        });
    }
    // A max_tokens stop means the text is incomplete — returning it as success would
    // silently hand the user a truncated translation (or unparsable JSON).
    if payload.stop_reason.as_deref() == Some("max_tokens") {
        return Err(
            "Claude stopped before finishing because the response hit the output limit. \
             Try a shorter text."
                .to_string(),
        );
    }

    // Responses can carry thinking blocks (empty text) and fallback markers ahead
    // of the answer; only text blocks are the answer.
    let text = payload
        .content
        .into_iter()
        .filter(|block| block.kind == "text")
        .map(|block| block.text)
        .collect::<String>();

    if text.trim().is_empty() {
        return Err("Claude returned an empty response.".to_string());
    }

    Ok((text, payload.usage))
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
            max_tokens: CLAUDE_PROBE_MAX_OUTPUT_TOKENS,
            messages: vec![ClaudeMessage {
                role: "user",
                content: "Reply with OK.",
            }],
            output_config: None,
            fallbacks: None,
            stream: false,
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

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        assemble_streamed_response, build_prompt_request, claude_compatible_schema,
        interpret_messages_response, normalize_messages_response, ClaudeModelCapabilities,
        CLAUDE_MAX_OUTPUT_TOKENS,
    };
    use crate::ai::types::{AiPromptOutputFormat, AiPromptRequest, AiProviderId};

    fn prompt_request(model_id: &str, output_format: AiPromptOutputFormat) -> AiPromptRequest {
        AiPromptRequest {
            provider_id: AiProviderId::Claude,
            model_id: model_id.to_string(),
            prompt: "Translate this.".to_string(),
            output_format,
        }
    }

    fn request_body(
        model_id: &str,
        output_format: AiPromptOutputFormat,
        capabilities: ClaudeModelCapabilities,
    ) -> Value {
        let request = prompt_request(model_id, output_format);
        serde_json::to_value(build_prompt_request(&request, model_id, capabilities, None).unwrap())
            .unwrap()
    }

    #[test]
    fn json_formats_send_a_structured_output_schema_and_effort() {
        for output_format in [
            AiPromptOutputFormat::AssistantTurnJson,
            AiPromptOutputFormat::TranslationSectionsJson,
            AiPromptOutputFormat::ReviewJson,
            AiPromptOutputFormat::TranslationBatchJson,
            AiPromptOutputFormat::ReviewBatchJson,
            AiPromptOutputFormat::GlossaryAlignmentJson,
        ] {
            let body = request_body(
                "claude-opus-5-5",
                output_format.clone(),
                ClaudeModelCapabilities::CURRENT,
            );

            assert_eq!(
                body.pointer("/output_config/format/type")
                    .and_then(Value::as_str),
                Some("json_schema"),
                "{output_format:?}"
            );
            assert_eq!(
                body.pointer("/output_config/format/schema/additionalProperties")
                    .and_then(Value::as_bool),
                Some(false),
                "{output_format:?}"
            );
            let expected_effort = match output_format {
                AiPromptOutputFormat::TranslationSectionsJson
                | AiPromptOutputFormat::TranslationBatchJson => "high",
                _ => "medium",
            };
            assert_eq!(
                body.pointer("/output_config/effort")
                    .and_then(Value::as_str),
                Some(expected_effort),
                "{output_format:?}"
            );
            assert_eq!(
                body.pointer("/max_tokens").and_then(Value::as_u64),
                Some(u64::from(CLAUDE_MAX_OUTPUT_TOKENS))
            );
            assert!(
                body.get("thinking").is_none(),
                "thinking is adaptive by default"
            );
        }
    }

    #[test]
    fn text_format_sends_effort_without_a_schema() {
        let body = request_body(
            "claude-opus-5-5",
            AiPromptOutputFormat::Text,
            ClaudeModelCapabilities::CURRENT,
        );

        assert!(body.pointer("/output_config/format").is_none());
        assert_eq!(
            body.pointer("/output_config/effort")
                .and_then(Value::as_str),
            Some("high")
        );
    }

    #[test]
    fn review_schema_drops_marker_minimum_for_claude() {
        let body = request_body(
            "claude-opus-5-5",
            AiPromptOutputFormat::ReviewBatchJson,
            ClaudeModelCapabilities::CURRENT,
        );
        let marker = body
            .pointer(
                "/output_config/format/schema/properties/rows/items/properties/suggestedFootnotes/items/properties/marker",
            )
            .unwrap();

        assert_eq!(marker, &json!({ "type": "integer" }));
    }

    #[test]
    fn compatible_schema_keeps_fields_named_like_keywords() {
        let schema = json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["minimum"],
            "properties": {
                "minimum": { "type": "number", "minimum": 0, "maximum": 100 },
                "items": { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 4 }
            }
        });

        assert_eq!(
            claude_compatible_schema(&schema),
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["minimum"],
                "properties": {
                    "minimum": { "type": "number" },
                    "items": { "type": "array", "items": { "type": "string" } }
                }
            })
        );
    }

    #[test]
    fn caller_supplied_schema_is_sent_to_capable_models() {
        let body = request_body(
            "claude-opus-5-5",
            AiPromptOutputFormat::JsonSchema {
                name: "custom".to_string(),
                schema: json!({ "type": "object", "additionalProperties": false, "properties": {} }),
            },
            ClaudeModelCapabilities::CURRENT,
        );

        assert_eq!(
            body.pointer("/output_config/format/schema/type")
                .and_then(Value::as_str),
            Some("object")
        );
    }

    #[test]
    fn older_models_get_neither_effort_nor_schema() {
        let legacy = ClaudeModelCapabilities {
            effort: false,
            structured_outputs: false,
        };
        let body = request_body("claude-3-haiku", AiPromptOutputFormat::ReviewJson, legacy);

        assert!(body.get("output_config").is_none());
        assert!(body.get("fallbacks").is_none());

        let request = prompt_request(
            "claude-3-haiku",
            AiPromptOutputFormat::JsonSchema {
                name: "custom".to_string(),
                schema: json!({ "type": "object" }),
            },
        );
        assert!(build_prompt_request(&request, "claude-3-haiku", legacy, None).is_err());
    }

    #[test]
    fn refusal_fallback_is_requested_only_for_classifier_models() {
        let opus = request_body(
            "claude-opus-5-5",
            AiPromptOutputFormat::Text,
            ClaudeModelCapabilities::CURRENT,
        );
        let sonnet = request_body(
            "claude-sonnet-5",
            AiPromptOutputFormat::Text,
            ClaudeModelCapabilities::CURRENT,
        );

        assert_eq!(
            opus.get("fallbacks").and_then(Value::as_str),
            Some("default")
        );
        assert!(sonnet.get("fallbacks").is_none());
    }

    #[test]
    fn capabilities_are_read_from_the_models_api_tree() {
        let haiku = json!({
            "structured_outputs": { "supported": true },
            "effort": { "supported": false }
        });

        assert_eq!(
            ClaudeModelCapabilities::from_capabilities(Some(&haiku)),
            ClaudeModelCapabilities {
                effort: false,
                structured_outputs: true,
            }
        );
        assert_eq!(
            ClaudeModelCapabilities::from_capabilities(None),
            ClaudeModelCapabilities::CURRENT
        );
    }

    #[test]
    fn messages_response_skips_thinking_and_fallback_blocks() {
        let body = r#"{
            "content": [
                { "type": "thinking", "thinking": "", "signature": "sig" },
                { "type": "fallback", "from": { "model": "claude-opus-5-5" }, "to": { "model": "claude-opus-5" } },
                { "type": "text", "text": "{\"translatedText\":\"Xin chào.\"}" }
            ],
            "stop_reason": "end_turn"
        }"#;

        assert_eq!(
            normalize_messages_response(body).unwrap().0,
            "{\"translatedText\":\"Xin chào.\"}"
        );
    }

    #[test]
    fn messages_response_reports_refusals_with_category() {
        let body = r#"{
            "content": [],
            "stop_reason": "refusal",
            "stop_details": { "type": "refusal", "category": "bio", "explanation": null }
        }"#;

        let error = normalize_messages_response(body).unwrap_err();

        assert!(error.contains("safety filter"), "got: {error}");
        assert!(error.contains("bio"), "got: {error}");
    }

    #[test]
    fn messages_response_concatenates_text_blocks() {
        let body = r#"{
            "content": [
                { "type": "text", "text": "Xin " },
                { "type": "text", "text": "chào." }
            ],
            "stop_reason": "end_turn"
        }"#;

        assert_eq!(normalize_messages_response(body).unwrap().0, "Xin chào.");
    }

    #[test]
    fn messages_response_rejects_max_tokens_truncation() {
        let body = r#"{
            "content": [
                { "type": "text", "text": "Half a translation that was cut" }
            ],
            "stop_reason": "max_tokens"
        }"#;

        let error = normalize_messages_response(body).unwrap_err();

        assert!(error.contains("output limit"), "got: {error}");
    }

    #[test]
    fn messages_response_rejects_empty_output() {
        let body = r#"{ "content": [], "stop_reason": "end_turn" }"#;

        let error = normalize_messages_response(body).unwrap_err();

        assert_eq!(error, "Claude returned an empty response.");
    }

    fn sse(events: &[Value]) -> String {
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
    fn prompt_requests_stream() {
        let body = request_body(
            "claude-opus-5-5",
            AiPromptOutputFormat::Text,
            ClaudeModelCapabilities::CURRENT,
        );

        assert_eq!(body.get("stream").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn streamed_response_joins_text_blocks_across_a_fallback() {
        let body = sse(&[
            json!({"type": "message_start", "message": {"usage": {"input_tokens": 216}}}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig"}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "ping"}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "{\"translatedText\":\"Ánh "}}),
            json!({"type": "content_block_start", "index": 2, "content_block": {"type": "fallback"}}),
            json!({"type": "content_block_start", "index": 3, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 3, "delta": {"type": "text_delta", "text": "sáng.\"}"}}),
            json!({"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_details": null},
                   "usage": {"input_tokens": 216, "output_tokens": 24, "output_tokens_details": {"thinking_tokens": 3}}}),
            json!({"type": "message_stop"}),
        ]);

        let (text, usage) =
            interpret_messages_response(assemble_streamed_response(&body).unwrap()).unwrap();

        assert_eq!(text, "{\"translatedText\":\"Ánh sáng.\"}");
        let usage = usage.unwrap();
        assert_eq!(usage["output_tokens"], json!(24));
        assert_eq!(usage["output_tokens_details"]["thinking_tokens"], json!(3));
    }

    #[test]
    fn streamed_refusal_is_reported_with_its_category() {
        let body = sse(&[
            json!({"type": "message_start", "message": {"usage": {"input_tokens": 10}}}),
            json!({"type": "message_delta", "delta": {"stop_reason": "refusal",
                   "stop_details": {"type": "refusal", "category": "bio"}}, "usage": {"output_tokens": 0}}),
            json!({"type": "message_stop"}),
        ]);

        let error =
            interpret_messages_response(assemble_streamed_response(&body).unwrap()).unwrap_err();

        assert!(error.contains("safety filter"), "got: {error}");
        assert!(error.contains("bio"), "got: {error}");
    }

    #[test]
    fn streamed_max_tokens_stop_is_an_error() {
        let body = sse(&[
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "{\"rows\":["}}),
            json!({"type": "message_delta", "delta": {"stop_reason": "max_tokens"}, "usage": {"output_tokens": 32000}}),
            json!({"type": "message_stop"}),
        ]);

        let error =
            interpret_messages_response(assemble_streamed_response(&body).unwrap()).unwrap_err();

        assert!(error.contains("output limit"), "got: {error}");
    }

    #[test]
    fn streamed_error_events_and_cut_off_streams_fail() {
        let overloaded = sse(&[
            json!({"type": "message_start", "message": {"usage": {}}}),
            json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
        ]);
        assert_eq!(
            assemble_streamed_response(&overloaded).unwrap_err(),
            "Claude is temporarily unavailable. Try again in a moment."
        );

        let cut_off = sse(&[
            json!({"type": "message_start", "message": {"usage": {}}}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "partial"}}),
        ]);
        assert!(assemble_streamed_response(&cut_off)
            .unwrap_err()
            .contains("ended before it was complete"));
    }
}
