use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum AiProviderId {
    #[serde(rename = "openai")]
    OpenAi,
}

impl AiProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewRequest {
    pub provider_id: AiProviderId,
    pub text: String,
    pub language_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewResponse {
    pub suggested_text: String,
}
