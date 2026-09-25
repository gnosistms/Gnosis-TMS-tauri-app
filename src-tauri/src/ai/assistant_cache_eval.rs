//! Live prompt-cache check for AI Assistant turns
//! (plans/ai-assistant-stateless-caching-plan.md, step 6).
//!
//! Plays a four-turn conversation about one row through the app's own
//! assistant prompt builder, provider request code and response parser, the
//! way the editor would: a question, a refinement, the draft applied to the
//! row, then a follow-up. Prints token and cache counts per turn and writes the
//! answers for review. It calls paid APIs, so it is `#[ignore]`d:
//!
//! ```text
//! GNOSIS_CACHE_EVAL_INPUT=/path/request.json GNOSIS_CACHE_EVAL_OUT=/path/out.json \
//! ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
//! cargo test --lib assistant_cache_eval -- --ignored --nocapture
//! ```
//!
//! The input is one `AiAssistantTurnRequest` in the app's IPC shape; the harness
//! sets the provider, model, kind, message and transcript for each turn.
//! Optional: `GNOSIS_CACHE_EVAL_CLAUDE_MODEL` (default `claude-opus-5-5`),
//! `GNOSIS_CACHE_EVAL_OPENAI_MODEL` (default `gpt-5.4`, empty to skip).

use std::env;
use std::fs;
use std::time::Instant;

use serde_json::{json, Value};

use super::providers::{claude, openai};
use super::types::{
    AiAssistantTargetLanguageHistoryEntry, AiAssistantTranscriptEntry, AiAssistantTurnKind,
    AiAssistantTurnRequest, AiPromptOutputFormat, AiPromptRequest, AiProviderId,
};
use super::{build_assistant_prompt_parts, parse_assistant_structured_response};

// Claude Opus 5.5 list prices, USD per million tokens.
const OPUS_5_5_INPUT: f64 = 4.0;
const OPUS_5_5_OUTPUT: f64 = 20.0;
const OPUS_5_5_CACHE_READ: f64 = 0.20;
const OPUS_5_5_CACHE_WRITE: f64 = 5.0;

enum Step {
    Ask(AiAssistantTurnKind, &'static str),
    ApplyDraft,
}

const SCRIPT: &[Step] = &[
    Step::Ask(
        AiAssistantTurnKind::Chat,
        "What does \"luz astral\" mean in this sentence, and does the current Vietnamese translation render it well?",
    ),
    Step::Ask(
        AiAssistantTurnKind::TranslateRefinement,
        "Make the translation read more naturally in Vietnamese while keeping the glossary terms.",
    ),
    Step::ApplyDraft,
    Step::Ask(
        AiAssistantTurnKind::Chat,
        "Is the version now in the editor faithful to the source? Point out anything that was lost.",
    ),
    Step::Ask(
        AiAssistantTurnKind::Chat,
        "Give me one alternative wording for its last sentence.",
    ),
];

fn usage_number(usage: &Option<Value>, pointer: &str) -> u64 {
    usage
        .as_ref()
        .and_then(|usage| usage.pointer(pointer))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn claude_cost(usage: &Option<Value>) -> f64 {
    let per_token = |count: u64, price: f64| count as f64 * price / 1_000_000.0;
    per_token(usage_number(usage, "/input_tokens"), OPUS_5_5_INPUT)
        + per_token(usage_number(usage, "/output_tokens"), OPUS_5_5_OUTPUT)
        + per_token(
            usage_number(usage, "/cache_read_input_tokens"),
            OPUS_5_5_CACHE_READ,
        )
        + per_token(
            usage_number(usage, "/cache_creation_input_tokens"),
            OPUS_5_5_CACHE_WRITE,
        )
}

fn api_key(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("{name} is not set"))
}

fn run_conversation(
    base: &AiAssistantTurnRequest,
    provider_id: AiProviderId,
    model_id: &str,
) -> Vec<Value> {
    let mut request = base.clone();
    request.provider_id = provider_id;
    request.model_id = model_id.to_string();
    let mut last_draft: Option<String> = None;
    let mut results = Vec::new();

    for step in SCRIPT {
        let (kind, message) = match step {
            Step::ApplyDraft => {
                // What the editor does when the user applies the draft: the
                // row's target changes, the change is reported once, and the
                // applied text becomes the newest target-language revision.
                let draft = last_draft.clone().expect("no draft to apply");
                let revision_number = request.row.target_language_history.len() + 1;
                request
                    .row
                    .target_language_history
                    .push(AiAssistantTargetLanguageHistoryEntry {
                        revision_number,
                        source_type: "ai_model".to_string(),
                        source_label: model_id.to_string(),
                        author_type: "current_user".to_string(),
                        author_name: "tester".to_string(),
                        author_login: "tester".to_string(),
                        author_email: String::new(),
                        operation_type: Some("ai-assistant-apply".to_string()),
                        ai_model: Some(model_id.to_string()),
                        committed_at: "2026-09-25T12:00:00Z".to_string(),
                        text: draft.clone(),
                    });
                request.row.updated_target_text = Some(draft.clone());
                request.row.target_text = draft;
                continue;
            }
            Step::Ask(kind, message) => (*kind, *message),
        };
        request.kind = kind;
        request.user_message = message.to_string();

        let parts = build_assistant_prompt_parts(
            &request,
            kind == AiAssistantTurnKind::TranslateRefinement,
        );
        let blocks = parts.blocks();
        let prompt = parts.text();
        let prompt_request = AiPromptRequest {
            provider_id,
            model_id: model_id.to_string(),
            prompt: prompt.clone(),
            output_format: AiPromptOutputFormat::AssistantTurnJson,
            prompt_blocks: Some(blocks.clone()),
        };
        let started = Instant::now();
        let outcome = match provider_id {
            AiProviderId::Claude => claude::run_prompt_with_effort(
                &prompt_request,
                &api_key("ANTHROPIC_API_KEY"),
                "medium",
            ),
            _ => openai::run_prompt_with_usage(&prompt_request, &api_key("OPENAI_API_KEY")).map(
                |(response, usage)| {
                    (
                        response.text,
                        usage.map(|usage| serde_json::to_value(usage).unwrap()),
                    )
                },
            ),
        };
        let elapsed_ms = started.elapsed().as_millis();
        let (text, usage) = outcome.unwrap_or_else(|error| panic!("{model_id}: {error}"));
        let parsed = parse_assistant_structured_response(&text, kind)
            .unwrap_or_else(|error| panic!("{model_id}: {error}\n{text}"));

        let turn = results.len() + 1;
        let (input, cache_read, cache_write) = match provider_id {
            AiProviderId::Claude => (
                usage_number(&usage, "/input_tokens"),
                usage_number(&usage, "/cache_read_input_tokens"),
                usage_number(&usage, "/cache_creation_input_tokens"),
            ),
            _ => (
                usage_number(&usage, "/input_tokens"),
                usage_number(&usage, "/input_tokens_details/cached_tokens"),
                0,
            ),
        };
        println!(
            "{model_id} turn {turn} ({kind:?}): input={input} cache_read={cache_read} cache_write={cache_write} output={} blocks={} {elapsed_ms}ms{}",
            usage_number(&usage, "/output_tokens"),
            blocks.len(),
            if provider_id == AiProviderId::Claude {
                format!(" ${:.4}", claude_cost(&usage))
            } else {
                String::new()
            },
        );

        // The editor's transcript for the next turn: the user's message, then
        // the assistant item, with a draft appended as the frontend does.
        request.transcript.push(AiAssistantTranscriptEntry {
            role: "user".to_string(),
            text: message.to_string(),
        });
        let draft_suffix = parsed
            .draft_translation_text
            .as_deref()
            .filter(|draft| !draft.trim().is_empty())
            .map(|draft| format!("\nDraft translation:\n{draft}"))
            .unwrap_or_default();
        request.transcript.push(AiAssistantTranscriptEntry {
            role: "assistant".to_string(),
            text: format!("{}{draft_suffix}", parsed.assistant_text)
                .trim()
                .to_string(),
        });
        if parsed.draft_translation_text.is_some() {
            last_draft = parsed.draft_translation_text.clone();
        }
        // The row-text snapshot is taken after each turn, so an applied
        // change is reported only on the next turn.
        request.row.updated_target_text = None;

        results.push(json!({
            "model": model_id,
            "turn": turn,
            "kind": format!("{kind:?}"),
            "message": message,
            "usage": usage,
            "elapsedMs": elapsed_ms,
            "blockChars": blocks.iter().map(|block| block.text.chars().count()).collect::<Vec<_>>(),
            "assistantText": parsed.assistant_text,
            "draftTranslationText": parsed.draft_translation_text,
            "prompt": prompt,
        }));
    }
    results
}

#[test]
#[ignore = "calls paid AI APIs; run explicitly with --ignored"]
fn assistant_cache_eval() {
    let input = env::var("GNOSIS_CACHE_EVAL_INPUT").expect("GNOSIS_CACHE_EVAL_INPUT is not set");
    let mut raw: Value = serde_json::from_str(&fs::read_to_string(&input).unwrap()).unwrap();
    raw["providerId"] = json!("claude");
    raw["modelId"] = json!("");
    raw["kind"] = json!("chat");
    let base: AiAssistantTurnRequest =
        serde_json::from_value(raw).expect("input does not match the app's IPC shape");

    let claude_model = env::var("GNOSIS_CACHE_EVAL_CLAUDE_MODEL")
        .unwrap_or_else(|_| "claude-opus-5-5".to_string());
    let openai_model =
        env::var("GNOSIS_CACHE_EVAL_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4".to_string());

    let mut results = run_conversation(&base, AiProviderId::Claude, &claude_model);
    if !openai_model.trim().is_empty() {
        results.extend(run_conversation(&base, AiProviderId::OpenAi, &openai_model));
    }

    if let Ok(out) = env::var("GNOSIS_CACHE_EVAL_OUT") {
        fs::write(&out, serde_json::to_string_pretty(&results).unwrap()).unwrap();
        println!("wrote {out}");
    }
}
