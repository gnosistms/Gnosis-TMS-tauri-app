use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum AiProviderId {
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "deepseek")]
    DeepSeek,
}

impl AiProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
            Self::Claude => "claude",
            Self::DeepSeek => "deepseek",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::OpenAi => "OpenAI",
            Self::Gemini => "Gemini",
            Self::Claude => "Claude",
            Self::DeepSeek => "DeepSeek",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub text: String,
    pub language_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewResponse {
    pub suggested_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationGlossaryHint {
    pub source_term: String,
    #[serde(default)]
    pub target_variants: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslatedGlossaryTermInput {
    #[serde(default)]
    pub glossary_source_terms: Vec<String>,
    #[serde(default)]
    pub target_variants: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslatedGlossaryEntry {
    pub source_term: String,
    pub glossary_source_term: String,
    #[serde(default)]
    pub target_variants: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslatedGlossaryPreparationRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub translation_source_text: String,
    pub translation_source_language: String,
    pub glossary_source_language: String,
    pub target_language: String,
    #[serde(default)]
    pub glossary_source_text: String,
    #[serde(default)]
    pub glossary_terms: Vec<AiTranslatedGlossaryTermInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslatedGlossaryPreparationResponse {
    pub glossary_source_text: String,
    #[serde(default)]
    pub entries: Vec<AiTranslatedGlossaryEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub text: String,
    pub source_language: String,
    pub target_language: String,
    #[serde(default)]
    pub glossary_hints: Vec<AiTranslationGlossaryHint>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationResponse {
    pub translated_text: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiPromptRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub prompt: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiPromptResponse {
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModel {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelProbeRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
}
