pub mod providers;
pub mod types;

use tauri::AppHandle;

use crate::ai::types::{
    AiModelProbeRequest, AiProviderId, AiProviderModel, AiReviewRequest, AiReviewResponse,
};
use crate::ai_secret_storage::load_ai_provider_secret;

pub(crate) fn build_review_prompt(request: &AiReviewRequest) -> String {
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

pub(crate) fn load_ai_provider_models(
    app: &AppHandle,
    provider_id: AiProviderId,
) -> Result<Vec<AiProviderModel>, String> {
    let api_key = load_ai_provider_secret(app, provider_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            provider_id.display_name()
        )
    })?;

    providers::list_models(provider_id, &api_key)
}

pub(crate) fn run_ai_review(
    app: &AppHandle,
    request: AiReviewRequest,
) -> Result<AiReviewResponse, String> {
    if request.text.trim().is_empty() {
        return Err("There is no text to review yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Review.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_secret(app, request.provider_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            request.provider_id.display_name()
        )
    })?;

    providers::run_review(&request, &api_key)
}

pub(crate) fn probe_ai_model(
    app: &AppHandle,
    request: AiModelProbeRequest,
) -> Result<(), String> {
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page first.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_secret(app, request.provider_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            request.provider_id.display_name()
        )
    })?;

    providers::probe_model(request.provider_id, request.model_id.trim(), &api_key)
}
