pub mod providers;
pub mod types;

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::AppHandle;

use crate::ai::types::{
    AiModelProbeRequest, AiPromptRequest, AiProviderId, AiProviderModel, AiReviewRequest,
    AiReviewResponse, AiTranslatedGlossaryEntry, AiTranslatedGlossaryPreparationRequest,
    AiTranslatedGlossaryPreparationResponse, AiTranslatedGlossaryTermInput,
    AiTranslationGlossaryHint, AiTranslationRequest, AiTranslationResponse,
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

const GLOSSARY_ALIGNMENT_BATCH_SIZE: usize = 8;
const GLOSSARY_CONTEXT_RADIUS_BYTES: usize = 72;

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
    token.chars().flat_map(|character| character.to_lowercase()).collect()
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
        if values.iter().any(|existing_value| existing_value == incoming_value) {
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
                append_unique_term_values(&mut existing_candidate.target_variants, &target_variants);
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
    let context_start = clamp_to_char_boundary_left(text, start.saturating_sub(GLOSSARY_CONTEXT_RADIUS_BYTES));
    let context_end = clamp_to_char_boundary_right(text, (end + GLOSSARY_CONTEXT_RADIUS_BYTES).min(text.len()));
    let prefix = if context_start > 0 { "..." } else { "" };
    let suffix = if context_end < text.len() { "..." } else { "" };
    format!("{prefix}{}{suffix}", text[context_start..context_end].trim())
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

                let is_match = candidate
                    .tokens
                    .iter()
                    .enumerate()
                    .all(|(candidate_index, token)| words[word_index + candidate_index].normalized == *token);
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
                glossary_source_context: build_glossary_match_context(glossary_source_text, start, end),
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
    serde_json::from_str(json_text)
        .map_err(|_| "The glossary alignment response did not match the expected JSON shape.".to_string())
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
    }
}

fn load_ai_provider_api_key(app: &AppHandle, provider_id: AiProviderId) -> Result<String, String> {
    load_ai_provider_secret(app, provider_id)?.ok_or_else(|| {
        format!(
            "No {} API key is saved yet. Open the AI Settings page and save one first.",
            provider_id.display_name()
        )
    })
}

pub(crate) fn load_ai_provider_models(
    app: &AppHandle,
    provider_id: AiProviderId,
) -> Result<Vec<AiProviderModel>, String> {
    let api_key = load_ai_provider_api_key(app, provider_id)?;

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

    let api_key = load_ai_provider_api_key(app, request.provider_id)?;

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

    let api_key = load_ai_provider_api_key(app, request.provider_id)?;
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

    let api_key = load_ai_provider_api_key(app, request.provider_id)?;

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

    let api_key = load_ai_provider_api_key(app, request.provider_id)?;

    providers::probe_model(request.provider_id, request.model_id.trim(), &api_key)
}

#[cfg(test)]
mod tests {
    use super::{build_translation_prompt, find_matched_glossary_terms};
    use crate::ai::types::{
        AiProviderId, AiTranslatedGlossaryTermInput, AiTranslationGlossaryHint,
        AiTranslationRequest,
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
            vec![
                "buong noi tam".to_string(),
                "phong ben trong".to_string(),
            ]
        );
        assert_eq!(
            matches[0].notes,
            vec!["Nota 1".to_string(), "Nota 2".to_string()]
        );
    }
}
