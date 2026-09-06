use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use unicode_normalization::UnicodeNormalization;

use crate::{
    ai::{
        load_ai_provider_api_key, providers,
        types::{AiPromptOutputFormat, AiPromptRequest, AiProviderId},
    },
    project_import::chapter_import::languages::language_display_name,
    storage_paths::installation_data_dir,
};

use super::{row_structure::create_inserted_row_file, *};

const EVENT_NAME: &str = "aligned-translation-progress";
const SECTION_SIZE: usize = 50;
const SECTION_OVERLAP: usize = 25;
const MISMATCH_THRESHOLD_PERCENT: f64 = 40.0;
const ALIGNMENT_PROMPT_VERSION: &str = "app-aligned-translation-v4-reliable-splits";
const APPLY_DEBUG_LOG_DIR: &str = "logs";
const APPLY_DEBUG_LOG_FILE: &str = "aligned-translation-apply.log";
const APPLY_DEBUG_LOG_MAX_BYTES: u64 = 1_000_000;
const APPLY_PROGRESS_TOTAL: usize = 6;
// Cached alignment jobs hold the pasted translation and source text, so reclaim abandoned
// previews after a week and delete a job as soon as it has been applied.
const ALIGNMENT_JOB_TTL_SECS: u64 = 7 * 24 * 60 * 60;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlignedTranslationPreflightInput {
    pub(crate) installation_id: i64,
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
    pub(crate) installation_id: i64,
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
    #[serde(default)]
    flow: String,
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
    flow: String,
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
    word_counts: BTreeMap<String, usize>,
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
    #[serde(default)]
    adjusted_text: Option<String>,
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
    #[serde(default)]
    source_context_hash: String,
    #[serde(default)]
    subtitle_continuations: bool,
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
    needs_rewrite: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SplitTargetFragmentHint {
    source_id: usize,
    target_text_fragment: String,
    adjusted_text: Option<String>,
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
    prune_stale_alignment_jobs(app, input.installation_id);

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
        return Err(
            "Select source and translation languages before adding translation.".to_string(),
        );
    }

    let languages = sanitize_chapter_languages(&context.chapter_file.languages);
    let Some(source_language) = languages
        .iter()
        .find(|language| language.code == source_language_code)
    else {
        return Err("The selected source language is not available in this file.".to_string());
    };
    if chapter_language_base_code(source_language).eq_ignore_ascii_case(&target_base_language_code)
    {
        return Err(
            "Choose a translation language different from the source language.".to_string(),
        );
    }
    let target_language_code =
        next_duplicate_language_code(&languages, &context.rows, &target_base_language_code);
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
    let single_block = is_single_block_unit_counts(source_units.len(), target_units.len());
    let existing_translation_count =
        count_existing_translation_rows(&context.rows, &target_language_code);

    let source_context_hash = alignment_source_context_hash(&context, &source_language_code);
    let signature = build_signature(
        &input,
        &source_context_hash,
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
    progress.flow = if single_block { "single" } else { "multi" }.to_string();
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
        let api_key =
            load_ai_provider_api_key(app, input.provider_id, Some(input.installation_id))?;
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
        source_context_hash,
        subtitle_continuations: chapter_has_srt_source(&context.chapter_file),
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
    let command_started = Instant::now();
    log_alignment_apply_checkpoint(
        app,
        &input.job_id,
        "apply-command:start",
        &format!(
            "installation_id={} repo_name={} chapter_id={}",
            input.installation_id, input.repo_name, input.chapter_id
        ),
    );
    if input.write_mode.trim() != "fillEmptyOnly" {
        return Err("Add translation only supports filling empty rows.".to_string());
    }
    let job_path = job_path(app, input.installation_id, &input.job_id)?;
    let mut job: AlignmentJob = read_json_file(&job_path, "alignment job")?;
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-command:job-loaded",
        &format!(
            "status={} source_units={} target_units={} alignments={} target_language={}",
            job.status,
            job.source_units.len(),
            job.target_units.len(),
            job.alignments.len(),
            job.target_language_code
        ),
    );
    if job.signature
        != build_apply_signature_check(
            &input,
            &job.source_context_hash,
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
            return Err(
                "The pasted text does not match well enough to apply without confirmation."
                    .to_string(),
            );
        }
        let api_key = load_ai_provider_api_key(app, job.provider_id, Some(input.installation_id))?;
        run_remaining_alignment(app, &mut job, &api_key)?;
        job.status = "readyToApply".to_string();
        save_job(&job_path, &job)?;
    }
    if job.status != "readyToApply" {
        return Err("The alignment job is not ready to apply.".to_string());
    }

    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let result = with_alignment_repo_lock(&repo_path, || {
        let mut context = load_alignment_context(
            app,
            input.installation_id,
            input.project_id.as_deref(),
            &input.repo_name,
            &input.chapter_id,
        )?;
        log_alignment_apply_checkpoint(
            app,
            &job.job_id,
            "apply-command:context-loaded",
            &format!(
                "rows={} has_base_commit={}",
                context.rows.len(),
                context.chapter_base_commit_sha.is_some()
            ),
        );
        verify_source_unchanged(&job, &context)?;
        final_checks(&job)?;
        log_alignment_apply_checkpoint(app, &job.job_id, "apply-command:source-verified", "");

        emit_apply_progress(app, &job.job_id, 0, "Preparing aligned translation");

        apply_job_to_chapter(app, &mut context, &job)
    });
    match &result {
        Ok(response) => log_alignment_apply_checkpoint(
            app,
            &job.job_id,
            "apply-command:complete",
            &format!(
                "elapsed_ms={} updated={} skipped={} inserted={} commit_sha={}",
                command_started.elapsed().as_millis(),
                response.updated_row_count,
                response.skipped_non_empty_row_count,
                response.inserted_row_count,
                response.commit_sha.as_deref().unwrap_or("none")
            ),
        ),
        Err(error) => log_alignment_apply_checkpoint(
            app,
            &job.job_id,
            "apply-command:error",
            &format!(
                "elapsed_ms={} error={}",
                command_started.elapsed().as_millis(),
                error
            ),
        ),
    }
    let result = result?;
    // The alignment is now committed, so drop its cached source/target text.
    remove_alignment_job_file(&job_path);
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "apply",
            "Applying translation",
            "complete",
            Some(APPLY_PROGRESS_TOTAL),
            Some(APPLY_PROGRESS_TOTAL),
            "Aligned translation was applied",
        ),
    );
    Ok(result)
}

fn with_alignment_repo_lock<T>(
    repo_path: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(repo_path);
    let _repo_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);
    operation()
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
    let repo_path =
        resolve_project_git_repo_path(app, installation_id, project_id, Some(repo_name))?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let chapter_path = find_chapter_path_by_id(app, &repo_path.join("chapters"), chapter_id)?;
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

fn next_duplicate_language_code(
    languages: &[ChapterLanguage],
    rows: &[StoredRowFile],
    base_code: &str,
) -> String {
    let base_code = base_code.trim();
    let mut used_codes = languages
        .iter()
        .map(|language| language.code.as_str())
        .collect::<BTreeSet<_>>();
    for row in rows {
        for code in row.fields.keys() {
            let code = code.trim();
            if !code.is_empty() {
                used_codes.insert(code);
            }
        }
    }
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
    let supported_name = language_display_name(base_code);
    if !supported_name.eq_ignore_ascii_case(base_code) {
        return supported_name;
    }

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

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn append_alignment_apply_log(app: &AppHandle, line: &str) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not determine the app data directory: {error}"))?;
    let log_dir = app_data_dir.join(APPLY_DEBUG_LOG_DIR);
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Could not create the add-translation log directory: {error}"))?;

    let log_path = log_dir.join(APPLY_DEBUG_LOG_FILE);
    let rotated_log_path = log_dir.join(format!("{APPLY_DEBUG_LOG_FILE}.1"));
    if fs::metadata(&log_path)
        .map(|metadata| metadata.len() > APPLY_DEBUG_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(&rotated_log_path);
        let _ = fs::rename(&log_path, &rotated_log_path);
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Could not open the add-translation log file: {error}"))?;
    writeln!(file, "{line}")
        .map_err(|error| format!("Could not append to the add-translation log file: {error}"))
}

fn log_alignment_apply_checkpoint(app: &AppHandle, job_id: &str, checkpoint: &str, detail: &str) {
    let line = format!(
        "{} job={} checkpoint={} {}",
        unix_timestamp_ms(),
        job_id,
        checkpoint,
        detail
    );
    if let Err(error) = append_alignment_apply_log(app, &line) {
        if cfg!(debug_assertions) {
            eprintln!("[gtms add-translation-apply-log] {error}");
        }
    }
}

fn emit_apply_progress(app: &AppHandle, job_id: &str, completed: usize, message: &str) {
    emit_progress(
        app,
        &progress_event(
            job_id,
            "apply",
            "Applying translation",
            "running",
            Some(completed.min(APPLY_PROGRESS_TOTAL)),
            Some(APPLY_PROGRESS_TOTAL),
            message,
        ),
    );
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
    source_context_hash: &str,
    _chapter_base_commit_sha: &Option<String>,
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
) -> Value {
    json!({
        "version": ALIGNMENT_PROMPT_VERSION,
        "chapterId": input.chapter_id,
        "projectFullName": input.project_full_name,
        "sourceContextHash": source_context_hash,
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
    source_context_hash: &str,
    _chapter_base_commit_sha: &Option<String>,
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
    provider_id: &AiProviderId,
    model_id: &str,
) -> Value {
    json!({
        "version": ALIGNMENT_PROMPT_VERSION,
        "chapterId": input.chapter_id,
        "projectFullName": input.project_full_name,
        "sourceContextHash": source_context_hash,
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
            unit_range: [
                slice.first().map(|unit| unit.id).unwrap_or(1),
                slice.last().map(|unit| unit.id).unwrap_or(1),
            ],
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
    if is_single_block_job(job) {
        let mut progress = progress_event(
            &job.job_id,
            "row_alignment",
            "Aligning translation",
            "running",
            Some(0),
            Some(1),
            "Aligning your translation",
        );
        progress.flow = flow_label(job).to_string();
        emit_progress(app, &progress);
        let matches = short_text_compatibility(app, job, api_key)?;
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

fn is_single_block_unit_counts(source_units_len: usize, target_units_len: usize) -> bool {
    source_units_len <= SECTION_SIZE && target_units_len <= SECTION_SIZE
}

fn is_single_block_job(job: &AlignmentJob) -> bool {
    is_single_block_unit_counts(job.source_units.len(), job.target_units.len())
}

fn flow_label(job: &AlignmentJob) -> &'static str {
    if is_single_block_job(job) {
        "single"
    } else {
        "multi"
    }
}

fn run_remaining_alignment(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<(), String> {
    if job.corridor.is_empty() {
        if is_single_block_job(job) {
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
    job.final_checks = final_checks(job)?;
    Ok(())
}

fn short_text_compatibility(
    app: &AppHandle,
    job: &AlignmentJob,
    api_key: &str,
) -> Result<bool, String> {
    let prompt_input = json!({
        "sourceUnits": job.source_units,
        "targetUnits": job.target_units,
    });
    let prompt = format!(
        "Determine whether the target text is a translation or partial translation of the source text. Return only the schema fields.\n\nInput:\n{}",
        serde_json::to_string_pretty(&prompt_input).unwrap_or_default()
    );
    let response: CompatibilityResponse = run_cached_json_prompt(
        app,
        job,
        api_key,
        "alignment_compatibility",
        compatibility_schema(),
        &prompt,
        |_| Ok(()),
    )?;
    Ok(response.matches)
}

fn summarize_sections(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<(), String> {
    let total = job.source_sections.len() + job.target_sections.len();
    for (index, (doc_role, section)) in job
        .source_sections
        .iter()
        .map(|s| ("source", s))
        .chain(job.target_sections.iter().map(|s| ("target", s)))
        .enumerate()
    {
        if job.summaries.iter().any(|summary| {
            summary.doc_role == doc_role
                && summary.section_id == section.section_id
                && summary.section_content_hash == section.content_hash
        }) {
            continue;
        }
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "summarize_sections",
                "Summarizing sections",
                "running",
                Some(index),
                Some(total),
                "Summarizing section",
            ),
        );
        let units = units_for_section(
            if doc_role == "source" {
                &job.source_units
            } else {
                &job.target_units
            },
            section,
        );
        let language = if doc_role == "source" {
            &job.source_language_code
        } else {
            &job.target_base_language_code
        };
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
        let response: SummaryResponse = run_cached_json_prompt(
            app,
            job,
            api_key,
            "same_language_section_summary",
            summary_schema(),
            &prompt,
            |response: &SummaryResponse| {
                if response.section_summary.summary.trim().is_empty() {
                    Err("The section summary was empty. Retry alignment.".to_string())
                } else {
                    Ok(())
                }
            },
        )?;
        job.summaries.push(SectionSummary {
            doc_role: doc_role.to_string(),
            section_id: section.section_id,
            language: language.to_string(),
            summary: response.section_summary.summary,
            section_content_hash: section.content_hash.clone(),
        });
    }
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "summarize_sections",
            "Summarizing sections",
            "complete",
            Some(total),
            Some(total),
            "Completed section summaries",
        ),
    );
    Ok(())
}

fn find_section_matches(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<(), String> {
    let source_summaries = summaries_by_role(job, "source");
    let target_summaries = summaries_by_role(job, "target");
    for (index, target) in target_summaries.iter().enumerate() {
        if job
            .section_matches
            .iter()
            .any(|item| item.target_section_id == target.section_id)
        {
            continue;
        }
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "find_section_matches",
                "Finding section matches",
                "running",
                Some(index),
                Some(target_summaries.len()),
                "Comparing section summaries",
            ),
        );
        let input = json!({
            "targetSection": target,
            "sourceCandidates": source_summaries,
        });
        let prompt = format!(
            "A match means the target section and source section contain overlapping rows. Because sections overlap by 50%, each target section typically has about three matches. Return every source candidate with match/no-match and estimated percent overlap. Do not explain.\n\nInput:\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        );
        let response: SectionMatchResponse = run_cached_json_prompt(
            app,
            job,
            api_key,
            "section_overlap_matches",
            section_match_schema(),
            &prompt,
            |response: &SectionMatchResponse| {
                let mut seen = HashSet::new();
                if response.matches.iter().any(|item| {
                    !source_summaries
                        .iter()
                        .any(|source| source.section_id == item.source_section_id)
                        || !seen.insert(item.source_section_id)
                }) {
                    return Err("Section matching returned invalid or duplicate source sections. Retry alignment.".to_string());
                }
                Ok(())
            },
        )?;
        for item in response.matches {
            job.section_matches.push(SectionMatch {
                target_section_id: target.section_id,
                source_section_id: item.source_section_id,
                is_match: item.is_match,
                overlap_percent: item.overlap_percent.clamp(0.0, 100.0),
            });
        }
    }
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "find_section_matches",
            "Finding section matches",
            "complete",
            Some(target_summaries.len()),
            Some(target_summaries.len()),
            "Completed section matching",
        ),
    );
    Ok(())
}

fn select_corridor(app: &AppHandle, job: &mut AlignmentJob) {
    let mut selected = Vec::new();
    for target_section in &job.target_sections {
        let mut matches = job
            .section_matches
            .iter()
            .filter(|item| item.target_section_id == target_section.section_id && item.is_match)
            .cloned()
            .collect::<Vec<_>>();
        matches.sort_by(|a, b| {
            b.overlap_percent
                .partial_cmp(&a.overlap_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
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
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "select_corridor",
            "Selecting section corridor",
            "complete",
            Some(job.corridor.len()),
            Some(job.target_sections.len().max(1)),
            "Selected section corridor",
        ),
    );
}

fn align_rows(app: &AppHandle, job: &mut AlignmentJob, api_key: &str) -> Result<(), String> {
    let total = job.target_sections.len().max(1);
    let candidates = collect_row_candidates(
        &job.source_units,
        &job.target_units,
        &job.source_sections,
        &job.target_sections,
        &job.corridor,
        |index, source_units, target_units| {
            emit_progress(
                app,
                &progress_event(
                    &job.job_id,
                    "row_alignment",
                    "Aligning rows inside matched sections",
                    "running",
                    Some(index),
                    Some(total),
                    "Aligning target section with its source corridor",
                ),
            );
            let prompt = build_row_alignment_prompt(source_units, target_units)?;
            run_cached_json_prompt(
                app,
                job,
                api_key,
                "row_alignment_response",
                alignment_schema(),
                &prompt,
                |response: &AlignmentResponse| {
                    validate_alignments(response.clone(), source_units, target_units).map(|_| ())
                },
            )
        },
    )?;
    job.alignments = resolve_row_candidate_conflicts(app, job, api_key, candidates)?;
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "row_alignment",
            "Aligning rows inside matched sections",
            "complete",
            Some(total),
            Some(total),
            "Completed row alignment",
        ),
    );
    Ok(())
}

fn collect_row_candidates(
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
    source_sections: &[SectionWindow],
    target_sections: &[SectionWindow],
    corridor: &[SectionMatch],
    mut align: impl FnMut(
        usize,
        &[AlignmentUnit],
        &[AlignmentUnit],
    ) -> Result<AlignmentResponse, String>,
) -> Result<BTreeMap<usize, Vec<Vec<usize>>>, String> {
    let mut candidates: BTreeMap<usize, Vec<Vec<usize>>> = BTreeMap::new();
    for (index, target_section) in target_sections.iter().enumerate() {
        // A target window can cover several source windows. Give its one pass
        // the complete selected corridor instead of asking each partial source
        // view to account for the entire target window independently.
        let matched_section_ids = corridor
            .iter()
            .filter(|pair| pair.target_section_id == target_section.section_id && pair.is_match)
            .map(|pair| pair.source_section_id)
            .collect::<HashSet<_>>();
        let source_ids = source_sections
            .iter()
            .filter(|section| matched_section_ids.contains(&section.section_id))
            .flat_map(|section| units_for_row_alignment(source_units, source_sections, section))
            .map(|unit| unit.id)
            .collect::<HashSet<_>>();
        // Keep the document order and deduplicate shared context without filling
        // the gaps between distant matches with unrelated source text.
        let sources = source_units
            .iter()
            .filter(|unit| source_ids.contains(&unit.id))
            .cloned()
            .collect::<Vec<_>>();
        let targets = units_for_section(target_units, target_section);
        let response = if sources.is_empty() {
            AlignmentResponse {
                alignments: targets
                    .iter()
                    .map(|unit| Alignment {
                        target_id: unit.id,
                        source_ids: Vec::new(),
                    })
                    .collect(),
            }
        } else {
            align(index, &sources, &targets)?
        };
        for alignment in validate_alignments(response, &sources, &targets)? {
            candidates
                .entry(alignment.target_id)
                .or_default()
                .push(alignment.source_ids);
        }
    }
    Ok(candidates)
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
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "resolve_conflicts",
                "Resolving conflicts",
                "running",
                Some(completed),
                Some(conflicts.max(1)),
                "Resolving row alignment conflict",
            ),
        );
        resolved.push(resolve_one_row_conflict(
            app, job, api_key, target_id, &distinct,
        )?);
        completed += 1;
    }
    emit_progress(
        app,
        &progress_event(
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
        ),
    );
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
    app: &AppHandle,
    job: &AlignmentJob,
    api_key: &str,
    target_id: usize,
    source_sets: &[Vec<usize>],
) -> Result<Alignment, String> {
    let Some(target) = job.target_units.iter().find(|unit| unit.id == target_id) else {
        return Err(format!(
            "Could not resolve conflict for unknown target unit {target_id}."
        ));
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
    let min_source_id = non_empty_source_ids
        .iter()
        .min()
        .copied()
        .unwrap_or(1)
        .saturating_sub(1)
        .max(1);
    let max_source_id = non_empty_source_ids
        .iter()
        .max()
        .copied()
        .unwrap_or(1)
        .saturating_add(1)
        .min(job.source_units.len());
    let candidate_sources = job
        .source_units
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
    let response: AlignmentResponse = run_cached_json_prompt(
        app,
        job,
        api_key,
        "row_conflict_resolution",
        alignment_schema(),
        &prompt,
        |response: &AlignmentResponse| {
            validate_alignments(
                response.clone(),
                &candidate_sources,
                std::slice::from_ref(target),
            )
            .map(|_| ())
        },
    )?;
    let mut alignments =
        validate_alignments(response, &candidate_sources, std::slice::from_ref(target))?;
    Ok(alignments.pop().unwrap_or(Alignment {
        target_id,
        source_ids: Vec::new(),
    }))
}

fn resolve_missing_alignments(job: &mut AlignmentJob) {
    let existing = job
        .alignments
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
    let targets = job
        .alignments
        .iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .map(|alignment| alignment.target_id)
        .collect::<Vec<_>>();
    let mut splits = Vec::new();
    for (index, target_id) in targets.iter().enumerate() {
        let prompt = build_split_prompt(job, *target_id)?;
        let response: SplitTargetResponse = run_cached_json_prompt(
            app,
            job,
            api_key,
            "split_target_response",
            split_schema(),
            &prompt,
            |response| validate_split_response(job, response, &[*target_id]).map(|_| ()),
        )?;
        splits.extend(validate_split_response(job, &response, &[*target_id])?);
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "split_targets",
                "Splitting combined target rows",
                "running",
                Some(index + 1),
                Some(targets.len()),
                "Checking sentence boundaries",
            ),
        );
    }
    job.split_targets = splits;
    emit_progress(
        app,
        &progress_event(
            &job.job_id,
            "split_targets",
            "Splitting combined target rows",
            "complete",
            Some(targets.len()),
            Some(targets.len()),
            "Completed split target pass",
        ),
    );
    Ok(())
}

fn build_split_prompt(job: &AlignmentJob, target_id: usize) -> Result<String, String> {
    let target = job
        .target_units
        .iter()
        .find(|unit| unit.id == target_id)
        .ok_or_else(|| "The split target is missing.".to_string())?;
    let alignment = job
        .alignments
        .iter()
        .find(|alignment| alignment.target_id == target_id)
        .ok_or_else(|| "The split alignment is missing.".to_string())?;
    let sources = alignment
        .source_ids
        .iter()
        .filter_map(|id| job.source_units.iter().find(|unit| unit.id == *id))
        .map(|unit| json!({"sourceId": unit.id, "sourceText": unit.text}))
        .collect::<Vec<_>>();
    let boundary_rule = if job.subtitle_continuations {
        "These are subtitle segments: a row break may continue the same sentence. Do not add a period or capitalize solely because of a segment boundary. Follow actual sentence boundaries indicated by the source and target context."
    } else {
        "These are paragraph rows. Prefer existing sentence boundaries. If a target sentence combines separate source paragraphs, split at the semantic boundary and repair punctuation/capitalization so each paragraph reads correctly in the target language. Do not create a sentence fragment."
    };
    Ok(format!(
        "Split this translated text across its matched source rows. Target language: {}.\n{}\nReturn exactly one splitTargets entry for targetId {}. For each fragment, targetTextFragment MUST be an exact substring of targetText. Preserve every non-whitespace character exactly once, in order, and cover every sourceId. Never split inside a word. Keep the exact fragment even when an adjustment is needed. adjustedText must be null when unchanged; otherwise it may change ONLY punctuation, whitespace, and letter capitalization appropriate for this language and boundary. Never add, remove, reorder, or replace words or change meaning. If grammatically correct paragraphs require changes to words, return needsRewrite: true rather than inventing a rewrite. Otherwise needsRewrite: false.\n\nInput:\n{}",
        job.target_base_language_code, boundary_rule, target_id,
        serde_json::to_string_pretty(&json!({"targetId": target_id, "targetText": target.text, "sources": sources}))
            .map_err(|error| format!("Could not prepare the split input: {error}"))?
    ))
}

fn split_error(target_id: usize) -> String {
    format!("ALIGNMENT_SPLIT_REVIEW: Paragraph {target_id} could not be split safely. Retry, or go back and separate/revise that paragraph in the translation text. Nothing has been applied.")
}

fn split_word_content(text: &str) -> Vec<String> {
    let normalized = text
        .nfc()
        .flat_map(char::to_uppercase)
        .flat_map(char::to_lowercase)
        .collect::<String>();
    normalized
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect()
}

fn valid_split_boundary(text: &str, index: usize, language: &str) -> bool {
    // These writing systems commonly omit spaces between words. Their boundaries
    // are determined semantically by the split prompt, not a whitespace heuristic.
    if ["zh", "ja", "th", "lo", "km", "my"]
        .contains(&language.split('-').next().unwrap_or(language))
    {
        return true;
    }
    if index == 0 {
        return true;
    }
    let before = text.chars().nth(index - 1);
    let after = text.chars().nth(index);
    !matches!((before, after), (Some(left), Some(right)) if left.is_alphanumeric() && right.is_alphanumeric())
}

fn validate_split_response(
    job: &AlignmentJob,
    response: &SplitTargetResponse,
    expected_targets: &[usize],
) -> Result<Vec<SplitTarget>, String> {
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for item in &response.split_targets {
        if !expected_targets.contains(&item.target_id)
            || !seen.insert(item.target_id)
            || item.needs_rewrite
        {
            return Err(split_error(item.target_id));
        }
        let target = job
            .target_units
            .iter()
            .find(|unit| unit.id == item.target_id)
            .ok_or_else(|| split_error(item.target_id))?;
        let alignment = job
            .alignments
            .iter()
            .find(|alignment| alignment.target_id == item.target_id)
            .ok_or_else(|| split_error(item.target_id))?;
        let allowed_sources = alignment.source_ids.iter().copied().collect::<HashSet<_>>();
        let mut search_start = 0;
        let mut fragments = Vec::new();
        for hint in &item.fragments {
            if !allowed_sources.contains(&hint.source_id)
                || hint.target_text_fragment.trim().is_empty()
            {
                return Err(split_error(item.target_id));
            }
            let (start, end) =
                find_fragment_range(&target.text, &hint.target_text_fragment, search_start)
                    .ok_or_else(|| split_error(item.target_id))?;
            if !valid_split_boundary(&target.text, start, &job.target_base_language_code)
                || !valid_split_boundary(&target.text, end, &job.target_base_language_code)
            {
                return Err(split_error(item.target_id));
            }
            let adjusted_text = hint
                .adjusted_text
                .as_ref()
                .filter(|text| *text != &hint.target_text_fragment)
                .cloned();
            if adjusted_text.as_ref().is_some_and(|text| {
                text.trim().is_empty()
                    || split_word_content(text) != split_word_content(&hint.target_text_fragment)
            }) {
                return Err(split_error(item.target_id));
            }
            fragments.push(SplitFragment {
                source_id: hint.source_id,
                range: [start, end],
                text: slice_chars(&target.text, start, end),
                adjusted_text,
            });
            search_start = end;
        }
        if !split_covers_target(&target.text, &fragments, &allowed_sources) {
            return Err(split_error(item.target_id));
        }
        results.push(SplitTarget {
            target_id: item.target_id,
            fragments,
        });
    }
    if let Some(missing) = expected_targets.iter().find(|id| !seen.contains(id)) {
        return Err(split_error(*missing));
    }
    Ok(results)
}

fn final_checks(job: &AlignmentJob) -> Result<Vec<FinalCheck>, String> {
    validate_alignments(
        AlignmentResponse {
            alignments: job.alignments.clone(),
        },
        &job.source_units,
        &job.target_units,
    )?;
    // Validate cached splits again before saving. Exact fragments prove coverage;
    // adjusted text is checked separately so authorized punctuation/case repairs
    // do not look like lost words.
    let response = SplitTargetResponse {
        split_targets: job
            .split_targets
            .iter()
            .map(|split| SplitTargetResponseItem {
                target_id: split.target_id,
                needs_rewrite: false,
                fragments: split
                    .fragments
                    .iter()
                    .map(|fragment| SplitTargetFragmentHint {
                        source_id: fragment.source_id,
                        target_text_fragment: fragment.text.clone(),
                        adjusted_text: fragment.adjusted_text.clone(),
                    })
                    .collect(),
            })
            .collect(),
    };
    let expected = job
        .alignments
        .iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .map(|alignment| alignment.target_id)
        .collect::<Vec<_>>();
    validate_split_response(job, &response, &expected)?;
    build_row_translation_plan(job)?;
    Ok(vec![FinalCheck {
        name: "exactTargetCoverageAndSafeSplits".to_string(),
        passed: true,
        warning: false,
        details: Vec::new(),
    }])
}

fn apply_job_to_chapter(
    app: &AppHandle,
    context: &mut AlignmentContext,
    job: &AlignmentJob,
) -> Result<AlignedTranslationApplyResponse, String> {
    let apply_started = Instant::now();
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:start",
        &format!(
            "source_units={} target_units={} alignments={} split_targets={}",
            job.source_units.len(),
            job.target_units.len(),
            job.alignments.len(),
            job.split_targets.len()
        ),
    );
    let mut languages = sanitize_chapter_languages(&context.chapter_file.languages);
    let target_exists = languages
        .iter()
        .any(|language| language.code == job.target_language_code);
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:languages-start",
        &format!(
            "target_exists={} language_count={}",
            target_exists,
            languages.len()
        ),
    );
    if !target_exists {
        let target_base_language_code = if job.target_base_language_code.trim().is_empty() {
            job.target_language_code.as_str()
        } else {
            job.target_base_language_code.as_str()
        };
        let duplicate_group_exists = languages.iter().any(|language| {
            chapter_language_base_code(language).eq_ignore_ascii_case(target_base_language_code)
        });
        let base_name = duplicate_language_base_name(&languages, target_base_language_code);
        languages.push(ChapterLanguage {
            code: job.target_language_code.clone(),
            name: base_name,
            role: "target".to_string(),
            base_code: if duplicate_group_exists
                || job.target_language_code != target_base_language_code
            {
                Some(target_base_language_code.to_string())
            } else {
                None
            },
        });
        number_duplicate_language_group(&mut languages, target_base_language_code);
        context.chapter_file.languages = languages.clone();
    }

    emit_apply_progress(app, &job.job_id, 1, "Loading chapter rows");
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:rows-load-start",
        &format!("stored_rows={}", context.rows.len()),
    );
    let mut row_values = load_row_values(&context.chapter_path, &context.rows)?;
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:rows-loaded",
        &format!("row_values={}", row_values.len()),
    );
    if !target_exists {
        for row_value in row_values.values_mut() {
            ensure_language_field(row_value, &job.target_language_code)?;
        }
    }

    emit_apply_progress(app, &job.job_id, 2, "Preparing row updates");
    let row_texts = build_row_translation_plan(job)?;
    let matched_row_count = row_texts.matched_rows.len();
    let unmatched_target_count = row_texts.unmatched_targets.len();
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:plan-built",
        &format!(
            "matched_rows={} unmatched_targets={}",
            matched_row_count, unmatched_target_count
        ),
    );
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
        if row_texts.adjusted_rows.contains(&row_id) {
            mark_alignment_adjustment(
                row_value,
                &job.target_language_code,
                row_texts
                    .original_rows
                    .get(&row_id)
                    .map(String::as_str)
                    .unwrap_or_default(),
            )?;
        }
        updated_row_count += 1;
    }

    let insertion_groups = group_unmatched_targets(job, row_texts.unmatched_targets);
    let insertion_plan = build_bulk_insertion_plan(&context.rows, &insertion_groups)?;
    let reordered_row_count = insertion_plan.existing_order_keys.len();
    for (row_id, order_key) in insertion_plan.existing_order_keys {
        if let Some(row_value) = row_values.get_mut(&row_id) {
            set_row_order_key(row_value, &order_key)?;
        }
    }
    for target in insertion_plan.inserted_targets {
        let row_id = uuid::Uuid::now_v7().to_string();
        let mut row_value = create_inserted_row_file(
            &row_id,
            &target.order_key,
            &context.chapter_file,
            &languages,
            None,
        );
        set_row_plain_text(
            &mut row_value,
            &job.target_language_code,
            &target.target.text,
        )?;
        row_values.insert(row_id.clone(), row_value);
        inserted_rows.push(row_id);
    }
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:rows-mutated",
        &format!(
            "updated={} skipped_non_empty={} inserted={} reordered={}",
            updated_row_count,
            skipped_non_empty,
            inserted_rows.len(),
            reordered_row_count
        ),
    );

    let rows_path = context.chapter_path.join("rows");
    let mut prepared_writes = Vec::new();
    emit_apply_progress(app, &job.job_id, 3, "Writing row files");
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:files-write-start",
        &format!("row_values={}", row_values.len()),
    );
    if !target_exists {
        let updated_text = format!(
            "{}\n",
            serde_json::to_string_pretty(&context.chapter_file)
                .map_err(|error| format!("Could not serialize chapter.json: {error}"))?
        );
        prepared_writes.push(PreparedRowFileWrite {
            relative_path: repo_relative_path(&context.repo_path, &context.chapter_json_path)?,
            original_text: fs::read_to_string(&context.chapter_json_path).ok(),
            path: context.chapter_json_path.clone(),
            updated_text,
        });
    }

    for (row_id, row_value) in row_values {
        let row_path = rows_path.join(format!("{row_id}.json"));
        let next_text = format!(
            "{}\n",
            serde_json::to_string_pretty(&row_value)
                .map_err(|error| format!("Could not serialize row '{row_id}': {error}"))?
        );
        let original_text = fs::read_to_string(&row_path).ok();
        if original_text.as_deref() == Some(next_text.as_str()) {
            continue;
        }
        prepared_writes.push(PreparedRowFileWrite {
            relative_path: repo_relative_path(&context.repo_path, &row_path)?,
            path: row_path,
            original_text,
            updated_text: next_text,
        });
    }
    let changed = !prepared_writes.is_empty();
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:files-prepared",
        &format!("changed_paths={}", prepared_writes.len()),
    );

    if changed {
        // write_row_files_and_commit preflights the write/session gates before the first
        // write and rolls every file back (restore or remove) if a later step fails, so a
        // failed commit cannot strand this multi-file apply as a dirty working tree.
        emit_apply_progress(app, &job.job_id, 5, "Saving aligned translation");
        log_alignment_apply_checkpoint(
            app,
            &job.job_id,
            "apply-job:write-commit-start",
            &format!("changed_paths={}", prepared_writes.len()),
        );
        super::shared::write_row_files_and_commit_locked(
            app,
            &context.repo_path,
            &format!("Add aligned {} translation", job.target_language_code),
            CommitMetadata {
                operation: Some("add-aligned-translation"),
                migration: None,
                status_note: None,
                ai_model: Some(job.model_id.as_str()),
            },
            &prepared_writes,
        )?;
        log_alignment_apply_checkpoint(
            app,
            &job.job_id,
            "apply-job:write-commit-complete",
            &format!("changed_paths={}", prepared_writes.len()),
        );
    } else {
        emit_apply_progress(app, &job.job_id, 5, "No local changes to save");
        log_alignment_apply_checkpoint(app, &job.job_id, "apply-job:no-changes", "");
    }

    emit_apply_progress(app, &job.job_id, 6, "Refreshing chapter data");
    log_alignment_apply_checkpoint(app, &job.job_id, "apply-job:rows-reload-start", "");
    let refreshed_rows = load_editor_rows(&context.chapter_path.join("rows"))?;
    let word_counts = build_word_counts_from_stored_rows(&refreshed_rows, &languages);
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:rows-reload-complete",
        &format!("refreshed_rows={}", refreshed_rows.len()),
    );
    let commit_sha = if changed {
        log_alignment_apply_checkpoint(app, &job.job_id, "apply-job:head-read-start", "");
        Some(git_output(
            &context.repo_path,
            &["rev-parse", "--short", "HEAD"],
        )?)
    } else {
        None
    };
    log_alignment_apply_checkpoint(
        app,
        &job.job_id,
        "apply-job:complete",
        &format!(
            "elapsed_ms={} changed={} commit_sha={}",
            apply_started.elapsed().as_millis(),
            changed,
            commit_sha.as_deref().unwrap_or("none")
        ),
    );
    Ok(AlignedTranslationApplyResponse {
        job_id: job.job_id.clone(),
        updated_row_count,
        skipped_non_empty_row_count: skipped_non_empty,
        inserted_row_count: inserted_rows.len(),
        target_language_code: job.target_language_code.clone(),
        word_counts,
        commit_sha,
        chapter_base_commit_sha: current_repo_head_sha(&context.repo_path),
    })
}

#[derive(Default)]
struct RowTranslationPlan {
    matched_rows: BTreeMap<String, String>,
    unmatched_targets: Vec<AlignmentUnit>,
    original_rows: BTreeMap<String, String>,
    adjusted_rows: HashSet<String>,
}

fn build_row_translation_plan(job: &AlignmentJob) -> Result<RowTranslationPlan, String> {
    let source_by_id = job
        .source_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let target_by_id = job
        .target_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let split_by_target = job
        .split_targets
        .iter()
        .map(|split| (split.target_id, split))
        .collect::<HashMap<_, _>>();
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
                if let Some(row_id) = source_by_id
                    .get(&fragment.source_id)
                    .and_then(|unit| unit.row_id.clone())
                {
                    append_row_text(&mut plan.original_rows, &row_id, &fragment.text);
                    append_row_text(
                        &mut plan.matched_rows,
                        &row_id,
                        fragment.adjusted_text.as_deref().unwrap_or(&fragment.text),
                    );
                    if fragment.adjusted_text.is_some() {
                        plan.adjusted_rows.insert(row_id);
                    }
                }
            }
            continue;
        }
        if alignment.source_ids.len() > 1 {
            return Err(split_error(alignment.target_id));
        }
        for source_id in &alignment.source_ids {
            if let Some(row_id) = source_by_id
                .get(source_id)
                .and_then(|unit| unit.row_id.clone())
            {
                append_row_text(&mut plan.original_rows, &row_id, &target.text);
                append_row_text(&mut plan.matched_rows, &row_id, &target.text);
            }
        }
    }
    plan.unmatched_targets.sort_by_key(|unit| unit.id);
    Ok(plan)
}

fn mark_alignment_adjustment(
    row: &mut Value,
    language_code: &str,
    original: &str,
) -> Result<(), String> {
    ensure_language_field(row, language_code)?;
    let field = row
        .get_mut("fields")
        .and_then(|fields| fields.get_mut(language_code))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The translation field is invalid.".to_string())?;
    field.insert(
        "editor_flags".to_string(),
        json!({"please_check": true, "reviewed": false}),
    );
    let escaped = original
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let existing_notes = field
        .get("notes_html")
        .and_then(Value::as_str)
        .unwrap_or_default();
    field.insert("notes_html".to_string(), Value::String(format!("{existing_notes}<p>Original text before sentence-boundary adjustments:</p><p>{escaped}</p>")));
    Ok(())
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
    let target_alignment = job
        .alignments
        .iter()
        .map(|alignment| (alignment.target_id, alignment))
        .collect::<HashMap<_, _>>();
    let source_by_id = job
        .source_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let mut groups: BTreeMap<(Option<String>, Option<String>), Vec<AlignmentUnit>> =
        BTreeMap::new();
    for target in unmatched_targets {
        let previous = job
            .alignments
            .iter()
            .filter(|alignment| alignment.target_id < target.id && !alignment.source_ids.is_empty())
            .max_by_key(|alignment| alignment.target_id)
            .and_then(|alignment| alignment.source_ids.iter().max().copied())
            .and_then(|source_id| source_by_id.get(&source_id))
            .and_then(|unit| unit.row_id.clone());
        let next = job
            .target_units
            .iter()
            .filter(|candidate| candidate.id > target.id)
            .find_map(|candidate| {
                target_alignment
                    .get(&candidate.id)
                    .filter(|alignment| !alignment.source_ids.is_empty())
            })
            .and_then(|alignment| alignment.source_ids.iter().min().copied())
            .and_then(|source_id| source_by_id.get(&source_id))
            .and_then(|unit| unit.row_id.clone());
        groups.entry((previous, next)).or_default().push(target);
    }
    groups
        .into_iter()
        .map(|((previous_row_id, next_row_id), targets)| InsertionGroup {
            previous_row_id,
            next_row_id,
            targets,
        })
        .collect()
}

fn alignment_source_context_hash(context: &AlignmentContext, language_code: &str) -> String {
    hash_json(&json!({
        "lifecycle": context.chapter_file.lifecycle.state,
        "sourceLanguage": context.chapter_file.languages.iter().find(|language| language.code == language_code),
        "sourceFiles": context.chapter_file.source_files,
        "rows": context.rows.iter().map(|row| json!({
            "rowId": row.row_id,
            "orderKey": row.structure.order_key,
            "sourceText": row_plain_text_map(row).get(language_code),
        })).collect::<Vec<_>>(),
    }))
}

fn verify_source_unchanged(job: &AlignmentJob, context: &AlignmentContext) -> Result<(), String> {
    if alignment_source_context_hash(context, &job.source_language_code) != job.source_context_hash
    {
        return Err("ALIGNMENT_SOURCE_CHANGED: The source or chapter structure changed. Restart alignment using your saved text.".to_string());
    }
    if !job.target_language_exists
        && context
            .chapter_file
            .languages
            .iter()
            .any(|language| language.code == job.target_language_code)
    {
        return Err("ALIGNMENT_SOURCE_CHANGED: The translation column was added while alignment was running. Restart alignment using your saved text.".to_string());
    }
    let current_units = source_units_from_rows(&context.rows, &job.source_language_code);
    let current = current_units
        .iter()
        .map(|unit| (&unit.row_id, &unit.text_hash))
        .collect::<Vec<_>>();
    let expected = job
        .source_units
        .iter()
        .map(|unit| (&unit.row_id, &unit.text_hash))
        .collect::<Vec<_>>();
    if current != expected {
        return Err(
            "ALIGNMENT_SOURCE_CHANGED: The source changed. Restart alignment using your saved text.".to_string(),
        );
    }
    Ok(())
}

fn load_row_values(
    chapter_path: &Path,
    rows: &[StoredRowFile],
) -> Result<BTreeMap<String, Value>, String> {
    let mut values = BTreeMap::new();
    for row in rows {
        let path = chapter_path
            .join("rows")
            .join(format!("{}.json", row.row_id));
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

fn set_row_plain_text(
    row_value: &mut Value,
    language_code: &str,
    text: &str,
) -> Result<(), String> {
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
        .filter(|row| {
            row_plain_text_map(row)
                .get(language_code)
                .map(|text| !text.trim().is_empty())
                .unwrap_or(false)
        })
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
            group
                .previous_row_id
                .as_deref()
                .and_then(|row_id| order_key_for_row(rows, row_id)),
            group
                .next_row_id
                .as_deref()
                .and_then(|row_id| order_key_for_row(rows, row_id)),
            group.targets.len(),
        ) {
            Ok(order_keys) => {
                inserted_targets.extend(
                    group
                        .targets
                        .iter()
                        .cloned()
                        .zip(order_keys)
                        .map(|(target, order_key)| OrderedTargetUnit { target, order_key }),
                );
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
            (None, Some(next)) => before
                .entry(next.clone())
                .or_default()
                .extend(group.targets.clone()),
            (Some(previous), _) => after
                .entry(previous.clone())
                .or_default()
                .extend(group.targets.clone()),
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
    structure_object.insert(
        "order_key".to_string(),
        Value::String(order_key.to_string()),
    );
    Ok(())
}

fn allocate_bulk_order_keys(
    previous: Option<&str>,
    next: Option<&str>,
    count: usize,
) -> Result<Vec<String>, String> {
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
                    .checked_mul(
                        u128::try_from(index)
                            .map_err(|error| format!("Could not allocate row keys: {error}"))?,
                    )
                    .ok_or_else(|| "There is no space left to insert all rows here.".to_string())?;
                keys.push(format!(
                    "{:032x}",
                    previous_key.checked_add(step).ok_or_else(|| {
                        "There is no space left to insert all rows here.".to_string()
                    })?
                ));
            }
        }
        (None, Some(next_key)) => {
            for reverse_index in (1..=count).rev() {
                let step = ORDER_KEY_SPACING
                    .checked_mul(
                        u128::try_from(reverse_index)
                            .map_err(|error| format!("Could not allocate row keys: {error}"))?,
                    )
                    .ok_or_else(|| "There is no space left to insert all rows here.".to_string())?;
                keys.push(format!(
                    "{:032x}",
                    next_key.checked_sub(step).ok_or_else(|| {
                        "There is no space left to insert all rows here.".to_string()
                    })?
                ));
            }
        }
        (None, None) => {
            for index in 1..=count {
                keys.push(format!(
                    "{:032x}",
                    ORDER_KEY_SPACING * u128::try_from(index).unwrap_or(1)
                ));
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

/// Cache only responses that pass the stage's semantic validator. Invalid cached
/// responses are discarded so Retry can request a fresh answer.
fn run_cached_json_prompt<T: for<'de> Deserialize<'de>>(
    app: &AppHandle,
    job: &AlignmentJob,
    api_key: &str,
    schema_name: &str,
    schema: Value,
    prompt: &str,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Result<T, String> {
    let path = job_path(app, job.installation_id, &job.job_id)?;
    save_job(&path, job)?;
    let cache_dir = path.with_extension("requests");
    let key = hash_json(&json!({
        "version": ALIGNMENT_PROMPT_VERSION,
        "provider": job.provider_id.as_str(), "model": job.model_id,
        "schemaName": schema_name, "schema": schema, "prompt": prompt,
    }));
    cached_validated_response(&cache_dir.join(format!("{key}.json")), validate, || {
        run_json_prompt::<Value>(job, api_key, schema_name, schema, prompt)
    })
}

fn cached_validated_response<T: for<'de> Deserialize<'de>>(
    path: &Path,
    validate: impl Fn(&T) -> Result<(), String>,
    request: impl FnOnce() -> Result<Value, String>,
) -> Result<T, String> {
    if let Ok(text) = fs::read_to_string(path) {
        if let Ok(response) = serde_json::from_str::<T>(&text) {
            if validate(&response).is_ok() {
                return Ok(response);
            }
        }
        fs::remove_file(path)
            .map_err(|error| format!("Could not reset the invalid alignment response: {error}"))?;
    }
    let value = request()?;
    let response: T = serde_json::from_value(value.clone())
        .map_err(|error| format!("The alignment response was invalid: {error}"))?;
    validate(&response)?;
    write_alignment_json_atomic(path, &value)?;
    Ok(response)
}

fn write_alignment_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create alignment cache: {error}"))?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::now_v7()));
    let result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Could not create alignment checkpoint: {error}"))?;
        serde_json::to_writer(&mut file, value)
            .map_err(|error| format!("Could not write alignment checkpoint: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not save alignment checkpoint: {error}"))?;
        drop(file);
        fs::rename(&temporary, path)
            .map_err(|error| format!("Could not replace alignment checkpoint: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
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
    serde_json::from_str(&response.text).map_err(|error| {
        format!("OpenAI returned JSON that did not match the {schema_name} schema: {error}")
    })
}

fn build_row_alignment_prompt(
    source_units: &[AlignmentUnit],
    target_units: &[AlignmentUnit],
) -> Result<String, String> {
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
    let source_ids = source_units
        .iter()
        .map(|unit| unit.id)
        .collect::<HashSet<_>>();
    let target_ids = target_units
        .iter()
        .map(|unit| unit.id)
        .collect::<BTreeSet<_>>();
    let mut seen = HashSet::new();
    let mut alignments = Vec::new();
    for alignment in response.alignments {
        if !target_ids.contains(&alignment.target_id) {
            return Err(format!(
                "GPT returned target id {}, but that target unit is not in the input.",
                alignment.target_id
            ));
        }
        if !seen.insert(alignment.target_id) {
            return Err(format!(
                "GPT returned target id {} more than once.",
                alignment.target_id
            ));
        }
        for source_id in &alignment.source_ids {
            if !source_ids.contains(source_id) {
                return Err(format!(
                    "GPT aligned target id {} to unknown source id {}.",
                    alignment.target_id, source_id
                ));
            }
        }
        alignments.push(alignment);
    }
    for target_id in target_ids {
        if !seen.contains(&target_id) {
            return Err(format!(
                "GPT did not return alignment for target id {target_id}."
            ));
        }
    }
    alignments.sort_by_key(|alignment| alignment.target_id);
    Ok(alignments)
}

fn units_for_section(units: &[AlignmentUnit], section: &SectionWindow) -> Vec<AlignmentUnit> {
    let ids = section.unit_ids.iter().copied().collect::<HashSet<_>>();
    units
        .iter()
        .filter(|unit| ids.contains(&unit.id))
        .cloned()
        .collect()
}

fn units_for_row_alignment(
    units: &[AlignmentUnit],
    sections: &[SectionWindow],
    section: &SectionWindow,
) -> Vec<AlignmentUnit> {
    // The corridor design includes one neighboring source section on each side.
    // Without this context, a valid match outside the primary window becomes an
    // empty/partial candidate that conflicts with passes which can see that text.
    let first_section_id = section.section_id.saturating_sub(1);
    let last_section_id = section.section_id.saturating_add(1);
    let ids = sections
        .iter()
        .filter(|candidate| {
            candidate.section_id >= first_section_id && candidate.section_id <= last_section_id
        })
        .flat_map(|candidate| candidate.unit_ids.iter().copied())
        .collect::<HashSet<_>>();
    units
        .iter()
        .filter(|unit| ids.contains(&unit.id))
        .cloned()
        .collect()
}

fn summaries_by_role(job: &AlignmentJob, role: &str) -> Vec<SectionSummary> {
    job.summaries
        .iter()
        .filter(|summary| summary.doc_role == role)
        .cloned()
        .collect()
}

fn mismatch_metrics(job: &AlignmentJob) -> MismatchMetrics {
    let matched_target = job
        .section_matches
        .iter()
        .filter(|item| item.is_match)
        .map(|item| item.target_section_id)
        .collect::<HashSet<_>>();
    let matched_source = job
        .section_matches
        .iter()
        .filter(|item| item.is_match)
        .map(|item| item.source_section_id)
        .collect::<HashSet<_>>();
    let total_source = job.source_sections.len().max(1);
    let total_target = job.target_sections.len().max(1);
    MismatchMetrics {
        source_unmatched_percent: (total_source.saturating_sub(matched_source.len()) as f64
            / total_source as f64)
            * 100.0,
        target_unmatched_percent: (total_target.saturating_sub(matched_target.len()) as f64
            / total_target as f64)
            * 100.0,
        matched_source_sections: matched_source.len(),
        matched_target_sections: matched_target.len(),
        total_source_sections: total_source,
        total_target_sections: total_target,
    }
}

fn find_fragment_range(text: &str, fragment: &str, start_char: usize) -> Option<(usize, usize)> {
    let byte_start = char_to_byte_index(text, start_char)?;
    let haystack = &text[byte_start..];
    let found = haystack.find(fragment)?;
    let start_byte = byte_start + found;
    let end_byte = start_byte + fragment.len();
    Some((
        byte_to_char_index(text, start_byte),
        byte_to_char_index(text, end_byte),
    ))
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
    text.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

fn split_covers_target(
    text: &str,
    fragments: &[SplitFragment],
    allowed_sources: &HashSet<usize>,
) -> bool {
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
    if !allowed_sources
        .iter()
        .all(|source_id| sources.contains(source_id))
    {
        return false;
    }
    text.chars()
        .enumerate()
        .all(|(index, character)| character.is_whitespace() || covered.contains(&index))
}

fn preflight_response(
    job: &AlignmentJob,
    progress: AlignmentProgressEvent,
) -> AlignedTranslationPreflightResponse {
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
        flow: flow_label(job).to_string(),
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
        (Some(completed), Some(total)) if total > 0 => {
            Some((completed as f64 / total as f64) * 100.0)
        }
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
        flow: String::new(),
    }
}

fn emit_progress(app: &AppHandle, event: &AlignmentProgressEvent) {
    let _ = app.emit(EVENT_NAME, event);
}

/// Job ids come from IPC input on apply and are joined into a cache path. They are
/// `hash_json` SHA-256 hex in normal use; validate as a plain single-component token so a
/// crafted `..`/separator id can never escape the alignment-jobs directory.
fn validated_alignment_job_id(job_id: &str) -> Result<&str, String> {
    let normalized = job_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || !normalized
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
    {
        return Err("The alignment job id is not valid.".to_string());
    }
    Ok(normalized)
}

fn job_path(app: &AppHandle, installation_id: i64, job_id: &str) -> Result<PathBuf, String> {
    let job_id = validated_alignment_job_id(job_id)?;
    let root = installation_data_dir(app, installation_id)?.join("alignment-jobs");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create alignment cache folder: {error}"))?;
    Ok(root.join(format!("{job_id}.json")))
}

/// Best-effort removal of a consumed/abandoned alignment job so its cached source and
/// pasted-translation text does not linger on disk.
fn remove_alignment_job_file(path: &Path) {
    let _ = fs::remove_dir_all(path.with_extension("requests"));
    if let Err(error) = fs::remove_file(path) {
        if path.exists() && cfg!(debug_assertions) {
            eprintln!("[gtms alignment-jobs] could not remove job file: {error}");
        }
    }
}

/// Best-effort sweep of alignment jobs older than the TTL. Runs at preflight so abandoned
/// previews (created but never applied) are reclaimed without a dedicated background task.
fn prune_stale_alignment_jobs(app: &AppHandle, installation_id: i64) {
    let Ok(data_dir) = installation_data_dir(app, installation_id) else {
        return;
    };
    let root = data_dir.join("alignment-jobs");
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let aged_out = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() > ALIGNMENT_JOB_TTL_SECS)
            .unwrap_or(false);
        if aged_out {
            remove_alignment_job_file(&path);
        }
    }
}

fn load_cached_job(path: &Path, signature: &Value) -> Result<Option<AlignmentJob>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let job: AlignmentJob = read_json_file(path, "alignment job")?;
    Ok((job.signature == *signature).then_some(job))
}

fn save_job(path: &Path, job: &AlignmentJob) -> Result<(), String> {
    let value = serde_json::to_value(job)
        .map_err(|error| format!("Could not serialize alignment checkpoint: {error}"))?;
    write_alignment_json_atomic(path, &value)
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
                    "required": ["targetId", "fragments", "needsRewrite"],
                    "properties": {
                        "targetId": { "type": "integer", "minimum": 1 },
                        "needsRewrite": { "type": "boolean" },
                        "fragments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["sourceId", "targetTextFragment", "adjustedText"],
                                "properties": {
                                    "sourceId": { "type": "integer", "minimum": 1 },
                                    "targetTextFragment": { "type": "string" },
                                    "adjustedText": { "type": ["string", "null"] }
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

    fn alignment_test_context() -> AlignmentContext {
        let rows = ["We left early.", "We arrived on time."].iter().enumerate().map(|(index, text)| {
            serde_json::from_value(json!({
                "row_id": format!("r{}", index + 1),
                "structure": {"order_key": format!("{:032x}", index + 1)},
                "status": {"review_state": "unreviewed"}, "origin": {"source_row_number": index + 1},
                "fields": {"en": {"plain_text": text}, "fr": {"plain_text": "Existing translation"}}
            })).unwrap()
        }).collect();
        AlignmentContext {
            repo_path: PathBuf::from("test-repo"), chapter_path: PathBuf::from("test-repo/chapter"),
            chapter_json_path: PathBuf::from("test-repo/chapter/chapter.json"),
            chapter_file: serde_json::from_value(json!({"chapter_id": "chapter-1", "title": "Chapter", "languages": [{"code":"en", "name":"English", "role":"source"}]})).unwrap(),
            rows, chapter_base_commit_sha: Some("before".to_string()),
        }
    }

    fn alignment_test_job() -> AlignmentJob {
        let context = alignment_test_context();
        let sources = source_units_from_rows(&context.rows, "en");
        let targets = parse_target_units("We left early, and we arrived on time.");
        AlignmentJob {
            job_id: "test-job".to_string(),
            status: "readyToApply".to_string(),
            signature: json!({}),
            installation_id: 1,
            repo_name: "repo".to_string(),
            project_id: None,
            chapter_id: "chapter-1".to_string(),
            chapter_base_commit_sha: context.chapter_base_commit_sha.clone(),
            source_context_hash: alignment_source_context_hash(&context, "en"),
            subtitle_continuations: false,
            provider_id: AiProviderId::OpenAi,
            model_id: "test-model".to_string(),
            source_language_code: "en".to_string(),
            target_language_code: "vi-x-2".to_string(),
            target_base_language_code: "vi".to_string(),
            target_language_exists: false,
            existing_translation_count: 0,
            source_sections: build_sections(&sources),
            target_sections: build_sections(&targets),
            source_units: sources,
            target_units: targets,
            summaries: vec![],
            section_matches: vec![],
            corridor: vec![],
            alignments: vec![Alignment {
                target_id: 1,
                source_ids: vec![1, 2],
            }],
            split_targets: vec![],
            mismatch: None,
            final_checks: vec![],
        }
    }

    fn test_split_response(
        first: &str,
        second: &str,
        first_adjusted: Option<&str>,
        second_adjusted: Option<&str>,
    ) -> SplitTargetResponse {
        serde_json::from_value(
            json!({"splitTargets": [{"targetId":1, "needsRewrite":false, "fragments":[
                {"sourceId":1, "targetTextFragment":first, "adjustedText":first_adjusted},
                {"sourceId":2, "targetTextFragment":second, "adjustedText":second_adjusted}
            ]}]}),
        )
        .unwrap()
    }

    #[test]
    fn missing_or_invalid_splits_cannot_duplicate_paragraphs_or_pass_final_checks() {
        let job = alignment_test_job();
        assert!(build_row_translation_plan(&job).is_err());
        assert!(final_checks(&job).is_err());
        assert!(validate_split_response(
            &job,
            &SplitTargetResponse {
                split_targets: vec![]
            },
            &[1]
        )
        .is_err());
        let invalid = test_split_response("Invented text", "and we arrived on time.", None, None);
        assert!(validate_split_response(&job, &invalid, &[1]).is_err());
        let missing = test_split_response("We left early,", "we arrived on time.", None, None);
        assert!(validate_split_response(&job, &missing, &[1]).is_err());
        let mut rewrite =
            test_split_response("We left early,", "and we arrived on time.", None, None);
        rewrite.split_targets[0].needs_rewrite = true;
        assert!(validate_split_response(&job, &rewrite, &[1]).is_err());
    }

    #[test]
    fn sentence_repairs_preserve_exact_fragments_and_flag_adjusted_rows() {
        let mut job = alignment_test_job();
        let response = test_split_response(
            "We left early,",
            "and we arrived on time.",
            Some("We left early."),
            Some("And we arrived on time."),
        );
        job.split_targets = validate_split_response(&job, &response, &[1]).unwrap();
        assert!(final_checks(&job).unwrap().iter().all(|check| check.passed));
        let plan = build_row_translation_plan(&job).unwrap();
        assert_eq!(plan.matched_rows["r1"], "We left early.");
        assert_eq!(plan.matched_rows["r2"], "And we arrived on time.");
        assert_eq!(plan.original_rows["r1"], "We left early,");
        assert_eq!(plan.adjusted_rows.len(), 2);
        let mut row = json!({"fields":{"vi-x-2":{"notes_html":"<p>Existing note</p>"}}});
        mark_alignment_adjustment(&mut row, "vi-x-2", "We left <early>,").unwrap();
        assert_eq!(
            row["fields"]["vi-x-2"]["editor_flags"]["please_check"],
            true
        );
        let notes = row["fields"]["vi-x-2"]["notes_html"].as_str().unwrap();
        assert!(notes.contains("Existing note"));
        assert!(notes.contains("We left &lt;early&gt;,"));
    }

    #[test]
    fn sentence_repairs_accept_vietnamese_case_but_reject_changed_words_and_midword_cuts() {
        let mut job = alignment_test_job();
        job.target_units = parse_target_units("Tôi đi sớm, và tôi đến đúng giờ.");
        let response = test_split_response(
            "Tôi đi sớm,",
            "và tôi đến đúng giờ.",
            Some("Tôi đi sớm."),
            Some("Và tôi đến đúng giờ."),
        );
        assert!(validate_split_response(&job, &response, &[1]).is_ok());
        let changed_words = test_split_response(
            "Tôi đi sớm,",
            "và tôi đến đúng giờ.",
            Some("Tôi đi muộn."),
            None,
        );
        assert!(validate_split_response(&job, &changed_words, &[1]).is_err());
        let removed_word = test_split_response(
            "Tôi đi sớm,",
            "và tôi đến đúng giờ.",
            None,
            Some("Tôi đến đúng giờ."),
        );
        assert!(validate_split_response(&job, &removed_word, &[1]).is_err());
        job.target_units = parse_target_units("Hello world.");
        assert!(validate_split_response(
            &job,
            &test_split_response("Hel", "lo world.", None, None),
            &[1]
        )
        .is_err());
        assert_ne!(split_word_content("a part"), split_word_content("apart"));
        assert_eq!(split_word_content("Straße"), split_word_content("STRASSE"));
    }

    #[test]
    fn subtitle_continuations_remain_verbatim_and_prompt_uses_real_language() {
        let mut job = alignment_test_job();
        job.subtitle_continuations = true;
        let prompt = build_split_prompt(&job, 1).unwrap();
        assert!(prompt.contains("Target language: vi."));
        assert!(!prompt.contains("vi-x-2"));
        assert!(prompt.contains("Do not add a period or capitalize solely"));
        let response = test_split_response("We left early,", "and we arrived on time.", None, None);
        job.split_targets = validate_split_response(&job, &response, &[1]).unwrap();
        let plan = build_row_translation_plan(&job).unwrap();
        assert_eq!(plan.matched_rows["r2"], "and we arrived on time.");
        assert!(plan.adjusted_rows.is_empty());
        job.subtitle_continuations = false;
        assert!(build_split_prompt(&job, 1)
            .unwrap()
            .contains("These are paragraph rows"));
    }

    #[test]
    fn unrelated_commits_and_other_language_edits_do_not_invalidate_alignment() {
        let job = alignment_test_job();
        let mut context = alignment_test_context();
        context.chapter_base_commit_sha = Some("unrelated-commit".to_string());
        context.chapter_file.title = "Renamed chapter".to_string();
        context.rows[0].fields.get_mut("fr").unwrap().plain_text =
            "New French translation".to_string();
        assert!(verify_source_unchanged(&job, &context).is_ok());
        context.rows[0].fields.get_mut("en").unwrap().plain_text = "Changed source".to_string();
        assert!(verify_source_unchanged(&job, &context)
            .unwrap_err()
            .contains("ALIGNMENT_SOURCE_CHANGED:"));
        let mut context = alignment_test_context();
        context.rows.reverse();
        assert!(verify_source_unchanged(&job, &context).is_err());
        let mut context = alignment_test_context();
        context.chapter_file.languages.push(ChapterLanguage {
            code: "vi-x-2".to_string(),
            name: "Vietnamese".to_string(),
            role: "target".to_string(),
            base_code: Some("vi".to_string()),
        });
        assert!(verify_source_unchanged(&job, &context).is_err());
    }

    #[test]
    fn alignment_lock_protects_reload_and_save_from_background_sync() {
        use std::sync::mpsc;
        let root = std::env::temp_dir().join(format!("alignment-lock-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("row.json");
        fs::write(&file, "before sync").unwrap();
        let lock = crate::repo_sync_shared::repo_sync_lock(&root);
        let sync_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&lock);
        let (started, waiting) = mpsc::channel();
        let path = root.clone();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            with_alignment_repo_lock(&path, || {
                let same_lock = crate::repo_sync_shared::repo_sync_lock(&path);
                assert!(same_lock.try_lock().is_err());
                let fresh = fs::read_to_string(path.join("row.json")).unwrap();
                assert_eq!(fresh, "after sync");
                fs::write(path.join("row.json"), format!("{fresh}; translation")).unwrap();
                Ok(())
            })
            .unwrap();
        });
        waiting
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        fs::write(&file, "after sync").unwrap();
        drop(sync_guard);
        worker.join().unwrap();
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "after sync; translation"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validated_response_checkpoints_survive_late_failures_and_reject_invalid_cache() {
        let root = std::env::temp_dir().join(format!("alignment-cache-{}", uuid::Uuid::now_v7()));
        let first = root.join("first.json");
        let second = root.join("second.json");
        let validate = |value: &Value| {
            if value.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(())
            } else {
                Err("invalid".to_string())
            }
        };
        cached_validated_response::<Value>(&first, validate, || Ok(json!({"ok": true}))).unwrap();
        assert!(
            cached_validated_response::<Value>(&second, validate, || Err(
                "provider failed".to_string()
            ))
            .is_err()
        );
        assert!(!second.exists());
        let reused = cached_validated_response::<Value>(&first, validate, || {
            panic!("completed request must not repeat")
        })
        .unwrap();
        assert_eq!(reused, json!({"ok":true}));
        assert!(
            cached_validated_response::<Value>(&second, validate, || Ok(json!({"ok":false})))
                .is_err()
        );
        assert!(!second.exists());
        fs::write(&second, "broken json").unwrap();
        cached_validated_response::<Value>(&second, validate, || Ok(json!({"ok":true}))).unwrap();
        assert_eq!(
            fs::read_dir(&root).unwrap().count(),
            2,
            "atomic writes leave no temp files"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn consumed_jobs_remove_their_response_checkpoints() {
        let root = std::env::temp_dir().join(format!("alignment-cleanup-{}", uuid::Uuid::now_v7()));
        let path = root.join("job.json");
        write_alignment_json_atomic(&path, &json!({})).unwrap();
        write_alignment_json_atomic(
            &path.with_extension("requests").join("response.json"),
            &json!({}),
        )
        .unwrap();
        remove_alignment_job_file(&path);
        assert!(!path.exists());
        assert!(!path.with_extension("requests").exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn numbered_alignment_units(count: usize) -> Vec<AlignmentUnit> {
        parse_target_units(
            &(1..=count)
                .map(|id| format!("Unit {id}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }

    fn positive_section_match(target_section_id: usize, source_section_id: usize) -> SectionMatch {
        SectionMatch {
            target_section_id,
            source_section_id,
            is_match: true,
            overlap_percent: 50.0,
        }
    }

    #[test]
    fn row_alignment_combines_only_selected_source_regions_in_document_order() {
        let sources = numbered_alignment_units(400);
        let targets = numbered_alignment_units(1);
        let mut negative_match = positive_section_match(1, 6);
        negative_match.is_match = false;
        let corridor = vec![
            positive_section_match(1, 10),
            positive_section_match(1, 1),
            positive_section_match(1, 10),
            positive_section_match(2, 6),
            negative_match,
        ];
        let mut calls = 0;
        let candidates = collect_row_candidates(
            &sources,
            &targets,
            &build_sections(&sources),
            &build_sections(&targets),
            &corridor,
            |index, source_input, target_input| {
                calls += 1;
                assert_eq!(index, 0);
                assert_eq!(target_input, targets);
                assert_eq!(
                    source_input.iter().map(|unit| unit.id).collect::<Vec<_>>(),
                    (1..=75).chain(201..=300).collect::<Vec<_>>()
                );
                Ok(AlignmentResponse {
                    alignments: vec![Alignment {
                        target_id: 1,
                        source_ids: vec![74, 201],
                    }],
                })
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(candidates[&1], vec![vec![74, 201]]);
    }

    #[test]
    fn row_alignment_preserves_empty_candidates_from_unmatched_target_sections() {
        let sources = numbered_alignment_units(82);
        let targets = numbered_alignment_units(54);
        let mut calls = 0;
        let candidates = collect_row_candidates(
            &sources,
            &targets,
            &build_sections(&sources),
            &build_sections(&targets),
            &[positive_section_match(1, 1)],
            |index, _, target_input| {
                calls += 1;
                assert_eq!(index, 0, "Unmatched sections must not call the AI provider");
                Ok(AlignmentResponse {
                    alignments: target_input
                        .iter()
                        .map(|target| Alignment {
                            target_id: target.id,
                            source_ids: vec![target.id],
                        })
                        .collect(),
                })
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(candidates.len(), 54);
        assert_eq!(candidates[&1], vec![vec![1]]);
        assert_eq!(dedupe_source_sets(&candidates[&30]), vec![vec![30], vec![]]);
        assert_eq!(candidates[&54], vec![Vec::<usize>::new()]);
    }

    #[test]
    fn row_alignment_keeps_actual_disagreements_between_overlapping_target_sections() {
        let sources = numbered_alignment_units(82);
        let targets = numbered_alignment_units(54);
        let candidates = collect_row_candidates(
            &sources,
            &targets,
            &build_sections(&sources),
            &build_sections(&targets),
            &[positive_section_match(1, 1), positive_section_match(2, 1)],
            |index, _, target_input| {
                Ok(AlignmentResponse {
                    alignments: target_input
                        .iter()
                        .map(|target| Alignment {
                            target_id: target.id,
                            source_ids: if target.id == 30 {
                                vec![30 + index]
                            } else {
                                vec![target.id]
                            },
                        })
                        .collect(),
                })
            },
        )
        .unwrap();
        assert_eq!(
            dedupe_source_sets(&candidates[&30]),
            vec![vec![30], vec![31]]
        );
        assert_eq!(
            candidates
                .values()
                .filter(|sets| dedupe_source_sets(sets).len() > 1)
                .count(),
            1
        );
    }

    #[test]
    fn row_alignment_expands_neighboring_source_sections_without_duplicate_ids() {
        let units = numbered_alignment_units(132);
        let sections = build_sections(&units);
        // First, interior, and last windows include exactly their available neighbors.
        for (index, expected_start, expected_end) in [(0, 1, 75), (2, 26, 125), (4, 76, 132)] {
            let expanded = units_for_row_alignment(&units, &sections, &sections[index]);
            assert_eq!(
                expanded.iter().map(|unit| unit.id).collect::<Vec<_>>(),
                (expected_start..=expected_end).collect::<Vec<_>>()
            );
            for unit in expanded {
                assert_eq!(unit, units[unit.id - 1]);
            }
        }
        let short_units = numbered_alignment_units(44);
        let short_sections = build_sections(&short_units);
        assert_eq!(
            units_for_row_alignment(&short_units, &short_sections, &short_sections[0]),
            short_units
        );
    }

    #[test]
    fn row_alignment_validates_against_expanded_source_bounds() {
        let units = numbered_alignment_units(132);
        let sections = build_sections(&units);
        let expanded = units_for_row_alignment(&units, &sections, &sections[1]);
        let targets = numbered_alignment_units(1);
        let response = |source_ids| AlignmentResponse {
            alignments: vec![Alignment {
                target_id: 1,
                source_ids,
            }],
        };
        // S2 alone only contains 26..75; its neighbors provide 1..100.
        assert!(validate_alignments(response(vec![1, 100]), &expanded, &targets).is_ok());
        assert!(validate_alignments(response(vec![101]), &expanded, &targets).is_err());
    }

    #[test]
    fn row_alignment_context_prevents_artificial_conflicts_on_every_content_target() {
        let sources = numbered_alignment_units(82);
        let source_sections = build_sections(&sources);
        // A deterministic exact matcher isolates source visibility from AI behavior.
        // 44 translated paragraphs cover source rows 2..82, leaving a heading.
        // Also exercise the same shape with ten genuinely unmatched extra lines.
        for target_count in [44, 54] {
            let targets = numbered_alignment_units(target_count);
            let target_sections = build_sections(&targets);
            let candidates_for = |expanded: bool| {
                let mut candidates: BTreeMap<usize, Vec<Vec<usize>>> = BTreeMap::new();
                for target_section in &target_sections {
                    let target_input = units_for_section(&targets, target_section);
                    for source_section in &source_sections {
                        let source_input = if expanded {
                            units_for_row_alignment(&sources, &source_sections, source_section)
                        } else {
                            units_for_section(&sources, source_section)
                        };
                        let visible: HashSet<_> = source_input.iter().map(|unit| unit.id).collect();
                        let response = AlignmentResponse {
                            alignments: target_input
                                .iter()
                                .map(|target| Alignment {
                                    target_id: target.id,
                                    source_ids: if target.id <= 44 {
                                        (2 + (target.id - 1) * 81 / 44..=1 + target.id * 81 / 44)
                                            .filter(|id| visible.contains(id))
                                            .collect()
                                    } else {
                                        Vec::new()
                                    },
                                })
                                .collect(),
                        };
                        for alignment in
                            validate_alignments(response, &source_input, &target_input).unwrap()
                        {
                            candidates
                                .entry(alignment.target_id)
                                .or_default()
                                .push(alignment.source_ids);
                        }
                    }
                }
                candidates
            };
            let conflict_count = |candidates: &BTreeMap<usize, Vec<Vec<usize>>>| {
                candidates
                    .values()
                    .filter(|sets| dedupe_source_sets(sets).len() > 1)
                    .count()
            };
            assert_eq!(conflict_count(&candidates_for(false)), 44);
            assert_eq!(conflict_count(&candidates_for(true)), 18);

            let corridor = target_sections
                .iter()
                .flat_map(|target| {
                    source_sections.iter().map(move |source| SectionMatch {
                        target_section_id: target.section_id,
                        source_section_id: source.section_id,
                        is_match: true,
                        overlap_percent: 50.0,
                    })
                })
                .collect::<Vec<_>>();
            let expected_ids = |target_id: usize| -> Vec<usize> {
                if target_id <= 44 {
                    (2 + (target_id - 1) * 81 / 44..=1 + target_id * 81 / 44).collect()
                } else {
                    Vec::new()
                }
            };
            let mut calls = 0;
            let combined = collect_row_candidates(
                &sources,
                &targets,
                &source_sections,
                &target_sections,
                &corridor,
                |_, visible_sources, input_targets| {
                    calls += 1;
                    let visible: HashSet<_> = visible_sources.iter().map(|unit| unit.id).collect();
                    Ok(AlignmentResponse {
                        alignments: input_targets
                            .iter()
                            .map(|target| Alignment {
                                target_id: target.id,
                                source_ids: expected_ids(target.id)
                                    .into_iter()
                                    .filter(|id| visible.contains(id))
                                    .collect(),
                            })
                            .collect(),
                    })
                },
            )
            .unwrap();
            assert_eq!(conflict_count(&combined), 0);
            assert_eq!(calls, target_sections.len());
            assert_eq!(combined.len(), target_count);
            for target in &targets {
                assert_eq!(
                    dedupe_source_sets(&combined[&target.id]),
                    vec![expected_ids(target.id)]
                );
                // Independent candidates from overlapping target windows are retained.
                let expected_passes = target_sections
                    .iter()
                    .filter(|section| section.unit_ids.contains(&target.id))
                    .count();
                assert_eq!(combined[&target.id].len(), expected_passes);
            }
        }
    }

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
    fn validated_alignment_job_id_accepts_hex_and_rejects_traversal() {
        assert!(validated_alignment_job_id(
            "a3f1c8e29b7d4f6018245e9bc0a7d3f1a3f1c8e29b7d4f6018245e9bc0a7d3f1"
        )
        .is_ok());
        assert_eq!(
            validated_alignment_job_id(" job-1_2 ").as_deref(),
            Ok("job-1_2")
        );
        for invalid in ["", "   ", ".", "..", "../escape", "a/b", "a\\b", "job.json"] {
            assert!(
                validated_alignment_job_id(invalid).is_err(),
                "'{invalid}' should be rejected"
            );
        }
    }

    #[test]
    fn single_block_flow_uses_section_size_boundary() {
        assert!(is_single_block_unit_counts(SECTION_SIZE, SECTION_SIZE));
        assert!(!is_single_block_unit_counts(SECTION_SIZE + 1, SECTION_SIZE));
        assert!(!is_single_block_unit_counts(SECTION_SIZE, SECTION_SIZE + 1));
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

    fn stored_row_with_fields(row_id: &str, fields: &[(&str, &str)]) -> StoredRowFile {
        StoredRowFile {
            row_id: row_id.to_string(),
            external_id: None,
            guidance: None,
            lifecycle: active_row_lifecycle_state(),
            structure: StoredRowStructure {
                order_key: row_id.to_string(),
            },
            status: StoredRowStatus {
                review_state: "unreviewed".to_string(),
            },
            origin: StoredRowOrigin {
                source_row_number: 1,
            },
            editor_comments_revision: 0,
            editor_comments: Vec::new(),
            text_style: None,
            fields: fields
                .iter()
                .map(|(code, plain_text)| {
                    (
                        (*code).to_string(),
                        StoredFieldValue {
                            plain_text: (*plain_text).to_string(),
                            footnote: String::new(),
                            image_caption: String::new(),
                            image: None,
                            editor_flags: StoredFieldEditorFlags::default(),
                            timing: None,
                        },
                    )
                })
                .collect(),
            format_metadata: StoredRowFormatMetadata::default(),
        }
    }

    #[test]
    fn next_duplicate_language_code_skips_inactive_row_field_codes() {
        let languages = vec![ChapterLanguage {
            code: "es".to_string(),
            name: "Spanish".to_string(),
            role: "source".to_string(),
            base_code: None,
        }];
        let rows = vec![stored_row_with_fields("row-1", &[("en", "previous text")])];

        assert_eq!(
            next_duplicate_language_code(&languages, &rows, "en"),
            "en-x-2"
        );
        assert_eq!(count_existing_translation_rows(&rows, "en-x-2"), 0);
    }

    #[test]
    fn next_duplicate_language_code_skips_multiple_inactive_row_field_codes() {
        let rows = vec![stored_row_with_fields(
            "row-1",
            &[("en", "previous text"), ("en-x-2", "previous text")],
        )];

        assert_eq!(next_duplicate_language_code(&[], &rows, "en"), "en-x-3");
    }

    #[test]
    fn number_duplicate_language_group_prefers_supported_display_name() {
        let mut languages = vec![
            ChapterLanguage {
                code: "en".to_string(),
                name: "en".to_string(),
                role: "source".to_string(),
                base_code: None,
            },
            ChapterLanguage {
                code: "en-x-2".to_string(),
                name: "en".to_string(),
                role: "target".to_string(),
                base_code: Some("en".to_string()),
            },
        ];

        number_duplicate_language_group(&mut languages, "en");

        assert_eq!(languages[0].name, "English 1");
        assert_eq!(languages[1].name, "English 2");
    }
}
