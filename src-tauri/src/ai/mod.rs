pub mod providers;
pub mod types;

use tauri::AppHandle;

use crate::ai::types::{AiReviewRequest, AiReviewResponse};
use crate::ai_secret_storage::load_ai_provider_secret;

pub(crate) fn run_ai_review(
    app: &AppHandle,
    request: AiReviewRequest,
) -> Result<AiReviewResponse, String> {
    if request.text.trim().is_empty() {
        return Err("There is no text to review yet.".to_string());
    }

    let api_key = load_ai_provider_secret(app, request.provider_id)?.ok_or_else(|| {
        "No OpenAI API key is saved yet. Open the AI Key page and save one first.".to_string()
    })?;

    providers::run_review(&request, &api_key)
}
