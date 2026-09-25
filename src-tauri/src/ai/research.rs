//! One streamed model request for Glossary Research.
//!
//! Research needs things the ordinary prompt path does not give: a cached
//! stable prefix (instructions + frozen entry) separate from the per-batch
//! content, an explicit output cap and effort, strict JSON output, the exact
//! token usage (the frontend enforces a spending limit from it), and a live
//! stream of thinking summaries and answer text for the research log.
//!
//! Streaming also keeps long answers clear of the ~60 s silent-drop problem of
//! non-streaming requests (see `providers::silent_drop_message`).
//!
//! Every outcome — including failures — is returned as `Ok(ResearchOutcome)`
//! so the frontend decides about retries and spending; nothing here is a crash.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::ai::load_ai_provider_api_key;
use crate::ai::providers::claude::claude_compatible_schema;
use crate::ai::providers::shared_http_client;
use crate::ai::types::AiProviderId;

pub(crate) const RESEARCH_STREAM_EVENT: &str = "glossary-research-stream";
const CLAUDE_MESSAGES_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION: &str = "2023-06-01";
const OPENAI_RESPONSES_API_URL: &str = "https://api.openai.com/v1/responses";
/// Whole-request ceiling. Streaming keeps bytes flowing, so this only stops a
/// request that is genuinely stuck.
const RESEARCH_REQUEST_TIMEOUT: Duration = Duration::from_secs(900);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchModelRequest {
    pub installation_id: Option<i64>,
    pub provider_id: AiProviderId,
    pub model_id: String,
    /// Identifies stream events and cancellation.
    pub request_id: String,
    /// Stable prefix; cached by the provider across a run's requests.
    pub instructions: String,
    /// Variable part (one batch).
    pub content: String,
    pub schema_name: String,
    pub schema: Value,
    pub effort: String,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchUsage {
    /// All input tokens, including cached and cache-written ones.
    pub input_tokens: u64,
    pub cached_tokens: u64,
    pub cache_write_tokens: u64,
    /// All output tokens, including thinking.
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub(crate) enum ResearchOutcome {
    /// Complete answer (the JSON text) with its usage.
    Ok { text: String, usage: ResearchUsage },
    /// The provider answered but the answer is unusable (output cap reached,
    /// safety refusal, empty). It was billed per `usage`.
    Incomplete {
        reason: String,
        usage: ResearchUsage,
    },
    /// No usable answer. `billed_unknown` means the provider may have billed
    /// work we could not measure (dropped stream, cancellation mid-answer);
    /// the frontend keeps the request's full cost reservation in that case.
    Failed {
        message: String,
        retryable: bool,
        billed_unknown: bool,
        usage: Option<ResearchUsage>,
    },
    Cancelled {
        billed_unknown: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEventPayload<'a> {
    request_id: &'a str,
    /// "thinking" (summary text) or "text" (answer text).
    kind: &'a str,
    delta: &'a str,
}

fn cancel_flags() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static FLAGS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn cancel_research_request(request_id: &str) {
    if let Ok(flags) = cancel_flags().lock() {
        if let Some(flag) = flags.get(request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

struct CancelGuard {
    request_id: String,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if let Ok(mut flags) = cancel_flags().lock() {
            flags.remove(&self.request_id);
        }
    }
}

/// Whether a provider can run Research: strict JSON output and usage reports.
pub(crate) fn provider_supports_research(provider_id: AiProviderId) -> bool {
    matches!(provider_id, AiProviderId::Claude | AiProviderId::OpenAi)
}

pub(crate) fn run_research_request(
    app: &AppHandle,
    request: ResearchModelRequest,
) -> Result<ResearchOutcome, String> {
    if !provider_supports_research(request.provider_id) {
        return Err(format!(
            "{} does not support glossary research.",
            request.provider_id.display_name()
        ));
    }
    if request.model_id.trim().is_empty() {
        return Err("Select a Research model on the AI Settings page first.".to_string());
    }
    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut flags) = cancel_flags().lock() {
        flags.insert(request.request_id.clone(), flag.clone());
    }
    let _guard = CancelGuard {
        request_id: request.request_id.clone(),
    };
    let emit = |kind: &str, delta: &str| {
        let _ = app.emit(
            RESEARCH_STREAM_EVENT,
            StreamEventPayload {
                request_id: &request.request_id,
                kind,
                delta,
            },
        );
    };
    let body = match request.provider_id {
        AiProviderId::Claude => claude_body(&request),
        _ => openai_body(&request),
    };
    let client = shared_http_client()?;
    let mut http = match request.provider_id {
        AiProviderId::Claude => client
            .post(CLAUDE_MESSAGES_API_URL)
            .header("x-api-key", api_key.trim())
            .header("anthropic-version", CLAUDE_API_VERSION),
        _ => client
            .post(OPENAI_RESPONSES_API_URL)
            .header("Authorization", format!("Bearer {}", api_key.trim())),
    };
    http = http
        .timeout(RESEARCH_REQUEST_TIMEOUT)
        .header("content-type", "application/json")
        .header("User-Agent", "gnosis-tms");
    let response = match http.json(&body).send() {
        Ok(response) => response,
        Err(error) => {
            // Nothing was received; whether the provider started work is unknown.
            return Ok(ResearchOutcome::Failed {
                message: transport_message(request.provider_id, &error),
                retryable: true,
                billed_unknown: !error.is_connect(),
                usage: None,
            });
        }
    };
    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Ok(http_failure(request.provider_id, status.as_u16(), &text));
    }
    let reader = BufReader::new(response);
    let mut state = StreamState::default();
    let result = match request.provider_id {
        AiProviderId::Claude => read_sse(reader, &flag, |event, data| {
            claude_event(&mut state, event, data, &emit)
        }),
        _ => read_sse(reader, &flag, |event, data| {
            openai_event(&mut state, event, data, &emit)
        }),
    };
    Ok(finish(request.provider_id, state, result))
}

// --- request bodies ------------------------------------------------------------

pub(crate) fn claude_body(request: &ResearchModelRequest) -> Value {
    json!({
        "model": request.model_id.trim(),
        "max_tokens": request.max_output_tokens,
        "stream": true,
        // Thinking is always on for current models; summaries feed the log.
        "thinking": {"type": "adaptive", "display": "summarized"},
        "system": [{
            "type": "text",
            "text": request.instructions,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": request.content}],
        "output_config": {
            "effort": request.effort,
            "format": {
                "type": "json_schema",
                "schema": claude_compatible_schema(&request.schema),
            },
        },
        // No refusal fallback: a study must not silently switch models.
    })
}

pub(crate) fn openai_body(request: &ResearchModelRequest) -> Value {
    json!({
        "model": request.model_id.trim(),
        "store": false,
        "stream": true,
        "max_output_tokens": request.max_output_tokens,
        "reasoning": {"effort": request.effort, "summary": "auto"},
        "prompt_cache_options": {"mode": "explicit"},
        "text": {
            "format": {
                "type": "json_schema",
                "name": request.schema_name,
                "strict": true,
                "schema": request.schema,
            },
            "verbosity": "low",
        },
        "input": [
            {"role": "developer", "content": [{
                "type": "input_text",
                "text": request.instructions,
                "prompt_cache_breakpoint": {"mode": "explicit"},
            }]},
            {"role": "user", "content": [{
                "type": "input_text",
                "text": request.content,
            }]},
        ],
    })
}

// --- stream reading ----------------------------------------------------------

#[derive(Debug, Default)]
pub(crate) struct StreamState {
    text: String,
    usage: ResearchUsage,
    usage_seen: bool,
    stop_reason: Option<String>,
    refusal_category: Option<String>,
    error: Option<String>,
    completed: bool,
}

enum ReadEnd {
    Finished,
    Cancelled,
    Broken(String),
}

/// Minimal server-sent-events reader: `event:` + `data:` lines, blank line
/// ends an event.  The callback returns false to stop reading.
fn read_sse<R: BufRead>(
    reader: R,
    cancel: &AtomicBool,
    mut on_event: impl FnMut(&str, &str) -> bool,
) -> ReadEnd {
    let mut event = String::new();
    let mut data = String::new();
    for line in reader.lines() {
        if cancel.load(Ordering::SeqCst) {
            return ReadEnd::Cancelled;
        }
        let line = match line {
            Ok(line) => line,
            Err(error) => return ReadEnd::Broken(error.to_string()),
        };
        if line.is_empty() {
            if !data.is_empty() && !on_event(&event, &data) {
                return ReadEnd::Finished;
            }
            event.clear();
            data.clear();
        } else if let Some(rest) = line.strip_prefix("event:") {
            event = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    if !data.is_empty() {
        on_event(&event, &data);
    }
    ReadEnd::Finished
}

fn number(value: &Value, pointer: &str) -> u64 {
    value.pointer(pointer).and_then(Value::as_u64).unwrap_or(0)
}

pub(crate) fn claude_event(
    state: &mut StreamState,
    event: &str,
    data: &str,
    emit: &impl Fn(&str, &str),
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return true;
    };
    let kind = value.get("type").and_then(Value::as_str).unwrap_or(event);
    match kind {
        "message_start" => {
            let usage = value.pointer("/message/usage").cloned().unwrap_or_default();
            let fresh = number(&usage, "/input_tokens");
            let read = number(&usage, "/cache_read_input_tokens");
            let write = number(&usage, "/cache_creation_input_tokens");
            state.usage.input_tokens = fresh + read + write;
            state.usage.cached_tokens = read;
            state.usage.cache_write_tokens = write;
            state.usage.output_tokens = number(&usage, "/output_tokens");
            state.usage_seen = true;
        }
        "content_block_delta" => match value.pointer("/delta/type").and_then(Value::as_str) {
            Some("text_delta") => {
                let delta = value.pointer("/delta/text").and_then(Value::as_str).unwrap_or("");
                state.text.push_str(delta);
                emit("text", delta);
            }
            Some("thinking_delta") => {
                let delta = value
                    .pointer("/delta/thinking")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                emit("thinking", delta);
            }
            _ => {}
        },
        "message_delta" => {
            if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                state.stop_reason = Some(reason.to_string());
            }
            if let Some(category) = value
                .pointer("/delta/stop_details/category")
                .and_then(Value::as_str)
            {
                state.refusal_category = Some(category.to_string());
            }
            if let Some(usage) = value.get("usage") {
                // Cumulative output count, thinking included.
                state.usage.output_tokens = number(usage, "/output_tokens");
                state.usage.reasoning_tokens =
                    number(usage, "/output_tokens_details/thinking_tokens");
            }
        }
        "message_stop" => {
            state.completed = true;
            return false;
        }
        "error" => {
            state.error = Some(
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Claude reported an error while answering.")
                    .to_string(),
            );
            return false;
        }
        _ => {}
    }
    true
}

pub(crate) fn openai_event(
    state: &mut StreamState,
    event: &str,
    data: &str,
    emit: &impl Fn(&str, &str),
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return true;
    };
    let kind = value.get("type").and_then(Value::as_str).unwrap_or(event);
    match kind {
        "response.output_text.delta" => {
            let delta = value.get("delta").and_then(Value::as_str).unwrap_or("");
            state.text.push_str(delta);
            emit("text", delta);
        }
        "response.reasoning_summary_text.delta" => {
            let delta = value.get("delta").and_then(Value::as_str).unwrap_or("");
            emit("thinking", delta);
        }
        "response.refusal.delta" => {
            state.stop_reason = Some("refusal".to_string());
        }
        "response.completed" | "response.incomplete" | "response.failed" => {
            let response = value.get("response").cloned().unwrap_or_default();
            if let Some(usage) = response.get("usage") {
                state.usage.input_tokens = number(usage, "/input_tokens");
                state.usage.cached_tokens = number(usage, "/input_tokens_details/cached_tokens");
                state.usage.cache_write_tokens =
                    number(usage, "/input_tokens_details/cache_write_tokens");
                state.usage.output_tokens = number(usage, "/output_tokens");
                state.usage.reasoning_tokens =
                    number(usage, "/output_tokens_details/reasoning_tokens");
                state.usage_seen = true;
            }
            match kind {
                "response.completed" => state.completed = true,
                "response.incomplete" => {
                    state.stop_reason = Some(
                        response
                            .pointer("/incomplete_details/reason")
                            .and_then(Value::as_str)
                            .unwrap_or("incomplete")
                            .to_string(),
                    )
                }
                _ => {
                    state.error = Some(
                        response
                            .pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("OpenAI reported a failed response.")
                            .to_string(),
                    )
                }
            }
            return false;
        }
        "error" => {
            state.error = Some(
                value
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("OpenAI reported an error while answering.")
                    .to_string(),
            );
            return false;
        }
        _ => {}
    }
    true
}

fn finish(provider_id: AiProviderId, state: StreamState, end: ReadEnd) -> ResearchOutcome {
    let name = provider_id.display_name();
    let usage = state.usage.clone();
    match end {
        ReadEnd::Cancelled => {
            return ResearchOutcome::Cancelled {
                billed_unknown: true,
            }
        }
        ReadEnd::Broken(error) => {
            return ResearchOutcome::Failed {
                message: format!("The connection to {name} broke while it was answering: {error}"),
                retryable: true,
                billed_unknown: true,
                usage: state.usage_seen.then_some(usage),
            }
        }
        ReadEnd::Finished => {}
    }
    if let Some(error) = state.error {
        return ResearchOutcome::Failed {
            message: format!("{name}: {error}"),
            retryable: true,
            billed_unknown: !state.usage_seen,
            usage: state.usage_seen.then_some(usage),
        };
    }
    match state.stop_reason.as_deref() {
        Some("refusal") => {
            return ResearchOutcome::Incomplete {
                reason: match state.refusal_category {
                    Some(category) => format!("refusal ({category})"),
                    None => "refusal".to_string(),
                },
                usage,
            }
        }
        Some("max_tokens") | Some("max_output_tokens") => {
            return ResearchOutcome::Incomplete {
                reason: "max_tokens".to_string(),
                usage,
            }
        }
        _ => {}
    }
    if !state.completed {
        return ResearchOutcome::Failed {
            message: format!("{name} ended the answer early."),
            retryable: true,
            billed_unknown: true,
            usage: state.usage_seen.then_some(usage),
        };
    }
    if state.text.trim().is_empty() {
        return ResearchOutcome::Incomplete {
            reason: "empty".to_string(),
            usage,
        };
    }
    ResearchOutcome::Ok {
        text: state.text,
        usage,
    }
}

fn transport_message(provider_id: AiProviderId, error: &reqwest::Error) -> String {
    let name = provider_id.display_name();
    if error.is_timeout() {
        format!("The {name} request timed out.")
    } else if error.is_connect() {
        format!("The app could not reach {name}. Check the internet connection.")
    } else {
        format!("The {name} request failed before an answer arrived.")
    }
}

fn http_failure(provider_id: AiProviderId, status: u16, body: &str) -> ResearchOutcome {
    let name = provider_id.display_name();
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let message = match status {
        401 | 403 => format!("{name} rejected the saved API key. Check it on the AI Settings page."),
        429 => format!("{name} is rate-limiting requests. {detail}"),
        _ if detail.is_empty() => format!("{name} returned HTTP {status}."),
        // Error messages never include key material from our side.
        _ => format!("{name} returned HTTP {status}: {detail}"),
    };
    ResearchOutcome::Failed {
        message: message.trim().to_string(),
        retryable: matches!(status, 408 | 409 | 429 | 500..=599),
        billed_unknown: false,
        usage: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn request(provider_id: AiProviderId) -> ResearchModelRequest {
        ResearchModelRequest {
            installation_id: None,
            provider_id,
            model_id: "m".into(),
            request_id: "r1".into(),
            instructions: "I".into(),
            content: "C".into(),
            schema_name: "s".into(),
            schema: json!({"type": "object", "properties": {"a": {"type": "string", "maxLength": 3}},
                           "required": ["a"], "additionalProperties": false}),
            effort: "low".into(),
            max_output_tokens: 900,
        }
    }

    fn run_stream(provider: AiProviderId, stream: &str) -> (ResearchOutcome, Vec<(String, String)>) {
        let emitted = std::cell::RefCell::new(Vec::new());
        let emit = |kind: &str, delta: &str| emitted.borrow_mut().push((kind.to_string(), delta.to_string()));
        let mut state = StreamState::default();
        let flag = AtomicBool::new(false);
        let end = match provider {
            AiProviderId::Claude => read_sse(Cursor::new(stream), &flag, |e, d| claude_event(&mut state, e, d, &emit)),
            _ => read_sse(Cursor::new(stream), &flag, |e, d| openai_event(&mut state, e, d, &emit)),
        };
        (finish(provider, state, end), emitted.into_inner())
    }

    #[test]
    fn claude_body_caches_the_prefix_and_sends_schema_effort_and_cap() {
        let body = claude_body(&request(AiProviderId::Claude));
        assert_eq!(body.pointer("/system/0/cache_control/type"), Some(&json!("ephemeral")));
        assert_eq!(body.pointer("/output_config/effort"), Some(&json!("low")));
        assert_eq!(body.pointer("/max_tokens"), Some(&json!(900)));
        assert_eq!(body.pointer("/thinking/display"), Some(&json!("summarized")));
        assert!(body.pointer("/output_config/format/schema/properties/a/maxLength").is_none());
        assert!(body.get("fallbacks").is_none());
    }

    #[test]
    fn openai_body_uses_an_explicit_breakpoint_and_strict_schema() {
        let body = openai_body(&request(AiProviderId::OpenAi));
        assert_eq!(body.pointer("/input/0/content/0/prompt_cache_breakpoint/mode"), Some(&json!("explicit")));
        assert_eq!(body.pointer("/text/format/strict"), Some(&json!(true)));
        assert_eq!(body.pointer("/reasoning/summary"), Some(&json!("auto")));
    }

    #[test]
    fn claude_stream_yields_text_thinking_and_full_usage() {
        let stream = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_read_input_tokens\":1000,\"cache_creation_input_tokens\":50,\"output_tokens\":1}}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"{\\\"a\\\":\"}}\n\n\
event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"\\\"x\\\"}\"}}\n\n\
event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":42}}\n\n\
event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let (outcome, emitted) = run_stream(AiProviderId::Claude, stream);
        assert_eq!(outcome, ResearchOutcome::Ok {
            text: "{\"a\":\"x\"}".into(),
            usage: ResearchUsage { input_tokens: 1060, cached_tokens: 1000, cache_write_tokens: 50,
                                   output_tokens: 42, reasoning_tokens: 0 },
        });
        assert_eq!(emitted[0], ("thinking".to_string(), "hmm".to_string()));
    }

    #[test]
    fn claude_output_cap_and_refusal_are_incomplete_not_ok() {
        let capped = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"},\"usage\":{\"output_tokens\":900}}\n\n\
data: {\"type\":\"message_stop\"}\n\n";
        assert!(matches!(run_stream(AiProviderId::Claude, capped).0,
                         ResearchOutcome::Incomplete { ref reason, .. } if reason == "max_tokens"));
        let refused = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n\
data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\",\"stop_details\":{\"category\":\"bio\"}},\"usage\":{\"output_tokens\":3}}\n\n\
data: {\"type\":\"message_stop\"}\n\n";
        assert!(matches!(run_stream(AiProviderId::Claude, refused).0,
                         ResearchOutcome::Incomplete { ref reason, .. } if reason == "refusal (bio)"));
    }

    #[test]
    fn a_stream_that_stops_early_may_have_been_billed() {
        let cut = "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n";
        assert!(matches!(run_stream(AiProviderId::Claude, cut).0,
                         ResearchOutcome::Failed { billed_unknown: true, .. }));
    }

    #[test]
    fn openai_stream_reads_usage_from_the_completed_event() {
        let stream = "event: response.reasoning_summary_text.delta\ndata: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"plan\"}\n\n\
event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"{}\"}\n\n\
event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":100,\"input_tokens_details\":{\"cached_tokens\":60,\"cache_write_tokens\":20},\"output_tokens\":30,\"output_tokens_details\":{\"reasoning_tokens\":12}}}}\n\n";
        let (outcome, emitted) = run_stream(AiProviderId::OpenAi, stream);
        assert_eq!(outcome, ResearchOutcome::Ok {
            text: "{}".into(),
            usage: ResearchUsage { input_tokens: 100, cached_tokens: 60, cache_write_tokens: 20,
                                   output_tokens: 30, reasoning_tokens: 12 },
        });
        assert_eq!(emitted[0].0, "thinking");
    }

    #[test]
    fn http_errors_never_echo_keys_and_classify_retries() {
        let outcome = http_failure(AiProviderId::Claude, 401, "{\"error\":{\"message\":\"invalid x-api-key sk-ant-XYZ\"}}");
        match outcome {
            ResearchOutcome::Failed { message, retryable, .. } => {
                assert!(!message.contains("sk-ant"));
                assert!(!retryable);
            }
            _ => panic!(),
        }
        assert!(matches!(http_failure(AiProviderId::OpenAi, 529, ""),
                         ResearchOutcome::Failed { retryable: true, .. }));
    }
}
