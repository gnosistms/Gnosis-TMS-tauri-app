use super::*;
use std::sync::{Condvar, Mutex};

const SPLIT_CONCURRENCY: usize = 4;
const SPLIT_BATCH_MAX_TARGETS: usize = 50;
// Byte budgets are conservative, language-independent guards, not tokenizer
// measurements. Include instructions/schema and room for verbatim fragment output.
const SPLIT_BATCH_INPUT_BYTES: usize = 24_000;
const SPLIT_BATCH_OUTPUT_BYTES: usize = 16_000;

pub(super) fn split_targets(
    app: &AppHandle,
    job: &mut AlignmentJob,
    api_key: &str,
) -> Result<(), String> {
    let targets = job
        .alignments
        .iter()
        .filter(|a| a.source_ids.len() > 1)
        .map(|a| a.target_id)
        .collect::<Vec<_>>();
    let batches = split_batches(job, &targets)?;
    let cache_dir = job_path(app, job.installation_id, &job.job_id)?.with_extension("requests");
    if !targets.is_empty() {
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "split_targets",
                "Splitting combined target rows",
                "running",
                Some(0),
                Some(targets.len()),
                "Aligning text fragments",
            ),
        );
    }
    let progress = Mutex::new(0usize);
    let request = |ids: &[usize], retry: bool| {
        let prompt = build_split_prompt(job, ids)?;
        let started = Instant::now();
        let result = run_json_prompt(
            job,
            api_key,
            "split_target_response",
            split_schema(),
            &prompt,
        );
        let usage = result.as_ref().ok().and_then(|(_, usage)| usage.as_ref());
        log_alignment_request(
            app,
            job,
            if retry { "split_retry" } else { "split_batch" },
            prompt.len(),
            started,
            false,
            if result.is_ok() { "ok" } else { "error" },
            usage,
        );
        result.map(|(value, _)| value)
    };
    let finished = run_split_workers(&batches, |ids| {
        let result = resolve_split_batch(job, ids, &cache_dir, false, &request, &|_| {
            log_alignment_request(app, job, "split_item", 0, Instant::now(), true, "ok", None);
        })?;
        let mut completed = progress
            .lock()
            .map_err(|_| "Could not update split progress.".to_string())?;
        *completed += result.len();
        // Keep count and emission together so concurrent completions cannot regress progress.
        emit_progress(
            app,
            &progress_event(
                &job.job_id,
                "split_targets",
                "Splitting combined target rows",
                "running",
                Some(*completed),
                Some(targets.len()),
                "Aligning text fragments",
            ),
        );
        Ok(result)
    })?;
    job.split_targets = finished.into_iter().flatten().collect();
    job.split_targets.sort_by_key(|split| split.target_id);
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

// Fixed-size waves bound threads and join all started work even when one fails.
// No new wave starts after failure; completed per-item checkpoints survive it.
pub(super) fn run_split_workers<T: Sync, R: Send>(
    items: &[T],
    run: impl Fn(&T) -> Result<R, String> + Sync,
) -> Result<Vec<R>, String> {
    let mut results = Vec::new();
    for wave in items.chunks(SPLIT_CONCURRENCY) {
        let completed = std::thread::scope(|scope| {
            let handles = wave
                .iter()
                .map(|item| {
                    let run = &run;
                    scope.spawn(move || run(item))
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| {
                    handle.join().unwrap_or_else(|_| {
                        Err("The alignment split worker failed. Retry alignment.".to_string())
                    })
                })
                .collect::<Vec<_>>()
        });
        for result in completed {
            results.push(result?);
        }
    }
    Ok(results)
}

fn split_input(job: &AlignmentJob, target_id: usize) -> Result<Value, String> {
    let target = job
        .target_units
        .iter()
        .find(|unit| unit.id == target_id)
        .ok_or_else(|| "The split target is missing.".to_string())?;
    let alignment = job
        .alignments
        .iter()
        .find(|a| a.target_id == target_id)
        .ok_or_else(|| "The split alignment is missing.".to_string())?;
    let sources = alignment
        .source_ids
        .iter()
        .map(|id| {
            job.source_units
                .iter()
                .find(|unit| unit.id == *id)
                .map(|unit| json!({"sourceId":unit.id, "sourceText":unit.text}))
                .ok_or_else(|| "The split source is missing.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"targetId":target_id, "targetText":target.text, "sources":sources}))
}

pub(super) fn build_split_prompt(job: &AlignmentJob, ids: &[usize]) -> Result<String, String> {
    let inputs = ids
        .iter()
        .map(|id| split_input(job, *id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(format!(
        "Align each translated target independently to its matched source rows. Target language: {}.\nReturn exactly one splitTargets entry per supplied targetId. Each fragment contains sourceId and targetTextFragment, copied exactly from targetText. Choose the boundaries by semantic correspondence to the source rows. Keep fragments in original target-text order and cover the entire target text and every sourceId for that target. Never move text or source IDs between targets.\nNO EDITING: never rewrite words, repair grammar, change capitalization/punctuation/whitespace, or omit/add characters. Keep incomplete sentences and mid-sentence splits as they are; the user will handle any cleanup. Return only the schema fields.\n\nInput:\n{}",
        job.target_base_language_code, json!({"splitTargets":inputs})
    ))
}

pub(super) fn split_batches(
    job: &AlignmentJob,
    targets: &[usize],
) -> Result<Vec<Vec<usize>>, String> {
    let mut batches = Vec::new();
    let mut batch = Vec::new();
    let mut output_bytes = 0usize;
    let base_input_bytes = build_split_prompt(job, &[])?.len() + split_schema().to_string().len();
    let mut input_bytes = base_input_bytes;
    for id in targets {
        let input = split_input(job, *id)?;
        let text_bytes = input["targetText"].to_string().len();
        let fragments = input["sources"].as_array().map(Vec::len).unwrap_or(0);
        let estimated_output = text_bytes
            .saturating_add(fragments.saturating_mul(64))
            .saturating_add(80);
        let item_bytes = input.to_string().len();
        let separator_bytes = usize::from(!batch.is_empty());
        let too_large = batch.len() + 1 > SPLIT_BATCH_MAX_TARGETS
            || input_bytes.saturating_add(item_bytes + separator_bytes) > SPLIT_BATCH_INPUT_BYTES
            || output_bytes.saturating_add(estimated_output) > SPLIT_BATCH_OUTPUT_BYTES;
        if too_large && !batch.is_empty() {
            batches.push(std::mem::take(&mut batch));
            output_bytes = 0;
            input_bytes = base_input_bytes;
        }
        // An indivisible large paragraph stays isolated, never truncated or lost.
        input_bytes = input_bytes.saturating_add(item_bytes + usize::from(!batch.is_empty()));
        batch.push(*id);
        output_bytes = output_bytes.saturating_add(estimated_output);
    }
    if !batch.is_empty() {
        batches.push(batch);
    }
    Ok(batches)
}

pub(super) fn split_checkpoint(
    job: &AlignmentJob,
    cache_dir: &Path,
    id: usize,
) -> Result<PathBuf, String> {
    // Each target has exactly the same semantic context in a batch and alone.
    // Key by its complete canonical prompt/schema/model, independently of group
    // membership, so validated siblings survive a retry/repartition of the batch.
    let key = hash_json(&json!({"version":ALIGNMENT_PROMPT_VERSION,
        "model":job.model_id, "provider":job.provider_id.as_str(),
        "schema":split_schema(), "prompt":build_split_prompt(job, &[id])?}));
    Ok(cache_dir.join(format!("split-{key}.json")))
}

pub(super) fn resolve_split_batch(
    job: &AlignmentJob,
    ids: &[usize],
    cache_dir: &Path,
    retry: bool,
    request: &(impl Fn(&[usize], bool) -> Result<Value, AlignmentPromptError> + Sync),
    cache_hit: &(impl Fn(usize) + Sync),
) -> Result<Vec<SplitTarget>, String> {
    let mut completed = Vec::new();
    let mut pending = Vec::new();
    for id in ids {
        let cached = read_validated_response::<SplitTargetResponse>(
            &split_checkpoint(job, cache_dir, *id)?,
            |response| validate_split_response(job, response, &[*id]).map(|_| ()),
        )?;
        if let Some(response) = cached {
            completed.extend(validate_split_response(job, &response, &[*id])?);
            cache_hit(*id);
        } else {
            pending.push(*id);
        }
    }
    if pending.is_empty() {
        return Ok(completed);
    }
    // Transport/auth/rate-limit errors propagate; they must not trigger a fan-out.
    let value = match request(&pending, retry) {
        Ok(value) => value,
        // No entries can be trusted from malformed/truncated JSON. Treat the
        // pending group as invalid and let the same bounded recovery shrink it.
        Err(AlignmentPromptError::InvalidJson(_)) => Value::Null,
        Err(AlignmentPromptError::Request(message)) => return Err(message),
    };
    let entries = value.get("splitTargets").and_then(Value::as_array);
    let known_ids = pending.iter().copied().collect::<HashSet<_>>();
    let envelope_valid = entries.is_some_and(|entries| {
        entries.iter().all(|item| {
            item.get("targetId")
                .and_then(Value::as_u64)
                .and_then(|id| usize::try_from(id).ok())
                .is_some_and(|id| known_ids.contains(&id))
        })
    });
    let mut failed = Vec::new();
    for id in &pending {
        let matching = entries
            .into_iter()
            .flatten()
            .filter(|item| item["targetId"].as_u64() == Some(*id as u64))
            .collect::<Vec<_>>();
        let valid = if envelope_valid && matching.len() == 1 {
            let checkpoint = json!({"splitTargets":[matching[0]]});
            serde_json::from_value::<SplitTargetResponse>(checkpoint.clone())
                .ok()
                .and_then(|response| validate_split_response(job, &response, &[*id]).ok())
                .map(|splits| (checkpoint, splits))
        } else {
            None
        };
        if let Some((checkpoint, splits)) = valid {
            write_alignment_json_atomic(&split_checkpoint(job, cache_dir, *id)?, &checkpoint)?;
            completed.extend(splits);
        } else {
            failed.push(*id);
        }
    }
    if !failed.is_empty() {
        if pending.len() == 1 {
            return Err(split_error(pending[0]));
        }
        // Shrink failed groups, keeping valid siblings. A single target is the
        // final attempt; unresolved/unsafe content still stops the whole apply.
        let chunk_size = failed.len().div_ceil(2).max(1);
        for group in failed.chunks(chunk_size) {
            completed.extend(resolve_split_batch(
                job, group, cache_dir, true, request, cache_hit,
            )?);
        }
    }
    completed.sort_by_key(|split| split.target_id);
    Ok(completed)
}

// Shared across alignment jobs, including cache-miss requests in other stages.
// No repository lock or mutable job state is held during a provider call.
pub(super) fn with_request_slot<T>(
    request: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    static ACTIVE: Mutex<usize> = Mutex::new(0);
    static AVAILABLE: Condvar = Condvar::new();
    let mut active = ACTIVE
        .lock()
        .map_err(|_| "Could not acquire an alignment request slot.".to_string())?;
    while *active >= SPLIT_CONCURRENCY {
        active = AVAILABLE
            .wait(active)
            .map_err(|_| "Could not wait for an alignment request slot.".to_string())?;
    }
    *active += 1;
    drop(active);
    struct Permit;
    impl Drop for Permit {
        fn drop(&mut self) {
            if let Ok(mut active) = ACTIVE.lock() {
                *active = active.saturating_sub(1);
                AVAILABLE.notify_one();
            }
        }
    }
    let _permit = Permit;
    request()
}
