pub mod claude;
pub mod deepseek;
pub mod gemini;
pub mod openai;
mod schemas;

use std::sync::OnceLock;
use std::time::Duration;

use crate::ai::types::{AiPromptRequest, AiPromptResponse, AiProviderId, AiProviderModel};

static SHARED_HTTP_CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

/// Per-request override for prompt runs. The shared client's 45s default fits model
/// listings and probes, but long generations on reasoning-heavy models routinely need
/// more; without streaming the whole response must finish inside this window.
pub(crate) const AI_PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

/// A non-streaming prompt that has sent no response bytes for about 60 s can be
/// dropped before our own timeout (observed with OpenAI, 2026-09-25: "peer
/// closed connection without sending TLS close_notify"). reqwest reports it as
/// a generic request error, so it is recognised by elapsed time. Streaming
/// would avoid it; see plans/claude-opus-5-5-support.md.
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::silent_drop_message;

    #[test]
    fn silent_drop_is_reported_only_for_long_generic_failures() {
        let message = silent_drop_message("OpenAI", false, false, Duration::from_secs(61)).unwrap();
        assert!(message.starts_with("OpenAI stopped responding after about a minute"));

        assert!(silent_drop_message("OpenAI", false, false, Duration::from_secs(20)).is_none());
        assert!(silent_drop_message("OpenAI", true, false, Duration::from_secs(61)).is_none());
        assert!(silent_drop_message("OpenAI", false, true, Duration::from_secs(61)).is_none());
    }
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
