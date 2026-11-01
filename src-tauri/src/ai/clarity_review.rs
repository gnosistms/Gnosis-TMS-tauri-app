//! "Identify parts that are difficult to understand": the AI Review mode that
//! reads a translation the way its reader would (target text only, with
//! neighbouring rows for context) and explains, in a comment, any part whose
//! meaning is unclear. It never suggests text changes.
//! See plans/ai-review-clarity-flags-plan.md.

use std::collections::HashSet;

use serde_json::json;

use super::{
    batch_response_candidates, format_language_ref, format_review_target_sections,
    retain_known_unique_rows, strip_markdown_code_fence,
};
use crate::ai::types::{
    AiAssistantRowWindowEntry, AiPromptOutputFormat, AiReviewBatchRequest, AiReviewBatchRowResult,
    AiReviewGlossaryTerm, AiReviewRequest, AiReviewResponse,
};

pub(super) const CLARITY_REVIEW_MODE: &str = "clarity";

fn target_language_label(label: &str, code: &str) -> String {
    let label = label.trim();
    if label.is_empty() {
        let code = code.trim();
        if code.is_empty() {
            "the target language".to_string()
        } else {
            code.to_string()
        }
    } else {
        label.to_string()
    }
}

fn clarity_guidance(target_label: &str) -> [String; 3] {
    [
        format!(
            "Task:\nYou are checking a {target_label} translation for parts that a reader would find difficult to understand. Read it as a fluent {target_label} reader who has only the translation, not the original text. Do not correct, rewrite, or improve anything."
        ),
        "When to flag:\nFlag a row only when a fluent reader could not work out what part of it means, or when part of it has more than one plausible meaning and the surrounding text does not settle which one is meant. A row's footnotes and image caption are part of the row. Do not flag text that is dense, formal, technical, or literary, or that uses specialist vocabulary, when a careful reader can still work out what it means. Do not flag spelling, grammar, punctuation, or style unless it makes the meaning unclear. Do not flag a heading, a list item, or a sentence that begins or continues in a neighbouring row merely for being incomplete on its own."
            .to_string(),
        format!(
            "Comment rule:\nFor a flagged row, write a short comment in {target_label} for the translator: quote the words that are unclear, say what makes them hard to understand, and if there are competing readings, name them. If the unclear part is in a footnote or the image caption, say so. Do not suggest a rewritten version. Use one to three sentences. For a row that reads clearly, return an empty comment."
        ),
    ]
}

/// The rule and the term list for the glossary terms the editor underlines in
/// the text, or `None` when there are none. Technical glossary terms alone made
/// the model flag otherwise clear rows.
fn glossary_terms_sections(
    target_label: &str,
    terms: &[AiReviewGlossaryTerm],
) -> Option<[String; 2]> {
    let values = terms
        .iter()
        .filter(|term| !term.target_term.trim().is_empty())
        .map(|term| {
            json!({
                "sourceTerm": term.source_term.trim(),
                "targetTerm": term.target_term.trim(),
            })
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        return None;
    }
    Some([
        format!(
            "Glossary terms rule:\nEach entry in <glossary_terms> pairs a term in the original text with the approved {target_label} glossary term the translation uses for it. The translator is required to use these terms. A row's use of one of them is not, on its own, a reason to flag it, even when the term is technical, specialised, or unfamiliar to a general reader. Flag such a row only when it would still be hard to understand for a reader who knows what the glossary terms mean."
        ),
        format!(
            "<glossary_terms format=\"json\">\n{}\n</glossary_terms>",
            serde_json::Value::Array(values)
        ),
    ])
}

fn format_target_context(entries: &[AiAssistantRowWindowEntry]) -> String {
    entries
        .iter()
        .map(|entry| entry.target_text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn push_context(sections: &mut Vec<String>, tag: &str, description: &str, context: &str) {
    if !context.is_empty() {
        sections.push(format!("<{tag}>\n{description}\n\n{context}\n</{tag}>"));
    }
}

fn clarity_response_contract() -> &'static str {
    "Return only valid JSON:\n{\"comment\":\"\"}"
}

fn clarity_batch_response_contract() -> &'static str {
    "Return only valid JSON:\n{\"rows\":[{\"rowId\":\"\",\"comment\":\"\"}]}\nReturn exactly one entry per row in <rows_to_check>, in the same order, each with its matching rowId."
}

pub(super) fn build_clarity_review_prompt(request: &AiReviewRequest) -> String {
    let target_code = if request.target_language_code.trim().is_empty() {
        &request.language_code
    } else {
        &request.target_language_code
    };
    let target_label = target_language_label(&request.target_language, target_code);
    let latest_translation = request
        .latest_translation
        .as_deref()
        .unwrap_or(&request.text)
        .trim();

    // The window is the rows before, the reviewed row, and the rows after.
    let row_id = request.row_id.trim();
    let row_index = request
        .row_window
        .iter()
        .position(|entry| !row_id.is_empty() && entry.row_id.trim() == row_id);
    let (before, after) = match row_index {
        Some(index) => (
            &request.row_window[..index],
            &request.row_window[index + 1..],
        ),
        None => (&request.row_window[..0], &request.row_window[..0]),
    };

    let glossary_terms = glossary_terms_sections(&target_label, &request.glossary_terms);

    let mut sections = vec![clarity_response_contract().to_string()];
    sections.extend(clarity_guidance(&target_label));
    if let Some([rule, _]) = &glossary_terms {
        sections.push(rule.clone());
    }
    sections.push(format!(
        "<languages>\ntarget: {}\n</languages>",
        format_language_ref(&request.target_language, target_code)
    ));
    if let Some([_, list]) = glossary_terms {
        sections.push(list);
    }
    push_context(
        &mut sections,
        "context_before",
        "These rows come immediately before the row you are checking, for context only.",
        &format_target_context(before),
    );
    sections.push(format!(
        "<row_to_check>\n{}\n</row_to_check>",
        format_review_target_sections(
            latest_translation,
            &request.footnotes,
            &request.image_caption
        )
    ));
    push_context(
        &mut sections,
        "context_after",
        "These rows come immediately after the row you are checking, for context only.",
        &format_target_context(after),
    );
    sections.push(clarity_response_contract().to_string());
    sections.join("\n\n")
}

pub(super) fn build_clarity_review_batch_prompt(request: &AiReviewBatchRequest) -> String {
    let target_code = if request.target_language_code.trim().is_empty() {
        &request.language_code
    } else {
        &request.target_language_code
    };
    let target_label = target_language_label(&request.target_language, target_code);

    let glossary_terms = glossary_terms_sections(&target_label, &request.glossary_terms);

    let mut sections = vec![clarity_batch_response_contract().to_string()];
    sections.extend(clarity_guidance(&target_label));
    if let Some([rule, _]) = &glossary_terms {
        sections.push(rule.clone());
    }
    sections.push(
        "Rows rule:\nThe rows in <rows_to_check> are consecutive and form one continuous text. Read them together with the context rows, judge each row in that context, and flag the row that contains the unclear words."
            .to_string(),
    );
    sections.push(format!(
        "<languages>\ntarget: {}\n</languages>",
        format_language_ref(&request.target_language, target_code)
    ));
    if let Some([_, list]) = glossary_terms {
        sections.push(list);
    }
    push_context(
        &mut sections,
        "context_before",
        "These rows come immediately before the rows you are checking, for context only.",
        &format_target_context(&request.context_before),
    );
    let rows_block = request
        .rows
        .iter()
        .map(|row| {
            format!(
                "<row id=\"{}\">\n{}\n</row>",
                row.row_id.trim(),
                format_review_target_sections(
                    row.latest_translation.trim(),
                    &row.footnotes,
                    &row.image_caption,
                )
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    sections.push(format!(
        "<rows_to_check>\nThese are the only rows you are checking.\n\n{rows_block}\n</rows_to_check>"
    ));
    push_context(
        &mut sections,
        "context_after",
        "These rows come immediately after the rows you are checking, for context only.",
        &format_target_context(&request.context_after),
    );
    sections.push(clarity_batch_response_contract().to_string());
    sections.join("\n\n")
}

pub(super) fn clarity_output_format() -> AiPromptOutputFormat {
    AiPromptOutputFormat::JsonSchema {
        name: "ai_clarity_review_response".to_string(),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["comment"],
            "properties": {
                "comment": { "type": "string" }
            }
        }),
    }
}

pub(super) fn clarity_batch_output_format() -> AiPromptOutputFormat {
    AiPromptOutputFormat::JsonSchema {
        name: "ai_clarity_review_batch_response".to_string(),
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["rows"],
            "properties": {
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["rowId", "comment"],
                        "properties": {
                            "rowId": { "type": "string" },
                            "comment": { "type": "string" }
                        }
                    }
                }
            }
        }),
    }
}

// `comment` is not defaulted: a response without it is malformed, not a
// verdict that the row reads clearly.
#[derive(serde::Deserialize)]
struct ClarityStructuredResponse {
    comment: String,
}

#[derive(serde::Deserialize)]
struct ClarityBatchStructuredResponse {
    rows: Vec<ClarityBatchStructuredRow>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClarityBatchStructuredRow {
    #[serde(default)]
    row_id: String,
    // Rows without a comment field are dropped so the caller retries them
    // through the single-row path, as rows without `reviewed` are in review.
    comment: Option<String>,
}

fn clarity_review_response(comment: String) -> AiReviewResponse {
    AiReviewResponse {
        suggested_text: String::new(),
        suggested_footnotes: Vec::new(),
        suggested_image_caption: String::new(),
        reviewed: None,
        comment: comment.trim().to_string(),
        prompt_text: String::new(),
    }
}

pub(super) fn parse_clarity_review_response(text: &str) -> Result<AiReviewResponse, String> {
    let trimmed = text.trim();
    let stripped = strip_markdown_code_fence(trimmed);
    let object_slice = trimmed
        .find('{')
        .and_then(|start| trimmed.rfind('}').map(|end| &trimmed[start..=end]));
    for candidate in [trimmed, stripped].into_iter().chain(object_slice) {
        if let Ok(parsed) = serde_json::from_str::<ClarityStructuredResponse>(candidate) {
            return Ok(clarity_review_response(parsed.comment));
        }
    }
    Err("The AI review returned a malformed response.".to_string())
}

/// Parses a clarity batch response, keeping only requested row ids (first
/// occurrence wins). Returns the rows and any unknown ids the model returned.
pub(super) fn parse_clarity_review_batch_response(
    text: &str,
    request: &AiReviewBatchRequest,
) -> Result<(Vec<AiReviewBatchRowResult>, Vec<String>), String> {
    for candidate in batch_response_candidates(text) {
        if let Ok(parsed) = serde_json::from_str::<ClarityBatchStructuredResponse>(&candidate) {
            let rows = parsed
                .rows
                .into_iter()
                .filter_map(|row| {
                    Some(AiReviewBatchRowResult {
                        row_id: row.row_id.trim().to_string(),
                        suggested_text: String::new(),
                        suggested_footnotes: Vec::new(),
                        suggested_image_caption: String::new(),
                        reviewed: false,
                        comment: row.comment?.trim().to_string(),
                    })
                })
                .collect::<Vec<_>>();
            let allowed: HashSet<String> = request
                .rows
                .iter()
                .map(|row| row.row_id.trim().to_string())
                .collect();
            return Ok(retain_known_unique_rows(rows, &allowed, |row| {
                row.row_id.clone()
            }));
        }
    }
    Err("The AI review returned a malformed batch response.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::{AiProviderId, AiReviewBatchRowInput, AiReviewFootnote};

    fn window_entry(row_id: &str, target_text: &str) -> AiAssistantRowWindowEntry {
        AiAssistantRowWindowEntry {
            row_id: row_id.to_string(),
            source_text: format!("source {row_id}"),
            target_text: target_text.to_string(),
        }
    }

    fn clarity_request() -> AiReviewRequest {
        AiReviewRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            text: "Câu cần kiểm tra".to_string(),
            language_code: "vi".to_string(),
            footnotes: vec![AiReviewFootnote {
                marker: 1,
                text: "Chú thích".to_string(),
            }],
            image_caption: String::new(),
            review_mode: Some("clarity".to_string()),
            latest_translation: Some("Câu cần kiểm tra".to_string()),
            source_text: Some("Source sentence".to_string()),
            source_footnotes: vec![],
            source_image_caption: String::new(),
            source_language_code: "en".to_string(),
            target_language_code: "vi".to_string(),
            source_language: "English".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            glossary_terms: vec![],
            qa_hints: vec![],
            alternate_language_texts: vec![],
            target_language_history: vec![],
            row_window: vec![
                window_entry("r1", "Câu trước"),
                window_entry("r2", "Câu cần kiểm tra"),
                window_entry("r3", "Câu sau"),
            ],
            row_id: "r2".to_string(),
            installation_id: None,
        }
    }

    #[test]
    fn single_prompt_uses_target_text_and_splits_context_at_the_row() {
        let prompt = build_clarity_review_prompt(&clarity_request());

        assert!(prompt.starts_with(clarity_response_contract()));
        assert!(prompt.contains("Read it as a fluent Vietnamese reader"));
        assert!(prompt.contains("write a short comment in Vietnamese"));
        assert!(prompt.contains("<context_before>\nThese rows come immediately before the row you are checking, for context only.\n\nCâu trước\n</context_before>"));
        assert!(prompt.contains(
            "<row_to_check>\n<latest_translation>\nCâu cần kiểm tra\n</latest_translation>"
        ));
        assert!(prompt.contains("<latest_footnotes format=\"json\">"));
        assert!(prompt.contains("<context_after>\nThese rows come immediately after the row you are checking, for context only.\n\nCâu sau\n</context_after>"));
        // The reader of the translation never sees the source.
        assert!(!prompt.contains("Source sentence"));
        assert!(!prompt.contains("source r1"));
        assert!(!prompt.contains("English"));
    }

    #[test]
    fn prompts_list_underlined_glossary_terms_and_say_they_are_not_enough_to_flag() {
        let mut request = clarity_request();
        let prompt = build_clarity_review_prompt(&request);
        assert!(!prompt.contains("Glossary terms rule:"));
        assert!(!prompt.contains("<glossary_terms"));

        request.glossary_terms = vec![
            AiReviewGlossaryTerm {
                source_term: "astral plane".to_string(),
                target_term: "cõi tinh tú".to_string(),
            },
            AiReviewGlossaryTerm {
                source_term: "unused".to_string(),
                target_term: "  ".to_string(),
            },
        ];
        let prompt = build_clarity_review_prompt(&request);

        assert!(prompt.contains("Glossary terms rule:\nEach entry in <glossary_terms> pairs a term in the original text with the approved Vietnamese glossary term"));
        assert!(prompt.contains("is not, on its own, a reason to flag it"));
        assert!(prompt.contains(
            "<languages>\ntarget: Vietnamese (vi)\n</languages>\n\n<glossary_terms format=\"json\">\n[{\"sourceTerm\":\"astral plane\",\"targetTerm\":\"cõi tinh tú\"}]\n</glossary_terms>"
        ));
        assert!(!prompt.contains("unused"));

        let batch = AiReviewBatchRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            review_mode: Some("clarity".to_string()),
            source_language_code: "en".to_string(),
            target_language_code: "vi".to_string(),
            language_code: "vi".to_string(),
            source_language: "English".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            glossary_terms: request.glossary_terms.clone(),
            context_before: vec![],
            context_after: vec![],
            rows: vec![],
            subtitle_cues: false,
            sentence_group: false,
            sentence_source_text: String::new(),
            sentence_target_text: String::new(),
            installation_id: None,
        };
        let prompt = build_clarity_review_batch_prompt(&batch);
        assert!(prompt.contains("Glossary terms rule:"));
        assert!(
            prompt.contains("[{\"sourceTerm\":\"astral plane\",\"targetTerm\":\"cõi tinh tú\"}]")
        );
    }

    #[test]
    fn single_prompt_omits_context_when_the_row_is_not_in_the_window() {
        let mut request = clarity_request();
        request.row_id = "missing".to_string();

        let prompt = build_clarity_review_prompt(&request);

        assert!(!prompt.contains("<context_before>"));
        assert!(!prompt.contains("<context_after>"));
        assert!(!prompt.contains("Câu trước"));
    }

    #[test]
    fn batch_prompt_lists_rows_with_target_context_only() {
        let request = AiReviewBatchRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            review_mode: Some("clarity".to_string()),
            source_language_code: "en".to_string(),
            target_language_code: "vi".to_string(),
            language_code: "vi".to_string(),
            source_language: "English".to_string(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            glossary_terms: vec![],
            context_before: vec![window_entry("r0", "Đoạn trước")],
            context_after: vec![window_entry("r9", "")],
            rows: vec![
                AiReviewBatchRowInput {
                    row_id: "r1".to_string(),
                    latest_translation: "Câu một".to_string(),
                    footnotes: vec![],
                    image_caption: "Chú thích ảnh".to_string(),
                    source_text: "Source one".to_string(),
                    source_footnotes: vec![],
                    source_image_caption: String::new(),
                    alternate_language_texts: vec![],
                    target_language_history: vec![],
                    qa_hints: vec![],
                },
                AiReviewBatchRowInput {
                    row_id: "r2".to_string(),
                    latest_translation: "Câu hai".to_string(),
                    footnotes: vec![],
                    image_caption: String::new(),
                    source_text: String::new(),
                    source_footnotes: vec![],
                    source_image_caption: String::new(),
                    alternate_language_texts: vec![],
                    target_language_history: vec![],
                    qa_hints: vec![],
                },
            ],
            subtitle_cues: false,
            sentence_group: false,
            sentence_source_text: String::new(),
            sentence_target_text: String::new(),
            installation_id: None,
        };

        let prompt = build_clarity_review_batch_prompt(&request);

        assert!(prompt.starts_with(clarity_batch_response_contract()));
        assert!(prompt.contains("consecutive and form one continuous text"));
        assert!(prompt.contains("<context_before>\nThese rows come immediately before the rows you are checking, for context only.\n\nĐoạn trước\n</context_before>"));
        assert!(prompt.contains("<row id=\"r1\">\n<latest_translation>\nCâu một\n</latest_translation>\n\n<latest_image_caption>\nChú thích ảnh\n</latest_image_caption>\n</row>"));
        assert!(prompt.contains("<row id=\"r2\">"));
        // Empty context rows add no section.
        assert!(!prompt.contains("<context_after>"));
        assert!(!prompt.contains("Source one"));
        assert!(!prompt.contains("source r0"));
    }

    #[test]
    fn single_response_requires_a_comment_field() {
        let flagged = parse_clarity_review_response(
            "```json\n{\"comment\":\"  \\\"tâm\\\" có thể hiểu hai cách. \"}\n```",
        )
        .expect("parse flagged");
        assert_eq!(flagged.comment, "\"tâm\" có thể hiểu hai cách.");
        assert!(flagged.suggested_text.is_empty());
        assert_eq!(flagged.reviewed, None);

        let clear = parse_clarity_review_response("{\"comment\":\"\"}").expect("parse clear");
        assert_eq!(clear.comment, "");

        assert!(parse_clarity_review_response("{}").is_err());
        assert!(parse_clarity_review_response("{\"suggestedText\":\"x\"}").is_err());
    }

    #[test]
    fn batch_response_keeps_requested_rows_and_drops_rows_without_a_comment() {
        let request = AiReviewBatchRequest {
            provider_id: AiProviderId::OpenAi,
            model_id: "gpt-5.4".to_string(),
            review_mode: Some("clarity".to_string()),
            source_language_code: String::new(),
            target_language_code: "vi".to_string(),
            language_code: "vi".to_string(),
            source_language: String::new(),
            target_language: "Vietnamese".to_string(),
            glossary_hints: vec![],
            glossary_terms: vec![],
            context_before: vec![],
            context_after: vec![],
            rows: ["r1", "r2", "r3"]
                .into_iter()
                .map(|row_id| AiReviewBatchRowInput {
                    row_id: row_id.to_string(),
                    latest_translation: "x".to_string(),
                    footnotes: vec![],
                    image_caption: String::new(),
                    source_text: String::new(),
                    source_footnotes: vec![],
                    source_image_caption: String::new(),
                    alternate_language_texts: vec![],
                    target_language_history: vec![],
                    qa_hints: vec![],
                })
                .collect(),
            subtitle_cues: false,
            sentence_group: false,
            sentence_source_text: String::new(),
            sentence_target_text: String::new(),
            installation_id: None,
        };

        let (rows, unknown) = parse_clarity_review_batch_response(
            "{\"rows\":[{\"rowId\":\"r1\",\"comment\":\"\"},{\"rowId\":\"r2\",\"comment\":\" Không rõ. \"},{\"rowId\":\"r3\"},{\"rowId\":\"r7\",\"comment\":\"x\"},{\"rowId\":\"r1\",\"comment\":\"dup\"}]}",
            &request,
        )
        .expect("parse batch");

        let summary = rows
            .iter()
            .map(|row| (row.row_id.as_str(), row.comment.as_str(), row.reviewed))
            .collect::<Vec<_>>();
        assert_eq!(summary, vec![("r1", "", false), ("r2", "Không rõ.", false)]);
        assert_eq!(unknown, vec!["r7".to_string()]);
        assert!(parse_clarity_review_batch_response("{\"comment\":\"\"}", &request).is_err());
    }

    #[test]
    fn output_schemas_require_every_field() {
        let AiPromptOutputFormat::JsonSchema { schema, .. } = clarity_output_format() else {
            panic!("expected a JSON schema");
        };
        assert_eq!(schema["required"], json!(["comment"]));
        let AiPromptOutputFormat::JsonSchema { schema, .. } = clarity_batch_output_format() else {
            panic!("expected a JSON schema");
        };
        assert_eq!(
            schema["properties"]["rows"]["items"]["required"],
            json!(["rowId", "comment"])
        );
    }
}
