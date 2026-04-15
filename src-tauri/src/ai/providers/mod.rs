pub mod claude;
pub mod deepseek;
pub mod gemini;
pub mod openai;

use crate::ai::types::{AiProviderId, AiProviderModel, AiReviewRequest, AiReviewResponse};

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

pub(crate) fn run_review(
    request: &AiReviewRequest,
    api_key: &str,
) -> Result<AiReviewResponse, String> {
    match request.provider_id {
        AiProviderId::OpenAi => openai::run_review(request, api_key),
        AiProviderId::Gemini => gemini::run_review(request, api_key),
        AiProviderId::Claude => claude::run_review(request, api_key),
        AiProviderId::DeepSeek => deepseek::run_review(request, api_key),
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
