pub mod claude;
pub mod deepseek;
pub mod gemini;
pub mod openai;
mod schemas;
mod sse;

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

use crate::ai::types::{AiPromptRequest, AiPromptResponse, AiProviderId, AiProviderModel};

static SHARED_HTTP_CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

/// Total limit for a prompt run, including reading a streamed body (the blocking
/// client has no per-read idle timeout). Claude and OpenAI stream, so bytes keep
/// flowing and this only needs to exceed the longest legitimate generation: up
/// to 32K output tokens at high effort can take several minutes. The shared
/// client's 45 s default still fits model listings and probes.
pub(crate) const AI_PROMPT_TIMEOUT: Duration = Duration::from_secs(600);

/// A non-streaming request that has received no response bytes for about 60 s
/// can be dropped before our own timeout (observed 2026-09-25 with OpenAI and
/// Claude, via reqwest and curl alike: "peer closed connection without sending
/// TLS close_notify"). reqwest reports it as a generic request error, so it is
/// recognised by elapsed time. Claude and OpenAI stream
/// (plans/ai-prompt-streaming.md), so this mainly covers plain requests.
const SILENT_DROP_MIN_ELAPSED: Duration = Duration::from_secs(55);

/// The message for a prompt request that failed without a timeout or connect
/// error after running about a minute, or `None` for any other failure. The
/// wording avoids "timed out" / "connection closed" so the frontend reports it
/// to Sentry instead of classifying it as an offline condition.
pub(crate) fn silent_drop_message(
    provider_name: &str,
    is_timeout: bool,
    is_connect: bool,
    elapsed: Duration,
) -> Option<String> {
    (!is_timeout && !is_connect && elapsed >= SILENT_DROP_MIN_ELAPSED).then(|| {
        format!(
            "{provider_name} stopped responding after about a minute without returning a result. \
             If this error persists, please report it to the Gnosis TMS development team."
        )
    })
}

/// Maps a failure to send a prompt request (before any response arrived).
pub(crate) fn prompt_send_error(
    provider_name: &str,
    error: reqwest::Error,
    elapsed: Duration,
    normalize: fn(reqwest::Error) -> String,
) -> String {
    silent_drop_message(
        provider_name,
        error.is_timeout(),
        error.is_connect(),
        elapsed,
    )
    .unwrap_or_else(|| normalize(error))
}

/// Maps a failure while reading a prompt response, such as a stream cut off
/// partway or the overall time limit expiring mid-stream.
pub(crate) fn prompt_read_error(provider_name: &str, error: &reqwest::Error) -> String {
    read_failure_message(provider_name, error.is_timeout())
}

fn read_failure_message(provider_name: &str, is_timeout: bool) -> String {
    if is_timeout {
        format!("The {provider_name} request timed out. Try again.")
    } else {
        format!(
            "{provider_name} stopped responding before its response was complete. \
             If this error persists, please report it to the Gnosis TMS development team."
        )
    }
}

/// Debug builds log token and cache counts for prompts sent with cache
/// boundaries (`prompt_blocks`, currently only AI Assistant turns), so cache
/// hits can be checked in `npm run tauri:dev`. No prompt text is logged.
/// Claude reports uncached input, cache reads and cache writes separately;
/// OpenAI reports total input including cached tokens, and no writes.
pub(crate) fn log_prompt_cache_usage(
    provider_name: &str,
    request: &AiPromptRequest,
    input_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
) {
    if !cfg!(debug_assertions) || request.prompt_blocks.is_none() {
        return;
    }
    let count = |value: Option<u64>| value.map_or_else(|| "-".to_string(), |n| n.to_string());
    eprintln!(
        "[gtms ai-cache] provider={provider_name} model={} input={} cache_read={} cache_write={}",
        request.model_id.trim(),
        count(input_tokens),
        count(cache_read_tokens),
        count(cache_write_tokens),
    );
}

pub(crate) fn shared_http_client() -> Result<&'static reqwest::blocking::Client, String> {
    if let Some(client) = SHARED_HTTP_CLIENT.get() {
        return Ok(client);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not start the AI HTTP client: {error}"))?;
    let _ = SHARED_HTTP_CLIENT.set(client);

    SHARED_HTTP_CLIENT
        .get()
        .ok_or_else(|| "Could not access the shared AI HTTP client.".to_string())
}

pub(crate) fn list_models(
    provider_id: AiProviderId,
    api_key: &str,
) -> Result<Vec<AiProviderModel>, String> {
    match provider_id {
        AiProviderId::OpenAi => openai::list_models(api_key),
        AiProviderId::Gemini => gemini::list_models(api_key),
        AiProviderId::Claude => claude::list_models(api_key),
        AiProviderId::DeepSeek => deepseek::list_models(api_key),
    }
}

pub(crate) fn run_prompt(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<AiPromptResponse, String> {
    match request.provider_id {
        AiProviderId::OpenAi => openai::run_prompt(request, api_key),
        AiProviderId::Gemini => gemini::run_prompt(request, api_key),
        AiProviderId::Claude => claude::run_prompt(request, api_key),
        AiProviderId::DeepSeek => deepseek::run_prompt(request, api_key),
    }
}

/// Runs a prompt and returns the provider's token-usage report as JSON, for
/// providers that supply one (OpenAI and Claude; `None` otherwise). Used by
/// add-translation alignment, which logs usage per request.
pub(crate) fn run_prompt_with_usage(
    request: &AiPromptRequest,
    api_key: &str,
) -> Result<(AiPromptResponse, Option<Value>), String> {
    match request.provider_id {
        AiProviderId::OpenAi => {
            openai::run_prompt_with_usage(request, api_key).map(|(response, usage)| {
                (
                    response,
                    usage.and_then(|usage| serde_json::to_value(usage).ok()),
                )
            })
        }
        AiProviderId::Claude => claude::run_prompt_with_usage(request, api_key),
        AiProviderId::Gemini | AiProviderId::DeepSeek => {
            run_prompt(request, api_key).map(|response| (response, None))
        }
    }
}

pub(crate) fn probe_model(
    provider_id: AiProviderId,
    model_id: &str,
    api_key: &str,
) -> Result<(), String> {
    match provider_id {
        AiProviderId::OpenAi => openai::probe_model(model_id, api_key),
        AiProviderId::Gemini => gemini::probe_model(model_id, api_key),
        AiProviderId::Claude => claude::probe_model(model_id, api_key),
        AiProviderId::DeepSeek => deepseek::probe_model(model_id, api_key),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{read_failure_message, silent_drop_message};

    #[test]
    fn silent_drop_is_reported_only_for_long_generic_failures() {
        let message = silent_drop_message("OpenAI", false, false, Duration::from_secs(61)).unwrap();
        assert!(message.starts_with("OpenAI stopped responding after about a minute"));

        assert!(silent_drop_message("OpenAI", false, false, Duration::from_secs(20)).is_none());
        assert!(silent_drop_message("OpenAI", true, false, Duration::from_secs(61)).is_none());
        assert!(silent_drop_message("OpenAI", false, true, Duration::from_secs(61)).is_none());
    }

    #[test]
    fn read_failures_distinguish_timeouts_from_cut_off_streams() {
        assert_eq!(
            read_failure_message("Claude", true),
            "The Claude request timed out. Try again."
        );
        assert!(read_failure_message("Claude", false)
            .starts_with("Claude stopped responding before its response was complete."));
    }
}
