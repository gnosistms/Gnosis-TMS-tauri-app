use std::{env, fs, path::PathBuf};

use reqwest::{blocking::Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use alignment_lab::{
    alignment_response_schema, apply_final_checks, apply_split_target_validation, build_prompt,
    build_report, build_split_target_prompt, find_split_targets, read_units, render_alignment_html,
    run_final_checks, split_target_response_schema, validate_alignments,
    validate_split_target_response, AlignmentResponse, SplitTargetResponse,
};

const OPENAI_RESPONSES_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL: &str = "gpt-5.5";
const LOCAL_API_KEY_FILE: &str = "openai-api-key.txt";
const SPLIT_TARGET_ERRORS_FILE: &str = "split-target-errors.json";

#[derive(Debug)]
struct AlignSingleArgs {
    source: PathBuf,
    target: PathBuf,
    model: String,
    print_prompt: bool,
    html: PathBuf,
}

#[derive(Debug, Serialize)]
struct OpenAiResponsesRequest {
    model: String,
    input: String,
    store: bool,
    text: OpenAiTextConfig,
}

#[derive(Debug, Serialize)]
struct OpenAiTextConfig {
    format: Value,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponsesCreateResponse {
    #[serde(default)]
    output_text: String,
    #[serde(default)]
    output: Vec<OpenAiOutputItem>,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputItem {
    #[serde(default)]
    content: Vec<OpenAiOutputContent>,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputContent {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    refusal: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorEnvelope {
    error: Option<OpenAiErrorBody>,
}

#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    #[serde(default)]
    message: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    let Some(command) = args.first().cloned() else {
        return Err(usage());
    };
    args.remove(0);

    match command.as_str() {
        "align-single" => align_single(parse_align_single_args(args)?),
        _ => Err(usage()),
    }
}

fn align_single(args: AlignSingleArgs) -> Result<(), String> {
    let source_units = read_units(&args.source)?;
    let target_units = read_units(&args.target)?;
    if source_units.is_empty() {
        return Err(format!(
            "The source file '{}' does not contain any non-blank lines.",
            args.source.display()
        ));
    }
    if target_units.is_empty() {
        return Err(format!(
            "The target file '{}' does not contain any non-blank lines.",
            args.target.display()
        ));
    }

    let prompt = build_prompt(&source_units, &target_units)?;
    if args.print_prompt {
        println!("{prompt}");
        return Ok(());
    }

    let api_key = load_api_key()?;

    let raw_response = run_openai_structured_prompt(
        &args.model,
        &prompt,
        &api_key,
        "alignment_response",
        alignment_response_schema(),
    )?;
    let parsed_response: AlignmentResponse =
        serde_json::from_str(&raw_response).map_err(|error| {
            format!("OpenAI returned JSON that did not match the alignment schema: {error}")
        })?;
    let alignments = validate_alignments(parsed_response, &source_units, &target_units)?;
    let split_target_inputs = find_split_targets(&alignments, &source_units, &target_units);
    let mut report = build_report(&args.model, &prompt, source_units, target_units, alignments);

    if !split_target_inputs.is_empty() {
        let split_prompt = build_split_target_prompt(&split_target_inputs)?;
        let raw_split_response = run_openai_structured_prompt(
            &args.model,
            &split_prompt,
            &api_key,
            "split_target_response",
            split_target_response_schema(),
        )?;
        let parsed_split_response: SplitTargetResponse = serde_json::from_str(&raw_split_response)
            .map_err(|error| {
                format!("OpenAI returned JSON that did not match the split target schema: {error}")
            })?;
        let split_validation =
            validate_split_target_response(parsed_split_response, &split_target_inputs);
        apply_split_target_validation(&mut report, Some(&split_prompt), split_validation);
    }

    let final_checks = run_final_checks(&report);
    let failed_final_checks = final_checks
        .iter()
        .filter(|check| !check.passed)
        .map(|check| check.name.clone())
        .collect::<Vec<_>>();
    apply_final_checks(&mut report, final_checks);
    if !failed_final_checks.is_empty() {
        eprintln!("Final checks failed: {}", failed_final_checks.join(", "));
    }

    write_split_target_errors(&report)?;
    let html = render_alignment_html(&report);
    fs::write(&args.html, html).map_err(|error| {
        format!(
            "Could not write HTML alignment report '{}': {error}",
            args.html.display()
        )
    })?;
    eprintln!("HTML report: {}", file_url(&args.html)?);

    let report_json = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("Could not serialize alignment report: {error}"))?;
    println!("{report_json}");

    Ok(())
}

fn load_api_key() -> Result<String, String> {
    if let Ok(value) = env::var("OPENAI_API_KEY") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let key_path = env::current_dir()
        .map_err(|error| format!("Could not resolve the current directory: {error}"))?
        .join(LOCAL_API_KEY_FILE);
    let value = std::fs::read_to_string(&key_path).map_err(|_| {
        format!(
            "Set OPENAI_API_KEY or paste your key into '{}'.",
            key_path.display()
        )
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("'{}' is empty.", key_path.display()));
    }

    Ok(trimmed.to_string())
}

fn run_openai_structured_prompt(
    model: &str,
    prompt: &str,
    api_key: &str,
    schema_name: &str,
    schema: Value,
) -> Result<String, String> {
    let request = OpenAiResponsesRequest {
        model: model.to_string(),
        input: prompt.to_string(),
        store: false,
        text: OpenAiTextConfig {
            format: json!({
                "type": "json_schema",
                "name": schema_name,
                "strict": true,
                "schema": schema
            }),
        },
    };

    let response = Client::new()
        .post(OPENAI_RESPONSES_API_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", "alignment-lab")
        .json(&request)
        .send()
        .map_err(|error| format!("Could not send OpenAI alignment request: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|error| format!("Could not read OpenAI alignment response: {error}"))?;

    if !status.is_success() {
        return Err(normalize_openai_error(status, &body));
    }

    extract_output_text(&body)
}

fn write_split_target_errors(report: &alignment_lab::AlignmentReport) -> Result<(), String> {
    if report.split_target_errors.is_empty() {
        if fs::remove_file(SPLIT_TARGET_ERRORS_FILE).is_err() {
            // Nothing to clean up.
        }
        return Ok(());
    }

    let json = serde_json::to_string_pretty(&report.split_target_errors)
        .map_err(|error| format!("Could not serialize split target errors: {error}"))?;
    fs::write(SPLIT_TARGET_ERRORS_FILE, json)
        .map_err(|error| format!("Could not write {SPLIT_TARGET_ERRORS_FILE}: {error}"))?;
    eprintln!(
        "Split target errors: {}",
        file_url(&PathBuf::from(SPLIT_TARGET_ERRORS_FILE))?
    );
    Ok(())
}

fn extract_output_text(body: &str) -> Result<String, String> {
    let payload: OpenAiResponsesCreateResponse = serde_json::from_str(body)
        .map_err(|error| format!("OpenAI returned a malformed response envelope: {error}"))?;

    if !payload.output_text.trim().is_empty() {
        return Ok(payload.output_text);
    }

    for output in payload.output {
        for content in output.content {
            if !content.refusal.trim().is_empty() {
                return Err(format!(
                    "OpenAI refused the alignment request: {}",
                    content.refusal
                ));
            }
            if content.kind == "output_text" && !content.text.trim().is_empty() {
                return Ok(content.text);
            }
        }
    }

    Err("OpenAI returned no alignment JSON.".to_string())
}

fn normalize_openai_error(status: StatusCode, body: &str) -> String {
    if let Ok(envelope) = serde_json::from_str::<OpenAiErrorEnvelope>(body) {
        if let Some(error) = envelope.error {
            if !error.message.trim().is_empty() {
                return format!("OpenAI request failed with {status}: {}", error.message);
            }
        }
    }

    format!("OpenAI request failed with {status}: {body}")
}

fn parse_align_single_args(args: Vec<String>) -> Result<AlignSingleArgs, String> {
    let mut source = None;
    let mut target = None;
    let mut model = DEFAULT_MODEL.to_string();
    let mut print_prompt = false;
    let mut html = PathBuf::from("alignment-report.html");
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--source" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--source requires a path.".to_string());
                };
                source = Some(PathBuf::from(value));
            }
            "--target" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--target requires a path.".to_string());
                };
                target = Some(PathBuf::from(value));
            }
            "--model" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--model requires a model id.".to_string());
                };
                model = value.to_string();
            }
            "--print-prompt" => {
                print_prompt = true;
            }
            "--html" => {
                index += 1;
                let Some(value) = args.get(index) else {
                    return Err("--html requires a path.".to_string());
                };
                html = PathBuf::from(value);
            }
            "--help" | "-h" => return Err(usage()),
            unknown => return Err(format!("Unknown argument '{unknown}'.\n\n{}", usage())),
        }

        index += 1;
    }

    let source = source.ok_or_else(|| "--source is required.".to_string())?;
    let target = target.ok_or_else(|| "--target is required.".to_string())?;
    if model.trim().is_empty() {
        return Err("--model cannot be empty.".to_string());
    }

    Ok(AlignSingleArgs {
        source,
        target,
        model,
        print_prompt,
        html,
    })
}

fn file_url(path: &PathBuf) -> Result<String, String> {
    let absolute_path = if path.is_absolute() {
        path.clone()
    } else {
        env::current_dir()
            .map_err(|error| format!("Could not resolve current directory: {error}"))?
            .join(path)
    };
    let absolute_path = absolute_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve '{}': {error}", absolute_path.display()))?;
    Ok(format!(
        "file://{}",
        absolute_path.to_string_lossy().replace(' ', "%20")
    ))
}

fn usage() -> String {
    format!(
        "Usage:\n  cargo run -- align-single --source fixtures/source.txt --target fixtures/target.txt [--model {DEFAULT_MODEL}] [--html alignment-report.html] [--print-prompt]"
    )
}
