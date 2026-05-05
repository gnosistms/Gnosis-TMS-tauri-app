use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    ai::{
        load_ai_provider_api_key, providers,
        types::{AiPromptOutputFormat, AiPromptRequest, AiProviderId},
    },
    storage_paths::installation_data_dir,
};

use super::{row_structure::create_inserted_row_file, *};

const EVENT_NAME: &str = "aligned-translation-progress";
const SECTION_SIZE: usize = 50;
const SECTION_OVERLAP: usize = 25;
const MISMATCH_THRESHOLD_PERCENT: f64 = 40.0;
const ALIGNMENT_PROMPT_VERSION: &str = "app-aligned-translation-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignedTranslationPreflightInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    #[serde(default)]
    project_full_name: String,
    chapter_id: String,
    source_language_code: String,
    target_language_code: String,
    pasted_text: String,
    provider_id: AiProviderId,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignedTranslationApplyInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    #[serde(default)]
    project_full_name: String,
    chapter_id: String,
    source_language_code: String,
    target_language_code: String,
    job_id: String,
    continue_on_mismatch: bool,
    write_mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignmentProgressEvent {
    job_id: String,
    stage_id: String,
    stage_label: String,
    status: String,
    completed: Option<usize>,
    total: Option<usize>,
    percent: Option<f64>,
    message: String,
    warning_count: usize,
    api_call_count: usize,
    cache_hit_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MismatchMetrics {
    source_unmatched_percent: f64,
    target_unmatched_percent: f64,
    matched_source_sections: usize,
    matched_target_sections: usize,
    total_source_sections: usize,
    total_target_sections: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignedTranslationPreflightResponse {
    job_id: String,
    status: String,
    source_language_code: String,
    target_language_code: String,
    #[serde(default)]
    target_base_language_code: String,
    target_language_exists: bool,
    existing_translation_count: usize,
    mismatch: Option<MismatchMetrics>,
    progress: AlignmentProgressEvent,
    #[serde(default)]
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignedTranslationApplyResponse {
    job_id: String,
    updated_row_count: usize,
    skipped_non_empty_row_count: usize,
    inserted_row_count: usize,
    target_language_code: String,
    source_word_counts: BTreeMap<String, usize>,
    commit_sha: Option<String>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AlignmentUnit {
    id: usize,
    text: String,
    original_line_number: usize,
    #[serde(default)]
    row_id: Option<String>,
    #[serde(default)]
    text_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Alignment {
    target_id: usize,
    source_ids: Vec<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentResponse {
    alignments: Vec<Alignment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionWindow {
    section_id: usize,
    unit_ids: Vec<usize>,
    unit_range: [usize; 2],
    content_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionSummary {
    doc_role: String,
    section_id: usize,
    language: String,
    summary: String,
    section_content_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionMatch {
    target_section_id: usize,
    source_section_id: usize,
    is_match: bool,
    overlap_percent: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitFragment {
    source_id: usize,
    range: [usize; 2],
    text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitTarget {
    target_id: usize,
    fragments: Vec<SplitFragment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentJob {
    job_id: String,
    status: String,
    signature: Value,
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    chapter_base_commit_sha: Option<String>,
    provider_id: AiProviderId,
    model_id: String,
    source_language_code: String,
    target_language_code: String,
    #[serde(default)]
    target_base_language_code: String,
    target_language_exists: bool,
    existing_translation_count: usize,
    source_units: Vec<AlignmentUnit>,
    target_units: Vec<AlignmentUnit>,
    source_sections: Vec<SectionWindow>,
    target_sections: Vec<SectionWindow>,
    summaries: Vec<SectionSummary>,
    section_matches: Vec<SectionMatch>,
    corridor: Vec<SectionMatch>,
    alignments: Vec<Alignment>,
    split_targets: Vec<SplitTarget>,
    mismatch: Option<MismatchMetrics>,
    final_checks: Vec<FinalCheck>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinalCheck {
    name: String,
    passed: bool,
    #[serde(default)]
    warning: bool,
    #[serde(default)]
    details: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompatibilityResponse {
    matches: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryResponse {
    section_summary: SummaryResponseItem,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryResponseItem {
    summary: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionMatchResponse {
    matches: Vec<SectionMatchResponseItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionMatchResponseItem {
    source_section_id: usize,
    is_match: bool,
    overlap_percent: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitTargetResponse {
    split_targets: Vec<SplitTargetResponseItem>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitTargetResponseItem {
    target_id: usize,
    fragments: Vec<SplitTargetFragmentHint>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitTargetFragmentHint {
    source_id: usize,
    target_text_fragment: String,
}

pub(crate) fn preflight_aligned_translation_to_gtms_chapter_sync(
    app: &AppHandle,
    input: AlignedTranslationPreflightInput,
) -> Result<AlignedTranslationPreflightResponse, String> {
    let mut input = input;
    if input.provider_id != AiProviderId::OpenAi {
        return Err("Add translation currently requires OpenAI.".to_string());
    }
    if input.model_id.trim().is_empty() {
        return Err("Select an OpenAI model before adding translation.".to_string());
    }

    let context = load_alignment_context(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        &input.repo_name,
        &input.chapter_id,
    )?;
    let source_language_code = input.source_language_code.trim().to_string();
    let target_base_language_code = input.target_language_code.trim().to_string();
    if source_language_code.is_empty() || target_base_language_code.is_empty() {
        return Err("Select source and translation languages before adding translation.".to_string());
    }

    let languages = sanitize_chapter_languages(&context.chapter_file.languages);
    let Some(source_language) = languages.iter().find(|language| language.code == source_language_code) else {
        return Err("The selected source language is not available in this file.".to_string());
    };
    if chapter_language_base_code(source_language).eq_ignore_ascii_case(&target_base_language_code) {
        return Err("Choose a translation language different from the source language.".to_string());
    }
    let target_language_code =
        next_duplicate_language_code(&languages, &target_base_language_code);
    input.target_language_code = target_language_code.clone();
    let target_language_exists = languages
        .iter()
        .any(|language| language.code == target_language_code);

    let source_units = source_units_from_rows(&context.rows, &source_language_code);
    let target_units = parse_target_units(&input.pasted_text);
    if source_units.is_empty() {
        return Err("There is no source text to align.".to_string());
    }
    if target_units.is_empty() {
        return Err("Paste translation text before adding translation.".to_string());
    }
    let existing_translation_count =
        count_existing_translation_rows(&context.rows, &target_language_code);

    let signature = build_signature(
        &input,
        &context.chapter_base_commit_sha,
        &source_units,
        &target_units,
    );
    let job_id = hash_json(&signature);
    let mut progress = progress_event(
        &job_id,
        "prepare_units",
        "Preparing text units",
        "complete",
        Some(1),
        Some(1),
        "Prepared source and target units",
    );
    emit_progress(app, &progress);

    let job_path = job_path(app, input.installation_id, &job_id)?;
    if let Some(job) = load_cached_job(&job_path, &signature)? {
        if job.status == "readyToApply" || job.status == "mismatch" {
            progress = progress_event(
                &job.job_id,
                "preflight",
                "Alignment preflight",
                "complete",
                Some(1),
                Some(1),
                "Loaded cached alignment preflight",
            );
            emit_progress(app, &progress);
            return Ok(preflight_response(&job, progress));
        }
        progress = progress_event(
            &job.job_id,
            "preflight",
            "Alignment preflight",
            "running",
            Some(0),
            Some(1),
            "Resuming cached alignment preflight",
        );
        emit_progress(app, &progress);
        let api_key = load_ai_provider_api_key(app, input.provider_id, Some(input.installation_id))?;
        return continue_preflight_job(app, &job_path, job, &api_key);
    }

    let source_sections = build_sections(&source_units);
    let target_sections = build_sections(&target_units);
    let job = AlignmentJob {
        job_id: job_id.clone(),
        status: "running".to_string(),
        signature,
        installation_id: input.installation_id,
        repo_name: input.repo_name.clone(),
        project_id: input.project_id.clone(),
        chapter_id: input.chapter_id.clone(),
        chapter_base_commit_sha: context.chapter_base_commit_sha.clone(),
        provider_id: input.provider_id,
        model_id: input.model_id.clone(),
        source_language_code,
        target_language_code,
        target_base_language_code,
        target_language_exists,
        existing_translation_count,
        source_units,
        target_units,
        source_sections,
        target_sections,
        summaries: Vec::new(),
        section_matches: Vec::new(),
        corridor: Vec::new(),
        alignments: Vec::new(),
        split_targets: Vec::new(),
        mismatch: None,
        final_checks: Vec::new(),
    };
    save_job(&job_path, &job)?;

    let api_key = load_ai_provider_api_key(app, input.provider_id, Some(input.installation_id))?;
    continue_preflight_job(app, &job_path, job, &api_key)
}

fn continue_preflight_job(
    app: &AppHandle,
    job_path: &Path,
    mut job: AlignmentJob,
    api_key: &str,
) -> Result<AlignedTranslationPreflightResponse, String> {
    let mismatch = run_mismatch_preflight(app, &mut job, api_key)?;
    save_job(job_path, &job)?;
    if mismatch {
        job.status = "mismatch".to_string();
        save_job(job_path, &job)?;
        let progress = progress_event(
            &job.job_id,
            "mismatch_gate",
            "Checking match quality",
            "warning",
            Some(1),
            Some(1),
            "The pasted text does not appear to match much of this file",
        );
        emit_progress(app, &progress);
        return Ok(preflight_response(&job, progress));
    }

    run_remaining_alignment(app, &mut job, api_key)?;
    job.status = "readyToApply".to_string();
    save_job(job_path, &job)?;
    let progress = progress_event(
        &job.job_id,
        "final_checks",
        "Final checks",
        "complete",
        Some(1),
        Some(1),
        "Alignment is ready to apply",
    );
    emit_progress(app, &progress);
    Ok(preflight_response(&job, progress))
}

pub(crate) fn apply_aligned_translation_to_gtms_chapter_sync(
    app: &AppHandle,
    input: AlignedTranslationApplyInput,
) -> Result<AlignedTranslationApplyResponse, String> {
    if input.write_mode.trim() != "fillEmptyOnly" {
        return Err("Add translation only supports filling empty rows.".to_string());
    }
    let job_path = job_path(app, input.installation_id, &input.job_id)?;
    let mut job: AlignmentJob = read_json_file(&job_path, "alignment job")?;
    if job.signature
        != build_apply_signature_check(
            &input,
            &job.chapter_base_commit_sha,
            &job.source_units,
            &job.target_units,
            &job.provider_id,
            &job.model_id,
        )
    {
        return Err("The cached alignment job does not match this request.".to_string());
    }
    if job.status == "mismatch" {
        if !input.continue_on_mismatch {
            return Err("The pasted text does not match well enough to apply without confirmation.".to_string());
        }
        let api_key = load_ai_provider_api_key(app, job.provider_id, Some(input.installation_id))?;
        run_remaining_alignment(app, &mut job, &api_key)?;
        job.status = "readyToApply".to_string();
        save_job(&job_path, &job)?;
    }
    if job.status != "readyToApply" {
        return Err("The alignment job is not ready to apply.".to_string());
    }

    let mut context = load_alignment_context(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        &input.repo_name,
        &input.chapter_id,
    )?;
    verify_source_unchanged(&job, &context)?;

    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "apply",
            "Applying translation",
            "running",
            Some(0),
            Some(1),
            "Writing aligned translation",
        ),
    );

    let result = apply_job_to_chapter(app, &mut context, &job)?;
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "apply",
            "Applying translation",
            "complete",
            Some(1),
            Some(1),
            "Aligned translation was applied",
        ),
    );
    Ok(result)
}

struct AlignmentContext {
    repo_path: PathBuf,
    chapter_path: PathBuf,
    chapter_json_path: PathBuf,
    chapter_file: StoredChapterFile,
    rows: Vec<StoredRowFile>,
    chapter_base_commit_sha: Option<String>,
}

fn load_alignment_context(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
    chapter_id: &str,
) -> Result<AlignmentContext, String> {
    let repo_path = resolve_project_git_repo_path(app, installation_id, project_id, Some(repo_name))?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), chapter_id)?;
    let chapter_json_path = chapter_path.join("chapter.json");
    let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
    let rows = load_editor_rows(&chapter_path.join("rows"))?
        .into_iter()
        .filter(|row| row.lifecycle.state != "deleted")
        .collect::<Vec<_>>();
    let chapter_base_commit_sha = current_repo_head_sha(&repo_path);
    Ok(AlignmentContext {
        repo_path,
        chapter_path,
        chapter_json_path,
        chapter_file,
        rows,
        chapter_base_commit_sha,
    })
}

fn source_units_from_rows(rows: &[StoredRowFile], language_code: &str) -> Vec<AlignmentUnit> {
    rows.iter()
        .filter_map(|row| {
            let text = row_plain_text_map(row)
                .get(language_code)
                .cloned()
                .unwrap_or_default()
                .trim()
                .to_string();
            if text.is_empty() {
                return None;
            }
            Some((row.row_id.clone(), text))
        })
        .enumerate()
        .map(|(index, (row_id, text))| AlignmentUnit {
            id: index + 1,
            text_hash: hash_text(&text),
            text,
            original_line_number: index + 1,
            row_id: Some(row_id),
        })
        .collect()
}

fn parse_target_units(text: &str) -> Vec<AlignmentUnit> {
    text.lines()
        .enumerate()
        .filter_map(|(line_index, line)| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            Some((line_index + 1, trimmed.to_string()))
        })
        .enumerate()
        .map(|(index, (line_number, text))| AlignmentUnit {
            id: index + 1,
            text_hash: hash_text(&text),
            text,
            original_line_number: line_number,
            row_id: None,
        })
        .collect()
}

fn chapter_language_base_code(language: &ChapterLanguage) -> &str {
    language
        .base_code
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty())
        .unwrap_or(language.code.as_str())
}

fn next_duplicate_language_code(languages: &[ChapterLanguage], base_code: &str) -> String {
    let base_code = base_code.trim();
    let used_codes = languages
        .iter()
        .map(|language| language.code.as_str())
        .collect::<BTreeSet<_>>();
    if !used_codes.contains(base_code) {
        return base_code.to_string();
    }

    for index in 2..1000 {
        let candidate = format!("{base_code}-x-{index}");
        if !used_codes.contains(candidate.as_str()) {
            return candidate;
        }
    }

    format!("{base_code}-x-{}", languages.len() + 1)
}

fn duplicate_language_base_name(languages: &[ChapterLanguage], base_code: &str) -> String {
    languages
        .iter()
        .find(|language| chapter_language_base_code(language).eq_ignore_ascii_case(base_code))
        .map(|language| {
            let trimmed_name = language.name.trim();
            if trimmed_name.is_empty() {
                base_code.to_string()
            } else {
                trimmed_name
                    .trim_end_matches(|character: char| character.is_ascii_digit())
                    .trim()
                    .to_string()
            }
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| base_code.to_string())
}

fn number_duplicate_language_group(languages: &mut [ChapterLanguage], base_code: &str) {
    let matching_indexes = languages
        .iter()
        .enumerate()
        .filter_map(|(index, language)| {
            if chapter_language_base_code(language).eq_ignore_ascii_case(base_code) {
                Some(index)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if matching_indexes.len() <= 1 {
        return;
    }

    let base_name = duplicate_language_base_name(languages, base_code);
    for (position, language_index) in matching_indexes.into_iter().enumerate() {
        if let Some(language) = languages.get_mut(language_index) {
            language.name = format!("{} {}", base_name, position + 1);
            language.base_code = Some(base_code.to_string());
        }
    }
}

fn build_signature(
    input: &AlignedTranslationPreflightInput,
    chapter_base_commit_sha: &Option<String>,
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
) -> Value {
    json!({
        "version": ALIGNMENT_PROMPT_VERSION,
        "chapterId": input.chapter_id,
        "projectFullName": input.project_full_name,
        "chapterBaseCommitSha": chapter_base_commit_sha,
        "sourceLanguageCode": input.source_language_code,
        "targetLanguageCode": input.target_language_code,
        "providerId": input.provider_id.as_str(),
        "modelId": input.model_id,
        "sectionSize": SECTION_SIZE,
        "sectionOverlap": SECTION_OVERLAP,
        "sourceRows": source_units.iter().map(|unit| json!({
            "id": unit.id,
            "rowId": unit.row_id,
            "textHash": unit.text_hash,
        })).collect::<Vec<_>>(),
        "targetTextHash": hash_json(&target_units.iter().map(|unit| &unit.text_hash).collect::<Vec<_>>()),
    })
}

fn build_apply_signature_check(
    input: &AlignedTranslationApplyInput,
    chapter_base_commit_sha: &Option<String>,
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
    provider_id: &AiProviderId,
    model_id: &str,
) -> Value {
    json!({
        "version": ALIGNMENT_PROMPT_VERSION,
        "chapterId": input.chapter_id,
        "projectFullName": input.project_full_name,
        "chapterBaseCommitSha": chapter_base_commit_sha,
        "sourceLanguageCode": input.source_language_code,
        "targetLanguageCode": input.target_language_code,
        "providerId": provider_id.as_str(),
        "modelId": model_id,
        "sectionSize": SECTION_SIZE,
        "sectionOverlap": SECTION_OVERLAP,
        "sourceRows": source_units.iter().map(|unit| json!({
            "id": unit.id,
            "rowId": unit.row_id,
            "textHash": unit.text_hash,
        })).collect::<Vec<_>>(),
        "targetTextHash": hash_json(&target_units.iter().map(|unit| &unit.text_hash).collect::<Vec<_>>()),
    })
}

fn build_sections(units: &[AlignmentUnit]) -> Vec<SectionWindow> {
    if units.is_empty() {
        return Vec::new();
    }
    let step = SECTION_SIZE.saturating_sub(SECTION_OVERLAP).max(1);
    let mut sections = Vec::new();
    let mut start = 0usize;
    while start < units.len() {
        let end = (start + SECTION_SIZE).min(units.len());
        let slice = &units[start..end];
        sections.push(SectionWindow {
            section_id: sections.len() + 1,
            unit_ids: slice.iter().map(|unit| unit.id).collect(),
            unit_range: [slice.first().map(|unit| unit.id).unwrap_or(1), slice.last().map(|unit| unit.id).unwrap_or(1)],
            content_hash: hash_json(&slice.iter().map(|unit| &unit.text_hash).collect::<Vec<_>>()),
        });
        if end == units.len() {
            break;
        }
        start += step;
    }
    sections
}

fn run_mismatch_preflight(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<bool, String> {
    if job.source_units.len() <= SECTION_SIZE && job.target_units.len() <= SECTION_SIZE {
        let matches = short_text_compatibility(job, api_key)?;
        job.mismatch = Some(if matches {
            MismatchMetrics {
                source_unmatched_percent: 0.0,
                target_unmatched_percent: 0.0,
                matched_source_sections: 1,
                matched_target_sections: 1,
                total_source_sections: 1,
                total_target_sections: 1,
            }
        } else {
            MismatchMetrics {
                source_unmatched_percent: 100.0,
                target_unmatched_percent: 100.0,
                matched_source_sections: 0,
                matched_target_sections: 0,
                total_source_sections: 1,
                total_target_sections: 1,
            }
        });
        return Ok(!matches);
    }

    summarize_sections(app, job, api_key)?;
    find_section_matches(app, job, api_key)?;
    select_corridor(app, job);
    let metrics = mismatch_metrics(job);
    let mismatch = metrics.source_unmatched_percent > MISMATCH_THRESHOLD_PERCENT
        || metrics.target_unmatched_percent > MISMATCH_THRESHOLD_PERCENT;
    job.mismatch = Some(metrics);
    Ok(mismatch)
}

fn run_remaining_alignment(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<(), String> {
    if job.corridor.is_empty() {
        if job.source_units.len() <= SECTION_SIZE && job.target_units.len() <= SECTION_SIZE {
            job.corridor.push(SectionMatch {
                source_section_id: 1,
                target_section_id: 1,
                is_match: true,
                overlap_percent: 100.0,
            });
        } else {
            select_corridor(app, job);
        }
    }
    align_rows(app, job, api_key)?;
    resolve_missing_alignments(job);
    split_targets(app, job, api_key)?;
    job.final_checks = final_checks(job);
    Ok(())
}

fn short_text_compatibility(job: &AlignmentJob, api_key: &str) -> Result<bool, String> {
    let prompt_input = json!({
        "sourceUnits": job.source_units,
        "targetUnits": job.target_units,
    });
    let prompt = format!(
        "Determine whether the target text is a translation or partial translation of the source text. Return only the schema fields.\n\nInput:\n{}",
        serde_json::to_string_pretty(&prompt_input).unwrap_or_default()
    );
    let response: CompatibilityResponse = run_json_prompt(
        job,
        api_key,
        "alignment_compatibility",
        compatibility_schema(),
        &prompt,
    )?;
    Ok(response.matches)
}

fn summarize_sections(app: &AppHandle, job: &mut AlignmentJob, api_key: &str) -> Result<(), String> {
    let total = job.source_sections.len() + job.target_sections.len();
    for (index, (doc_role, section)) in job.source_sections.iter().map(|s| ("source", s)).chain(job.target_sections.iter().map(|s| ("target", s))).enumerate() {
        if job.summaries.iter().any(|summary| {
            summary.doc_role == doc_role
                && summary.section_id == section.section_id
                && summary.section_content_hash == section.content_hash
        }) {
            continue;
        }
        emit_progress(app, &progress_event(
            &job.job_id,
            "summarize_sections",
            "Summarizing sections",
            "running",
            Some(index),
            Some(total),
            "Summarizing section",
        ));
        let units = units_for_section(if doc_role == "source" { &job.source_units } else { &job.target_units }, section);
        let language = if doc_role == "source" { &job.source_language_code } else { &job.target_language_code };
        let input = json!({
            "docRole": doc_role,
            "sectionId": section.section_id,
            "language": language,
            "units": units,
        });
        let prompt = format!(
            "Summarize this {language} document section in approximately 100 words in {language}. Do not translate the summary to another language.\n\nInput:\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        );
        let response: SummaryResponse =
            run_json_prompt(job, api_key, "same_language_section_summary", summary_schema(), &prompt)?;
        job.summaries.push(SectionSummary {
            doc_role: doc_role.to_string(),
            section_id: section.section_id,
            language: language.to_string(),
            summary: response.section_summary.summary,
            section_content_hash: section.content_hash.clone(),
        });
    }
    emit_progress(app, &progress_event(
        &job.job_id,
        "summarize_sections",
        "Summarizing sections",
        "complete",
        Some(total),
        Some(total),
        "Completed section summaries",
    ));
    Ok(())
}

fn find_section_matches(app: &AppHandle, job: &mut AlignmentJob, api_key: &str) -> Result<(), String> {
    let source_summaries = summaries_by_role(job, "source");
    let target_summaries = summaries_by_role(job, "target");
    for (index, target) in target_summaries.iter().enumerate() {
        if job.section_matches.iter().any(|item| item.target_section_id == target.section_id) {
            continue;
        }
        emit_progress(app, &progress_event(
            &job.job_id,
            "find_section_matches",
            "Finding section matches",
            "running",
            Some(index),
            Some(target_summaries.len()),
            "Comparing section summaries",
        ));
        let input = json!({
            "targetSection": target,
            "sourceCandidates": source_summaries,
        });
        let prompt = format!(
            "A match means the target section and source section contain overlapping rows. Because sections overlap by 50%, each target section typically has about three matches. Return every source candidate with match/no-match and estimated percent overlap. Do not explain.\n\nInput:\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        );
        let response: SectionMatchResponse =
            run_json_prompt(job, api_key, "section_overlap_matches", section_match_schema(), &prompt)?;
        for item in response.matches {
            job.section_matches.push(SectionMatch {
                target_section_id: target.section_id,
                source_section_id: item.source_section_id,
                is_match: item.is_match,
                overlap_percent: item.overlap_percent.clamp(0.0, 100.0),
            });
        }
    }
    emit_progress(app, &progress_event(
        &job.job_id,
        "find_section_matches",
        "Finding section matches",
        "complete",
        Some(target_summaries.len()),
        Some(target_summaries.len()),
        "Completed section matching",
    ));
    Ok(())
}

fn select_corridor(app: &AppHandle, job: &mut AlignmentJob) {
    let mut selected = Vec::new();
    for target_section in &job.target_sections {
        let mut matches = job.section_matches
            .iter()
            .filter(|item| item.target_section_id == target_section.section_id && item.is_match)
            .cloned()
            .collect::<Vec<_>>();
        matches.sort_by(|a, b| b.overlap_percent.partial_cmp(&a.overlap_percent).unwrap_or(std::cmp::Ordering::Equal));
        selected.extend(matches.into_iter().take(3));
    }
    if selected.is_empty() && job.source_sections.len() == 1 && job.target_sections.len() == 1 {
        selected.push(SectionMatch {
            target_section_id: 1,
            source_section_id: 1,
            is_match: true,
            overlap_percent: 100.0,
        });
    }
    job.corridor = selected;
    emit_progress(app, &progress_event(
        &job.job_id,
        "select_corridor",
        "Selecting section corridor",
        "complete",
        Some(job.corridor.len()),
        Some(job.target_sections.len().max(1)),
        "Selected section corridor",
    ));
}

fn align_rows(app: &AppHandle, job: &mut AlignmentJob, api_key: &str) -> Result<(), String> {
    let total = job.corridor.len().max(1);
    let mut candidates: BTreeMap<usize, Vec<Vec<usize>>> = BTreeMap::new();
    let corridor = job.corridor.clone();
    for (index, pair) in corridor.iter().enumerate() {
        emit_progress(app, &progress_event(
            &job.job_id,
            "row_alignment",
            "Aligning rows inside matched sections",
            "running",
            Some(index),
            Some(total),
            "Aligning section row pairs",
        ));
        let Some(source_section) = job.source_sections.iter().find(|section| section.section_id == pair.source_section_id) else {
            continue;
        };
        let Some(target_section) = job.target_sections.iter().find(|section| section.section_id == pair.target_section_id) else {
            continue;
        };
        let source_units = units_for_section(&job.source_units, source_section);
        let target_units = units_for_section(&job.target_units, target_section);
        let prompt = build_row_alignment_prompt(&source_units, &target_units)?;
        let response: AlignmentResponse =
            run_json_prompt(job, api_key, "row_alignment_response", alignment_schema(), &prompt)?;
        let alignments = validate_alignments(response, &source_units, &target_units)?;
        for alignment in alignments {
            candidates.entry(alignment.target_id).or_default().push(alignment.source_ids);
        }
    }
    job.alignments = resolve_row_candidate_conflicts(app, job, api_key, candidates)?;
    emit_progress(app, &progress_event(
        &job.job_id,
        "row_alignment",
        "Aligning rows inside matched sections",
        "complete",
        Some(total),
        Some(total),
        "Completed row alignment",
    ));
    Ok(())
}

fn resolve_row_candidate_conflicts(
    app: &AppHandle,
    job: &AlignmentJob,
    api_key: &str,
    candidates: BTreeMap<usize, Vec<Vec<usize>>>,
) -> Result<Vec<Alignment>, String> {
    let conflicts = candidates
        .iter()
        .filter(|(_, source_sets)| dedupe_source_sets(source_sets).len() > 1)
        .count();
    let mut resolved = Vec::new();
    let mut completed = 0usize;
    for (target_id, source_sets) in candidates {
        let distinct = dedupe_source_sets(&source_sets);
        if distinct.len() <= 1 {
            resolved.push(Alignment {
                target_id,
                source_ids: distinct.into_iter().next().unwrap_or_default(),
            });
            continue;
        }
        emit_progress(app, &progress_event(
            &job.job_id,
            "resolve_conflicts",
            "Resolving conflicts",
            "running",
            Some(completed),
            Some(conflicts.max(1)),
            "Resolving row alignment conflict",
        ));
        resolved.push(resolve_one_row_conflict(job, api_key, target_id, &distinct)?);
        completed += 1;
    }
    emit_progress(app, &progress_event(
        &job.job_id,
        "resolve_conflicts",
        "Resolving conflicts",
        "complete",
        Some(completed),
        Some(conflicts.max(1)),
        if conflicts == 0 {
            "No row alignment conflicts to resolve"
        } else {
            "Resolved row alignment conflicts"
        },
    ));
    resolved.sort_by_key(|alignment| alignment.target_id);
    Ok(resolved)
}

fn dedupe_source_sets(source_sets: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut distinct = source_sets
        .iter()
        .map(|set| {
            let mut sorted = set.clone();
            sorted.sort_unstable();
            sorted.dedup();
            sorted
        })
        .collect::<Vec<_>>();
    distinct.sort_by_key(|set| {
        (
            set.is_empty(),
            set.first().copied().unwrap_or(usize::MAX),
            set.last().copied().unwrap_or(usize::MAX),
            set.len(),
        )
    });
    distinct.dedup();
    distinct
}

fn resolve_one_row_conflict(
    job: &AlignmentJob,
    api_key: &str,
    target_id: usize,
    source_sets: &[Vec<usize>],
) -> Result<Alignment, String> {
    let Some(target) = job.target_units.iter().find(|unit| unit.id == target_id) else {
        return Err(format!("Could not resolve conflict for unknown target unit {target_id}."));
    };
    let non_empty_source_ids = source_sets
        .iter()
        .flat_map(|set| set.iter().copied())
        .collect::<Vec<_>>();
    if non_empty_source_ids.is_empty() {
        return Ok(Alignment {
            target_id,
            source_ids: Vec::new(),
        });
    }
    let min_source_id = non_empty_source_ids.iter().min().copied().unwrap_or(1).saturating_sub(1).max(1);
    let max_source_id = non_empty_source_ids
        .iter()
        .max()
        .copied()
        .unwrap_or(1)
        .saturating_add(1)
        .min(job.source_units.len());
    let candidate_sources = job.source_units
        .iter()
        .filter(|unit| unit.id >= min_source_id && unit.id <= max_source_id)
        .cloned()
        .collect::<Vec<_>>();
    let prompt = format!(
        "Resolve one row-level alignment conflict. The previous alignment passes disagreed about the source ids for this target unit. Use only the provided expanded source region. Return exactly one alignment for targetId {}. Return sourceIds: [] if none of the source units match. Return ids only.\n\nInput:\n{}",
        target_id,
        serde_json::to_string_pretty(&json!({
            "targetUnit": target,
            "conflictingSourceIdSets": source_sets,
            "expandedSourceUnits": candidate_sources,
        }))
        .unwrap_or_default()
    );
    let response: AlignmentResponse =
        run_json_prompt(job, api_key, "row_conflict_resolution", alignment_schema(), &prompt)?;
    let mut alignments = validate_alignments(response, &candidate_sources, std::slice::from_ref(target))?;
    Ok(alignments.pop().unwrap_or(Alignment {
        target_id,
        source_ids: Vec::new(),
    }))
}

fn resolve_missing_alignments(job: &mut AlignmentJob) {
    let existing = job.alignments
        .iter()
        .map(|alignment| alignment.target_id)
        .collect::<HashSet<_>>();
    for target in &job.target_units {
        if !existing.contains(&target.id) {
            job.alignments.push(Alignment {
                target_id: target.id,
                source_ids: Vec::new(),
            });
        }
    }
    job.alignments.sort_by_key(|alignment| alignment.target_id);
}

fn split_targets(app: &AppHandle, job: &mut AlignmentJob, api_key: &str) -> Result<(), String> {
    let split_inputs = job.alignments.iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .filter_map(|alignment| {
            let target = job.target_units.iter().find(|unit| unit.id == alignment.target_id)?;
            let sources = alignment.source_ids.iter()
                .filter_map(|source_id| job.source_units.iter().find(|unit| unit.id == *source_id))
                .map(|unit| json!({ "sourceId": unit.id, "sourceText": unit.text }))
                .collect::<Vec<_>>();
            Some(json!({
                "targetId": target.id,
                "targetText": target.text,
                "sources": sources,
            }))
        })
        .collect::<Vec<_>>();
    if split_inputs.is_empty() {
        emit_progress(app, &progress_event(
            &job.job_id,
            "split_targets",
            "Splitting combined target rows",
            "complete",
            Some(0),
            Some(0),
            "No combined target rows to split",
        ));
        return Ok(());
    }
    let prompt = format!(
        "Split target-language text units into the exact parts that correspond to each source-language unit. Return only target ids, source ids, and exact target text fragments copied from targetText.\n\nInput:\n{}",
        serde_json::to_string_pretty(&json!({ "splitTargets": split_inputs })).unwrap_or_default()
    );
    let response: SplitTargetResponse =
        run_json_prompt(job, api_key, "split_target_response", split_schema(), &prompt)?;
    job.split_targets = validate_split_response(job, response);
    emit_progress(app, &progress_event(
        &job.job_id,
        "split_targets",
        "Splitting combined target rows",
        "complete",
        Some(job.split_targets.len()),
        Some(split_inputs.len()),
        "Completed split target pass",
    ));
    Ok(())
}

fn validate_split_response(job: &AlignmentJob, response: SplitTargetResponse) -> Vec<SplitTarget> {
    let target_by_id = job.target_units.iter().map(|unit| (unit.id, unit)).collect::<HashMap<_, _>>();
    let allowed: HashMap<usize, HashSet<usize>> = job.alignments.iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .map(|alignment| (alignment.target_id, alignment.source_ids.iter().copied().collect()))
        .collect();
    let mut results = Vec::new();
    for item in response.split_targets {
        let Some(target) = target_by_id.get(&item.target_id) else {
            continue;
        };
        let Some(allowed_sources) = allowed.get(&item.target_id) else {
            continue;
        };
        let mut search_start = 0usize;
        let mut fragments = Vec::new();
        for hint in item.fragments {
            if !allowed_sources.contains(&hint.source_id) || hint.target_text_fragment.trim().is_empty() {
                continue;
            }
            if let Some((start, end)) = find_fragment_range(&target.text, &hint.target_text_fragment, search_start) {
                fragments.push(SplitFragment {
                    source_id: hint.source_id,
                    range: [start, end],
                    text: slice_chars(&target.text, start, end),
                });
                search_start = end;
            }
        }
        if split_covers_target(&target.text, &fragments, allowed_sources) {
            results.push(SplitTarget {
                target_id: item.target_id,
                fragments,
            });
        }
    }
    results
}

fn final_checks(job: &AlignmentJob) -> Vec<FinalCheck> {
    let rendered_target_texts = rendered_target_texts(job);
    let target_missing = missing_tokens(
        job.target_units.iter().map(|unit| unit.text.as_str()),
        rendered_target_texts.iter().map(String::as_str),
    );
    vec![
        FinalCheck {
            name: "sourceTextCoverage".to_string(),
            passed: true,
            warning: false,
            details: Vec::new(),
        },
        FinalCheck {
            name: "targetWordCoverage".to_string(),
            passed: target_missing.is_empty(),
            warning: false,
            details: target_missing,
        },
    ]
}

fn apply_job_to_chapter(
    app: &AppHandle,
    context: &mut AlignmentContext,
    job: &AlignmentJob,
) -> Result<AlignedTranslationApplyResponse, String> {
    let mut languages = sanitize_chapter_languages(&context.chapter_file.languages);
    let target_exists = languages.iter().any(|language| language.code == job.target_language_code);
    if !target_exists {
        let target_base_language_code = if job.target_base_language_code.trim().is_empty() {
            job.target_language_code.as_str()
        } else {
            job.target_base_language_code.as_str()
        };
        let duplicate_group_exists = languages.iter().any(|language| {
            chapter_language_base_code(language)
                .eq_ignore_ascii_case(target_base_language_code)
        });
        let base_name = duplicate_language_base_name(&languages, target_base_language_code);
        languages.push(ChapterLanguage {
            code: job.target_language_code.clone(),
            name: base_name,
            role: "target".to_string(),
            base_code: if duplicate_group_exists || job.target_language_code != target_base_language_code {
                Some(target_base_language_code.to_string())
            } else {
                None
            },
        });
        number_duplicate_language_group(&mut languages, target_base_language_code);
        context.chapter_file.languages = languages.clone();
    }

    let mut row_values = load_row_values(&context.chapter_path, &context.rows)?;
    if !target_exists {
        for (_, row_value) in row_values.iter_mut() {
            ensure_language_field(row_value, &job.target_language_code)?;
        }
    }

    let row_texts = build_row_translation_plan(job);
    let mut updated_row_count = 0usize;
    let mut skipped_non_empty = 0usize;
    let mut inserted_rows = Vec::new();
    for (row_id, text) in row_texts.matched_rows {
        let Some(row_value) = row_values.get_mut(&row_id) else {
            continue;
        };
        let existing = row_plain_text_from_value(row_value, &job.target_language_code)?;
        if !existing.trim().is_empty() {
            skipped_non_empty += 1;
            continue;
        }
        set_row_plain_text(row_value, &job.target_language_code, &text)?;
        updated_row_count += 1;
    }

    let insertion_groups = group_unmatched_targets(job, row_texts.unmatched_targets);
    let insertion_plan = build_bulk_insertion_plan(&context.rows, &insertion_groups)?;
    for (row_id, order_key) in insertion_plan.existing_order_keys {
        if let Some(row_value) = row_values.get_mut(&row_id) {
            set_row_order_key(row_value, &order_key)?;
        }
    }
    for target in insertion_plan.inserted_targets {
        let row_id = uuid::Uuid::now_v7().to_string();
        let mut row_value = create_inserted_row_file(&row_id, &target.order_key, &context.chapter_file, &languages);
        set_row_plain_text(&mut row_value, &job.target_language_code, &target.target.text)?;
        row_values.insert(row_id.clone(), row_value);
        inserted_rows.push(row_id);
    }

    let rows_path = context.chapter_path.join("rows");
    let mut changed_paths = Vec::new();
    if !target_exists {
        write_json_pretty(&context.chapter_json_path, &context.chapter_file)?;
        changed_paths.push(repo_relative_path(&context.repo_path, &context.chapter_json_path)?);
    }

    for (row_id, row_value) in row_values {
        let row_path = rows_path.join(format!("{row_id}.json"));
        let next_text = format!(
            "{}\n",
            serde_json::to_string_pretty(&row_value)
                .map_err(|error| format!("Could not serialize row '{row_id}': {error}"))?
        );
        let current_text = fs::read_to_string(&row_path).unwrap_or_default();
        if current_text != next_text {
            write_text_file(&row_path, &next_text)?;
            changed_paths.push(repo_relative_path(&context.repo_path, &row_path)?);
        }
    }

    if !changed_paths.is_empty() {
        let mut add_args = vec!["add"];
        for path in &changed_paths {
            add_args.push(path.as_str());
        }
        git_output(&context.repo_path, &add_args)?;
        let commit_paths = changed_paths.iter().map(String::as_str).collect::<Vec<_>>();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &context.repo_path,
            &format!("Add aligned {} translation", job.target_language_code),
            &commit_paths,
            CommitMetadata {
                operation: Some("add-aligned-translation"),
                status_note: None,
                ai_model: Some(job.model_id.as_str()),
            },
        )?;
    }

    let refreshed_rows = load_editor_rows(&context.chapter_path.join("rows"))?;
    let source_word_counts = build_source_word_counts_from_stored_rows(&refreshed_rows, &languages);
    let commit_sha = if changed_paths.is_empty() {
        None
    } else {
        Some(git_output(&context.repo_path, &["rev-parse", "--short", "HEAD"])?)
    };
    Ok(AlignedTranslationApplyResponse {
        job_id: job.job_id.clone(),
        updated_row_count,
        skipped_non_empty_row_count: skipped_non_empty,
        inserted_row_count: inserted_rows.len(),
        target_language_code: job.target_language_code.clone(),
        source_word_counts,
        commit_sha,
        chapter_base_commit_sha: current_repo_head_sha(&context.repo_path),
    })
}

#[derive(Default)]
struct RowTranslationPlan {
    matched_rows: BTreeMap<String, String>,
    unmatched_targets: Vec<AlignmentUnit>,
}

fn build_row_translation_plan(job: &AlignmentJob) -> RowTranslationPlan {
    let source_by_id = job.source_units.iter().map(|unit| (unit.id, unit)).collect::<HashMap<_, _>>();
    let target_by_id = job.target_units.iter().map(|unit| (unit.id, unit)).collect::<HashMap<_, _>>();
    let split_by_target = job.split_targets.iter().map(|split| (split.target_id, split)).collect::<HashMap<_, _>>();
    let mut plan = RowTranslationPlan::default();
    for alignment in &job.alignments {
        let Some(target) = target_by_id.get(&alignment.target_id) else {
            continue;
        };
        if alignment.source_ids.is_empty() {
            plan.unmatched_targets.push((*target).clone());
            continue;
        }
        if let Some(split) = split_by_target.get(&alignment.target_id) {
            for fragment in &split.fragments {
                if let Some(row_id) = source_by_id.get(&fragment.source_id).and_then(|unit| unit.row_id.clone()) {
                    append_row_text(&mut plan.matched_rows, &row_id, &fragment.text);
                }
            }
            continue;
        }
        for source_id in &alignment.source_ids {
            if let Some(row_id) = source_by_id.get(source_id).and_then(|unit| unit.row_id.clone()) {
                append_row_text(&mut plan.matched_rows, &row_id, &target.text);
            }
        }
    }
    plan.unmatched_targets.sort_by_key(|unit| unit.id);
    plan
}

fn append_row_text(rows: &mut BTreeMap<String, String>, row_id: &str, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    rows.entry(row_id.to_string())
        .and_modify(|existing| {
            if !existing.is_empty() {
                existing.push('\n');
            }
            existing.push_str(text);
        })
        .or_insert_with(|| text.to_string());
}

struct InsertionGroup {
    previous_row_id: Option<String>,
    next_row_id: Option<String>,
    targets: Vec<AlignmentUnit>,
}

struct BulkInsertionPlan {
    existing_order_keys: BTreeMap<String, String>,
    inserted_targets: Vec<OrderedTargetUnit>,
}

struct OrderedTargetUnit {
    target: AlignmentUnit,
    order_key: String,
}

enum LogicalRowSlot {
    Existing(String),
    Inserted(AlignmentUnit),
}

fn group_unmatched_targets(
    job: &AlignmentJob,
    unmatched_targets: Vec<AlignmentUnit>,
) -> Vec<InsertionGroup> {
    let target_alignment = job.alignments.iter().map(|alignment| (alignment.target_id, alignment)).collect::<HashMap<_, _>>();
    let source_by_id = job.source_units.iter().map(|unit| (unit.id, unit)).collect::<HashMap<_, _>>();
    let mut groups: BTreeMap<(Option<String>, Option<String>), Vec<AlignmentUnit>> = BTreeMap::new();
    for target in unmatched_targets {
        let previous = job.alignments.iter()
            .filter(|alignment| alignment.target_id < target.id && !alignment.source_ids.is_empty())
            .max_by_key(|alignment| alignment.target_id)
            .and_then(|alignment| alignment.source_ids.iter().max().copied())
            .and_then(|source_id| source_by_id.get(&source_id))
            .and_then(|unit| unit.row_id.clone());
        let next = job.target_units.iter()
            .filter(|candidate| candidate.id > target.id)
            .find_map(|candidate| target_alignment.get(&candidate.id).filter(|alignment| !alignment.source_ids.is_empty()))
            .and_then(|alignment| alignment.source_ids.iter().min().copied())
            .and_then(|source_id| source_by_id.get(&source_id))
            .and_then(|unit| unit.row_id.clone());
        groups.entry((previous, next)).or_default().push(target);
    }
    groups.into_iter()
        .map(|((previous_row_id, next_row_id), targets)| InsertionGroup {
            previous_row_id,
            next_row_id,
            targets,
        })
        .collect()
}

fn verify_source_unchanged(job: &AlignmentJob, context: &AlignmentContext) -> Result<(), String> {
    if context.chapter_base_commit_sha != job.chapter_base_commit_sha {
        return Err("The file changed while alignment was running. Run Add translation again.".to_string());
    }
    let current_units = source_units_from_rows(&context.rows, &job.source_language_code);
    let current = current_units.iter().map(|unit| (&unit.row_id, &unit.text_hash)).collect::<Vec<_>>();
    let expected = job.source_units.iter().map(|unit| (&unit.row_id, &unit.text_hash)).collect::<Vec<_>>();
    if current != expected {
        return Err("The file changed while alignment was running. Run Add translation again.".to_string());
    }
    Ok(())
}

fn load_row_values(chapter_path: &Path, rows: &[StoredRowFile]) -> Result<BTreeMap<String, Value>, String> {
    let mut values = BTreeMap::new();
    for row in rows {
        let path = chapter_path.join("rows").join(format!("{}.json", row.row_id));
        values.insert(row.row_id.clone(), read_json_file(&path, "row file")?);
    }
    Ok(values)
}

fn ensure_language_field(row_value: &mut Value, language_code: &str) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    fields_object
        .entry(language_code.to_string())
        .or_insert_with(default_field_value);
    let field_object = fields_object
        .get_mut(language_code)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)
}

fn default_field_value() -> Value {
    json!({
        "value_kind": "text",
        "plain_text": "",
        "footnote": "",
        "image_caption": "",
        "rich_text": Value::Null,
        "notes_html": "",
        "attachments": [],
        "passthrough_value": Value::Null,
        "editor_flags": {
            "reviewed": false,
            "please_check": false,
        }
    })
}

fn row_plain_text_from_value(row_value: &mut Value, language_code: &str) -> Result<String, String> {
    ensure_language_field(row_value, language_code)?;
    Ok(row_value
        .get("fields")
        .and_then(Value::as_object)
        .and_then(|fields| fields.get(language_code))
        .and_then(Value::as_object)
        .and_then(|field| field.get("plain_text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

fn set_row_plain_text(row_value: &mut Value, language_code: &str, text: &str) -> Result<(), String> {
    ensure_language_field(row_value, language_code)?;
    let fields_object = row_fields_object_mut(row_value)?;
    let field_object = fields_object
        .get_mut(language_code)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;
    field_object.insert("plain_text".to_string(), Value::String(text.to_string()));
    field_object.remove("html_preview");
    Ok(())
}

fn count_existing_translation_rows(rows: &[StoredRowFile], language_code: &str) -> usize {
    rows.iter()
        .filter(|row| row_plain_text_map(row).get(language_code).map(|text| !text.trim().is_empty()).unwrap_or(false))
        .count()
}

fn order_key_for_row<'a>(rows: &'a [StoredRowFile], row_id: &str) -> Option<&'a str> {
    rows.iter()
        .find(|row| row.row_id == row_id)
        .map(|row| row.structure.order_key.as_str())
}

fn build_bulk_insertion_plan(
    rows: &[StoredRowFile],
    groups: &[InsertionGroup],
) -> Result<BulkInsertionPlan, String> {
    let mut inserted_targets = Vec::new();
    let mut needs_rebalance = false;
    for group in groups {
        match allocate_bulk_order_keys(
            group.previous_row_id.as_deref().and_then(|row_id| order_key_for_row(rows, row_id)),
            group.next_row_id.as_deref().and_then(|row_id| order_key_for_row(rows, row_id)),
            group.targets.len(),
        ) {
            Ok(order_keys) => {
                inserted_targets.extend(group.targets.iter().cloned().zip(order_keys).map(
                    |(target, order_key)| OrderedTargetUnit { target, order_key },
                ));
            }
            Err(_) => {
                needs_rebalance = true;
                break;
            }
        }
    }
    if !needs_rebalance {
        return Ok(BulkInsertionPlan {
            existing_order_keys: BTreeMap::new(),
            inserted_targets,
        });
    }
    build_rebalanced_bulk_insertion_plan(rows, groups)
}

fn build_rebalanced_bulk_insertion_plan(
    rows: &[StoredRowFile],
    groups: &[InsertionGroup],
) -> Result<BulkInsertionPlan, String> {
    let mut before = BTreeMap::<String, Vec<AlignmentUnit>>::new();
    let mut after = BTreeMap::<String, Vec<AlignmentUnit>>::new();
    let mut document_start = Vec::new();
    let mut document_end = Vec::new();
    for group in groups {
        match (&group.previous_row_id, &group.next_row_id) {
            (None, Some(next)) => before.entry(next.clone()).or_default().extend(group.targets.clone()),
            (Some(previous), _) => after.entry(previous.clone()).or_default().extend(group.targets.clone()),
            (None, None) => document_start.extend(group.targets.clone()),
        }
    }
    document_end.extend(document_start);

    let mut ordered_rows = rows.to_vec();
    ordered_rows.sort_by(|left, right| {
        left.structure
            .order_key
            .cmp(&right.structure.order_key)
            .then_with(|| left.row_id.cmp(&right.row_id))
    });

    let mut slots = Vec::new();
    if ordered_rows.is_empty() {
        slots.extend(document_end.into_iter().map(LogicalRowSlot::Inserted));
    } else {
        for row in &ordered_rows {
            if let Some(targets) = before.remove(&row.row_id) {
                slots.extend(targets.into_iter().map(LogicalRowSlot::Inserted));
            }
            slots.push(LogicalRowSlot::Existing(row.row_id.clone()));
            if let Some(targets) = after.remove(&row.row_id) {
                slots.extend(targets.into_iter().map(LogicalRowSlot::Inserted));
            }
        }
        slots.extend(document_end.into_iter().map(LogicalRowSlot::Inserted));
    }
    for (_, targets) in before {
        slots.extend(targets.into_iter().map(LogicalRowSlot::Inserted));
    }
    for (_, targets) in after {
        slots.extend(targets.into_iter().map(LogicalRowSlot::Inserted));
    }

    let mut existing_order_keys = BTreeMap::new();
    let mut inserted_targets = Vec::new();
    for (index, slot) in slots.into_iter().enumerate() {
        let order_key = rebalanced_order_key(index)?;
        match slot {
            LogicalRowSlot::Existing(row_id) => {
                existing_order_keys.insert(row_id, order_key);
            }
            LogicalRowSlot::Inserted(target) => {
                inserted_targets.push(OrderedTargetUnit { target, order_key });
            }
        }
    }
    Ok(BulkInsertionPlan {
        existing_order_keys,
        inserted_targets,
    })
}

fn rebalanced_order_key(index: usize) -> Result<String, String> {
    let position = u128::try_from(index + 1)
        .map_err(|error| format!("Could not rebalance row order keys: {error}"))?;
    let key = ORDER_KEY_SPACING
        .checked_mul(position)
        .ok_or_else(|| "There are too many rows to rebalance order keys safely.".to_string())?;
    Ok(format!("{key:032x}"))
}

fn set_row_order_key(row_value: &mut Value, order_key: &str) -> Result<(), String> {
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let structure_value = row_object
        .entry("structure".to_string())
        .or_insert_with(|| json!({}));
    let structure_object = structure_value
        .as_object_mut()
        .ok_or_else(|| "The row structure is not a JSON object.".to_string())?;
    structure_object.insert("order_key".to_string(), Value::String(order_key.to_string()));
    Ok(())
}

fn allocate_bulk_order_keys(previous: Option<&str>, next: Option<&str>, count: usize) -> Result<Vec<String>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let previous_value = previous.map(parse_order_key_hex_local).transpose()?;
    let next_value = next.map(parse_order_key_hex_local).transpose()?;
    let mut keys = Vec::with_capacity(count);
    match (previous_value, next_value) {
        (Some(previous_key), Some(next_key)) => {
            if previous_key >= next_key {
                return Err("The surrounding rows are out of order.".to_string());
            }
            let slots = u128::try_from(count + 1)
                .map_err(|error| format!("Could not allocate row keys: {error}"))?;
            let gap = next_key - previous_key;
            if gap <= slots {
                return Err("There is no space left to insert all rows here.".to_string());
            }
            for index in 1..=count {
                let step = u128::try_from(index)
                    .map_err(|error| format!("Could not allocate row keys: {error}"))?;
                keys.push(format!("{:032x}", previous_key + ((gap * step) / slots)));
            }
        }
        (Some(previous_key), None) => {
            for index in 1..=count {
                let step = ORDER_KEY_SPACING
                    .checked_mul(u128::try_from(index).map_err(|error| format!("Could not allocate row keys: {error}"))?)
                    .ok_or_else(|| "There is no space left to insert all rows here.".to_string())?;
                keys.push(format!("{:032x}", previous_key.checked_add(step).ok_or_else(|| "There is no space left to insert all rows here.".to_string())?));
            }
        }
        (None, Some(next_key)) => {
            for reverse_index in (1..=count).rev() {
                let step = ORDER_KEY_SPACING
                    .checked_mul(u128::try_from(reverse_index).map_err(|error| format!("Could not allocate row keys: {error}"))?)
                    .ok_or_else(|| "There is no space left to insert all rows here.".to_string())?;
                keys.push(format!("{:032x}", next_key.checked_sub(step).ok_or_else(|| "There is no space left to insert all rows here.".to_string())?));
            }
        }
        (None, None) => {
            for index in 1..=count {
                keys.push(format!("{:032x}", ORDER_KEY_SPACING * u128::try_from(index).unwrap_or(1)));
            }
        }
    }
    Ok(keys)
}

fn parse_order_key_hex_local(value: &str) -> Result<u128, String> {
    let normalized = value.trim();
    if normalized.len() != 32 {
        return Err("The row order key is invalid.".to_string());
    }
    u128::from_str_radix(normalized, 16).map_err(|_| "The row order key is invalid.".to_string())
}

fn run_json_prompt<T: for<'de> Deserialize<'de>>(
    job: &AlignmentJob,
    api_key: &str,
    schema_name: &str,
    schema: Value,
    prompt: &str,
) -> Result<T, String> {
    let response = providers::run_prompt(
        &AiPromptRequest {
            provider_id: job.provider_id,
            model_id: job.model_id.clone(),
            prompt: prompt.to_string(),
            previous_response_id: None,
            output_format: AiPromptOutputFormat::JsonSchema {
                name: schema_name.to_string(),
                schema,
            },
        },
        api_key,
    )?;
    serde_json::from_str(&response.text)
        .map_err(|error| format!("OpenAI returned JSON that did not match the {schema_name} schema: {error}"))
}

fn build_row_alignment_prompt(source_units: &[AlignmentUnit], target_units: &[AlignmentUnit]) -> Result<String, String> {
    let input = json!({
        "sourceUnits": source_units,
        "targetUnits": target_units,
    });
    Ok(format!(
        "You align translated target-language text units to authoritative source-language text units.\n\nRules:\n- Return every target unit exactly once.\n- Return only targetId and sourceIds.\n- Use sourceIds: [] when no source text matches.\n- One target can match multiple source ids.\n- Multiple targets can reference the same source id.\n- Never copy text in the response.\n\nInput:\n{}",
        serde_json::to_string_pretty(&input).map_err(|error| format!("Could not serialize prompt input: {error}"))?
    ))
}

fn validate_alignments(
    response: AlignmentResponse,
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
) -> Result<Vec<Alignment>, String> {
    let source_ids = source_units.iter().map(|unit| unit.id).collect::<HashSet<_>>();
    let target_ids = target_units.iter().map(|unit| unit.id).collect::<BTreeSet<_>>();
    let mut seen = HashSet::new();
    let mut alignments = Vec::new();
    for alignment in response.alignments {
        if !target_ids.contains(&alignment.target_id) {
            return Err(format!("GPT returned target id {}, but that target unit is not in the input.", alignment.target_id));
        }
        if !seen.insert(alignment.target_id) {
            return Err(format!("GPT returned target id {} more than once.", alignment.target_id));
        }
        for source_id in &alignment.source_ids {
            if !source_ids.contains(source_id) {
                return Err(format!("GPT aligned target id {} to unknown source id {}.", alignment.target_id, source_id));
            }
        }
        alignments.push(alignment);
    }
    for target_id in target_ids {
        if !seen.contains(&target_id) {
            return Err(format!("GPT did not return alignment for target id {target_id}."));
        }
    }
    alignments.sort_by_key(|alignment| alignment.target_id);
    Ok(alignments)
}

fn units_for_section(units: &[AlignmentUnit], section: &SectionWindow) -> Vec<AlignmentUnit> {
    let ids = section.unit_ids.iter().copied().collect::<HashSet<_>>();
    units.iter().filter(|unit| ids.contains(&unit.id)).cloned().collect()
}

fn summaries_by_role(job: &AlignmentJob, role: &str) -> Vec<SectionSummary> {
    job.summaries.iter().filter(|summary| summary.doc_role == role).cloned().collect()
}

fn mismatch_metrics(job: &AlignmentJob) -> MismatchMetrics {
    let matched_target = job.section_matches.iter()
        .filter(|item| item.is_match)
        .map(|item| item.target_section_id)
        .collect::<HashSet<_>>();
    let matched_source = job.section_matches.iter()
        .filter(|item| item.is_match)
        .map(|item| item.source_section_id)
        .collect::<HashSet<_>>();
    let total_source = job.source_sections.len().max(1);
    let total_target = job.target_sections.len().max(1);
    MismatchMetrics {
        source_unmatched_percent: ((total_source - matched_source.len()).max(0) as f64 / total_source as f64) * 100.0,
        target_unmatched_percent: ((total_target - matched_target.len()).max(0) as f64 / total_target as f64) * 100.0,
        matched_source_sections: matched_source.len(),
        matched_target_sections: matched_target.len(),
        total_source_sections: total_source,
        total_target_sections: total_target,
    }
}

fn rendered_target_texts(job: &AlignmentJob) -> Vec<String> {
    let plan = build_row_translation_plan(job);
    plan.matched_rows
        .into_values()
        .chain(plan.unmatched_targets.into_iter().map(|unit| unit.text))
        .collect()
}

fn missing_tokens<'a>(input: impl Iterator<Item = &'a str>, output: impl Iterator<Item = &'a str>) -> Vec<String> {
    let input_counts = token_counts(input);
    let output_counts = token_counts(output);
    input_counts.into_iter()
        .filter_map(|(token, count)| {
            let found = output_counts.get(&token).copied().unwrap_or(0);
            (found < count).then_some(format!("{token:?}: expected at least {count}, found {found}"))
        })
        .collect()
}

fn token_counts<'a>(texts: impl Iterator<Item = &'a str>) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for text in texts {
        for token in text.split_whitespace() {
            *counts.entry(token.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

fn find_fragment_range(text: &str, fragment: &str, start_char: usize) -> Option<(usize, usize)> {
    let byte_start = char_to_byte_index(text, start_char)?;
    let haystack = &text[byte_start..];
    let found = haystack.find(fragment)?;
    let start_byte = byte_start + found;
    let end_byte = start_byte + fragment.len();
    Some((byte_to_char_index(text, start_byte), byte_to_char_index(text, end_byte)))
}

fn char_to_byte_index(text: &str, char_index: usize) -> Option<usize> {
    if char_index == text.chars().count() {
        return Some(text.len());
    }
    text.char_indices().nth(char_index).map(|(index, _)| index)
}

fn byte_to_char_index(text: &str, byte_index: usize) -> usize {
    text[..byte_index].chars().count()
}

fn slice_chars(text: &str, start: usize, end: usize) -> String {
    text.chars().skip(start).take(end.saturating_sub(start)).collect()
}

fn split_covers_target(text: &str, fragments: &[SplitFragment], allowed_sources: &HashSet<usize>) -> bool {
    let mut covered = HashSet::new();
    let mut sources = HashSet::new();
    for fragment in fragments {
        if fragment.text.trim().is_empty() {
            continue;
        }
        sources.insert(fragment.source_id);
        for index in fragment.range[0]..fragment.range[1] {
            covered.insert(index);
        }
    }
    if !allowed_sources.iter().all(|source_id| sources.contains(source_id)) {
        return false;
    }
    text.chars()
        .enumerate()
        .all(|(index, character)| character.is_whitespace() || covered.contains(&index))
}

fn preflight_response(job: &AlignmentJob, progress: AlignmentProgressEvent) -> AlignedTranslationPreflightResponse {
    AlignedTranslationPreflightResponse {
        job_id: job.job_id.clone(),
        status: job.status.clone(),
        source_language_code: job.source_language_code.clone(),
        target_language_code: job.target_language_code.clone(),
        target_base_language_code: job.target_base_language_code.clone(),
        target_language_exists: job.target_language_exists,
        existing_translation_count: job.existing_translation_count,
        mismatch: job.mismatch.clone(),
        progress,
        error: String::new(),
    }
}

fn progress_event(
    job_id: &str,
    stage_id: &str,
    stage_label: &str,
    status: &str,
    completed: Option<usize>,
    total: Option<usize>,
    message: &str,
) -> AlignmentProgressEvent {
    let percent = match (completed, total) {
        (Some(completed), Some(total)) if total > 0 => Some((completed as f64 / total as f64) * 100.0),
        _ => None,
    };
    AlignmentProgressEvent {
        job_id: job_id.to_string(),
        stage_id: stage_id.to_string(),
        stage_label: stage_label.to_string(),
        status: status.to_string(),
        completed,
        total,
        percent,
        message: message.to_string(),
        warning_count: usize::from(status == "warning"),
        api_call_count: 0,
        cache_hit_count: 0,
    }
}

fn emit_progress(app: &AppHandle, event: &AlignmentProgressEvent) {
    let _ = app.emit(EVENT_NAME, event);
}

fn job_path(app: &AppHandle, installation_id: i64, job_id: &str) -> Result<PathBuf, String> {
    let root = installation_data_dir(app, installation_id)?.join("alignment-jobs");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create alignment cache folder: {error}"))?;
    Ok(root.join(format!("{job_id}.json")))
}

fn load_cached_job(path: &Path, signature: &Value) -> Result<Option<AlignmentJob>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let job: AlignmentJob = read_json_file(path, "alignment job")?;
    Ok((job.signature == *signature).then_some(job))
}

fn save_job(path: &Path, job: &AlignmentJob) -> Result<(), String> {
    write_json_pretty(path, job)
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hash_json(value: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn compatibility_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["matches"],
        "properties": {
            "matches": { "type": "boolean" }
        }
    })
}

fn summary_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["sectionSummary"],
        "properties": {
            "sectionSummary": {
                "type": "object",
                "additionalProperties": false,
                "required": ["summary"],
                "properties": {
                    "summary": { "type": "string" }
                }
            }
        }
    })
}

fn section_match_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["matches"],
        "properties": {
            "matches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["sourceSectionId", "isMatch", "overlapPercent"],
                    "properties": {
                        "sourceSectionId": { "type": "integer", "minimum": 1 },
                        "isMatch": { "type": "boolean" },
                        "overlapPercent": { "type": "number", "minimum": 0, "maximum": 100 }
                    }
                }
            }
        }
    })
}

fn alignment_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["alignments"],
        "properties": {
            "alignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["targetId", "sourceIds"],
                    "properties": {
                        "targetId": { "type": "integer", "minimum": 1 },
                        "sourceIds": {
                            "type": "array",
                            "items": { "type": "integer", "minimum": 1 }
                        }
                    }
                }
            }
        }
    })
}

fn split_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["splitTargets"],
        "properties": {
            "splitTargets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["targetId", "fragments"],
                    "properties": {
                        "targetId": { "type": "integer", "minimum": 1 },
                        "fragments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["sourceId", "targetTextFragment"],
                                "properties": {
                                    "sourceId": { "type": "integer", "minimum": 1 },
                                    "targetTextFragment": { "type": "string" }
                                }
                            }
                        }
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_target_units_trims_blank_lines_and_preserves_line_numbers() {
        let units = parse_target_units(" one \n\n two\r\n three ");
        assert_eq!(units.len(), 3);
        assert_eq!(units[0].id, 1);
        assert_eq!(units[0].text, "one");
        assert_eq!(units[0].original_line_number, 1);
        assert_eq!(units[1].original_line_number, 3);
    }

    #[test]
    fn bulk_order_keys_evenly_split_finite_gap() {
        let keys = allocate_bulk_order_keys(
            Some("00000000000000000000000000000000"),
            Some("00000000000000000000000000000064"),
            4,
        )
        .expect("keys should allocate");
        assert_eq!(
            keys,
            vec![
                "00000000000000000000000000000014",
                "00000000000000000000000000000028",
                "0000000000000000000000000000003c",
                "00000000000000000000000000000050",
            ]
        );
    }

    #[test]
    fn append_row_text_joins_multiple_units_with_newline() {
        let mut rows = BTreeMap::new();
        append_row_text(&mut rows, "row-1", "one");
        append_row_text(&mut rows, "row-1", "two");
        assert_eq!(rows.get("row-1").map(String::as_str), Some("one\ntwo"));
    }
}
