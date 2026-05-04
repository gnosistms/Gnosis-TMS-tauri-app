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
    #[serde(default)]
    pub review_mode: Option<String>,
    #[serde(default)]
    pub latest_translation: Option<String>,
    #[serde(default)]
    pub source_text: Option<String>,
    #[serde(default)]
    pub glossary_hints: Vec<AiTranslationGlossaryHint>,
    #[serde(default)]
    pub installation_id: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewResponse {
    pub suggested_text: String,
    #[serde(default)]
    pub reviewed: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationGlossaryHint {
    pub source_term: String,
    #[serde(default)]
    pub target_variants: Vec<String>,
    #[serde(default)]
    pub no_translation_position: Option<String>,
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
    #[serde(default)]
    pub installation_id: Option<i64>,
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
    #[serde(default)]
    pub installation_id: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslationResponse {
    pub translated_text: String,
    #[serde(default)]
    pub prompt_text: String,
    #[serde(default)]
    pub provider_continuation: Option<AiProviderContinuationMetadata>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiPromptRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub prompt: String,
    pub previous_response_id: Option<String>,
    pub output_format: AiPromptOutputFormat,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AiPromptResponse {
    pub text: String,
    pub provider_response_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiPromptOutputFormat {
    Text,
    AssistantTurnJson,
    ReviewJson,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderContinuationMetadata {
    #[serde(default)]
    pub previous_response_id: Option<String>,
    #[serde(default)]
    pub provider_response_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiAssistantTurnKind {
    Chat,
    TranslateRefinement,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantTranscriptEntry {
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantRowLanguageText {
    #[serde(default)]
    pub language_code: String,
    #[serde(default)]
    pub language_label: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantTargetLanguageHistoryEntry {
    #[serde(default)]
    pub revision_number: usize,
    #[serde(default)]
    pub source_type: String,
    #[serde(default)]
    pub source_label: String,
    #[serde(default)]
    pub author_type: String,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub author_login: String,
    #[serde(default)]
    pub author_email: String,
    #[serde(default)]
    pub operation_type: Option<String>,
    #[serde(default)]
    pub ai_model: Option<String>,
    #[serde(default)]
    pub committed_at: String,
    #[serde(default)]
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantRowContext {
    #[serde(default)]
    pub row_id: String,
    #[serde(default)]
    pub source_language_code: String,
    #[serde(default)]
    pub source_language_label: String,
    #[serde(default)]
    pub source_text: String,
    #[serde(default)]
    pub target_language_code: String,
    #[serde(default)]
    pub target_language_label: String,
    #[serde(default)]
    pub target_text: String,
    #[serde(default)]
    pub updated_source_text: Option<String>,
    #[serde(default)]
    pub updated_target_text: Option<String>,
    #[serde(default)]
    pub alternate_language_texts: Vec<AiAssistantRowLanguageText>,
    #[serde(default)]
    pub target_language_history: Vec<AiAssistantTargetLanguageHistoryEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantRowWindowEntry {
    #[serde(default)]
    pub row_id: String,
    #[serde(default)]
    pub source_text: String,
    #[serde(default)]
    pub target_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantConcordanceHit {
    #[serde(default)]
    pub row_id: String,
    #[serde(default)]
    pub source_snippet: String,
    #[serde(default)]
    pub target_snippet: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantTurnRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub kind: AiAssistantTurnKind,
    #[serde(default)]
    pub user_message: String,
    #[serde(default)]
    pub transcript: Vec<AiAssistantTranscriptEntry>,
    pub row: AiAssistantRowContext,
    #[serde(default)]
    pub row_window: Vec<AiAssistantRowWindowEntry>,
    #[serde(default)]
    pub glossary_hints: Vec<AiTranslationGlossaryHint>,
    #[serde(default)]
    pub document_digest: String,
    #[serde(default)]
    pub document_revision_key: String,
    #[serde(default)]
    pub concordance_hits: Vec<AiAssistantConcordanceHit>,
    #[serde(default)]
    pub reply_language_hint: String,
    #[serde(default)]
    pub installation_id: Option<i64>,
    #[serde(default)]
    pub provider_continuation: Option<AiProviderContinuationMetadata>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistantTurnResponse {
    pub assistant_text: String,
    #[serde(default)]
    pub draft_translation_text: Option<String>,
    #[serde(default)]
    pub prompt_text: String,
    #[serde(default)]
    pub provider_continuation: Option<AiProviderContinuationMetadata>,
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
    #[serde(default)]
    pub installation_id: Option<i64>,
}
