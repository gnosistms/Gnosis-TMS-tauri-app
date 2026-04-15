pub mod providers;
pub mod types;

use tauri::AppHandle;

use crate::ai::types::{
    AiModelProbeRequest, AiPromptRequest, AiProviderId, AiProviderModel, AiReviewRequest,
    AiReviewResponse, AiTranslationGlossaryHint, AiTranslationRequest, AiTranslationResponse,
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

pub(crate) fn build_translation_prompt(request: &AiTranslationRequest) -> String {
    let source_language = request.source_language.trim();
    let target_language = request.target_language.trim();
    let source_label = if source_language.is_empty() {
        "the source language"
    } else {
        source_language
    };
    let target_label = if target_language.is_empty() {
        "the target language"
    } else {
        target_language
    };
    let glossary_hints = format_translation_glossary_hints(&request.glossary_hints);

    if glossary_hints.is_empty() {
        return format!(
            "Translate {source_label} to {target_label}, outputting only the translation: {}",
            request.text
        );
    }

    format!(
        "Translate {source_label} to {target_label}, outputting only the translation.\n\nGlossary hints:\n- Apply a glossary hint only when its sourceTerm appears in the source text.\n- targetVariants is sorted in order of preference, best first. Use later variants only when grammar or context requires it.\n- Use notes as translation guidance when they are present.\n\n{glossary_hints}\n\nSource text:\n{}",
        request.text
    )
}

fn format_translation_glossary_hints(hints: &[AiTranslationGlossaryHint]) -> String {
    hints.iter()
        .filter_map(|hint| {
            let source_term = hint.source_term.trim();
            let target_variants = hint
                .target_variants
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            let notes = hint
                .notes
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if source_term.is_empty() || (target_variants.is_empty() && notes.is_empty()) {
                return None;
            }

            let mut lines = vec![format!("- sourceTerm: \"{source_term}\"")];
            if !target_variants.is_empty() {
                lines.push(format!(
                    "  targetVariants: {}",
                    target_variants
                        .iter()
                        .map(|value| format!("\"{value}\""))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
            if !notes.is_empty() {
                lines.push(format!(
                    "  notes: {}",
                    notes
                        .iter()
                        .map(|value| format!("\"{value}\""))
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }

            Some(lines.join("\n"))
        })
        .collect::<Vec<_>>()
        .join("\n")
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

    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: build_review_prompt(&request),
        },
        &api_key,
    )?;

    Ok(AiReviewResponse {
        suggested_text: response.text,
    })
}

pub(crate) fn run_ai_translation(
    app: &AppHandle,
    request: AiTranslationRequest,
) -> Result<AiTranslationResponse, String> {
    if request.text.trim().is_empty() {
        return Err("There is no source text to translate yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Translate.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_secret(app, request.provider_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            request.provider_id.display_name()
        )
    })?;

    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: build_translation_prompt(&request),
        },
        &api_key,
    )?;

    Ok(AiTranslationResponse {
        translated_text: response.text,
    })
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

#[cfg(test)]
mod tests {
    use super::build_translation_prompt;
    use crate::ai::types::{AiProviderId, AiTranslationGlossaryHint, AiTranslationRequest};

    #[test]
    fn build_translation_prompt_keeps_plain_prompt_when_no_glossary_hints_are_present() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Hola".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
        });

        assert_eq!(
            prompt,
            "Translate Spanish to Vietnamese, outputting only the translation: Hola"
        );
    }

    #[test]
    fn build_translation_prompt_includes_glossary_hints_with_preference_guidance() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La gnostica habla.".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "gnostica".to_string(),
                target_variants: vec![
                    "hoc tro gnosis".to_string(),
                    "cua gnosis".to_string(),
                ],
                notes: vec!["Lien quan den Gnosis".to_string()],
            }],
        });

        assert!(prompt.contains(
            "targetVariants is sorted in order of preference, best first. Use later variants only when grammar or context requires it."
        ));
        assert!(prompt.contains("- sourceTerm: \"gnostica\""));
        assert!(prompt.contains("  targetVariants: \"hoc tro gnosis\", \"cua gnosis\""));
        assert!(prompt.contains("  notes: \"Lien quan den Gnosis\""));
        assert!(prompt.contains("Source text:\nLa gnostica habla."));
    }
}
