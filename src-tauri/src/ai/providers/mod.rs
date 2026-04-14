pub mod openai;

use crate::ai::types::{AiProviderId, AiReviewRequest, AiReviewResponse};

pub(crate) fn run_review(
    request: &AiReviewRequest,
    api_key: &str,
) -> Result<AiReviewResponse, String> {
    match request.provider_id {
        AiProviderId::OpenAi => openai::run_review(request, api_key),
    }
}
