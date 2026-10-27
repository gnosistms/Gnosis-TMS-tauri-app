//! Exact subtitle anchors, consented overlap matching, and a bounded meaning check.
use super::*;
use crate::project_import::chapter_import::{parse_translation_srt, SubtitleCue};
use std::collections::VecDeque;
mod meaning;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddSubtitleTranslationInput {
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    source_language_code: String,
    target_language_code: String,
    file_name: String,
    bytes: Vec<u8>,
    #[serde(default)]
    confirmations: Vec<String>,
    #[serde(default)]
    perform_meaning_check: bool,
    provider_id: Option<AiProviderId>,
    model_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddSubtitleTranslationResponse {
    status: &'static str,
    mismatch: Option<SubtitleMismatch>,
    result: Option<AlignedTranslationApplyResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleMismatch {
    stage: &'static str,
    unmatched_count: usize,
    total_count: usize,
    unmatched_percent: f64,
    confirmation: String,
    examples: Vec<MeaningPair>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct MeaningPair {
    line_number: usize,
    source_line: usize,
    target_line: usize,
    source_text: String,
    target_text: String,
}

struct SubtitlePlan {
    application: TranslationApplyPlan,
    overlap_pairs: Vec<MeaningPair>,
}

fn warning(
    stage: &'static str,
    unmatched: usize,
    total: usize,
    signature: &str,
    confirmations: &[String],
    examples: Vec<MeaningPair>,
) -> Option<SubtitleMismatch> {
    let confirmation = hash_json(
        &json!({"version":"subtitle-overlap-v1","stage":stage,"plan":signature,"examples":examples}),
    );
    if confirmations.contains(&confirmation) {
        return None;
    }
    Some(SubtitleMismatch {
        stage,
        unmatched_count: unmatched,
        total_count: total,
        unmatched_percent: if total == 0 {
            0.0
        } else {
            unmatched as f64 * 100.0 / total as f64
        },
        confirmation,
        examples,
    })
}
fn too_many_unmatched(unmatched: usize, total: usize) -> bool {
    total > 0 && unmatched * 100 > total * 5
}
fn warning_response(mismatch: SubtitleMismatch) -> AddSubtitleTranslationResponse {
    AddSubtitleTranslationResponse {
        status: "mismatch",
        mismatch: Some(mismatch),
        result: None,
    }
}
fn check_response() -> AddSubtitleTranslationResponse {
    AddSubtitleTranslationResponse {
        status: "needsAiCheck",
        mismatch: None,
        result: None,
    }
}

fn meaning_warning(
    rejected: Vec<MeaningPair>,
    sample_count: usize,
    signature: &str,
    confirmations: &[String],
) -> Option<SubtitleMismatch> {
    if rejected.len() <= 3 {
        return None;
    }
    warning(
        "meaning",
        rejected.len(),
        sample_count,
        signature,
        confirmations,
        rejected,
    )
}

struct PreparedSubtitle {
    plan: SubtitlePlan,
    signature: String,
    early_warning: Option<SubtitleMismatch>,
}

fn prepare_subtitle(
    context: &AlignmentContext,
    input: &AddSubtitleTranslationInput,
    cues: &[SubtitleCue],
    operation_id: &str,
) -> Result<PreparedSubtitle, String> {
    if !chapter_has_srt_source(&context.chapter_file) {
        return Err("SRT translations can only be added to an existing subtitle file.".into());
    }
    let languages = sanitize_chapter_languages(&context.chapter_file.languages);
    let source = languages
        .iter()
        .find(|language| language.code == input.source_language_code)
        .ok_or_else(|| "The selected source language is not available in this file.".to_string())?;
    let base = crate::project_import::chapter_import::languages::normalize_language_code(
        &input.target_language_code,
    )
    .ok_or_else(|| "Select a supported translation language.".to_string())?;
    if chapter_language_base_code(source).eq_ignore_ascii_case(&base) {
        return Err("Choose a translation language different from the source language.".into());
    }
    let target = next_duplicate_language_code(&languages, &context.rows, &base);
    let signature = hash_json(
        &json!({"version":"subtitle-overlap-v1", "chapter":input.chapter_id,
        "sourceContext":alignment_source_context_hash(context,&input.source_language_code),
        "timings":context.rows.iter().map(|r| row_timing(r,&input.source_language_code)).collect::<Vec<_>>(),
        "cues":cues.iter().map(|c|json!([c.start_ms,c.end_ms,c.text])).collect::<Vec<_>>(),
        "targetLanguage":target}),
    );
    let exact = build_subtitle_plan(
        &context.rows,
        &input.source_language_code,
        cues,
        operation_id.into(),
        target.clone(),
        base.clone(),
        false,
    )?;
    let unmatched = exact.application.row_texts.unmatched_targets.len();
    if !too_many_unmatched(unmatched, cues.len()) {
        return Ok(PreparedSubtitle {
            plan: exact,
            signature,
            early_warning: None,
        });
    }
    if let Some(mismatch) = warning(
        "exact",
        unmatched,
        cues.len(),
        &signature,
        &input.confirmations,
        Vec::new(),
    ) {
        return Ok(PreparedSubtitle {
            plan: exact,
            signature,
            early_warning: Some(mismatch),
        });
    }
    let overlap = build_subtitle_plan(
        &context.rows,
        &input.source_language_code,
        cues,
        operation_id.into(),
        target,
        base,
        true,
    )?;
    let unmatched = overlap.application.row_texts.unmatched_targets.len();
    let early_warning = if too_many_unmatched(unmatched, cues.len()) {
        warning(
            "overlap",
            unmatched,
            cues.len(),
            &signature,
            &input.confirmations,
            Vec::new(),
        )
    } else {
        None
    };
    Ok(PreparedSubtitle {
        plan: overlap,
        signature,
        early_warning,
    })
}

/// Emits aligned-translation-progress. No repo lock is held during the AI check.
pub(crate) fn add_subtitle_translation_sync(
    app: &AppHandle,
    input: AddSubtitleTranslationInput,
) -> Result<AddSubtitleTranslationResponse, String> {
    if !input.file_name.to_ascii_lowercase().ends_with(".srt") {
        return Err("Choose a valid SRT subtitle file.".into());
    }
    let cues = parse_translation_srt(&input.bytes, &input.file_name)?;
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let id = uuid::Uuid::now_v7().to_string();
    emit_progress(
        app,
        &subtitle_progress(
            &id,
            "match_timestamps",
            "Matching subtitle start times",
            0,
            cues.len(),
        ),
    );
    let prepared = with_alignment_repo_lock(&repo_path, || {
        alignment_cancellation::check()?;
        let context = load_alignment_context(
            app,
            input.installation_id,
            input.project_id.as_deref(),
            &input.repo_name,
            &input.chapter_id,
        )?;
        prepare_subtitle(&context, &input, &cues, &id)
    })?;
    if let Some(mismatch) = prepared.early_warning {
        return Ok(warning_response(mismatch));
    }
    let sample = meaning::sample_pairs(&prepared.plan.overlap_pairs);
    if !sample.is_empty() {
        emit_progress(
            app,
            &subtitle_progress(
                &id,
                "match_overlap",
                "Matched overlapping subtitles",
                cues.len(),
                cues.len(),
            ),
        );
        if !input.perform_meaning_check {
            return Ok(check_response());
        }
        let provider = input
            .provider_id
            .ok_or_else(|| "Select an AI provider for the subtitle meaning check.".to_string())?;
        let model = input
            .model_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "Select an AI model for the subtitle meaning check.".to_string())?;
        let key = load_ai_provider_api_key(app, provider, Some(input.installation_id))?;
        emit_progress(
            app,
            &subtitle_progress(
                &id,
                "check_meaning",
                "Checking subtitle meanings",
                0,
                sample.len(),
            ),
        );
        let rejected =
            meaning::check_pairs(app, input.installation_id, provider, model, &key, &sample)?;
        alignment_cancellation::check()?;
        if let Some(mismatch) = meaning_warning(
            rejected,
            sample.len(),
            &prepared.signature,
            &input.confirmations,
        ) {
            return Ok(warning_response(mismatch));
        }
    }
    with_alignment_repo_lock(&repo_path, || {
        alignment_cancellation::check()?;
        let mut context = load_alignment_context(
            app,
            input.installation_id,
            input.project_id.as_deref(),
            &input.repo_name,
            &input.chapter_id,
        )?;
        let current = prepare_subtitle(&context, &input, &cues, &id)?;
        if current.signature != prepared.signature {
            return Err("The original subtitles changed during the check. Restart to review the updated matches.".into());
        }
        if let Some(mismatch) = current.early_warning {
            return Ok(warning_response(mismatch));
        }
        alignment_cancellation::begin_apply()?;
        let response = apply_translation_plan(app, &mut context, current.plan.application)?;
        emit_progress(
            app,
            &subtitle_progress(&id, "apply", "Added subtitle translation", 1, 1),
        );
        Ok(AddSubtitleTranslationResponse {
            status: "applied",
            mismatch: None,
            result: Some(response),
        })
    })
}

fn subtitle_progress(
    id: &str,
    stage: &str,
    message: &str,
    completed: usize,
    total: usize,
) -> AlignmentProgressEvent {
    let mut progress = progress_event(
        id,
        stage,
        message,
        if completed == total {
            "complete"
        } else {
            "running"
        },
        Some(completed),
        Some(total),
        message,
    );
    progress.flow = if stage == "match_overlap" || stage == "check_meaning" {
        "subtitleOverlap"
    } else {
        "subtitle"
    }
    .into();
    progress
}
fn row_timing(row: &StoredRowFile, language: &str) -> Option<StoredSrtTiming> {
    row.fields
        .get(language)
        .and_then(|field| field.timing)
        .or(row.format_metadata.srt)
}

#[cfg(test)]
fn subtitle_plan(
    rows: &[StoredRowFile],
    source_language: &str,
    cues: &[SubtitleCue],
    job_id: String,
    target_language_code: String,
    target_base_language_code: String,
) -> Result<TranslationApplyPlan, String> {
    build_subtitle_plan(
        rows,
        source_language,
        cues,
        job_id,
        target_language_code,
        target_base_language_code,
        false,
    )
    .map(|p| p.application)
}

fn build_subtitle_plan(
    rows: &[StoredRowFile],
    source_language: &str,
    cues: &[SubtitleCue],
    job_id: String,
    target_language_code: String,
    target_base_language_code: String,
    allow_overlap: bool,
) -> Result<SubtitlePlan, String> {
    let mut starts = BTreeMap::<u64, VecDeque<usize>>::new();
    let mut timings = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let timing = row_timing(row,source_language).ok_or_else(|| "An existing subtitle row has no timestamps. Add its timestamps before importing translations.".to_string())?;
        if timings
            .last()
            .is_some_and(|t: &StoredSrtTiming| t.start_ms > timing.start_ms)
        {
            return Err("The existing subtitle rows are not in time order. Put them in time order before adding translations.".into());
        }
        starts.entry(timing.start_ms).or_default().push_back(index);
        timings.push(timing);
    }
    let mut assignments = cues
        .iter()
        .map(|c| starts.get_mut(&c.start_ms).and_then(VecDeque::pop_front))
        .collect::<Vec<_>>();
    let exact = assignments.clone();
    let mut used = assignments
        .iter()
        .flatten()
        .copied()
        .collect::<HashSet<_>>();
    if allow_overlap {
        for (i, cue) in cues.iter().enumerate() {
            if assignments[i].is_some() {
                continue;
            }
            let mut best = None;
            let mut largest = 0;
            for (source, timing) in timings.iter().enumerate() {
                if used.contains(&source) {
                    continue;
                }
                let overlap = timing
                    .end_ms
                    .min(cue.end_ms)
                    .saturating_sub(timing.start_ms.max(cue.start_ms));
                if overlap > largest {
                    largest = overlap;
                    best = Some(source);
                }
            }
            if let Some(source) = best {
                used.insert(source);
                assignments[i] = Some(source);
            }
        }
    }
    let mut matched_rows = BTreeMap::new();
    let mut unmatched = Vec::new();
    let mut inserted_timings = BTreeMap::new();
    let mut overlap_pairs = Vec::new();
    let mut matched_timings = BTreeMap::new();
    for (index, cue) in cues.iter().enumerate() {
        if let Some(source) = assignments[index] {
            matched_rows.insert(rows[source].row_id.clone(), cue.text.clone());
            if let Some(timing) = rows[source]
                .fields
                .get(source_language)
                .and_then(|field| field.timing)
            {
                matched_timings.insert(rows[source].row_id.clone(), timing);
            }
            if exact[index].is_none() {
                overlap_pairs.push(MeaningPair {
                    line_number: 0,
                    source_line: source + 1,
                    target_line: index + 1,
                    source_text: rows[source]
                        .fields
                        .get(source_language)
                        .map(|f| f.plain_text.clone())
                        .unwrap_or_default(),
                    target_text: cue.text.clone(),
                });
            }
        } else {
            let id = index + 1;
            unmatched.push(AlignmentUnit {
                id,
                text: cue.text.clone(),
                original_line_number: id,
                row_id: None,
                text_hash: hash_text(&cue.text),
            });
            inserted_timings.insert(
                id,
                StoredSrtTiming {
                    start_ms: cue.start_ms,
                    end_ms: cue.end_ms,
                },
            );
        }
    }
    unmatched.sort_by_key(|c| inserted_timings[&c.id].start_ms);
    let mut groups = BTreeMap::<usize, Vec<AlignmentUnit>>::new();
    for cue in &unmatched {
        let position =
            timings.partition_point(|time| time.start_ms <= inserted_timings[&cue.id].start_ms);
        groups.entry(position).or_default().push(cue.clone());
    }
    let insertion_groups = groups
        .into_iter()
        .map(|(position, targets)| InsertionGroup {
            previous_row_id: position.checked_sub(1).map(|i| rows[i].row_id.clone()),
            next_row_id: rows.get(position).map(|r| r.row_id.clone()),
            targets,
        })
        .collect();
    Ok(SubtitlePlan {
        application: TranslationApplyPlan {
            job_id,
            target_language_code,
            target_base_language_code,
            model_id: None,
            row_texts: RowTranslationPlan {
                matched_rows,
                unmatched_targets: unmatched,
            },
            insertion_groups,
            inserted_timings,
            matched_timings,
        },
        overlap_pairs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(index: usize, start: u64, end: u64) -> StoredRowFile {
        serde_json::from_value(json!({
            "row_id":format!("r{index}"), "lifecycle":{"state":"active"},
            "structure":{"order_key":rebalanced_order_key(index).unwrap()},
            "status":{"review_state":"unreviewed"}, "origin":{"source_row_number":index + 1},
            "fields":{"es":{"plain_text":format!("Source {index}")}},
            "format_metadata":{"srt":{"start_ms":start,"end_ms":end}},
        }))
        .unwrap()
    }
    fn cue(start: u64, end: u64, text: &str) -> SubtitleCue {
        SubtitleCue {
            start_ms: start,
            end_ms: end,
            text: text.into(),
        }
    }
    fn plan(rows: &[StoredRowFile], cues: &[SubtitleCue]) -> TranslationApplyPlan {
        subtitle_plan(rows, "es", cues, "test".into(), "vi".into(), "vi".into()).unwrap()
    }

    #[test]
    fn blank_cues_keep_exact_overlap_and_insertion_assignments() {
        let rows = vec![row(0, 0, 1000), row(1, 1000, 2000)];
        let result = build_subtitle_plan(
            &rows,
            "es",
            &[cue(0, 1000, ""), cue(1100, 1900, ""), cue(3000, 4000, "")],
            "test".into(),
            "vi".into(),
            "vi".into(),
            true,
        )
        .unwrap();
        assert_eq!(result.application.row_texts.matched_rows["r0"], "");
        assert_eq!(result.application.row_texts.matched_rows["r1"], "");
        assert_eq!(result.application.row_texts.unmatched_targets.len(), 1);
        assert_eq!(result.application.inserted_timings[&3].start_ms, 3000);
        assert!(meaning::sample_pairs(&result.overlap_pairs).is_empty());
    }

    #[test]
    fn three_rejected_pairs_are_allowed_but_four_require_the_final_warning() {
        for count in [0, 3, 4, 20] {
            let rejected = (0..count)
                .map(|i| MeaningPair {
                    line_number: i + 1,
                    source_line: i + 1,
                    target_line: i + 1,
                    source_text: "Old".into(),
                    target_text: "New".into(),
                })
                .collect();
            assert_eq!(
                meaning_warning(rejected, 20, "plan", &[]).is_some(),
                count > 3
            );
        }
    }

    #[test]
    fn exact_starts_lock_rows_even_when_end_times_and_text_differ() {
        let rows = vec![row(0, 1000, 2000), row(1, 3000, 4000)];
        let before = serde_json::to_value(&rows).unwrap();
        let plan = plan(
            &rows,
            &[cue(1000, 2500, "Một\nHai"), cue(3000, 3500, "Three")],
        );
        assert!(plan.model_id.is_none());
        assert_eq!(plan.row_texts.matched_rows["r0"], "Một\nHai");
        assert_eq!(plan.row_texts.matched_rows["r1"], "Three");
        assert!(plan.insertion_groups.is_empty());
        assert_eq!(serde_json::to_value(&rows).unwrap(), before);
    }

    fn context(rows: Vec<StoredRowFile>) -> AlignmentContext {
        AlignmentContext {
            repo_path: PathBuf::new(),
            chapter_path: PathBuf::new(),
            chapter_json_path: PathBuf::new(),
            chapter_base_commit_sha: Some("base".into()),
            rows,
            chapter_file: serde_json::from_value(
                json!({"chapter_id":"test","title":"Subtitles","lifecycle":{"state":"active"},
                "languages":[{"code":"es","name":"Spanish","role":"source"}],
                "source_files":[{"format":"srt","path_hint":"source.srt","file_metadata":{}}]}),
            )
            .unwrap(),
        }
    }
    fn input() -> AddSubtitleTranslationInput {
        AddSubtitleTranslationInput {
            installation_id: 1,
            repo_name: "test".into(),
            project_id: None,
            chapter_id: "test".into(),
            source_language_code: "es".into(),
            target_language_code: "vi".into(),
            file_name: "test.srt".into(),
            bytes: Vec::new(),
            confirmations: Vec::new(),
            perform_meaning_check: false,
            provider_id: None,
            model_id: None,
        }
    }
    #[test]
    fn five_percent_is_allowed_but_more_requires_exact_and_then_overlap_consent() {
        for unmatched in [0, 1, 2, 20] {
            let context = context(
                (0..20)
                    .map(|i| row(i, i as u64 * 3000, i as u64 * 3000 + 2000))
                    .collect(),
            );
            let cues = (0..20)
                .map(|i| cue(i * 3000 + u64::from(i < unmatched), i * 3000 + 2000, "Text"))
                .collect::<Vec<_>>();
            let mut input = input();
            let first = prepare_subtitle(&context, &input, &cues, "op-1").unwrap();
            if unmatched <= 1 {
                assert!(first.early_warning.is_none());
                assert!(first.plan.overlap_pairs.is_empty());
            } else {
                let warning = first.early_warning.unwrap();
                assert_eq!(warning.stage, "exact");
                assert_eq!(warning.unmatched_count, unmatched as usize);
                assert_eq!(warning.total_count, 20);
                input.confirmations.push(warning.confirmation);
                let second = prepare_subtitle(&context, &input, &cues, "op-2").unwrap();
                assert!(second.early_warning.is_none());
                assert_eq!(second.plan.overlap_pairs.len(), unmatched as usize);
                assert!(second
                    .plan
                    .application
                    .row_texts
                    .unmatched_targets
                    .is_empty());
            }
        }
    }
    #[test]
    fn overlap_residual_over_five_percent_requires_its_own_confirmation() {
        let context = context(
            (0..20)
                .map(|i| row(i, i as u64 * 3000, i as u64 * 3000 + 2000))
                .collect(),
        );
        let cues = (0..20)
            .map(|i| {
                cue(
                    i * 3000 + if i < 2 { 100_000 } else { 1 },
                    i * 3000 + if i < 2 { 102_000 } else { 2000 },
                    "Text",
                )
            })
            .collect::<Vec<_>>();
        let mut input = input();
        let first = prepare_subtitle(&context, &input, &cues, "op").unwrap();
        input
            .confirmations
            .push(first.early_warning.unwrap().confirmation);
        let second = prepare_subtitle(&context, &input, &cues, "op").unwrap();
        let warning = second.early_warning.unwrap();
        assert_eq!(warning.stage, "overlap");
        assert_eq!(warning.unmatched_percent, 10.0);
        input.confirmations.push(warning.confirmation);
        let third = prepare_subtitle(&context, &input, &cues, "op").unwrap();
        assert!(third.early_warning.is_none());
        assert_eq!(third.plan.overlap_pairs.len(), 18);
    }
    #[test]
    fn changing_source_timing_or_new_text_invalidates_confirmation_but_adding_ai_configuration_does_not(
    ) {
        let mut context = context(vec![row(0, 1000, 2000)]);
        let mut input = input();
        let mut cues = vec![cue(1001, 2000, "Translation")];
        let first = prepare_subtitle(&context, &input, &cues, "op").unwrap();
        input
            .confirmations
            .push(first.early_warning.unwrap().confirmation);
        input.provider_id = Some(AiProviderId::OpenAi);
        input.model_id = Some("test-model".into());
        assert!(prepare_subtitle(&context, &input, &cues, "op")
            .unwrap()
            .early_warning
            .is_none());
        cues[0].text = "Different translation".into();
        assert_eq!(
            prepare_subtitle(&context, &input, &cues, "op")
                .unwrap()
                .early_warning
                .unwrap()
                .stage,
            "exact"
        );
        cues[0].text = "Translation".into();
        context.rows[0]
            .format_metadata
            .srt
            .as_mut()
            .unwrap()
            .start_ms = 900;
        assert_eq!(
            prepare_subtitle(&context, &input, &cues, "op")
                .unwrap()
                .early_warning
                .unwrap()
                .stage,
            "exact"
        );
    }
    #[test]
    fn overlap_uses_largest_available_intersection_and_reserves_all_exact_matches_first() {
        let rows = vec![row(0, 0, 4000), row(1, 1000, 5000), row(2, 6000, 9000)];
        let cues = vec![
            cue(500, 4500, "Overlap"),
            cue(1000, 2000, "Exact"),
            cue(6500, 8000, "Later"),
        ];
        let result = build_subtitle_plan(
            &rows,
            "es",
            &cues,
            "op".into(),
            "vi".into(),
            "vi".into(),
            true,
        )
        .unwrap();
        assert_eq!(result.application.row_texts.matched_rows["r0"], "Overlap");
        assert_eq!(result.application.row_texts.matched_rows["r1"], "Exact");
        assert_eq!(
            result
                .overlap_pairs
                .iter()
                .map(|p| p.target_line)
                .collect::<Vec<_>>(),
            vec![1, 3]
        );
    }
    #[test]
    fn overlap_never_reuses_a_row_does_not_match_adjacent_intervals_and_breaks_ties_in_source_order(
    ) {
        let rows = vec![row(0, 1000, 3000), row(1, 2000, 4000)];
        let cues = vec![
            cue(1500, 3500, "Tie"),
            cue(1501, 3501, "Next available"),
            cue(4000, 5000, "Adjacent"),
        ];
        let result = build_subtitle_plan(
            &rows,
            "es",
            &cues,
            "op".into(),
            "vi".into(),
            "vi".into(),
            true,
        )
        .unwrap();
        assert_eq!(result.application.row_texts.matched_rows["r0"], "Tie");
        assert_eq!(
            result.application.row_texts.matched_rows["r1"],
            "Next available"
        );
        assert_eq!(
            result.application.row_texts.unmatched_targets[0].text,
            "Adjacent"
        );
    }
    #[test]
    fn all_rejected_meaning_examples_are_bound_to_the_final_warning() {
        let rejected = (0..7)
            .map(|i| MeaningPair {
                line_number: i + 1,
                source_line: i + 1,
                target_line: i + 1,
                source_text: "Old".into(),
                target_text: "New".into(),
            })
            .collect::<Vec<_>>();
        let warning =
            warning("meaning", rejected.len(), 20, "plan", &[], rejected.clone()).unwrap();
        assert_eq!(warning.examples.len(), 7);
        assert!(
            super::warning("meaning", 7, 20, "plan", &[warning.confirmation], rejected).is_none()
        );
    }

    #[test]
    fn unmatched_cues_insert_before_between_and_after_all_existing_rows_in_time_order() {
        let rows = vec![row(0, 1000, 2000), row(1, 3000, 4000), row(2, 5000, 6000)];
        // Deliberately unordered file: insertion uses start time, not cue index.
        let cues = [
            cue(7000, 8000, "After"),
            cue(2000, 2500, "Between"),
            cue(0, 500, "Before"),
            cue(1000, 1500, "Matched"),
        ];
        let plan = plan(&rows, &cues);
        let insertion = build_bulk_insertion_plan(&rows, &plan.insertion_groups).unwrap();
        assert_eq!(plan.row_texts.matched_rows.len(), 1);
        assert_eq!(insertion.inserted_targets.len(), 3);
        let mut order = rows
            .iter()
            .map(|r| {
                (
                    insertion
                        .existing_order_keys
                        .get(&r.row_id)
                        .unwrap_or(&r.structure.order_key)
                        .clone(),
                    r.format_metadata.srt.unwrap().start_ms,
                )
            })
            .collect::<Vec<_>>();
        for inserted in &insertion.inserted_targets {
            order.push((
                inserted.order_key.clone(),
                plan.inserted_timings[&inserted.target.id].start_ms,
            ));
        }
        order.sort();
        assert_eq!(
            order
                .into_iter()
                .map(|(_, start)| start)
                .collect::<Vec<_>>(),
            [0, 1000, 2000, 3000, 5000, 7000]
        );
        assert_eq!(plan.row_texts.matched_rows["r0"], "Matched");
    }

    #[test]
    fn matching_only_end_times_or_near_starts_always_creates_new_rows() {
        let rows = vec![row(0, 1000, 2000)];
        let plan = plan(
            &rows,
            &[cue(1001, 2000, "Near"), cue(999, 2000, "Also near")],
        );
        assert!(plan.row_texts.matched_rows.is_empty());
        assert_eq!(plan.row_texts.unmatched_targets.len(), 2);
    }

    #[test]
    fn duplicate_starts_match_in_file_order_without_overwriting_a_locked_row() {
        let rows = vec![row(0, 1000, 2000), row(1, 1000, 3000)];
        let plan = plan(
            &rows,
            &[
                cue(1000, 4000, "First"),
                cue(1000, 5000, "Second"),
                cue(1000, 6000, "Third"),
            ],
        );
        assert_eq!(plan.row_texts.matched_rows["r0"], "First");
        assert_eq!(plan.row_texts.matched_rows["r1"], "Second");
        assert_eq!(plan.row_texts.unmatched_targets[0].text, "Third");
        assert_eq!(
            plan.insertion_groups[0].previous_row_id.as_deref(),
            Some("r1")
        );
    }

    #[test]
    fn selected_source_timing_override_is_used_before_imported_base() {
        let mut rows = vec![row(0, 1000, 2000)];
        rows[0].fields.get_mut("es").unwrap().timing = Some(StoredSrtTiming {
            start_ms: 4000,
            end_ms: 5000,
        });
        let plan = plan(
            &rows,
            &[cue(1000, 2000, "Base"), cue(4000, 9000, "Override")],
        );
        assert_eq!(plan.row_texts.matched_rows["r0"], "Override");
        assert_eq!(plan.row_texts.unmatched_targets[0].text, "Base");
    }

    #[test]
    fn missing_or_unordered_existing_timing_is_refused_without_mutation() {
        let mut rows = vec![row(0, 3000, 4000), row(1, 1000, 2000)];
        assert!(subtitle_plan(&rows, "es", &[], "test".into(), "vi".into(), "vi".into()).is_err());
        rows.truncate(1);
        rows[0].format_metadata.srt = None;
        assert!(subtitle_plan(&rows, "es", &[], "test".into(), "vi".into(), "vi".into()).is_err());
    }

    #[test]
    fn matched_row_content_and_timing_survive_while_new_row_gets_uploaded_timing() {
        let row = row(0, 1000, 2000);
        let mut json = serde_json::to_value(&row).unwrap();
        let original = json.clone();
        set_row_plain_text(&mut json, "vi", "Translation").unwrap();
        assert_eq!(json["fields"]["es"], original["fields"]["es"]);
        assert_eq!(json["format_metadata"], original["format_metadata"]);
        let chapter: StoredChapterFile = serde_json::from_value(json!({
            "chapter_id":"test", "title":"Subtitles", "lifecycle":{"state":"active"},
            "languages":[{"code":"es","name":"Spanish","role":"source"},{"code":"vi","name":"Vietnamese","role":"target"}],
            "source_files":[],
        })).unwrap();
        let inserted = create_inserted_row_file(
            "new",
            &rebalanced_order_key(1).unwrap(),
            &chapter,
            &chapter.languages,
            Some(StoredSrtTiming {
                start_ms: 2500,
                end_ms: 3500,
            }),
        );
        assert_eq!(inserted["format_metadata"]["srt"]["start_ms"], 2500);
        assert_eq!(inserted["format_metadata"]["srt"]["end_ms"], 3500);
        assert_eq!(inserted["fields"]["es"]["plain_text"], "");
    }

    #[test]
    #[ignore = "opt-in read-only replay of local SRT files; no provider or user-data writes"]
    fn replay_subtitle_files_read_only() {
        let source_path = std::env::var("GNOSIS_SUBTITLE_EVAL_SOURCE").unwrap();
        let target_path = std::env::var("GNOSIS_SUBTITLE_EVAL_TARGET").unwrap();
        let source = parse_translation_srt(&fs::read(source_path).unwrap(), "source.srt").unwrap();
        let target = parse_translation_srt(&fs::read(target_path).unwrap(), "target.srt").unwrap();
        let rows = source
            .iter()
            .enumerate()
            .map(|(i, c)| row(i, c.start_ms, c.end_ms))
            .collect::<Vec<_>>();
        let started = Instant::now();
        let plan = plan(&rows, &target);
        let insertion = build_bulk_insertion_plan(&rows, &plan.insertion_groups).unwrap();
        assert_eq!(
            plan.row_texts.matched_rows.len() + insertion.inserted_targets.len(),
            target.len()
        );
        let mut ordered = rows
            .iter()
            .map(|r| {
                (
                    insertion
                        .existing_order_keys
                        .get(&r.row_id)
                        .unwrap_or(&r.structure.order_key)
                        .clone(),
                    r.format_metadata.srt.unwrap().start_ms,
                )
            })
            .collect::<Vec<_>>();
        ordered.extend(insertion.inserted_targets.iter().map(|r| {
            (
                r.order_key.clone(),
                plan.inserted_timings[&r.target.id].start_ms,
            )
        }));
        ordered.sort();
        assert!(ordered.windows(2).all(|w| w[0].1 <= w[1].1));
        println!(
            "{}",
            json!({"sourceCues":source.len(),"targetCues":target.len(),"matchedStartTimes":plan.row_texts.matched_rows.len(),"insertedRows":insertion.inserted_targets.len(),"resultRows":ordered.len(),"planMilliseconds":started.elapsed().as_secs_f64()*1000.0,"aiRequests":0,"aiTokens":0})
        );
    }
}
