pub mod providers;
pub mod types;

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::ai::types::{
    AiAssistantConcordanceHit, AiAssistantRowContext, AiAssistantRowWindowEntry,
    AiAssistantTargetLanguageHistoryEntry, AiAssistantTranscriptEntry, AiAssistantTurnKind,
    AiAssistantTurnRequest, AiAssistantTurnResponse, AiModelProbeRequest, AiPromptOutputFormat,
    AiPromptRequest, AiProviderContinuationMetadata, AiProviderId, AiProviderModel,
    AiReviewRequest, AiReviewResponse, AiTranslatedGlossaryEntry,
    AiTranslatedGlossaryPreparationRequest, AiTranslatedGlossaryPreparationResponse,
    AiTranslatedGlossaryTermInput, AiTranslationGlossaryHint, AiTranslationGlossaryTargetVariant,
    AiTranslationGlossaryTargetVariantObject, AiTranslationNoTranslationHint, AiTranslationRequest,
    AiTranslationResponse,
};
use crate::ai_secret_storage::load_ai_provider_secret;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiReviewStructuredResponse {
    #[serde(default)]
    suggested_text: String,
    #[serde(default)]
    suggested_footnote: String,
    #[serde(default)]
    suggested_image_caption: String,
    reviewed: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiTranslationSectionsStructuredResponse {
    #[serde(default)]
    translated_text: String,
    #[serde(default)]
    translated_footnote: String,
    #[serde(default)]
    translated_image_caption: String,
}

fn normalize_review_mode(request: &AiReviewRequest) -> Option<&str> {
    match request.review_mode.as_deref().unwrap_or("").trim() {
        "grammar" => Some("grammar"),
        "meaning" => Some("meaning"),
        _ => None,
    }
}

fn review_response_contract() -> &'static str {
    "Return only valid JSON:\n{\"suggestedText\":\"\",\"suggestedFootnote\":\"\",\"suggestedImageCaption\":\"\",\"reviewed\":true}"
}

fn format_optional_tagged_section(tag: &str, value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("<{tag}>\n{trimmed}\n</{tag}>"))
    }
}

fn format_review_target_sections(
    latest_translation: &str,
    footnote: &str,
    image_caption: &str,
) -> String {
    let mut sections = Vec::new();
    sections.push(format!(
        "<latest_translation>\n{latest_translation}\n</latest_translation>"
    ));
    if let Some(section) = format_optional_tagged_section("latest_footnote", footnote) {
        sections.push(section);
    }
    if let Some(section) = format_optional_tagged_section("latest_image_caption", image_caption) {
        sections.push(section);
    }
    sections.join("\n\n")
}

fn format_review_source_sections(
    source_text: &str,
    source_footnote: &str,
    source_image_caption: &str,
) -> String {
    let mut sections = Vec::new();
    sections.push(format!("<source_text>\n{source_text}\n</source_text>"));
    if let Some(section) = format_optional_tagged_section("source_footnote", source_footnote) {
        sections.push(section);
    }
    if let Some(section) =
        format_optional_tagged_section("source_image_caption", source_image_caption)
    {
        sections.push(section);
    }
    sections.join("\n\n")
}

pub(crate) fn build_review_prompt(request: &AiReviewRequest) -> String {
    if let Some(review_mode) = normalize_review_mode(request) {
        let latest_translation = request
            .latest_translation
            .as_deref()
            .unwrap_or(&request.text)
            .trim();
        if review_mode == "meaning" {
            let glossary_info = format_translation_glossary_hints(&request.glossary_hints);
            let glossary_info = if glossary_info.trim().is_empty() {
                "No glossary terms found in the source text.".to_string()
            } else {
                glossary_info
            };
            let source_text = request.source_text.as_deref().unwrap_or("").trim();
            let source_sections = format_review_source_sections(
                source_text,
                &request.source_footnote,
                &request.source_image_caption,
            );
            let target_sections = format_review_target_sections(
                latest_translation,
                &request.footnote,
                &request.image_caption,
            );
            let row = AiAssistantRowContext {
                row_id: String::new(),
                source_language_code: request.source_language_code.clone(),
                source_language_label: request.source_language.clone(),
                source_text: source_text.to_string(),
                target_language_code: if request.target_language_code.trim().is_empty() {
                    request.language_code.clone()
                } else {
                    request.target_language_code.clone()
                },
                target_language_label: request.target_language.clone(),
                target_text: latest_translation.to_string(),
                updated_source_text: None,
                updated_target_text: None,
                alternate_language_texts: request.alternate_language_texts.clone(),
                target_language_history: request.target_language_history.clone(),
            };
            let source_context = format_assistant_source_context(&request.row_window, source_text);
            let source_language =
                format_language_ref(&request.source_language, &request.source_language_code);
            let target_language = format_language_ref(
                &request.target_language,
                if request.target_language_code.trim().is_empty() {
                    &request.language_code
                } else {
                    &request.target_language_code
                },
            );
            let target_language_history = format_assistant_target_language_history(
                &row.target_language_history,
                latest_translation,
            );
            let reference_translations = format_assistant_reference_translations(&row);
            let mut sections = Vec::new();
            sections.push(review_response_contract().to_string());
            sections.push(
                "Task:\nReview the latest target-language sections against the source-language sections for translation accuracy, spelling, and grammar. When evaluating translation accuracy, respect the user's choice of words unless there is a real error in the translation. Pay attention to the target-language history. Notice which edits are from humans and which are from AI. If a human has edited an AI translation, do not revert those human changes unless they introduced a real translation, spelling, or grammar error."
                    .to_string(),
            );
            sections.push(
                "Decision rule:\n- If every reviewed section is correct: set all suggested fields to empty strings and reviewed to true.\n- If any section has errors: set reviewed to false and put corrected content only in the matching suggested field. Keep unchanged sections as empty strings."
                    .to_string(),
            );
            sections.push(
                "Use supporting context when relevant. Do not treat reference translations or edit history as more authoritative than the source-language sections. Keep main text, footnotes, and image captions separate."
                    .to_string(),
            );
            sections.push(format!(
                "<languages>\nsource: {source_language}\ntarget: {target_language}\n</languages>"
            ));
            sections.push(format!(
                "<glossary_info format=\"json\">\n{glossary_info}\n</glossary_info>"
            ));
            sections.push(format!(
                "<target_language_history>\n{target_language_history}\n</target_language_history>"
            ));
            sections.push(format!(
                "<reference_translations>\nThe following translations into other languages may have errors. Use them only as context when source_text is ambiguous.\n\n{reference_translations}\n</reference_translations>"
            ));
            sections.push(format!(
                "<source_context>\nThis is the source text in context, provided to help you understand source_text more clearly:\n\n{source_context}\n</source_context>"
            ));
            sections.push(format!(
                "<review_item>\nThese are the only sections you are reviewing.\n\n{source_sections}\n\n{target_sections}\n</review_item>"
            ));
            sections.push(review_response_contract().to_string());
            return sections.join("\n\n");
        }

        let target_sections = format_review_target_sections(
            latest_translation,
            &request.footnote,
            &request.image_caption,
        );
        let sections = [
            review_response_contract().to_string(),
            "Task:\nReview the target-language sections only for spelling and grammar errors. Do not review translation accuracy or compare them against source text.".to_string(),
            "Decision rule:\n- If every reviewed section is correct: set all suggested fields to empty strings and reviewed to true.\n- If any section has errors: set reviewed to false and put corrected content only in the matching suggested field. Keep unchanged sections as empty strings.".to_string(),
            "Preserve the meaning, terminology, tone, and style unless a change is needed to correct spelling or grammar. Keep main text, footnotes, and image captions separate.".to_string(),
            format!(
                "<review_item>\nThese are the only sections you are reviewing.\n\n{target_sections}\n</review_item>"
            ),
            review_response_contract().to_string(),
        ];
        return sections.join("\n\n");
    }

    let language_code = request.language_code.trim();
    if language_code.is_empty() {
        format!(
            "Check spelling and grammar on the following text. Output only your suggested revised version of the text. Do not explain what you changed and why. If the text to review is already correct, do not change anything.\n\nText to review:\n{}",
            request.text
        )
    } else {
        format!(
            "Check spelling and grammar on the following text. Output only your suggested revised version of the text. Do not explain what you changed and why. If the text to review is already correct, do not change anything.\n\nLanguage code: {language_code}\n\nText to review:\n{}",
            request.text
        )
    }
}

fn parse_review_structured_response(text: &str) -> Result<AiReviewResponse, String> {
    let trimmed = text.trim();
    let stripped = strip_markdown_code_fence(trimmed);
    let object_slice = trimmed
        .find('{')
        .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]));

    for candidate in [trimmed, stripped]
        .into_iter()
        .chain(object_slice.into_iter())
    {
        if let Ok(mut parsed) = serde_json::from_str::<AiReviewStructuredResponse>(candidate) {
            if parsed.reviewed {
                parsed.suggested_text.clear();
                parsed.suggested_footnote.clear();
                parsed.suggested_image_caption.clear();
            }
            return Ok(AiReviewResponse {
                suggested_text: parsed.suggested_text,
                suggested_footnote: parsed.suggested_footnote,
                suggested_image_caption: parsed.suggested_image_caption,
                reviewed: Some(parsed.reviewed),
                prompt_text: String::new(),
            });
        }
    }

    Err("The AI review returned a malformed response.".to_string())
}

fn translation_request_has_sections(request: &AiTranslationRequest) -> bool {
    !request.source_footnote.trim().is_empty() || !request.source_image_caption.trim().is_empty()
}

fn translation_response_contract() -> &'static str {
    "Return only valid JSON:\n{\"translatedText\":\"\",\"translatedFootnote\":\"\",\"translatedImageCaption\":\"\"}"
}

fn parse_translation_sections_response(text: &str) -> Result<AiTranslationResponse, String> {
    let trimmed = text.trim();
    let stripped = strip_markdown_code_fence(trimmed);
    let object_slice = trimmed
        .find('{')
        .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]));

    for candidate in [trimmed, stripped]
        .into_iter()
        .chain(object_slice.into_iter())
    {
        if let Ok(parsed) =
            serde_json::from_str::<AiTranslationSectionsStructuredResponse>(candidate)
        {
            return Ok(AiTranslationResponse {
                translated_text: parsed.translated_text,
                translated_footnote: parsed.translated_footnote,
                translated_image_caption: parsed.translated_image_caption,
                prompt_text: String::new(),
                provider_continuation: None,
            });
        }
    }

    Err("The AI translation returned a malformed sectioned response.".to_string())
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
    let sectioned_output = translation_request_has_sections(request);
    let mut sections = Vec::new();
    if sectioned_output {
        sections.push(format!(
            "Task:\nTranslate the source-language sections from {source_label} to {target_label}."
        ));
        sections.push(translation_response_contract().to_string());
        sections.push(
            "Output rule:\nReturn JSON only. Keep the main text, footnote, and image caption translations in their matching fields. Do not append footnotes or image captions to translatedText."
                .to_string(),
        );
    } else {
        sections.push(format!(
            "Task:\nTranslate source_text from {source_label} to {target_label}."
        ));
        sections.push(
            "Output rule:\nReturn only the translated text. Do not include labels, commentary, or quotes."
                .to_string(),
        );
    }
    sections.push(format!(
        "<languages>\nsource: {source_label}\ntarget: {target_label}\n</languages>"
    ));

    if !glossary_hints.is_empty() {
        sections.push(
            "Glossary rules:\nGlossary hints are compact JSON. Apply a glossary hint only when its sourceTerm appears in source_text. targetVariants contains non-empty target text sorted in order of preference, best first. Use later variants only when grammar or context requires it. noTranslation means this glossary term may be omitted from the translation; noTranslation.position ranks omission against targetVariants: \"only\" means omit the source term because no target text is recommended, \"first\" means omission is preferred and targetVariants are fallbacks, and \"later\" means targetVariants are preferred while omission is allowed when smoother or clearer. If a target variant text uses the notation base[ruby: annotation], preserve that ruby annotation when using the term. Use target variant notes, noTranslation.note, globalNotes, and footnotes as translation guidance when present."
                .to_string(),
        );
        sections.push(format!(
            "<glossary_info format=\"json\">\n{glossary_hints}\n</glossary_info>"
        ));
    }

    sections.push(format!("<source_text>\n{}\n</source_text>", request.text));
    if let Some(section) =
        format_optional_tagged_section("source_footnote", &request.source_footnote)
    {
        sections.push(section);
    }
    if let Some(section) =
        format_optional_tagged_section("source_image_caption", &request.source_image_caption)
    {
        sections.push(section);
    }
    if sectioned_output {
        sections.push(translation_response_contract().to_string());
    } else {
        sections.push("Return only the translated text.".to_string());
    }
    sections.join("\n\n")
}

fn format_translation_glossary_hints(hints: &[AiTranslationGlossaryHint]) -> String {
    let values = hints
        .iter()
        .filter_map(|hint| {
            let source_term = hint.source_term.trim();
            let target_variants = hint
                .target_variants
                .iter()
                .filter_map(format_glossary_target_variant_value)
                .collect::<Vec<_>>();
            let mut global_notes = hint
                .global_notes
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            for note in hint
                .notes
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                if !global_notes.iter().any(|value| value == note) {
                    global_notes.push(note.to_string());
                }
            }
            let footnotes = hint
                .footnotes
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            let no_translation = normalize_no_translation_hint(
                hint.no_translation.as_ref(),
                hint.no_translation_position.as_deref(),
            );
            if source_term.is_empty()
                || (target_variants.is_empty()
                    && global_notes.is_empty()
                    && footnotes.is_empty()
                    && no_translation.is_none())
            {
                return None;
            }

            let mut object = serde_json::Map::new();
            object.insert(
                "sourceTerm".to_string(),
                serde_json::Value::String(source_term.to_string()),
            );
            if !target_variants.is_empty() {
                object.insert(
                    "targetVariants".to_string(),
                    serde_json::Value::Array(target_variants),
                );
            }
            if !global_notes.is_empty() {
                object.insert(
                    "globalNotes".to_string(),
                    serde_json::Value::Array(
                        global_notes
                            .into_iter()
                            .map(serde_json::Value::String)
                            .collect(),
                    ),
                );
            }
            if !footnotes.is_empty() {
                object.insert(
                    "footnotes".to_string(),
                    serde_json::Value::Array(
                        footnotes
                            .into_iter()
                            .map(serde_json::Value::String)
                            .collect(),
                    ),
                );
            }
            if let Some(no_translation) = no_translation {
                object.insert(
                    "noTranslation".to_string(),
                    format_no_translation_value(&no_translation),
                );
            }

            Some(serde_json::Value::Object(object))
        })
        .collect::<Vec<_>>();

    if values.is_empty() {
        String::new()
    } else {
        serde_json::Value::Array(values).to_string()
    }
}

fn normalize_no_translation_hint(
    value: Option<&AiTranslationNoTranslationHint>,
    legacy_position: Option<&str>,
) -> Option<AiTranslationNoTranslationHint> {
    let position = value
        .map(|hint| hint.position.trim())
        .filter(|position| !position.is_empty())
        .or_else(|| {
            legacy_position
                .map(str::trim)
                .filter(|position| !position.is_empty())
        })?;
    let note = value
        .map(|hint| hint.note.trim().to_string())
        .unwrap_or_default();
    Some(AiTranslationNoTranslationHint {
        position: position.to_string(),
        note,
    })
}

fn format_no_translation_value(
    no_translation: &AiTranslationNoTranslationHint,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "position".to_string(),
        serde_json::Value::String(no_translation.position.trim().to_string()),
    );
    let note = no_translation.note.trim();
    if !note.is_empty() {
        object.insert(
            "note".to_string(),
            serde_json::Value::String(note.to_string()),
        );
    }
    serde_json::Value::Object(object)
}

fn format_glossary_target_variant_value(
    variant: &AiTranslationGlossaryTargetVariant,
) -> Option<serde_json::Value> {
    let (text, note) = match variant {
        AiTranslationGlossaryTargetVariant::Text(text) => (text.trim(), ""),
        AiTranslationGlossaryTargetVariant::Object(object) => {
            (object.text.trim(), object.note.trim())
        }
    };
    if text.is_empty() {
        return None;
    }

    let mut object = serde_json::Map::new();
    if !text.is_empty() {
        object.insert(
            "text".to_string(),
            serde_json::Value::String(text.to_string()),
        );
    }
    if !note.is_empty() {
        object.insert(
            "note".to_string(),
            serde_json::Value::String(note.to_string()),
        );
    }
    Some(serde_json::Value::Object(object))
}

fn format_assistant_transcript(entries: &[AiAssistantTranscriptEntry]) -> String {
    entries
        .iter()
        .filter_map(|entry| {
            let role = entry.role.trim();
            let text = entry.text.trim();
            if role.is_empty() || text.is_empty() {
                return None;
            }

            Some(format!("- {role}: {text}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_language_ref(label: &str, code: &str) -> String {
    let trimmed_label = label.trim();
    let trimmed_code = code.trim();
    match (trimmed_label.is_empty(), trimmed_code.is_empty()) {
        (true, true) => String::new(),
        (false, true) => trimmed_label.to_string(),
        (true, false) => trimmed_code.to_string(),
        (false, false) => format!("{trimmed_label} ({trimmed_code})"),
    }
}

fn push_tagged_prompt_section(sections: &mut Vec<String>, tag: &str, value: impl AsRef<str>) {
    let trimmed = value.as_ref().trim();
    if trimmed.is_empty() {
        return;
    }

    sections.push(format!("<{tag}>\n{trimmed}\n</{tag}>"));
}

fn push_optional_tagged_prompt_section(
    sections: &mut Vec<String>,
    tag: &str,
    value: &Option<String>,
) {
    if let Some(value) = value {
        let trimmed = value.trim();
        sections.push(format!(
            "<{tag}>\n{}\n</{tag}>",
            if trimmed.is_empty() {
                "(empty)"
            } else {
                trimmed
            }
        ));
    }
}

fn format_assistant_target_language_history(
    entries: &[AiAssistantTargetLanguageHistoryEntry],
    fallback_current_target: &str,
) -> String {
    let fallback_text = fallback_current_target.trim();
    let mut normalized_entries = entries
        .iter()
        .filter(|entry| {
            !entry.text.trim().is_empty()
                || !entry.source_type.trim().is_empty()
                || !entry.source_label.trim().is_empty()
        })
        .cloned()
        .collect::<Vec<_>>();

    if normalized_entries.is_empty() && !fallback_text.is_empty() {
        normalized_entries.push(AiAssistantTargetLanguageHistoryEntry {
            revision_number: 1,
            source_type: "unknown".to_string(),
            source_label: "current_editor_text".to_string(),
            author_type: "unknown".to_string(),
            author_name: String::new(),
            author_login: String::new(),
            author_email: String::new(),
            operation_type: None,
            ai_model: None,
            committed_at: String::new(),
            text: fallback_text.to_string(),
        });
    }

    if normalized_entries.is_empty() {
        return String::new();
    }

    let mut lines = vec![
        "What follows is the edit history of the target-language text, sorted oldest first. The final revision is the current target-language draft in the editor. Use this history as context when it is relevant to the user's request.\n\
\n\
Origin labels:\n\
- human: a human-created or human-edited revision. Respect these choices as intentional unless they contain a real translation, spelling, or grammar error.\n\
- AI: an AI-generated revision. If later human edits changed it, do not revert to the earlier AI wording unless the human edit introduced a real error.\n\
\n\
Source labels:\n\
- current_user: the person currently asking you for help. These edits are strong evidence of the user's preferences, terminology choices, style, and intentional translation decisions.\n\
- other_user: another human editor. These edits may also reflect intentional translation decisions.\n\
- ai_model: an AI-generated revision. If later human edits changed it, do not casually revert to the earlier AI wording.\n\
- file_import: text from the original imported file. Its true author is unknown, so treat it as the starting state rather than as authoritative."
            .to_string(),
    ];

    for (index, entry) in normalized_entries.iter().enumerate() {
        let revision_number = if entry.revision_number == 0 {
            index + 1
        } else {
            entry.revision_number
        };
        let source_type = entry.source_type.trim();
        let source_label = entry.source_label.trim();
        let source = if source_label.is_empty() {
            if source_type.is_empty() {
                "unknown"
            } else {
                source_type
            }
        } else {
            source_label
        };
        let origin = if source_type == "ai_model"
            || entry
                .ai_model
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
        {
            "AI"
        } else {
            "human"
        };
        let mut metadata = vec![format!("origin={origin}"), format!("source={source}")];
        if !source_type.is_empty() && source_type != source {
            metadata.push(format!("sourceType={source_type}"));
        }
        let author_type = entry.author_type.trim();
        if !author_type.is_empty() && author_type != "unknown" {
            metadata.push(format!("committedBy={author_type}"));
        }
        let author_name = entry.author_name.trim();
        if !author_name.is_empty() {
            metadata.push(format!("authorName={author_name}"));
        }
        let author_login = entry.author_login.trim();
        if !author_login.is_empty() {
            metadata.push(format!("authorLogin={author_login}"));
        }
        if let Some(operation_type) = entry.operation_type.as_ref().map(|value| value.trim()) {
            if !operation_type.is_empty() {
                metadata.push(format!("operationType={operation_type}"));
            }
        }
        if let Some(ai_model) = entry.ai_model.as_ref().map(|value| value.trim()) {
            if !ai_model.is_empty() {
                metadata.push(format!("aiModel={ai_model}"));
            }
        }
        let committed_at = entry.committed_at.trim();
        if !committed_at.is_empty() {
            metadata.push(format!("committedAt={committed_at}"));
        }

        let text = entry.text.trim();
        lines.push(format!(
            "{revision_number}. {}\ntext:\n{}",
            metadata.join(", "),
            if text.is_empty() { "(empty)" } else { text },
        ));
    }

    lines.join("\n\n")
}

fn format_assistant_source_context(
    row_window: &[AiAssistantRowWindowEntry],
    fallback_source_text: &str,
) -> String {
    let lines = row_window
        .iter()
        .filter_map(|entry| {
            let source_text = entry.source_text.trim();
            if source_text.is_empty() {
                None
            } else {
                Some(source_text.to_string())
            }
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        fallback_source_text.trim().to_string()
    } else {
        lines.join("\n")
    }
}

fn format_assistant_reference_translations(row: &AiAssistantRowContext) -> String {
    let source_language_code = row.source_language_code.trim();
    let target_language_code = row.target_language_code.trim();
    let lines = row
        .alternate_language_texts
        .iter()
        .filter_map(|entry| {
            let language_code = entry.language_code.trim();
            let text = entry.text.trim();
            if text.is_empty()
                || language_code.is_empty()
                || language_code == source_language_code
                || language_code == target_language_code
            {
                return None;
            }

            let language_label = entry.language_label.trim();
            let label = if language_label.is_empty() {
                language_code
            } else {
                language_label
            };
            Some(format!("{label}: {text}"))
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return String::new();
    }

    format!(
        "The following is a list of translations into other languages. They may have errors, so do not consider these authoritative unless the user explicitly asks you to consult them. These will be useful in cases where the source is ambiguous and the user asks you to look at what translators of other languages did with the same source text.\n\nReference language translations:\n{}",
        lines.join("\n")
    )
}

fn format_assistant_user_action(request: &AiAssistantTurnRequest) -> String {
    let user_message = request.user_message.trim();
    if !user_message.is_empty() {
        return format!("<user_request>\n{user_message}\n</user_request>");
    }

    format!(
        "<instruction>\nTranslate source_text to target_language, taking into account the source_context and glossary information provided above.\n</instruction>"
    )
}

fn build_assistant_prompt(request: &AiAssistantTurnRequest, draft_response: bool) -> String {
    let row = &request.row;
    let glossary_hints = format_translation_glossary_hints(&request.glossary_hints);
    let source_context = format_assistant_source_context(&request.row_window, &row.source_text);
    let source_language =
        format_language_ref(&row.source_language_label, &row.source_language_code);
    let target_language =
        format_language_ref(&row.target_language_label, &row.target_language_code);
    let conversation_history = format_assistant_transcript(&request.transcript);

    let mut sections = Vec::new();
    sections.push(
        "You are an AI assistant inside a translation editor.\n\
Use the supplied source context, target-language history, reference translations, glossary, and conversation history when relevant.\n\
Be direct and useful. If the answer depends on ambiguity in the source text, say so."
            .to_string(),
    );
    sections.push(reply_language_instruction(&request.reply_language_hint));
    if draft_response {
        sections.push(
            "Return JSON only with this shape:\n\
{\"assistantText\":\"...\",\"draftTranslationText\":\"...\"}\n\
assistantText should be a short explanation for the user.\n\
draftTranslationText must contain only the revised translation text, with no labels or commentary.\n\
Do not repeat draftTranslationText inside assistantText."
                .to_string(),
        );
    } else {
        sections.push(
            "Return JSON only with this shape:\n\
{\"assistantText\":\"...\",\"draftTranslationText\":null}\n\
If your answer includes a complete proposed or revised target-language translation that the user could apply to the row, set draftTranslationText to only that translation text and do not repeat it inside assistantText. Otherwise set draftTranslationText to null."
                .to_string(),
        );
    }

    push_tagged_prompt_section(
        &mut sections,
        "source_context",
        format!(
            "This is the source text in context, provided to help you understand source_text more clearly:\n{source_context}"
        ),
    );
    push_tagged_prompt_section(
        &mut sections,
        "languages",
        format!("source: {source_language}\ntarget: {target_language}"),
    );
    push_tagged_prompt_section(
        &mut sections,
        "target_language_history",
        format_assistant_target_language_history(&row.target_language_history, &row.target_text),
    );
    push_tagged_prompt_section(
        &mut sections,
        "reference_translations",
        format_assistant_reference_translations(row),
    );
    if !glossary_hints.trim().is_empty() {
        sections.push(format!(
            "<glossary_info format=\"json\">\n{glossary_hints}\n</glossary_info>"
        ));
    }
    push_tagged_prompt_section(&mut sections, "document_digest", &request.document_digest);
    push_tagged_prompt_section(
        &mut sections,
        "document_revision_key",
        &request.document_revision_key,
    );
    let concordance_hits = format_assistant_concordance_hits(&request.concordance_hits);
    if concordance_hits != "None." {
        push_tagged_prompt_section(&mut sections, "concordance_hits", concordance_hits);
    }
    push_tagged_prompt_section(&mut sections, "source_text", &row.source_text);
    push_optional_tagged_prompt_section(
        &mut sections,
        "updated_source_text",
        &row.updated_source_text,
    );
    push_optional_tagged_prompt_section(
        &mut sections,
        "updated_target_text",
        &row.updated_target_text,
    );
    push_tagged_prompt_section(&mut sections, "conversation_history", conversation_history);
    sections.push(format_assistant_user_action(request));

    sections.join("\n\n")
}

fn format_assistant_concordance_hits(values: &[AiAssistantConcordanceHit]) -> String {
    let lines = values
        .iter()
        .filter_map(|value| {
            let source_snippet = value.source_snippet.trim();
            let target_snippet = value.target_snippet.trim();
            if source_snippet.is_empty() && target_snippet.is_empty() {
                return None;
            }

            Some(format!(
                "- row {}:\n  source: {}\n  target: {}",
                if value.row_id.trim().is_empty() {
                    "unknown"
                } else {
                    value.row_id.trim()
                },
                if source_snippet.is_empty() {
                    "(empty)"
                } else {
                    source_snippet
                },
                if target_snippet.is_empty() {
                    "(empty)"
                } else {
                    target_snippet
                },
            ))
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        "None.".to_string()
    } else {
        lines.join("\n")
    }
}

fn reply_language_instruction(reply_language_hint: &str) -> String {
    let normalized = reply_language_hint.trim();
    if normalized.is_empty() {
        "Reply in the same language as the user's latest message unless they explicitly ask for another reply language.".to_string()
    } else {
        format!("Reply in {normalized} unless the user explicitly asks for another reply language.")
    }
}

fn build_assistant_chat_prompt(request: &AiAssistantTurnRequest) -> String {
    build_assistant_prompt(request, false)
}

fn build_assistant_translate_refinement_prompt(request: &AiAssistantTurnRequest) -> String {
    build_assistant_prompt(request, true)
}

fn strip_markdown_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") || !trimmed.ends_with("```") {
        return trimmed;
    }

    let without_prefix = trimmed
        .split_once('\n')
        .map(|(_opening, rest)| rest)
        .unwrap_or(trimmed);
    without_prefix
        .strip_suffix("```")
        .map(str::trim)
        .unwrap_or(trimmed)
}

fn parse_assistant_structured_response(
    text: &str,
    kind: AiAssistantTurnKind,
) -> Result<AiAssistantStructuredResponse, String> {
    let trimmed = text.trim();
    let stripped = strip_markdown_code_fence(trimmed);
    let object_slice = trimmed
        .find('{')
        .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]));

    for candidate in [trimmed, stripped]
        .into_iter()
        .chain(object_slice.into_iter())
    {
        if let Ok(parsed) = serde_json::from_str::<AiAssistantStructuredResponse>(candidate) {
            let has_draft_translation_text = parsed
                .draft_translation_text
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
            if parsed.assistant_text.trim().is_empty() && !has_draft_translation_text {
                continue;
            }
            if kind == AiAssistantTurnKind::TranslateRefinement && !has_draft_translation_text {
                continue;
            }
            return Ok(parsed);
        }
    }

    Err(AI_ASSISTANT_MALFORMED_RESPONSE_MESSAGE.to_string())
}

fn is_missing_previous_response_error(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    normalized.contains("previous response") && normalized.contains("not found")
}

const GLOSSARY_ALIGNMENT_BATCH_SIZE: usize = 8;
const GLOSSARY_CONTEXT_RADIUS_BYTES: usize = 72;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiAssistantStructuredResponse {
    #[serde(default)]
    response_kind: Option<AiAssistantResponseKind>,
    assistant_text: String,
    #[serde(default)]
    draft_translation_text: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiAssistantMalformedResponseErrorPayload<'a> {
    message: &'a str,
    raw_response: &'a str,
    prompt_text: &'a str,
}

const AI_ASSISTANT_MALFORMED_RESPONSE_MESSAGE: &str =
    "The AI assistant returned a malformed response.";
const AI_ASSISTANT_MALFORMED_RESPONSE_ERROR_PREFIX: &str = "AI_ASSISTANT_MALFORMED_RESPONSE_JSON:";

fn format_ai_assistant_malformed_response_error(raw_response: &str, prompt_text: &str) -> String {
    let payload = AiAssistantMalformedResponseErrorPayload {
        message: AI_ASSISTANT_MALFORMED_RESPONSE_MESSAGE,
        raw_response,
        prompt_text,
    };
    serde_json::to_string(&payload)
        .map(|json| format!("{AI_ASSISTANT_MALFORMED_RESPONSE_ERROR_PREFIX}{json}"))
        .unwrap_or_else(|_| AI_ASSISTANT_MALFORMED_RESPONSE_MESSAGE.to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum AiAssistantResponseKind {
    TranslationDraft,
    Commentary,
    Mixed,
    Error,
}

#[derive(Clone, Debug)]
struct PreparedGlossaryCandidate {
    match_term: String,
    tokens: Vec<String>,
    target_variants: Vec<AiTranslationGlossaryTargetVariant>,
    no_translation: Option<AiTranslationNoTranslationHint>,
    notes: Vec<String>,
    footnotes: Vec<String>,
}

#[derive(Clone, Debug)]
struct TokenizedWord {
    start: usize,
    end: usize,
    normalized: String,
}

#[derive(Clone, Debug)]
struct PreparedGlossaryMatch {
    glossary_source_term: String,
    glossary_source_context: String,
    target_variants: Vec<AiTranslationGlossaryTargetVariant>,
    no_translation: Option<AiTranslationNoTranslationHint>,
    notes: Vec<String>,
    footnotes: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryAlignmentBatchResponse {
    #[serde(default)]
    mappings: Vec<GlossaryAlignmentMapping>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryAlignmentMapping {
    id: String,
    translation_source_term: Option<String>,
}

fn glossary_token_regex() -> &'static Regex {
    static TOKEN_REGEX: OnceLock<Regex> = OnceLock::new();
    TOKEN_REGEX
        .get_or_init(|| Regex::new(r"[\p{L}\p{M}\p{N}]+").expect("valid glossary token regex"))
}

fn normalize_glossary_token(token: &str) -> String {
    token
        .chars()
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn sanitize_term_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

fn append_unique_term_values(values: &mut Vec<String>, incoming_values: &[String]) {
    for incoming_value in incoming_values {
        if values
            .iter()
            .any(|existing_value| existing_value == incoming_value)
        {
            continue;
        }
        values.push(incoming_value.clone());
    }
}

fn sanitize_glossary_target_variants(
    values: &[AiTranslationGlossaryTargetVariant],
) -> Vec<AiTranslationGlossaryTargetVariant> {
    let mut variants = Vec::<AiTranslationGlossaryTargetVariant>::new();
    let mut seen_text_indexes = HashMap::<String, usize>::new();

    for value in values {
        let (text, note) = match value {
            AiTranslationGlossaryTargetVariant::Text(text) => (text.trim(), ""),
            AiTranslationGlossaryTargetVariant::Object(object) => {
                (object.text.trim(), object.note.trim())
            }
        };
        if text.is_empty() {
            continue;
        }

        if let Some(existing_index) = seen_text_indexes.get(text).copied() {
            if !note.is_empty() {
                match &mut variants[existing_index] {
                    AiTranslationGlossaryTargetVariant::Object(existing) => {
                        merge_note_text(&mut existing.note, note);
                    }
                    AiTranslationGlossaryTargetVariant::Text(existing_text) => {
                        variants[existing_index] = AiTranslationGlossaryTargetVariant::Object(
                            AiTranslationGlossaryTargetVariantObject {
                                text: existing_text.trim().to_string(),
                                note: note.to_string(),
                            },
                        );
                    }
                }
            }
            continue;
        }

        seen_text_indexes.insert(text.to_string(), variants.len());
        if note.is_empty() {
            variants.push(AiTranslationGlossaryTargetVariant::Text(text.to_string()));
        } else {
            variants.push(AiTranslationGlossaryTargetVariant::Object(
                AiTranslationGlossaryTargetVariantObject {
                    text: text.to_string(),
                    note: note.to_string(),
                },
            ));
        }
    }

    variants
}

fn append_unique_target_variants(
    values: &mut Vec<AiTranslationGlossaryTargetVariant>,
    incoming_values: &[AiTranslationGlossaryTargetVariant],
) {
    let mut combined = values.clone();
    combined.extend_from_slice(incoming_values);
    *values = sanitize_glossary_target_variants(&combined);
}

fn merge_note_text(existing: &mut String, incoming: &str) {
    let incoming = incoming.trim();
    if incoming.is_empty() {
        return;
    }
    let current = existing.trim();
    if current.is_empty() {
        *existing = incoming.to_string();
        return;
    }
    if current.split("\n\n").any(|value| value.trim() == incoming) {
        return;
    }
    *existing = format!("{current}\n\n{incoming}");
}

fn merge_no_translation_hints(
    existing: &mut Option<AiTranslationNoTranslationHint>,
    incoming: Option<AiTranslationNoTranslationHint>,
) {
    let Some(incoming) = incoming else {
        return;
    };

    match existing {
        Some(existing) => merge_note_text(&mut existing.note, &incoming.note),
        None => *existing = Some(incoming),
    }
}

fn tokenize_glossary_term(term: &str) -> Vec<String> {
    glossary_token_regex()
        .find_iter(term)
        .map(|matched| normalize_glossary_token(matched.as_str()))
        .collect()
}

fn tokenize_text_words(text: &str) -> Vec<TokenizedWord> {
    glossary_token_regex()
        .find_iter(text)
        .map(|matched| TokenizedWord {
            start: matched.start(),
            end: matched.end(),
            normalized: normalize_glossary_token(matched.as_str()),
        })
        .collect()
}

fn build_glossary_match_candidates(
    glossary_terms: &[AiTranslatedGlossaryTermInput],
) -> HashMap<String, Vec<PreparedGlossaryCandidate>> {
    let mut merged_candidates_by_key = HashMap::<String, PreparedGlossaryCandidate>::new();

    for term in glossary_terms {
        let target_variants = sanitize_glossary_target_variants(&term.target_variants);
        let mut notes = sanitize_term_list(&term.global_notes);
        append_unique_term_values(&mut notes, &sanitize_term_list(&term.notes));
        let footnotes = sanitize_term_list(&term.footnotes);
        let no_translation = normalize_no_translation_hint(term.no_translation.as_ref(), None);
        for source_term in sanitize_term_list(&term.glossary_source_terms) {
            let tokens = tokenize_glossary_term(&source_term);
            if tokens.is_empty() {
                continue;
            }

            let candidate_key = tokens.join(" ");
            if let Some(existing_candidate) = merged_candidates_by_key.get_mut(&candidate_key) {
                if source_term.len() > existing_candidate.match_term.len() {
                    existing_candidate.match_term = source_term;
                }
                append_unique_target_variants(
                    &mut existing_candidate.target_variants,
                    &target_variants,
                );
                append_unique_term_values(&mut existing_candidate.notes, &notes);
                append_unique_term_values(&mut existing_candidate.footnotes, &footnotes);
                merge_no_translation_hints(
                    &mut existing_candidate.no_translation,
                    no_translation.clone(),
                );
                continue;
            }

            merged_candidates_by_key.insert(
                candidate_key,
                PreparedGlossaryCandidate {
                    match_term: source_term,
                    tokens,
                    target_variants: target_variants.clone(),
                    no_translation: no_translation.clone(),
                    notes: notes.clone(),
                    footnotes: footnotes.clone(),
                },
            );
        }
    }

    let mut candidates_by_first_token = HashMap::<String, Vec<PreparedGlossaryCandidate>>::new();

    for candidate in merged_candidates_by_key.into_values() {
        candidates_by_first_token
            .entry(candidate.tokens[0].clone())
            .or_default()
            .push(candidate);
    }

    for candidates in candidates_by_first_token.values_mut() {
        candidates.sort_by(|left, right| {
            right
                .tokens
                .len()
                .cmp(&left.tokens.len())
                .then_with(|| right.match_term.len().cmp(&left.match_term.len()))
        });
    }

    candidates_by_first_token
}

fn clamp_to_char_boundary_left(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn clamp_to_char_boundary_right(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn build_glossary_match_context(text: &str, start: usize, end: usize) -> String {
    let context_start =
        clamp_to_char_boundary_left(text, start.saturating_sub(GLOSSARY_CONTEXT_RADIUS_BYTES));
    let context_end =
        clamp_to_char_boundary_right(text, (end + GLOSSARY_CONTEXT_RADIUS_BYTES).min(text.len()));
    let prefix = if context_start > 0 { "..." } else { "" };
    let suffix = if context_end < text.len() { "..." } else { "" };
    format!(
        "{prefix}{}{suffix}",
        text[context_start..context_end].trim()
    )
}

fn find_matched_glossary_terms(
    glossary_source_text: &str,
    glossary_terms: &[AiTranslatedGlossaryTermInput],
) -> Vec<PreparedGlossaryMatch> {
    let candidates_by_first_token = build_glossary_match_candidates(glossary_terms);
    if candidates_by_first_token.is_empty() {
        return vec![];
    }

    let words = tokenize_text_words(glossary_source_text);
    let mut matched_terms = Vec::new();
    let mut seen_surface_terms = HashSet::new();
    let mut word_index = 0usize;

    while word_index < words.len() {
        let current_word = &words[word_index];
        let mut matched_candidate = None;
        if let Some(candidates) = candidates_by_first_token.get(&current_word.normalized) {
            for candidate in candidates {
                if word_index + candidate.tokens.len() > words.len() {
                    continue;
                }

                let is_match =
                    candidate
                        .tokens
                        .iter()
                        .enumerate()
                        .all(|(candidate_index, token)| {
                            words[word_index + candidate_index].normalized == *token
                        });
                if is_match {
                    matched_candidate = Some(candidate.clone());
                    break;
                }
            }
        }

        let Some(candidate) = matched_candidate else {
            word_index += 1;
            continue;
        };

        let start = words[word_index].start;
        let end = words[word_index + candidate.tokens.len() - 1].end;
        let glossary_source_term = glossary_source_text[start..end].trim().to_string();
        let dedupe_key = normalize_glossary_token(&glossary_source_term);
        if seen_surface_terms.insert(dedupe_key) {
            matched_terms.push(PreparedGlossaryMatch {
                glossary_source_term,
                glossary_source_context: build_glossary_match_context(
                    glossary_source_text,
                    start,
                    end,
                ),
                target_variants: candidate.target_variants,
                no_translation: candidate.no_translation,
                notes: candidate.notes,
                footnotes: candidate.footnotes,
            });
        }

        word_index += candidate.tokens.len();
    }

    matched_terms
}

fn build_glossary_alignment_prompt(
    request: &AiTranslatedGlossaryPreparationRequest,
    glossary_source_text: &str,
    matches: &[PreparedGlossaryMatch],
) -> String {
    let items = matches
        .iter()
        .enumerate()
        .map(|(index, matched_term)| {
            format!(
                "- id: \"{}\"\n  glossarySourceTerm: \"{}\"\n  glossarySourceContext: \"{}\"",
                index,
                matched_term.glossary_source_term.replace('"', "\\\""),
                matched_term.glossary_source_context.replace('"', "\\\""),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are aligning glossary-source phrases back to the original translation source text.\n\nReturn only JSON with this exact shape:\n{{\"mappings\":[{{\"id\":\"0\",\"translationSourceTerm\":\"exact substring or null\"}}]}}\n\nRules:\n- translationSourceTerm must be an exact contiguous substring from the translation source text.\n- If there is no confident exact substring, use null.\n- Do not explain anything.\n- Do not use markdown fences.\n\nTranslation source language: {}\nGlossary source language: {}\n\nTranslation source text:\n{}\n\nGlossary source text:\n{}\n\nItems:\n{}",
        request.translation_source_language.trim(),
        request.glossary_source_language.trim(),
        request.translation_source_text,
        glossary_source_text,
        items,
    )
}

fn build_glossary_alignment_prompt_request(
    request: &AiTranslatedGlossaryPreparationRequest,
    glossary_source_text: &str,
    matches: &[PreparedGlossaryMatch],
) -> AiPromptRequest {
    AiPromptRequest {
        provider_id: request.provider_id,
        model_id: request.model_id.clone(),
        prompt: build_glossary_alignment_prompt(request, glossary_source_text, matches),
        previous_response_id: None,
        output_format: AiPromptOutputFormat::GlossaryAlignmentJson,
    }
}

fn extract_json_object(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }

    let without_fences = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .trim();
    let without_fences = without_fences
        .strip_suffix("```")
        .unwrap_or(without_fences)
        .trim();
    if without_fences.starts_with('{') && without_fences.ends_with('}') {
        return Some(without_fences);
    }

    match (trimmed.find('{'), trimmed.rfind('}')) {
        (Some(start), Some(end)) if start < end => Some(&trimmed[start..=end]),
        _ => None,
    }
}

fn parse_glossary_alignment_batch_response(
    response_text: &str,
) -> Result<GlossaryAlignmentBatchResponse, String> {
    let json_text = extract_json_object(response_text)
        .ok_or_else(|| "The glossary alignment response did not contain JSON.".to_string())?;
    serde_json::from_str(json_text).map_err(|_| {
        "The glossary alignment response did not match the expected JSON shape.".to_string()
    })
}

fn build_pivot_translation_request(
    request: &AiTranslatedGlossaryPreparationRequest,
) -> AiTranslationRequest {
    AiTranslationRequest {
        provider_id: request.provider_id,
        model_id: request.model_id.clone(),
        text: request.translation_source_text.clone(),
        source_footnote: String::new(),
        source_image_caption: String::new(),
        target_footnote: String::new(),
        target_image_caption: String::new(),
        source_language: request.translation_source_language.clone(),
        target_language: request.glossary_source_language.clone(),
        glossary_hints: vec![],
        installation_id: request.installation_id,
    }
}

pub(crate) fn load_ai_provider_api_key(
    app: &AppHandle,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<String, String> {
    load_ai_provider_secret(app, provider_id, installation_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            provider_id.display_name()
        )
    })
}

pub(crate) fn load_ai_provider_models(
    app: &AppHandle,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<Vec<AiProviderModel>, String> {
    let api_key = load_ai_provider_api_key(app, provider_id, installation_id)?;

    providers::list_models(provider_id, &api_key)
}

pub(crate) fn run_ai_review(
    app: &AppHandle,
    request: AiReviewRequest,
) -> Result<AiReviewResponse, String> {
    let structured_review_mode = normalize_review_mode(&request);
    let text_to_review = request
        .latest_translation
        .as_deref()
        .unwrap_or(&request.text);

    if text_to_review.trim().is_empty()
        && request.footnote.trim().is_empty()
        && request.image_caption.trim().is_empty()
    {
        return Err("There is no text to review yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Review.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;

    let prompt = build_review_prompt(&request);
    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: prompt.clone(),
            previous_response_id: None,
            output_format: if structured_review_mode.is_some() {
                AiPromptOutputFormat::ReviewJson
            } else {
                AiPromptOutputFormat::Text
            },
        },
        &api_key,
    )?;

    if structured_review_mode.is_some() {
        let mut parsed = parse_review_structured_response(&response.text)?;
        parsed.prompt_text = prompt;
        return Ok(parsed);
    }

    Ok(AiReviewResponse {
        suggested_text: response.text,
        suggested_footnote: String::new(),
        suggested_image_caption: String::new(),
        reviewed: None,
        prompt_text: prompt,
    })
}

pub(crate) fn prepare_ai_translated_glossary(
    app: &AppHandle,
    request: AiTranslatedGlossaryPreparationRequest,
) -> Result<AiTranslatedGlossaryPreparationResponse, String> {
    if request.translation_source_text.trim().is_empty() {
        return Err("There is no source text to translate yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Translate.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;
    let glossary_terms = request
        .glossary_terms
        .iter()
        .filter(|term| !sanitize_term_list(&term.glossary_source_terms).is_empty())
        .cloned()
        .collect::<Vec<_>>();
    if glossary_terms.is_empty() {
        return Ok(AiTranslatedGlossaryPreparationResponse {
            glossary_source_text: request.glossary_source_text.trim().to_string(),
            entries: vec![],
        });
    }

    let glossary_source_text = if request.glossary_source_text.trim().is_empty() {
        providers::run_prompt(
            &AiPromptRequest {
                provider_id: request.provider_id,
                model_id: request.model_id.clone(),
                prompt: build_translation_prompt(&build_pivot_translation_request(&request)),
                previous_response_id: None,
                output_format: AiPromptOutputFormat::Text,
            },
            &api_key,
        )?
        .text
    } else {
        request.glossary_source_text.trim().to_string()
    };

    let matched_terms = find_matched_glossary_terms(&glossary_source_text, &glossary_terms);
    if matched_terms.is_empty() {
        return Ok(AiTranslatedGlossaryPreparationResponse {
            glossary_source_text,
            entries: vec![],
        });
    }

    let mut prepared_entries = Vec::<AiTranslatedGlossaryEntry>::new();
    let mut seen_entries = HashSet::<String>::new();
    for matched_term_batch in matched_terms.chunks(GLOSSARY_ALIGNMENT_BATCH_SIZE) {
        let response = providers::run_prompt(
            &build_glossary_alignment_prompt_request(
                &request,
                &glossary_source_text,
                matched_term_batch,
            ),
            &api_key,
        )?;
        let parsed_response = parse_glossary_alignment_batch_response(&response.text)?;
        let mappings_by_id = parsed_response
            .mappings
            .into_iter()
            .map(|mapping| (mapping.id, mapping.translation_source_term))
            .collect::<HashMap<_, _>>();

        for (index, matched_term) in matched_term_batch.iter().enumerate() {
            let Some(raw_source_term) = mappings_by_id.get(&index.to_string()) else {
                continue;
            };
            let Some(source_term) = raw_source_term.as_ref().map(|value| value.trim()) else {
                continue;
            };
            if source_term.is_empty() || !request.translation_source_text.contains(source_term) {
                continue;
            }

            let dedupe_key = format!(
                "{}::{}",
                normalize_glossary_token(source_term),
                normalize_glossary_token(&matched_term.glossary_source_term),
            );
            if !seen_entries.insert(dedupe_key) {
                continue;
            }

            prepared_entries.push(AiTranslatedGlossaryEntry {
                source_term: source_term.to_string(),
                glossary_source_term: matched_term.glossary_source_term.clone(),
                target_variants: matched_term.target_variants.clone(),
                no_translation: matched_term.no_translation.clone(),
                notes: matched_term.notes.clone(),
                global_notes: matched_term.notes.clone(),
                footnotes: matched_term.footnotes.clone(),
            });
        }
    }

    Ok(AiTranslatedGlossaryPreparationResponse {
        glossary_source_text,
        entries: prepared_entries,
    })
}

pub(crate) fn run_ai_translation(
    app: &AppHandle,
    request: AiTranslationRequest,
) -> Result<AiTranslationResponse, String> {
    let sectioned_output = translation_request_has_sections(&request);
    if request.text.trim().is_empty()
        && request.source_footnote.trim().is_empty()
        && request.source_image_caption.trim().is_empty()
    {
        return Err("There is no source text to translate yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Translate.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;
    let prompt = build_translation_prompt(&request);

    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: prompt.clone(),
            previous_response_id: None,
            output_format: if sectioned_output {
                AiPromptOutputFormat::TranslationSectionsJson
            } else {
                AiPromptOutputFormat::Text
            },
        },
        &api_key,
    )?;

    if sectioned_output {
        let mut parsed = parse_translation_sections_response(&response.text)?;
        parsed.prompt_text = prompt;
        parsed.provider_continuation = Some(AiProviderContinuationMetadata {
            previous_response_id: None,
            provider_response_id: response.provider_response_id,
        });
        return Ok(parsed);
    }

    Ok(AiTranslationResponse {
        translated_text: response.text,
        translated_footnote: String::new(),
        translated_image_caption: String::new(),
        prompt_text: prompt,
        provider_continuation: Some(AiProviderContinuationMetadata {
            previous_response_id: None,
            provider_response_id: response.provider_response_id,
        }),
    })
}

pub(crate) fn run_ai_assistant_turn(
    app: &AppHandle,
    request: AiAssistantTurnRequest,
) -> Result<AiAssistantTurnResponse, String> {
    if request.user_message.trim().is_empty() {
        return Err("Write a message before sending it to AI Assistant.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before using AI Assistant.",
            request.provider_id.display_name()
        ));
    }
    if request.row.source_text.trim().is_empty() {
        return Err("There is no source text to discuss yet.".to_string());
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;
    let prompt = match request.kind {
        AiAssistantTurnKind::Chat => build_assistant_chat_prompt(&request),
        AiAssistantTurnKind::TranslateRefinement => {
            build_assistant_translate_refinement_prompt(&request)
        }
    };
    let previous_response_id = request
        .provider_continuation
        .as_ref()
        .and_then(|metadata| metadata.previous_response_id.clone());
    let response = match providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: prompt.clone(),
            previous_response_id: previous_response_id.clone(),
            output_format: AiPromptOutputFormat::AssistantTurnJson,
        },
        &api_key,
    ) {
        Ok(response) => response,
        Err(error)
            if previous_response_id.is_some() && is_missing_previous_response_error(&error) =>
        {
            providers::run_prompt(
                &AiPromptRequest {
                    provider_id: request.provider_id,
                    model_id: request.model_id.clone(),
                    prompt: prompt.clone(),
                    previous_response_id: None,
                    output_format: AiPromptOutputFormat::AssistantTurnJson,
                },
                &api_key,
            )?
        }
        Err(error) => return Err(error),
    };
    let structured_response =
        match parse_assistant_structured_response(&response.text, request.kind) {
            Ok(response) => response,
            Err(error) if error == AI_ASSISTANT_MALFORMED_RESPONSE_MESSAGE => {
                return Err(format_ai_assistant_malformed_response_error(
                    &response.text,
                    &prompt,
                ));
            }
            Err(error) => return Err(error),
        };
    let _response_kind = structured_response.response_kind.as_ref();

    Ok(AiAssistantTurnResponse {
        assistant_text: structured_response.assistant_text,
        draft_translation_text: structured_response.draft_translation_text,
        prompt_text: prompt,
        raw_response: response.text,
        provider_continuation: Some(AiProviderContinuationMetadata {
            previous_response_id: None,
            provider_response_id: response.provider_response_id,
        }),
    })
}

pub(crate) fn probe_ai_model(app: &AppHandle, request: AiModelProbeRequest) -> Result<(), String> {
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page first.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;

    providers::probe_model(request.provider_id, request.model_id.trim(), &api_key)
}

#[cfg(test)]
mod tests {
    use super::{
        build_assistant_chat_prompt, build_glossary_alignment_prompt_request, build_review_prompt,
        build_translation_prompt, find_matched_glossary_terms, parse_assistant_structured_response,
        parse_review_structured_response, parse_translation_sections_response,
        PreparedGlossaryMatch,
    };
    use crate::ai::types::{
        AiAssistantRowContext, AiAssistantRowLanguageText, AiAssistantRowWindowEntry,
        AiAssistantTargetLanguageHistoryEntry, AiAssistantTranscriptEntry, AiAssistantTurnKind,
        AiAssistantTurnRequest, AiPromptOutputFormat, AiProviderId, AiReviewRequest,
        AiTranslatedGlossaryPreparationRequest, AiTranslatedGlossaryTermInput,
        AiTranslationGlossaryHint, AiTranslationGlossaryTargetVariant,
        AiTranslationNoTranslationHint, AiTranslationRequest,
    };

    fn target_variant(value: &str) -> AiTranslationGlossaryTargetVariant {
        AiTranslationGlossaryTargetVariant::Text(value.to_string())
    }

    fn review_request() -> AiReviewRequest {
        AiReviewRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Ban dich hien tai".to_string(),
            language_code: "vi".to_string(),
            footnote: String::new(),
            image_caption: String::new(),
            review_mode: None,
            latest_translation: None,
            source_text: None,
            source_footnote: String::new(),
            source_image_caption: String::new(),
            source_language_code: String::new(),
            target_language_code: String::new(),
            source_language: String::new(),
            target_language: String::new(),
            glossary_hints: vec![],
            alternate_language_texts: vec![],
            target_language_history: vec![],
            row_window: vec![],
            installation_id: None,
        }
    }

    #[test]
    fn build_review_prompt_keeps_plain_single_row_behavior_without_mode() {
        let prompt = build_review_prompt(&review_request());

        assert_eq!(
            prompt,
            "Check spelling and grammar on the following text. Output only your suggested revised version of the text. Do not explain what you changed and why. If the text to review is already correct, do not change anything.\n\nLanguage code: vi\n\nText to review:\nBan dich hien tai"
        );
    }

    #[test]
    fn build_review_prompt_uses_grammar_structured_prompt() {
        let mut request = review_request();
        request.review_mode = Some("grammar".to_string());
        request.latest_translation = Some("Ban dich hien tai".to_string());

        let prompt = build_review_prompt(&request);

        assert!(prompt.contains("Return only valid JSON"));
        assert!(prompt.contains(
            "Task:\nReview the target-language sections only for spelling and grammar errors."
        ));
        assert!(prompt.contains("Do not review translation accuracy"));
        assert!(prompt.contains("Keep main text, footnotes, and image captions separate."));
        assert!(prompt.contains("<review_item>"));
        assert!(prompt.contains("These are the only sections you are reviewing."));
        assert!(prompt.contains("<latest_translation>\nBan dich hien tai\n</latest_translation>"));
        assert!(!prompt.contains("source_text"));
        assert!(
            prompt.ends_with("Return only valid JSON:\n{\"suggestedText\":\"\",\"suggestedFootnote\":\"\",\"suggestedImageCaption\":\"\",\"reviewed\":true}")
        );
        assert_eq!(
            prompt
                .matches("If every reviewed section is correct")
                .count(),
            1
        );
        assert_eq!(prompt.matches("If any section has errors").count(), 1);
    }

    #[test]
    fn build_review_prompt_uses_meaning_structured_prompt_with_glossary() {
        let mut request = review_request();
        request.review_mode = Some("meaning".to_string());
        request.source_text = Some("Fuente actual".to_string());
        request.source_language_code = "es".to_string();
        request.target_language_code = "vi".to_string();
        request.source_language = "Spanish".to_string();
        request.target_language = "Vietnamese".to_string();
        request.latest_translation = Some("Ban dich hien tai".to_string());
        request.alternate_language_texts = vec![AiAssistantRowLanguageText {
            language_code: "en".to_string(),
            language_label: "English".to_string(),
            text: "Current English reference".to_string(),
        }];
        request.target_language_history = vec![AiAssistantTargetLanguageHistoryEntry {
            revision_number: 1,
            source_type: "file_import".to_string(),
            source_label: "file_import".to_string(),
            author_type: "unknown".to_string(),
            author_name: String::new(),
            author_login: String::new(),
            author_email: String::new(),
            operation_type: Some("editor-update".to_string()),
            ai_model: None,
            committed_at: "2026-05-11T10:00:00Z".to_string(),
            text: "Ban dich cu".to_string(),
        }];
        request.row_window = vec![
            AiAssistantRowWindowEntry {
                row_id: "row-0".to_string(),
                source_text: "Fuente anterior".to_string(),
                target_text: "Ban dich truoc".to_string(),
            },
            AiAssistantRowWindowEntry {
                row_id: "row-1".to_string(),
                source_text: "Fuente actual".to_string(),
                target_text: "Ban dich hien tai".to_string(),
            },
        ];
        request.glossary_hints = vec![AiTranslationGlossaryHint {
            source_term: "Fuente".to_string(),
            target_variants: vec![target_variant("nguon")],
            no_translation_position: None,
            no_translation: None,
            notes: vec!["Use the spiritual meaning.".to_string()],
            global_notes: vec![],
            footnotes: vec![],
        }];

        let prompt = build_review_prompt(&request);

        assert!(prompt.contains("<source_context>"));
        assert!(prompt.contains("Fuente anterior\nFuente actual"));
        assert!(prompt
            .contains("<languages>\nsource: Spanish (es)\ntarget: Vietnamese (vi)\n</languages>"));
        assert!(prompt.contains("<target_language_history>"));
        assert!(prompt.contains("origin=human, source=file_import"));
        assert!(prompt.contains("<reference_translations>"));
        assert!(prompt.contains("English: Current English reference"));
        assert!(prompt.contains("<source_text>\nFuente actual\n</source_text>"));
        assert!(prompt.contains("<glossary_info format=\"json\">"));
        assert!(prompt.contains("Review the latest target-language sections against the source-language sections for translation accuracy, spelling, and grammar."));
        assert!(prompt.contains(
            "respect the user's choice of words unless there is a real error in the translation"
        ));
        assert!(prompt.contains(
            "If a human has edited an AI translation, do not revert those human changes"
        ));
        assert!(prompt.contains(r#""sourceTerm":"Fuente""#));
        assert!(prompt.contains(r#""targetVariants":[{"text":"nguon"}]"#));
        assert!(prompt.contains("<review_item>"));
        assert!(prompt.contains("These are the only sections you are reviewing."));
        assert!(prompt.contains("<latest_translation>\nBan dich hien tai\n</latest_translation>"));
        assert!(
            prompt.ends_with("Return only valid JSON:\n{\"suggestedText\":\"\",\"suggestedFootnote\":\"\",\"suggestedImageCaption\":\"\",\"reviewed\":true}")
        );
        assert_eq!(
            prompt
                .matches("If every reviewed section is correct")
                .count(),
            1
        );
        assert_eq!(prompt.matches("If any section has errors").count(), 1);
    }

    #[test]
    fn parse_review_structured_response_accepts_json_and_clears_clean_text() {
        let response = parse_review_structured_response(
            r#"{"suggestedText":"This should be ignored","reviewed":true}"#,
        )
        .unwrap();

        assert_eq!(response.suggested_text, "");
        assert_eq!(response.reviewed, Some(true));
    }

    #[test]
    fn parse_review_structured_response_accepts_corrected_json() {
        let response = parse_review_structured_response(
            r#"```json
            {"suggestedText":"Corrected text","reviewed":false}
            ```"#,
        )
        .unwrap();

        assert_eq!(response.suggested_text, "Corrected text");
        assert_eq!(response.reviewed, Some(false));
    }

    #[test]
    fn build_translation_prompt_uses_structured_prompt_when_no_glossary_hints_are_present() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Hola".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            installation_id: None,
        });

        assert_eq!(
            prompt,
            "Task:\nTranslate source_text from Spanish to Vietnamese.\n\nOutput rule:\nReturn only the translated text. Do not include labels, commentary, or quotes.\n\n<languages>\nsource: Spanish\ntarget: Vietnamese\n</languages>\n\n<source_text>\nHola\n</source_text>\n\nReturn only the translated text."
        );
    }

    #[test]
    fn build_translation_prompt_uses_sectioned_json_when_secondary_text_is_present() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Hola".to_string(),
            source_footnote: "Nota fuente".to_string(),
            source_image_caption: "Caption source".to_string(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            installation_id: None,
        });

        assert!(prompt.contains("\"translatedText\":\"\""));
        assert!(prompt.contains("\"translatedFootnote\":\"\""));
        assert!(prompt.contains("\"translatedImageCaption\":\"\""));
        assert!(prompt.contains("<source_footnote>\nNota fuente\n</source_footnote>"));
        assert!(prompt.contains("<source_image_caption>\nCaption source\n</source_image_caption>"));
        assert!(prompt.contains("Do not append footnotes or image captions to translatedText."));
    }

    #[test]
    fn parse_translation_sections_response_keeps_sections_separate() {
        let response = parse_translation_sections_response(
            r#"{"translatedText":"Xin chao","translatedFootnote":"Chu thich","translatedImageCaption":"Chu thich anh"}"#,
        )
        .unwrap();

        assert_eq!(response.translated_text, "Xin chao");
        assert_eq!(response.translated_footnote, "Chu thich");
        assert_eq!(response.translated_image_caption, "Chu thich anh");
    }

    #[test]
    fn build_translation_prompt_includes_glossary_hints_with_preference_guidance() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La gnostica habla.".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "gnostica".to_string(),
                target_variants: vec![
                    target_variant("hoc tro gnosis"),
                    target_variant("cua gnosis"),
                ],
                no_translation_position: None,
                no_translation: None,
                notes: vec!["Lien quan den Gnosis".to_string()],
                global_notes: vec![],
                footnotes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains(
            "targetVariants contains non-empty target text sorted in order of preference, best first. Use later variants only when grammar or context requires it."
        ));
        assert!(prompt.contains(
            "If a target variant text uses the notation base[ruby: annotation], preserve that ruby annotation when using the term."
        ));
        assert!(prompt.contains(r#""sourceTerm":"gnostica""#));
        assert!(prompt
            .contains(r#""targetVariants":[{"text":"hoc tro gnosis"},{"text":"cua gnosis"}]"#));
        assert!(prompt.contains(r#""globalNotes":["Lien quan den Gnosis"]"#));
        assert!(prompt.contains("<glossary_info format=\"json\">"));
        assert!(prompt.contains("<source_text>\nLa gnostica habla.\n</source_text>"));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_only_guidance() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec![],
                no_translation_position: Some("only".to_string()),
                no_translation: None,
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains(r#""sourceTerm":"mente""#));
        assert!(prompt.contains(r#""noTranslation":{"position":"only"}"#));
        assert!(!prompt.contains(r#""targetVariants""#));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_preface_when_empty_variant_is_first() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec![target_variant("tam"), target_variant("tri")],
                no_translation_position: Some("first".to_string()),
                no_translation: None,
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains(r#""noTranslation":{"position":"first"}"#));
        assert!(prompt.contains(r#""targetVariants":[{"text":"tam"},{"text":"tri"}]"#));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_fallback_when_empty_variant_is_later() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec![target_variant("tam"), target_variant("tri")],
                no_translation_position: Some("later".to_string()),
                no_translation: None,
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains(r#""targetVariants":[{"text":"tam"},{"text":"tri"}]"#));
        assert!(prompt.contains(r#""noTranslation":{"position":"later"}"#));
    }

    #[test]
    fn build_translation_prompt_splits_note_only_empty_variant_into_no_translation_note() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_footnote: String::new(),
            source_image_caption: String::new(),
            target_footnote: String::new(),
            target_image_caption: String::new(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec![],
                no_translation_position: None,
                no_translation: Some(AiTranslationNoTranslationHint {
                    position: "only".to_string(),
                    note: "Omit when redundant.".to_string(),
                }),
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            }],
            installation_id: None,
        });

        assert!(
            prompt.contains(r#""noTranslation":{"note":"Omit when redundant.","position":"only"}"#)
        );
        assert!(!prompt.contains(r#""targetVariants":[{"note""#));
    }

    #[test]
    fn glossary_alignment_prompt_request_uses_structured_output() {
        let request = AiTranslatedGlossaryPreparationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            translation_source_text: "La camara interior brilla.".to_string(),
            translation_source_language: "Spanish".to_string(),
            glossary_source_language: "English".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_source_text: "The inner chamber shines.".to_string(),
            glossary_terms: vec![],
            installation_id: None,
        };
        let matches = vec![PreparedGlossaryMatch {
            glossary_source_term: "inner chamber".to_string(),
            glossary_source_context: "The inner chamber shines.".to_string(),
            target_variants: vec![target_variant("buong noi tam")],
            no_translation: None,
            notes: vec![],
            footnotes: vec![],
        }];

        let prompt_request = build_glossary_alignment_prompt_request(
            &request,
            "The inner chamber shines.",
            &matches,
        );

        assert_eq!(
            prompt_request.output_format,
            AiPromptOutputFormat::GlossaryAlignmentJson
        );
        assert!(prompt_request.prompt.contains(
            r#"{"mappings":[{"id":"0","translationSourceTerm":"exact substring or null"}]}"#
        ));
        assert!(prompt_request
            .prompt
            .contains("translationSourceTerm must be an exact contiguous substring"));
    }

    #[test]
    fn matched_glossary_terms_merge_duplicate_source_terms() {
        let matches = find_matched_glossary_terms(
            "La camara interior brilla.",
            &[
                AiTranslatedGlossaryTermInput {
                    glossary_source_terms: vec!["camara interior".to_string()],
                    target_variants: vec![target_variant("buong noi tam")],
                    no_translation: None,
                    notes: vec!["Nota 1".to_string()],
                    global_notes: vec![],
                    footnotes: vec!["Footnote 1".to_string()],
                },
                AiTranslatedGlossaryTermInput {
                    glossary_source_terms: vec!["camara interior".to_string()],
                    target_variants: vec![target_variant("phong ben trong")],
                    no_translation: None,
                    notes: vec!["Nota 2".to_string()],
                    global_notes: vec![],
                    footnotes: vec!["Footnote 2".to_string()],
                },
            ],
        );

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].glossary_source_term, "camara interior");
        assert_eq!(
            matches[0].target_variants,
            vec![
                target_variant("buong noi tam"),
                target_variant("phong ben trong")
            ]
        );
        assert_eq!(
            matches[0].notes,
            vec!["Nota 1".to_string(), "Nota 2".to_string()]
        );
        assert_eq!(
            matches[0].footnotes,
            vec!["Footnote 1".to_string(), "Footnote 2".to_string()]
        );
    }

    fn assistant_request_for_prompt() -> AiAssistantTurnRequest {
        AiAssistantTurnRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.5".to_string(),
            kind: AiAssistantTurnKind::Chat,
            user_message: "Make it more natural.".to_string(),
            transcript: vec![AiAssistantTranscriptEntry {
                role: "assistant".to_string(),
                text: "Earlier answer.".to_string(),
            }],
            row: AiAssistantRowContext {
                row_id: "row-4".to_string(),
                source_language_code: "es".to_string(),
                source_language_label: "Spanish".to_string(),
                source_text: "Fuente actual".to_string(),
                target_language_code: "vi".to_string(),
                target_language_label: "Vietnamese".to_string(),
                target_text: "Ban dich hien tai".to_string(),
                updated_source_text: None,
                updated_target_text: None,
                alternate_language_texts: vec![],
                target_language_history: vec![],
            },
            row_window: vec![
                AiAssistantRowWindowEntry {
                    row_id: "row-1".to_string(),
                    source_text: "Linea anterior 3".to_string(),
                    target_text: String::new(),
                },
                AiAssistantRowWindowEntry {
                    row_id: "row-2".to_string(),
                    source_text: "Linea anterior 2".to_string(),
                    target_text: String::new(),
                },
                AiAssistantRowWindowEntry {
                    row_id: "row-3".to_string(),
                    source_text: "Linea anterior 1".to_string(),
                    target_text: String::new(),
                },
                AiAssistantRowWindowEntry {
                    row_id: "row-4".to_string(),
                    source_text: "Fuente actual".to_string(),
                    target_text: String::new(),
                },
                AiAssistantRowWindowEntry {
                    row_id: "row-5".to_string(),
                    source_text: "Linea siguiente 1".to_string(),
                    target_text: String::new(),
                },
            ],
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "Fuente".to_string(),
                target_variants: vec![target_variant("nguon")],
                no_translation_position: None,
                no_translation: None,
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            }],
            document_digest: String::new(),
            document_revision_key: String::new(),
            concordance_hits: vec![],
            reply_language_hint: String::new(),
            installation_id: None,
            provider_continuation: None,
        }
    }

    #[test]
    fn assistant_prompt_uses_source_context_blob_and_final_source_text() {
        let prompt = build_assistant_chat_prompt(&assistant_request_for_prompt());

        assert!(prompt.contains(
            "<source_context>\nThis is the source text in context, provided to help you understand source_text more clearly:\nLinea anterior 3\nLinea anterior 2\nLinea anterior 1\nFuente actual\nLinea siguiente 1\n</source_context>"
        ));
        assert!(
            prompt.contains(
                "<source_text>\nFuente actual\n</source_text>\n\n<conversation_history>\n- assistant: Earlier answer.\n</conversation_history>\n\n<user_request>\nMake it more natural.\n</user_request>"
            )
        );
        assert!(!prompt.contains("previous_row_1"));
        assert!(!prompt.contains("Row window context: None."));
    }

    #[test]
    fn assistant_prompt_omits_empty_sections_and_uses_single_glossary_section() {
        let prompt = build_assistant_chat_prompt(&assistant_request_for_prompt());

        assert!(!prompt.contains("<document_digest>"));
        assert!(!prompt.contains("<document_revision_key>"));
        assert!(!prompt.contains("<concordance_hits>"));
        assert!(!prompt.contains("None."));
        assert_eq!(prompt.matches("<glossary_info format=\"json\">").count(), 1);
    }

    #[test]
    fn assistant_prompt_uses_default_instruction_when_user_request_is_empty() {
        let mut request = assistant_request_for_prompt();
        request.user_message.clear();
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains(
            "<instruction>\nTranslate source_text to target_language, taking into account the source_context and glossary information provided above.\n</instruction>"
        ));
        assert!(!prompt.contains("<user_request>"));
    }

    #[test]
    fn assistant_prompt_uses_target_language_history_instead_of_current_target() {
        let mut request = assistant_request_for_prompt();
        request.row.target_language_history = vec![
            AiAssistantTargetLanguageHistoryEntry {
                revision_number: 1,
                source_type: "file_import".to_string(),
                source_label: "file_import".to_string(),
                author_type: "current_user".to_string(),
                author_name: "sirhans".to_string(),
                author_login: "sirhans".to_string(),
                author_email: "sirhans@users.noreply.github.com".to_string(),
                operation_type: Some("import".to_string()),
                ai_model: None,
                committed_at: "2026-05-04T00:00:00Z".to_string(),
                text: "Ban dich nhap".to_string(),
            },
            AiAssistantTargetLanguageHistoryEntry {
                revision_number: 2,
                source_type: "ai_model".to_string(),
                source_label: "GPT 5.4".to_string(),
                author_type: "current_user".to_string(),
                author_name: "sirhans".to_string(),
                author_login: "sirhans".to_string(),
                author_email: "sirhans@users.noreply.github.com".to_string(),
                operation_type: Some("ai-translation".to_string()),
                ai_model: Some("gpt-5.4".to_string()),
                committed_at: "2026-05-04T00:01:00Z".to_string(),
                text: "Ban dich AI".to_string(),
            },
            AiAssistantTargetLanguageHistoryEntry {
                revision_number: 3,
                source_type: "current_user".to_string(),
                source_label: "current_user".to_string(),
                author_type: "current_user".to_string(),
                author_name: "sirhans".to_string(),
                author_login: "sirhans".to_string(),
                author_email: "sirhans@users.noreply.github.com".to_string(),
                operation_type: Some("editor-update".to_string()),
                ai_model: None,
                committed_at: "2026-05-04T00:02:00Z".to_string(),
                text: "Ban dich nguoi dung".to_string(),
            },
        ];
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains("<target_language_history>"));
        assert!(prompt
            .contains("The final revision is the current target-language draft in the editor."));
        assert!(prompt.contains("1. origin=human, source=file_import, committedBy=current_user"));
        assert!(prompt.contains(
            "2. origin=AI, source=GPT 5.4, sourceType=ai_model, committedBy=current_user"
        ));
        assert!(prompt.contains("aiModel=gpt-5.4"));
        assert!(prompt.contains("3. origin=human, source=current_user, committedBy=current_user"));
        assert!(prompt.contains("text:\nBan dich nguoi dung"));
        assert!(!prompt.contains("Current target:"));
    }

    #[test]
    fn assistant_prompt_includes_reference_translations_without_history() {
        let mut request = assistant_request_for_prompt();
        request.row.alternate_language_texts = vec![
            AiAssistantRowLanguageText {
                language_code: "en".to_string(),
                language_label: "English".to_string(),
                text: "Current English reference".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "it".to_string(),
                language_label: String::new(),
                text: "Traduzione italiana".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "ru".to_string(),
                language_label: "Russian".to_string(),
                text: "   ".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "es".to_string(),
                language_label: "Spanish".to_string(),
                text: "Do not include source entry".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "vi".to_string(),
                language_label: "Vietnamese".to_string(),
                text: "Do not include target entry".to_string(),
            },
        ];
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains("<reference_translations>"));
        assert!(prompt.contains(
            "The following is a list of translations into other languages. They may have errors, so do not consider these authoritative unless the user explicitly asks you to consult them."
        ));
        assert!(prompt.contains("Reference language translations:\nEnglish: Current English reference\nit: Traduzione italiana"));
        assert_eq!(
            prompt.matches("Reference language translations:").count(),
            1
        );
        assert!(!prompt.contains("Do not include source entry"));
        assert!(!prompt.contains("Do not include target entry"));
        assert!(!prompt.contains("Russian:"));
        assert!(!prompt.contains("source=file_import"));
        assert!(!prompt.contains("committedAt="));
    }

    #[test]
    fn assistant_prompt_keeps_duplicate_base_sibling_reference_translations() {
        let mut request = assistant_request_for_prompt();
        request.row.target_language_code = "zh-Hans".to_string();
        request.row.target_language_label = "Chinese 1".to_string();
        request.row.alternate_language_texts = vec![
            AiAssistantRowLanguageText {
                language_code: "zh-Hans".to_string(),
                language_label: "Chinese 1".to_string(),
                text: "Do not include selected Chinese 1 target".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "zh-Hans-x-2".to_string(),
                language_label: "Chinese 2".to_string(),
                text: "Chinese sibling reference".to_string(),
            },
        ];
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains("Chinese 2: Chinese sibling reference"));
        assert!(!prompt.contains("Do not include selected Chinese 1 target"));

        request.row.target_language_code = "zh-Hans-x-2".to_string();
        request.row.target_language_label = "Chinese 2".to_string();
        request.row.alternate_language_texts = vec![
            AiAssistantRowLanguageText {
                language_code: "zh-Hans".to_string(),
                language_label: "Chinese 1".to_string(),
                text: "Chinese first-column reference".to_string(),
            },
            AiAssistantRowLanguageText {
                language_code: "zh-Hans-x-2".to_string(),
                language_label: "Chinese 2".to_string(),
                text: "Do not include selected Chinese 2 target".to_string(),
            },
        ];
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains("Chinese 1: Chinese first-column reference"));
        assert!(!prompt.contains("Do not include selected Chinese 2 target"));
    }

    #[test]
    fn assistant_chat_prompt_allows_model_to_return_translation_draft() {
        let prompt = build_assistant_chat_prompt(&assistant_request_for_prompt());

        assert!(prompt.contains(
            "set draftTranslationText to only that translation text and do not repeat it inside assistantText."
        ));
        assert!(prompt.contains("Otherwise set draftTranslationText to null."));
    }

    #[test]
    fn assistant_structured_response_accepts_openai_response_kind() {
        let response = parse_assistant_structured_response(
            r#"{
                "responseKind": "translation_draft",
                "assistantText": "Here is a smoother version.",
                "draftTranslationText": "Ban dich muot ma hon."
            }"#,
            AiAssistantTurnKind::Chat,
        )
        .unwrap();

        assert_eq!(response.assistant_text, "Here is a smoother version.");
        assert_eq!(
            response.draft_translation_text.as_deref(),
            Some("Ban dich muot ma hon.")
        );
    }

    #[test]
    fn assistant_structured_response_accepts_empty_text_with_translation_draft() {
        let response = parse_assistant_structured_response(
            r#"{
                "assistantText": "",
                "draftTranslationText": "Trong những khoảnh khắc này, bạn sẽ quan sát những tư tưởng đến với tâm trí mình; hãy khảo sát chúng, nhưng không xua đuổi hay kết án chúng, và không đồng nhất bản thân với chúng, để chúng tự biến mất, như những con chim bay qua không gian, không để lại dấu vết.",
                "responseKind": "translation_draft"
            }"#,
            AiAssistantTurnKind::TranslateRefinement,
        )
        .unwrap();

        assert_eq!(response.assistant_text, "");
        assert_eq!(
            response.draft_translation_text.as_deref(),
            Some("Trong những khoảnh khắc này, bạn sẽ quan sát những tư tưởng đến với tâm trí mình; hãy khảo sát chúng, nhưng không xua đuổi hay kết án chúng, và không đồng nhất bản thân với chúng, để chúng tự biến mất, như những con chim bay qua không gian, không để lại dấu vết.")
        );
    }

    #[test]
    fn assistant_structured_response_accepts_legacy_shape_without_response_kind() {
        let response = parse_assistant_structured_response(
            r#"{
                "assistantText": "This row refers to the inner work.",
                "draftTranslationText": null
            }"#,
            AiAssistantTurnKind::Chat,
        )
        .unwrap();

        assert_eq!(
            response.assistant_text,
            "This row refers to the inner work."
        );
        assert_eq!(response.draft_translation_text, None);
    }

    #[test]
    fn assistant_translate_refinement_rejects_missing_draft_translation() {
        let error = parse_assistant_structured_response(
            r#"{
                "responseKind": "commentary",
                "assistantText": "This is already good.",
                "draftTranslationText": null
            }"#,
            AiAssistantTurnKind::TranslateRefinement,
        )
        .unwrap_err();

        assert_eq!(error, "The AI assistant returned a malformed response.");
    }

    #[test]
    fn assistant_prompt_includes_updated_row_text_before_conversation_history() {
        let mut request = assistant_request_for_prompt();
        request.row.updated_source_text = Some("Fuente actualizada".to_string());
        request.row.updated_target_text = Some("Ban dich moi".to_string());
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains(
            "<source_text>\nFuente actual\n</source_text>\n\n<updated_source_text>\nFuente actualizada\n</updated_source_text>\n\n<updated_target_text>\nBan dich moi\n</updated_target_text>\n\n<conversation_history>\n- assistant: Earlier answer.\n</conversation_history>\n\n<user_request>\nMake it more natural.\n</user_request>"
        ));
    }

    #[test]
    fn assistant_prompt_includes_updated_empty_text_when_field_was_cleared() {
        let mut request = assistant_request_for_prompt();
        request.row.updated_target_text = Some(String::new());
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains(
            "<source_text>\nFuente actual\n</source_text>\n\n<updated_target_text>\n(empty)\n</updated_target_text>\n\n<conversation_history>\n- assistant: Earlier answer.\n</conversation_history>"
        ));
    }
}
