pub mod claude;
pub mod deepseek;
pub mod gemini;
pub mod openai;

use std::sync::OnceLock;
use std::time::Duration;

use crate::ai::types::{AiPromptRequest, AiPromptResponse, AiProviderId, AiProviderModel};

static SHARED_HTTP_CLIENT: OnceLock<Result<reqwest::blocking::Client, String>> = OnceLock::new();

pub(crate) fn shared_http_client() -> Result<&'static reqwest::blocking::Client, String> {
    SHARED_HTTP_CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|error| format!("Could not start the AI HTTP client: {error}"))
        })
        .as_ref()
        .map_err(|error| error.clone())
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
