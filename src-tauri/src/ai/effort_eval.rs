//! Live effort-calibration harness (plans/claude-opus-5-5-support.md, Phase 2).
//!
//! Replays real AI Translate / Batch Translate / Batch Review requests through
//! the app's own prompt builders and response parsers at several effort levels,
//! then writes a blind side-by-side report for a human to judge. It calls paid
//! APIs, so it is `#[ignore]`d and only runs when invoked explicitly:
//!
//! ```text
//! GNOSIS_EVAL_INPUT=/path/input.json GNOSIS_EVAL_OUT_DIR=/path/out \
//! ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
//! cargo test --lib effort_eval -- --ignored --nocapture
//! ```
//!
//! Input JSON (request objects use the app's IPC shape; `providerId` and
//! `modelId` are filled in by the harness):
//!
//! ```text
//! {
//!   "translationBatches": [AiTranslationBatchRequest, ...],
//!   "reviewBatches": [AiReviewBatchRequest, ...],
//!   "translations": [AiTranslationRequest, ...],
//!   "translationRowIds": ["row id per entry in translations", ...],
//!   "references": { "<rowId>": "existing human translation", ... }
//! }
//! ```
//!
//! Optional environment: `GNOSIS_EVAL_CLAUDE_MODEL` (default `claude-opus-5-5`),
//! `GNOSIS_EVAL_CLAUDE_EFFORTS` (default `low,medium,high`),
//! `GNOSIS_EVAL_OPENAI_MODEL` (default `gpt-5.4`), `GNOSIS_EVAL_OPENAI_EFFORTS`
//! (default `none,low`; empty to skip OpenAI), `GNOSIS_EVAL_REPEATS` (default 1).

use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::{json, Value};

use super::providers::{claude, openai};
use super::types::{
    AiPromptOutputFormat, AiPromptRequest, AiProviderId, AiReviewBatchRequest,
    AiTranslationBatchRequest, AiTranslationRequest,
};
use super::{
    build_review_batch_prompt, build_translation_batch_prompt, build_translation_prompt,
    parse_review_batch_response, parse_translation_sections_response,
    parse_validated_translation_batch_response, translation_request_has_sections,
};

// Claude Opus 5.5 list prices, USD per million tokens.
const OPUS_5_5_INPUT: f64 = 4.0;
const OPUS_5_5_OUTPUT: f64 = 20.0;
const OPUS_5_5_CACHE_READ: f64 = 0.20;
const OPUS_5_5_CACHE_WRITE: f64 = 5.0;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvalInput {
    #[serde(default)]
    translation_batches: Vec<Value>,
    #[serde(default)]
    review_batches: Vec<Value>,
    #[serde(default)]
    translations: Vec<Value>,
    #[serde(default)]
    translation_row_ids: Vec<String>,
    #[serde(default)]
    references: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Claude,
    OpenAi,
}

#[derive(Clone, Debug)]
struct RunConfig {
    provider: Provider,
    model: String,
    effort: &'static str,
}

impl RunConfig {
    fn label(&self) -> String {
        format!("{}@{}", self.model, self.effort)
    }

    fn provider_id(&self) -> AiProviderId {
        match self.provider {
            Provider::Claude => AiProviderId::Claude,
            Provider::OpenAi => AiProviderId::OpenAi,
        }
    }
}

/// One AI call's outcome for one case.
struct CallResult {
    config: String,
    case: String,
    kind: &'static str,
    elapsed_ms: u128,
    usage: Option<Value>,
    error: Option<String>,
    // rowId -> rendered output for the blind review.
    outputs: BTreeMap<String, String>,
}

fn static_effort(value: &str) -> Option<&'static str> {
    match value.trim() {
        "none" => Some("none"),
        "minimal" => Some("minimal"),
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "xhigh" => Some("xhigh"),
        "max" => Some("max"),
        _ => None,
    }
}

fn efforts_from_env(name: &str, default: &str) -> Vec<&'static str> {
    env::var(name)
        .unwrap_or_else(|_| default.to_string())
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            static_effort(value).unwrap_or_else(|| panic!("{name}: unknown effort {value:?}"))
        })
        .collect()
}

fn run_configs() -> Vec<RunConfig> {
    let mut configs = Vec::new();
    let claude_model =
        env::var("GNOSIS_EVAL_CLAUDE_MODEL").unwrap_or_else(|_| "claude-opus-5-5".to_string());
    for effort in efforts_from_env("GNOSIS_EVAL_CLAUDE_EFFORTS", "low,medium,high") {
        configs.push(RunConfig {
            provider: Provider::Claude,
            model: claude_model.clone(),
            effort,
        });
    }
    let openai_model =
        env::var("GNOSIS_EVAL_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4".to_string());
    for effort in efforts_from_env("GNOSIS_EVAL_OPENAI_EFFORTS", "none,low") {
        configs.push(RunConfig {
            provider: Provider::OpenAi,
            model: openai_model.clone(),
            effort,
        });
    }
    configs
}

fn api_key(provider: Provider) -> String {
    let name = match provider {
        Provider::Claude => "ANTHROPIC_API_KEY",
        Provider::OpenAi => "OPENAI_API_KEY",
    };
    env::var(name).unwrap_or_else(|_| panic!("{name} must be set for this run"))
}

fn with_selection<T: for<'de> Deserialize<'de>>(request: &Value, config: &RunConfig) -> T {
    let mut request = request.clone();
    request["providerId"] = serde_json::to_value(config.provider_id()).unwrap();
    request["modelId"] = json!(config.model);
    serde_json::from_value(request).expect("input request does not match the app's IPC shape")
}

fn call(
    config: &RunConfig,
    prompt: String,
    output_format: AiPromptOutputFormat,
) -> (Result<String, String>, Option<Value>, u128) {
    let request = AiPromptRequest {
        provider_id: config.provider_id(),
        model_id: config.model.clone(),
        prompt,
        output_format,
        prompt_blocks: None,
    };
    let started = Instant::now();
    let outcome = match config.provider {
        Provider::Claude => {
            claude::run_prompt_with_effort(&request, &api_key(Provider::Claude), config.effort)
        }
        Provider::OpenAi => openai::run_prompt_with_reasoning_effort(
            &request,
            &api_key(Provider::OpenAi),
            config.effort,
        )
        .map(|(response, usage)| {
            (
                response.text,
                usage.map(|usage| serde_json::to_value(usage).unwrap()),
            )
        }),
    };
    let elapsed_ms = started.elapsed().as_millis();
    match outcome {
        Ok((text, usage)) => (Ok(text), usage, elapsed_ms),
        Err(error) => (Err(error), None, elapsed_ms),
    }
}

fn run_translation_batch(config: &RunConfig, case: &str, raw: &Value) -> CallResult {
    let request: AiTranslationBatchRequest = with_selection(raw, config);
    let prompt = build_translation_batch_prompt(&request);
    let (text, usage, elapsed_ms) =
        call(config, prompt, AiPromptOutputFormat::TranslationBatchJson);
    let parsed =
        text.and_then(|text| parse_validated_translation_batch_response(&text, &request.rows));
    let (outputs, error) = match parsed {
        Ok(rows) => (
            rows.into_iter()
                .map(|row| {
                    let mut rendered = row.translated_text;
                    if !row.translated_footnote.trim().is_empty() {
                        rendered.push_str(&format!("\n[footnote] {}", row.translated_footnote));
                    }
                    if !row.translated_image_caption.trim().is_empty() {
                        rendered.push_str(&format!("\n[caption] {}", row.translated_image_caption));
                    }
                    (row.row_id, rendered)
                })
                .collect(),
            None,
        ),
        Err(error) => (BTreeMap::new(), Some(error)),
    };
    CallResult {
        config: config.label(),
        case: case.to_string(),
        kind: "translation batch",
        elapsed_ms,
        usage,
        error,
        outputs,
    }
}

fn run_review_batch(config: &RunConfig, case: &str, raw: &Value) -> CallResult {
    let request: AiReviewBatchRequest = with_selection(raw, config);
    let prompt = build_review_batch_prompt(&request);
    let (text, usage, elapsed_ms) = call(config, prompt, AiPromptOutputFormat::ReviewBatchJson);
    let (outputs, error) = match text.and_then(|text| parse_review_batch_response(&text)) {
        Ok(rows) => (
            rows.into_iter()
                .map(|row| {
                    let rendered = if row.reviewed {
                        "(no change suggested)".to_string()
                    } else {
                        let mut rendered = row.suggested_text;
                        for footnote in row.suggested_footnotes {
                            rendered.push_str(&format!(
                                "\n[footnote {}] {}",
                                footnote.marker, footnote.text
                            ));
                        }
                        rendered
                    };
                    (row.row_id, rendered)
                })
                .collect(),
            None,
        ),
        Err(error) => (BTreeMap::new(), Some(error)),
    };
    CallResult {
        config: config.label(),
        case: case.to_string(),
        kind: "review batch",
        elapsed_ms,
        usage,
        error,
        outputs,
    }
}

fn run_translation(config: &RunConfig, case: &str, row_id: &str, raw: &Value) -> CallResult {
    let request: AiTranslationRequest = with_selection(raw, config);
    let prompt = build_translation_prompt(&request);
    let sectioned = translation_request_has_sections(&request);
    let output_format = if sectioned {
        AiPromptOutputFormat::TranslationSectionsJson
    } else {
        AiPromptOutputFormat::Text
    };
    let (text, usage, elapsed_ms) = call(config, prompt, output_format);
    let rendered = text.and_then(|text| {
        if sectioned {
            parse_translation_sections_response(&text).map(|parsed| parsed.translated_text)
        } else {
            Ok(text)
        }
    });
    let (outputs, error) = match rendered {
        Ok(text) => (BTreeMap::from([(row_id.to_string(), text)]), None),
        Err(error) => (BTreeMap::new(), Some(error)),
    };
    CallResult {
        config: config.label(),
        case: case.to_string(),
        kind: "single translation",
        elapsed_ms,
        usage,
        error,
        outputs,
    }
}

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

fn row_source_texts(input: &EvalInput) -> HashMap<String, String> {
    let mut sources = HashMap::new();
    for batch in input
        .translation_batches
        .iter()
        .chain(&input.review_batches)
    {
        for row in batch["rows"].as_array().into_iter().flatten() {
            let row_id = row["rowId"].as_str().unwrap_or_default().to_string();
            let source = row["sourceText"].as_str().unwrap_or_default().to_string();
            sources.entry(row_id).or_insert(source);
        }
    }
    for (row_id, request) in input.translation_row_ids.iter().zip(&input.translations) {
        sources
            .entry(row_id.clone())
            .or_insert_with(|| request["text"].as_str().unwrap_or_default().to_string());
    }
    sources
}

fn review_row_translations(input: &EvalInput) -> HashMap<String, String> {
    input
        .review_batches
        .iter()
        .flat_map(|batch| batch["rows"].as_array().cloned().unwrap_or_default())
        .map(|row| {
            (
                row["rowId"].as_str().unwrap_or_default().to_string(),
                row["latestTranslation"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            )
        })
        .collect()
}

fn write_summary(results: &[CallResult], configs: &[RunConfig]) -> String {
    let mut lines = vec![
        "# Effort calibration summary".to_string(),
        String::new(),
        "Output tokens include thinking / reasoning. Claude cost uses Opus 5.5 list prices."
            .to_string(),
        String::new(),
        "| Config | Kind | Calls | Failed | Avg latency (s) | Input tok | Cached tok | Output tok | Thinking tok | Est. cost (USD) |"
            .to_string(),
        "|---|---|---|---|---|---|---|---|---|---|".to_string(),
    ];
    for config in configs {
        let label = config.label();
        for kind in ["single translation", "translation batch", "review batch"] {
            let calls = results
                .iter()
                .filter(|result| result.config == label && result.kind == kind)
                .collect::<Vec<_>>();
            if calls.is_empty() {
                continue;
            }
            let failed = calls.iter().filter(|result| result.error.is_some()).count();
            let avg_latency = calls
                .iter()
                .map(|result| result.elapsed_ms as f64)
                .sum::<f64>()
                / calls.len() as f64
                / 1000.0;
            let sum = |pointer: &str| {
                calls
                    .iter()
                    .map(|result| usage_number(&result.usage, pointer))
                    .sum::<u64>()
            };
            let (cached, cost) = match config.provider {
                Provider::Claude => (
                    sum("/cache_read_input_tokens"),
                    format!(
                        "{:.4}",
                        calls
                            .iter()
                            .map(|result| claude_cost(&result.usage))
                            .sum::<f64>()
                    ),
                ),
                Provider::OpenAi => (
                    sum("/input_tokens_details/cached_tokens"),
                    "(see OpenAI pricing)".to_string(),
                ),
            };
            // Claude reports thinking_tokens, OpenAI reasoning_tokens.
            let thinking = sum("/output_tokens_details/thinking_tokens")
                + sum("/output_tokens_details/reasoning_tokens");
            lines.push(format!(
                "| {label} | {kind} | {} | {failed} | {avg_latency:.1} | {} | {cached} | {} | {thinking} | {cost} |",
                calls.len(),
                sum("/input_tokens"),
                sum("/output_tokens"),
            ));
        }
    }
    let failures = results
        .iter()
        .filter_map(|result| {
            result
                .error
                .as_ref()
                .map(|error| format!("- {} / {}: {error}", result.config, result.case))
        })
        .collect::<Vec<_>>();
    if !failures.is_empty() {
        lines.push(String::new());
        lines.push("## Failures".to_string());
        lines.extend(failures);
    }
    lines.join("\n") + "\n"
}

/// Writes the blind review: each row's outputs appear under shuffled letters;
/// the letter -> config mapping goes to a separate key file.
fn write_blind_review(results: &[CallResult], input: &EvalInput) -> (String, Value) {
    let sources = row_source_texts(input);
    let reviewed_translations = review_row_translations(input);
    let mut rng = rand::thread_rng();
    let mut key = serde_json::Map::new();
    let mut lines = vec![
        "# Blind review".to_string(),
        String::new(),
        "Rate each lettered output. Letters are shuffled per row; the key is in key.json."
            .to_string(),
    ];

    // Results are ordered config-first; list each case once, in first-seen order.
    let mut cases: Vec<(&'static str, String)> = Vec::new();
    for result in results {
        let case = (result.kind, result.case.clone());
        if !cases.contains(&case) {
            cases.push(case);
        }
    }
    for (kind, case) in cases {
        let case_results = results
            .iter()
            .filter(|result| result.kind == kind && result.case == case)
            .collect::<Vec<_>>();
        let mut row_ids = case_results
            .iter()
            .flat_map(|result| result.outputs.keys().cloned())
            .collect::<Vec<_>>();
        row_ids.sort();
        row_ids.dedup();

        lines.push(String::new());
        lines.push(format!("## {kind}: {case}"));
        for row_id in row_ids {
            lines.push(String::new());
            lines.push(format!("### Row {row_id}"));
            if let Some(source) = sources.get(&row_id) {
                lines.push(format!("**Source:** {source}"));
            }
            if kind == "review batch" {
                if let Some(translation) = reviewed_translations.get(&row_id) {
                    lines.push(format!("**Translation under review:** {translation}"));
                }
            }
            if let Some(reference) = input.references.get(&row_id) {
                lines.push(format!("**Reference:** {reference}"));
            }
            let mut shuffled = case_results.clone();
            shuffled.shuffle(&mut rng);
            for (index, result) in shuffled.iter().enumerate() {
                let letter = (b'A' + index as u8) as char;
                let output = result
                    .outputs
                    .get(&row_id)
                    .cloned()
                    .unwrap_or_else(|| "(failed)".to_string());
                lines.push(format!("- **{letter}:** {output}"));
                key.insert(
                    format!("{kind} / {case} / row {row_id} / {letter}"),
                    json!(result.config),
                );
            }
        }
    }
    (lines.join("\n") + "\n", Value::Object(key))
}

#[test]
#[ignore = "calls paid AI APIs; run explicitly with GNOSIS_EVAL_INPUT set"]
fn effort_eval() {
    let input_path = env::var("GNOSIS_EVAL_INPUT").expect("GNOSIS_EVAL_INPUT must be set");
    let out_dir = PathBuf::from(env::var("GNOSIS_EVAL_OUT_DIR").expect("GNOSIS_EVAL_OUT_DIR"));
    let repeats = env::var("GNOSIS_EVAL_REPEATS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let input: EvalInput =
        serde_json::from_str(&fs::read_to_string(&input_path).expect("read GNOSIS_EVAL_INPUT"))
            .expect("parse GNOSIS_EVAL_INPUT");
    let configs = run_configs();
    fs::create_dir_all(&out_dir).expect("create output directory");

    let mut results = Vec::new();
    for repeat in 1..=repeats {
        for config in &configs {
            for (index, raw) in input.translation_batches.iter().enumerate() {
                let case = format!("batch {} (run {repeat})", index + 1);
                results.push(run_translation_batch(config, &case, raw));
                eprintln!("{} {case}: done", config.label());
            }
            for (index, raw) in input.review_batches.iter().enumerate() {
                let case = format!("review {} (run {repeat})", index + 1);
                results.push(run_review_batch(config, &case, raw));
                eprintln!("{} {case}: done", config.label());
            }
            for (index, raw) in input.translations.iter().enumerate() {
                let row_id = input
                    .translation_row_ids
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| format!("single-{}", index + 1));
                let case = format!("single translations (run {repeat})");
                results.push(run_translation(config, &case, &row_id, raw));
                eprintln!("{} single {row_id}: done", config.label());
            }
        }
    }

    let raw_results = results
        .iter()
        .map(|result| {
            json!({
                "config": result.config,
                "case": result.case,
                "kind": result.kind,
                "elapsedMs": result.elapsed_ms,
                "usage": result.usage,
                "error": result.error,
                "outputs": result.outputs,
            })
        })
        .collect::<Vec<_>>();
    let (review, key) = write_blind_review(&results, &input);
    fs::write(
        out_dir.join("summary.md"),
        write_summary(&results, &configs),
    )
    .unwrap();
    fs::write(out_dir.join("review.md"), review).unwrap();
    fs::write(
        out_dir.join("key.json"),
        serde_json::to_string_pretty(&key).unwrap(),
    )
    .unwrap();
    fs::write(
        out_dir.join("results.json"),
        serde_json::to_string_pretty(&raw_results).unwrap(),
    )
    .unwrap();
    eprintln!("Wrote report to {}", out_dir.display());
}
