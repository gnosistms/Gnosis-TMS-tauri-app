pub mod providers;
pub mod types;

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::ai::types::{
    AiAssistantConcordanceHit, AiAssistantRowWindowEntry, AiAssistantTranscriptEntry,
    AiAssistantTurnKind, AiAssistantTurnRequest, AiAssistantTurnResponse, AiModelProbeRequest,
    AiPromptOutputFormat, AiPromptRequest, AiProviderContinuationMetadata, AiProviderId,
    AiProviderModel, AiReviewRequest, AiReviewResponse, AiTranslatedGlossaryEntry,
    AiTranslatedGlossaryPreparationRequest, AiTranslatedGlossaryPreparationResponse,
    AiTranslatedGlossaryTermInput, AiTranslationGlossaryHint, AiTranslationRequest,
    AiTranslationResponse,
};
use crate::ai_secret_storage::load_ai_provider_secret;

pub(crate) fn build_review_prompt(request: &AiReviewRequest) -> String {
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
        "Translate {source_label} to {target_label}, outputting only the translation.\n\nGlossary hints:\n- Apply a glossary hint only when its sourceTerm appears in the source text.\n- targetVariants is sorted in order of preference, best first. Use later variants only when grammar or context requires it.\n- If a targetVariant uses the notation base[ruby: annotation], preserve that ruby annotation when using the term.\n- Use notes as translation guidance when they are present.\n\n{glossary_hints}\n\nSource text:\n{}",
        request.text
    )
}

fn format_translation_glossary_hints(hints: &[AiTranslationGlossaryHint]) -> String {
    hints
        .iter()
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
            let no_translation_position = hint.no_translation_position.as_deref().unwrap_or("").trim();
            if source_term.is_empty()
                || (target_variants.is_empty()
                    && notes.is_empty()
                    && no_translation_position.is_empty())
            {
                return None;
            }

            let mut lines = vec![format!("- sourceTerm: \"{source_term}\"")];
            if no_translation_position == "only" {
                lines.push(format!(
                    "  Leave '{source_term}' out of your translation."
                ));
            } else {
                if no_translation_position == "first" {
                    lines.push(format!(
                        "  Usually, the word {source_term} should be left out of the translation, however, if the context calls for it, you may consider one of the following translations:"
                    ));
                }

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

                if no_translation_position == "later" {
                    lines.push(format!(
                        "  If it makes the translation smoother or easier to understand, leave '{source_term}' out of the translation."
                    ));
                }
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

fn push_prompt_section(sections: &mut Vec<String>, label: &str, value: impl AsRef<str>) {
    let trimmed = value.as_ref().trim();
    if trimmed.is_empty() {
        return;
    }

    sections.push(format!("{label}:\n{trimmed}"));
}

fn push_optional_prompt_section(sections: &mut Vec<String>, label: &str, value: &Option<String>) {
    if let Some(value) = value {
        let trimmed = value.trim();
        sections.push(format!(
            "{label}:\n{}",
            if trimmed.is_empty() { "(empty)" } else { trimmed }
        ));
    }
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

fn format_assistant_user_action(request: &AiAssistantTurnRequest) -> String {
    let user_message = request.user_message.trim();
    if !user_message.is_empty() {
        return format!("User request:\n{user_message}");
    }

    format!(
        "Instruction:\nTranslate source_text to target_language, taking into account the source_context and glossary information provided above."
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
Use the supplied source context, current target, glossary, and conversation history when relevant.\n\
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

    push_prompt_section(
        &mut sections,
        "source_context",
        format!(
            "This is the source text in context, provided to help you understand source_text more clearly:\n{source_context}"
        ),
    );
    push_prompt_section(&mut sections, "source_language", source_language);
    push_prompt_section(&mut sections, "target_language", target_language);
    push_prompt_section(&mut sections, "Current target", &row.target_text);
    push_prompt_section(&mut sections, "Glossary", glossary_hints);
    push_prompt_section(&mut sections, "Document digest", &request.document_digest);
    push_prompt_section(
        &mut sections,
        "Document revision key",
        &request.document_revision_key,
    );
    let concordance_hits = format_assistant_concordance_hits(&request.concordance_hits);
    if concordance_hits != "None." {
        push_prompt_section(&mut sections, "Concordance hits", concordance_hits);
    }
    push_prompt_section(&mut sections, "source_text", &row.source_text);
    push_optional_prompt_section(&mut sections, "updated_source_text", &row.updated_source_text);
    push_optional_prompt_section(&mut sections, "updated_target_text", &row.updated_target_text);
    push_prompt_section(&mut sections, "Conversation history", conversation_history);
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
            if parsed.assistant_text.trim().is_empty() {
                continue;
            }
            if kind == AiAssistantTurnKind::TranslateRefinement
                && parsed
                    .draft_translation_text
                    .as_ref()
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
            {
                continue;
            }
            return Ok(parsed);
        }
    }

    Err("The AI assistant returned a malformed response.".to_string())
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
    target_variants: Vec<String>,
    notes: Vec<String>,
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
    target_variants: Vec<String>,
    notes: Vec<String>,
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
        let target_variants = sanitize_term_list(&term.target_variants);
        let notes = sanitize_term_list(&term.notes);
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
                append_unique_term_values(
                    &mut existing_candidate.target_variants,
                    &target_variants,
                );
                append_unique_term_values(&mut existing_candidate.notes, &notes);
                continue;
            }

            merged_candidates_by_key.insert(
                candidate_key,
                PreparedGlossaryCandidate {
                    match_term: source_term,
                    tokens,
                    target_variants: target_variants.clone(),
                    notes: notes.clone(),
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
                notes: candidate.notes,
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
        source_language: request.translation_source_language.clone(),
        target_language: request.glossary_source_language.clone(),
        glossary_hints: vec![],
        installation_id: request.installation_id,
    }
}

fn load_ai_provider_api_key(
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
    if request.text.trim().is_empty() {
        return Err("There is no text to review yet.".to_string());
    }
    if request.model_id.trim().is_empty() {
        return Err(format!(
            "Select a {} model on the AI Settings page before running Review.",
            request.provider_id.display_name()
        ));
    }

    let api_key = load_ai_provider_api_key(app, request.provider_id, request.installation_id)?;

    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: request.provider_id,
            model_id: request.model_id.clone(),
            prompt: build_review_prompt(&request),
            previous_response_id: None,
            output_format: AiPromptOutputFormat::Text,
        },
        &api_key,
    )?;

    Ok(AiReviewResponse {
        suggested_text: response.text,
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
            &AiPromptRequest {
                provider_id: request.provider_id,
                model_id: request.model_id.clone(),
                prompt: build_glossary_alignment_prompt(
                    &request,
                    &glossary_source_text,
                    matched_term_batch,
                ),
                previous_response_id: None,
                output_format: AiPromptOutputFormat::Text,
            },
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
                notes: matched_term.notes.clone(),
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
    if request.text.trim().is_empty() {
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
            output_format: AiPromptOutputFormat::Text,
        },
        &api_key,
    )?;

    Ok(AiTranslationResponse {
        translated_text: response.text,
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
    let structured_response = parse_assistant_structured_response(&response.text, request.kind)?;
    let _response_kind = structured_response.response_kind.as_ref();

    Ok(AiAssistantTurnResponse {
        assistant_text: structured_response.assistant_text,
        draft_translation_text: structured_response.draft_translation_text,
        prompt_text: prompt,
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
        build_assistant_chat_prompt, build_translation_prompt, find_matched_glossary_terms,
        parse_assistant_structured_response,
    };
    use crate::ai::types::{
        AiAssistantRowContext, AiAssistantRowWindowEntry, AiAssistantTranscriptEntry,
        AiAssistantTurnKind, AiAssistantTurnRequest, AiProviderId, AiTranslatedGlossaryTermInput,
        AiTranslationGlossaryHint, AiTranslationRequest,
    };

    #[test]
    fn build_translation_prompt_keeps_plain_prompt_when_no_glossary_hints_are_present() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Hola".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            installation_id: None,
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
                target_variants: vec!["hoc tro gnosis".to_string(), "cua gnosis".to_string()],
                no_translation_position: None,
                notes: vec!["Lien quan den Gnosis".to_string()],
            }],
            installation_id: None,
        });

        assert!(prompt.contains(
            "targetVariants is sorted in order of preference, best first. Use later variants only when grammar or context requires it."
        ));
        assert!(prompt.contains(
            "If a targetVariant uses the notation base[ruby: annotation], preserve that ruby annotation when using the term."
        ));
        assert!(prompt.contains("- sourceTerm: \"gnostica\""));
        assert!(prompt.contains("  targetVariants: \"hoc tro gnosis\", \"cua gnosis\""));
        assert!(prompt.contains("  notes: \"Lien quan den Gnosis\""));
        assert!(prompt.contains("Source text:\nLa gnostica habla."));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_only_guidance() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec![],
                no_translation_position: Some("only".to_string()),
                notes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains("- sourceTerm: \"mente\""));
        assert!(prompt.contains("  Leave 'mente' out of your translation."));
        assert!(!prompt.contains("targetVariants:"));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_preface_when_empty_variant_is_first() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec!["tam".to_string(), "tri".to_string()],
                no_translation_position: Some("first".to_string()),
                notes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains("Usually, the word mente should be left out of the translation, however, if the context calls for it, you may consider one of the following translations:"));
        assert!(prompt.contains("  targetVariants: \"tam\", \"tri\""));
    }

    #[test]
    fn build_translation_prompt_includes_no_translation_fallback_when_empty_variant_is_later() {
        let prompt = build_translation_prompt(&AiTranslationRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "La mente canta.".to_string(),
            source_language: "Spanish".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![AiTranslationGlossaryHint {
                source_term: "mente".to_string(),
                target_variants: vec!["tam".to_string(), "tri".to_string()],
                no_translation_position: Some("later".to_string()),
                notes: vec![],
            }],
            installation_id: None,
        });

        assert!(prompt.contains("  targetVariants: \"tam\", \"tri\""));
        assert!(prompt.contains(
            "  If it makes the translation smoother or easier to understand, leave 'mente' out of the translation."
        ));
    }

    #[test]
    fn matched_glossary_terms_merge_duplicate_source_terms() {
        let matches = find_matched_glossary_terms(
            "La camara interior brilla.",
            &[
                AiTranslatedGlossaryTermInput {
                    glossary_source_terms: vec!["camara interior".to_string()],
                    target_variants: vec!["buong noi tam".to_string()],
                    notes: vec!["Nota 1".to_string()],
                },
                AiTranslatedGlossaryTermInput {
                    glossary_source_terms: vec!["camara interior".to_string()],
                    target_variants: vec!["phong ben trong".to_string()],
                    notes: vec!["Nota 2".to_string()],
                },
            ],
        );

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].glossary_source_term, "camara interior");
        assert_eq!(
            matches[0].target_variants,
            vec!["buong noi tam".to_string(), "phong ben trong".to_string(),]
        );
        assert_eq!(
            matches[0].notes,
            vec!["Nota 1".to_string(), "Nota 2".to_string()]
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
                target_variants: vec!["nguon".to_string()],
                no_translation_position: None,
                notes: vec![],
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
            "source_context:\nThis is the source text in context, provided to help you understand source_text more clearly:\nLinea anterior 3\nLinea anterior 2\nLinea anterior 1\nFuente actual\nLinea siguiente 1"
        ));
        assert!(
            prompt.contains(
                "source_text:\nFuente actual\n\nConversation history:\n- assistant: Earlier answer.\n\nUser request:\nMake it more natural."
            )
        );
        assert!(!prompt.contains("previous_row_1"));
        assert!(!prompt.contains("Row window context: None."));
    }

    #[test]
    fn assistant_prompt_omits_empty_sections_and_uses_single_glossary_section() {
        let prompt = build_assistant_chat_prompt(&assistant_request_for_prompt());

        assert!(!prompt.contains("Document digest:"));
        assert!(!prompt.contains("Document revision key:"));
        assert!(!prompt.contains("Concordance hits:"));
        assert!(!prompt.contains("None."));
        assert_eq!(prompt.matches("Glossary:").count(), 1);
    }

    #[test]
    fn assistant_prompt_uses_default_instruction_when_user_request_is_empty() {
        let mut request = assistant_request_for_prompt();
        request.user_message.clear();
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains(
            "Instruction:\nTranslate source_text to target_language, taking into account the source_context and glossary information provided above."
        ));
        assert!(!prompt.contains("User request:"));
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
    fn assistant_structured_response_accepts_legacy_shape_without_response_kind() {
        let response = parse_assistant_structured_response(
            r#"{
                "assistantText": "This row refers to the inner work.",
                "draftTranslationText": null
            }"#,
            AiAssistantTurnKind::Chat,
        )
        .unwrap();

        assert_eq!(response.assistant_text, "This row refers to the inner work.");
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
            "source_text:\nFuente actual\n\nupdated_source_text:\nFuente actualizada\n\nupdated_target_text:\nBan dich moi\n\nConversation history:\n- assistant: Earlier answer.\n\nUser request:\nMake it more natural."
        ));
    }

    #[test]
    fn assistant_prompt_includes_updated_empty_text_when_field_was_cleared() {
        let mut request = assistant_request_for_prompt();
        request.row.updated_target_text = Some(String::new());
        let prompt = build_assistant_chat_prompt(&request);

        assert!(prompt.contains(
            "source_text:\nFuente actual\n\nupdated_target_text:\n(empty)\n\nConversation history:\n- assistant: Earlier answer."
        ));
    }
}
