use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Barrier, Mutex,
};

fn fixture(count: usize) -> AlignmentJob {
    let mut job = tests::alignment_test_job();
    let source = (1..=count)
        .flat_map(|n| {
            [
                format!("The red train arrived at platform {n}."),
                format!("The passengers at platform {n} got off with their suitcases."),
            ]
        })
        .collect::<Vec<_>>()
        .join("\n");
    job.source_units = parse_target_units(&source);
    for unit in &mut job.source_units {
        unit.row_id = Some(format!("r{}", unit.id));
    }
    job.target_units = parse_target_units(&(1..=count).map(|n|
        format!("El tren rojo llegó al andén {n}. Los pasajeros del andén {n} bajaron con sus maletas."))
        .collect::<Vec<_>>().join("\n"));
    job.target_base_language_code = "es".into();
    job.source_sections = build_sections(&job.source_units);
    job.target_sections = build_sections(&job.target_units);
    job.alignments = (1..=count)
        .map(|id| Alignment {
            target_id: id,
            source_ids: vec![id * 2 - 1, id * 2],
        })
        .collect();
    job
}

fn answer(job: &AlignmentJob, ids: &[usize]) -> Value {
    json!({"splitTargets":ids.iter().map(|id| {
        let text = &job.target_units[*id-1].text;
        let (first, second) = text.split_once(". ").unwrap();
        json!({"targetId":id,"fragments":[
            {"sourceId":id*2-1,"targetTextFragment":format!("{first}. ")},
            {"sourceId":id*2,"targetTextFragment":second}
        ]})
    }).collect::<Vec<_>>()})
}

struct TempCache(PathBuf);
impl TempCache {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("alignment-efficiency-{}", uuid::Uuid::now_v7())))
    }
}
impl Drop for TempCache {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn section_answers_must_cover_all_candidates_exactly_once() {
    let candidates = (1..=3)
        .map(|section_id| SectionSummary {
            section_id,
            doc_role: "source".into(),
            language: "en".into(),
            summary: "Text".into(),
            section_content_hash: "hash".into(),
        })
        .collect::<Vec<_>>();
    let response = |ids: &[usize]| SectionMatchResponse {
        matches: ids
            .iter()
            .map(|id| SectionMatchResponseItem {
                source_section_id: *id,
                is_match: false,
                overlap_percent: 0.0,
            })
            .collect(),
    };
    for ids in [
        vec![],
        vec![1],
        vec![1, 2],
        vec![1, 1, 3],
        vec![1, 2, 4],
        vec![1, 2, 3, 3],
    ] {
        assert!(validate_section_matches(&response(&ids), &candidates).is_err());
    }
    assert!(validate_section_matches(&response(&[3, 1, 2]), &candidates).is_ok());
}

#[test]
fn prompt_projection_preserves_text_ids_and_line_boundaries_without_local_metadata() {
    let mut job = fixture(20);
    job.target_units[1].original_line_number = 4;
    let prompt = build_row_alignment_prompt(&job.source_units, &job.target_units).unwrap();
    let payload: Value = serde_json::from_str(prompt.split("Input:\n").nth(1).unwrap()).unwrap();
    for (role, units) in [
        ("sourceUnits", &job.source_units),
        ("targetUnits", &job.target_units),
    ] {
        for (index, unit) in units.iter().enumerate() {
            assert_eq!(payload[role][index]["id"], unit.id);
            assert_eq!(payload[role][index]["text"], unit.text);
            assert_eq!(
                payload[role][index]["originalLineNumber"],
                unit.original_line_number
            );
            assert!(payload[role][index].get("rowId").is_none());
            assert!(payload[role][index].get("textHash").is_none());
        }
    }
    let old = serde_json::to_string_pretty(
        &json!({"sourceUnits":job.source_units,"targetUnits":job.target_units}),
    )
    .unwrap();
    assert!(payload.to_string().len() < old.len() / 2);
}

#[test]
fn twenty_splits_use_one_request_and_cached_rerun_uses_none() {
    let mut job = fixture(20);
    let ids = (1..=20).collect::<Vec<_>>();
    assert_eq!(
        splits::split_batches(&job, &ids).unwrap(),
        vec![ids.clone()]
    );
    let cache = TempCache::new();
    let calls = AtomicUsize::new(0);
    job.split_targets = splits::resolve_split_batch(
        &job,
        &ids,
        &cache.0,
        false,
        &|requested, retry| {
            assert!(!retry);
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(answer(&job, requested))
        },
        &|_| {},
    )
    .unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(job.split_targets.len(), 20);
    assert!(final_checks(&job).is_ok());
    let cached = AtomicUsize::new(0);
    let second = splits::resolve_split_batch(
        &job,
        &ids,
        &cache.0,
        false,
        &|_, _| panic!("cache miss"),
        &|_| {
            cached.fetch_add(1, Ordering::SeqCst);
        },
    )
    .unwrap();
    assert_eq!(second.len(), 20);
    assert_eq!(cached.load(Ordering::SeqCst), 20);
}

#[test]
fn malformed_or_missing_items_retry_only_failed_targets_and_keep_good_checkpoints() {
    let job = fixture(3);
    let cache = TempCache::new();
    let calls = Mutex::new(Vec::new());
    let result = splits::resolve_split_batch(
        &job,
        &[1, 2, 3],
        &cache.0,
        false,
        &|ids, retry| {
            calls.lock().unwrap().push(ids.to_vec());
            if !retry {
                let mut value = answer(&job, &[1, 2]);
                value["splitTargets"][1]["fragments"][0]["targetTextFragment"] =
                    json!("Invented words.");
                Ok(value)
            } else {
                Ok(answer(&job, ids))
            }
        },
        &|_| {},
    )
    .unwrap();
    assert_eq!(result.len(), 3);
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec![1, 2, 3], vec![2], vec![3]]
    );
    assert!(splits::split_checkpoint(&job, &cache.0, 1)
        .unwrap()
        .exists());
}

#[test]
fn duplicate_or_unknown_targets_never_get_accepted_without_recovery() {
    for unknown in [false, true] {
        let job = fixture(2);
        let cache = TempCache::new();
        let calls = AtomicUsize::new(0);
        let result = splits::resolve_split_batch(
            &job,
            &[1, 2],
            &cache.0,
            false,
            &|ids, retry| {
                calls.fetch_add(1, Ordering::SeqCst);
                if retry {
                    return Ok(answer(&job, ids));
                }
                let mut value = answer(&job, ids);
                let mut extra = value["splitTargets"][0].clone();
                if unknown {
                    extra["targetId"] = json!(99);
                }
                value["splitTargets"].as_array_mut().unwrap().push(extra);
                Ok(value)
            },
            &|_| {},
        )
        .unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), if unknown { 3 } else { 2 });
    }
}

#[test]
fn failed_recovery_keeps_valid_siblings_and_never_applies_unsafe_splits() {
    let job = fixture(2);
    let cache = TempCache::new();
    let calls = AtomicUsize::new(0);
    let result = splits::resolve_split_batch(
        &job,
        &[1, 2],
        &cache.0,
        false,
        &|ids, retry| {
            calls.fetch_add(1, Ordering::SeqCst);
            let mut value = answer(&job, ids);
            let index = if retry { 0 } else { 1 };
            value["splitTargets"][index]["fragments"][0]["targetTextFragment"] =
                json!("Invented words.");
            Ok(value)
        },
        &|_| {},
    );
    assert!(result.unwrap_err().starts_with("ALIGNMENT_SPLIT_REVIEW:"));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(!splits::split_checkpoint(&job, &cache.0, 2)
        .unwrap()
        .exists());
    splits::resolve_split_batch(
        &job,
        &[1, 2],
        &cache.0,
        false,
        &|ids, _| {
            assert_eq!(ids, &[2]);
            Ok(answer(&job, ids))
        },
        &|_| {},
    )
    .unwrap();
}

#[test]
fn malformed_json_retries_smaller_groups_and_reuses_valid_checkpoints() {
    let job = fixture(5);
    let cache = TempCache::new();
    // A previous attempt already finished the first target.
    splits::resolve_split_batch(
        &job,
        &[1],
        &cache.0,
        false,
        &|ids, _| Ok(answer(&job, ids)),
        &|_| {},
    )
    .unwrap();
    let calls = Mutex::new(Vec::new());
    let results = splits::resolve_split_batch(
        &job,
        &[1, 2, 3, 4, 5],
        &cache.0,
        false,
        &|ids, retry| {
            calls.lock().unwrap().push(ids.to_vec());
            if !retry {
                parse_alignment_json(
                    r#"{"splitTargets":[{"targetId":2,"fragments":["#,
                    "split_target_response",
                )
            } else {
                parse_alignment_json(&answer(&job, ids).to_string(), "split_target_response")
            }
        },
        &|_| {},
    )
    .unwrap();
    assert_eq!(results.len(), 5);
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec![2, 3, 4, 5], vec![2, 3], vec![4, 5]]
    );
    splits::resolve_split_batch(
        &job,
        &[1, 2, 3, 4, 5],
        &cache.0,
        false,
        &|_, _| panic!("validated results must be cached"),
        &|_| {},
    )
    .unwrap();
}

#[test]
fn repeatedly_malformed_json_stops_at_a_single_target_without_caching_it() {
    let job = fixture(4);
    let cache = TempCache::new();
    let calls = Mutex::new(Vec::new());
    let error = splits::resolve_split_batch(
        &job,
        &[1, 2, 3, 4],
        &cache.0,
        false,
        &|ids, _| {
            calls.lock().unwrap().push(ids.to_vec());
            parse_alignment_json("not JSON", "split_target_response")
        },
        &|_| {},
    )
    .unwrap_err();
    assert!(error.contains("ALIGNMENT_SPLIT_REVIEW"));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![vec![1, 2, 3, 4], vec![1, 2], vec![1]]
    );
    assert!(!splits::split_checkpoint(&job, &cache.0, 1)
        .unwrap()
        .exists());
}

#[test]
fn transport_errors_never_expand_into_more_requests() {
    for message in [
        "rate limit",
        "invalid credentials",
        "connection failed",
        "request timed out",
    ] {
        let job = fixture(20);
        let cache = TempCache::new();
        let calls = AtomicUsize::new(0);
        let error = splits::resolve_split_batch(
            &job,
            &(1..=20).collect::<Vec<_>>(),
            &cache.0,
            false,
            &|_, _| {
                calls.fetch_add(1, Ordering::SeqCst);
                Err(AlignmentPromptError::Request(message.into()))
            },
            &|_| {},
        )
        .unwrap_err();
        assert_eq!(error, message);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn budgets_isolate_large_units_and_preserve_all_ids() {
    let mut job = fixture(60);
    let ids = (1..=60).collect::<Vec<_>>();
    job.target_units[15].text = "長い文章".repeat(10_000);
    let batches = splits::split_batches(&job, &ids).unwrap();
    assert_eq!(batches.iter().flatten().copied().collect::<Vec<_>>(), ids);
    assert!(batches.iter().any(|batch| batch == &[16]));
    assert!(batches.iter().all(|batch| batch.len() <= 50));
    for batch in &batches {
        if batch.len() > 1 {
            assert!(
                splits::build_split_prompt(&job, batch).unwrap().len()
                    + split_schema().to_string().len()
                    <= 24_000
            );
        }
    }
}

#[test]
fn checkpoint_identity_tracks_semantic_context_model_and_boundary_rules() {
    let job = fixture(1);
    let cache = Path::new("unused");
    let original = splits::split_checkpoint(&job, cache, 1).unwrap();
    let mut changed = job.clone();
    changed.model_id.push('x');
    assert_ne!(
        splits::split_checkpoint(&changed, cache, 1).unwrap(),
        original
    );
    let mut changed = job.clone();
    changed.source_units[0].text.push('x');
    assert_ne!(
        splits::split_checkpoint(&changed, cache, 1).unwrap(),
        original
    );
    let mut changed = job.clone();
    changed.subtitle_continuations = true;
    // Subtitle and paragraph splits now share the same no-editing rules.
    assert_eq!(
        splits::split_checkpoint(&changed, cache, 1).unwrap(),
        original
    );
    let mut changed = job.clone();
    changed.target_base_language_code = "vi".into();
    assert_ne!(
        splits::split_checkpoint(&changed, cache, 1).unwrap(),
        original
    );
}

#[test]
fn workers_overlap_but_share_four_slots_across_jobs_and_stop_after_failure() {
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let barrier = Barrier::new(4);
    std::thread::scope(|scope| {
        let run = |_: &usize| {
            splits::with_request_slot(|| {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(count, Ordering::SeqCst);
                barrier.wait();
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(())
            })
        };
        let first =
            scope.spawn(move || splits::run_split_workers(&(0..8).collect::<Vec<_>>(), run));
        let second =
            scope.spawn(move || splits::run_split_workers(&(0..8).collect::<Vec<_>>(), run));
        first.join().unwrap().unwrap();
        second.join().unwrap().unwrap();
    });
    assert_eq!(peak.load(Ordering::SeqCst), 4);
    let calls = AtomicUsize::new(0);
    assert!(
        splits::run_split_workers(&(0..8).collect::<Vec<_>>(), |id| {
            calls.fetch_add(1, Ordering::SeqCst);
            if *id == 0 {
                Err("failed".into())
            } else {
                Ok(*id)
            }
        })
        .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 4);
}

// Opt-in only. A caller supplies GNOSIS_ALIGNMENT_EVAL_MODEL and the matching
// key: GNOSIS_ALIGNMENT_EVAL_PROVIDER=claude uses ANTHROPIC_API_KEY, otherwise
// OPENAI_API_KEY. Fixtures are synthetic; no app storage is read.
fn live_credentials() -> (AiProviderId, String) {
    match std::env::var("GNOSIS_ALIGNMENT_EVAL_PROVIDER").as_deref() {
        Ok("claude") => (
            AiProviderId::Claude,
            std::env::var("ANTHROPIC_API_KEY").expect("set ANTHROPIC_API_KEY securely"),
        ),
        _ => (
            AiProviderId::OpenAi,
            std::env::var("OPENAI_API_KEY").expect("set OPENAI_API_KEY securely"),
        ),
    }
}

#[test]
#[ignore = "paid AI evaluation; requires explicit test credentials/model"]
fn live_alignment_and_split_batch_evaluation() {
    let (provider_id, key) = live_credentials();
    let model =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_MODEL").expect("set GNOSIS_ALIGNMENT_EVAL_MODEL");
    let mut job = fixture(20);
    job.provider_id = provider_id;
    job.model_id = model;
    let prompt = build_row_alignment_prompt(&job.source_units, &job.target_units).unwrap();
    let start = Instant::now();
    let (value, usage) = run_json_prompt(
        &job,
        &key,
        "row_alignment_response",
        alignment_schema(),
        &prompt,
    )
    .unwrap();
    let aligned = validate_alignments(
        serde_json::from_value(value).unwrap(),
        &job.source_units,
        &job.target_units,
    )
    .unwrap();
    assert_eq!(
        aligned, job.alignments,
        "synthetic bilingual row mapping changed"
    );
    eprintln!(
        "alignment eval: elapsed_ms={} usage={}",
        start.elapsed().as_millis(),
        json!(usage)
    );
    // Same row instructions with the previous full-metadata input, for a direct
    // input-token/accuracy comparison on identical synthetic content.
    let old_input = serde_json::to_string_pretty(
        &json!({"sourceUnits":job.source_units,"targetUnits":job.target_units}),
    )
    .unwrap();
    let old_prompt = format!(
        "{}Input:\n{}",
        prompt.split("Input:\n").next().unwrap(),
        old_input
    );
    let (old_value, old_usage) = run_json_prompt(
        &job,
        &key,
        "row_alignment_response",
        alignment_schema(),
        &old_prompt,
    )
    .unwrap();
    let old_aligned = validate_alignments(
        serde_json::from_value(old_value).unwrap(),
        &job.source_units,
        &job.target_units,
    )
    .unwrap();
    assert_eq!(old_aligned, aligned);
    eprintln!("baseline alignment eval: usage={}", json!(old_usage));
    let ids = (1..=20).collect::<Vec<_>>();
    let cache = TempCache::new();
    let calls = AtomicUsize::new(0);
    let start = Instant::now();
    job.split_targets = splits::resolve_split_batch(
        &job,
        &ids,
        &cache.0,
        false,
        &|ids, retry| {
            if calls.fetch_add(1, Ordering::SeqCst) >= 5 {
                return Err(AlignmentPromptError::Request(
                    "Live evaluation request budget reached.".into(),
                ));
            }
            let prompt = splits::build_split_prompt(&job, ids)?;
            let (value, usage) =
                run_json_prompt(&job, &key, "split_target_response", split_schema(), &prompt)?;
            eprintln!(
                "split eval: targets={} retry={} prompt_bytes={} usage={}",
                ids.len(),
                retry,
                prompt.len(),
                json!(usage)
            );
            Ok(value)
        },
        &|_| {},
    )
    .unwrap();
    assert!(final_checks(&job).is_ok());
    let expected: SplitTargetResponse = serde_json::from_value(answer(&job, &ids)).unwrap();
    let mut expected_job = job.clone();
    expected_job.split_targets = validate_split_response(&job, &expected, &ids).unwrap();
    let expected_rows = build_row_translation_plan(&expected_job).unwrap();
    let actual_rows = build_row_translation_plan(&job).unwrap();
    // Exact coverage is checked above. Leading/trailing inter-sentence whitespace
    // may belong to either fragment without changing its source assignment.
    assert_eq!(
        actual_rows.matched_rows.len(),
        expected_rows.matched_rows.len()
    );
    for (id, text) in &actual_rows.matched_rows {
        assert_eq!(text.trim(), expected_rows.matched_rows[id].trim());
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "batch required recovery on the simple fixture"
    );
    eprintln!(
        "split eval: calls={} elapsed_ms={}",
        calls.load(Ordering::SeqCst),
        start.elapsed().as_millis()
    );
}

#[test]
#[ignore = "paid AI evaluation; requires explicit test credentials/model"]
fn live_alignment_boundary_evaluation() {
    let (provider_id, key) = live_credentials();
    let model =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_MODEL").expect("set GNOSIS_ALIGNMENT_EVAL_MODEL");
    let cases = [
        (
            false,
            vec![
                (
                    "The doctor examined the patient.",
                    "Then she wrote a prescription.",
                    "Bác sĩ khám cho bệnh nhân.",
                    "Sau đó cô ấy viết đơn thuốc.",
                ),
                (
                    "The library opens at nine.",
                    "It closes at six in the evening.",
                    "Thư viện mở cửa lúc chín giờ.",
                    "Thư viện đóng cửa lúc sáu giờ tối.",
                ),
                (
                    "We left early.",
                    "We arrived on time.",
                    "Chúng tôi đi sớm.",
                    "Chúng tôi đến đúng giờ.",
                ),
            ],
        ),
        (
            true,
            vec![
                (
                    "We left early",
                    "and arrived on time.",
                    "Chúng tôi đi sớm",
                    "và đến đúng giờ.",
                ),
                (
                    "The doctor examined the patient",
                    "and then wrote a prescription.",
                    "Bác sĩ khám cho bệnh nhân",
                    "và sau đó viết đơn thuốc.",
                ),
            ],
        ),
    ];
    for (subtitle, items) in cases {
        let mut job = fixture(items.len());
        job.provider_id = provider_id;
        job.model_id = model.clone();
        job.target_base_language_code = "vi".into();
        job.subtitle_continuations = subtitle;
        for (i, (first, second, target_first, target_second)) in items.iter().enumerate() {
            job.source_units[i * 2].text = first.to_string();
            job.source_units[i * 2 + 1].text = second.to_string();
            job.target_units[i].text = format!("{target_first} {target_second}");
        }
        let ids = (1..=items.len()).collect::<Vec<_>>();
        let prompt = splits::build_split_prompt(&job, &ids).unwrap();
        let (value, usage) =
            run_json_prompt(&job, &key, "split_target_response", split_schema(), &prompt).unwrap();
        let response: SplitTargetResponse = serde_json::from_value(value).unwrap();
        job.split_targets = validate_split_response(&job, &response, &ids).unwrap();
        assert!(final_checks(&job).is_ok());
        let plan = build_row_translation_plan(&job).unwrap();
        for (i, (_, _, first, second)) in items.iter().enumerate() {
            assert_eq!(plan.matched_rows[&format!("r{}", i * 2 + 1)].trim(), *first);
            assert_eq!(
                plan.matched_rows[&format!("r{}", i * 2 + 2)].trim(),
                *second
            );
        }
        eprintln!(
            "Vietnamese boundary eval: subtitle={} targets={} usage={}",
            subtitle,
            items.len(),
            json!(usage)
        );
    }
}

#[derive(Default)]
struct LiveUsage {
    calls: u64,
    input: u64,
    output: u64,
    cached: u64,
}

impl LiveUsage {
    fn add(&mut self, usage: &Option<Value>) {
        let count = |pointer: &str| {
            usage
                .as_ref()
                .and_then(|usage| usage.pointer(pointer))
                .and_then(Value::as_u64)
                .unwrap_or(0)
        };
        self.calls += 1;
        self.input += count("/input_tokens");
        self.output += count("/output_tokens");
        // Claude reports cache reads apart from input; OpenAI inside it.
        self.cached +=
            count("/cache_read_input_tokens") + count("/input_tokens_details/cached_tokens");
    }
}

/// Real-text evaluation: a chapter's source rows and an existing translation
/// of it, pasted as paragraphs with every sixth pair of rows merged into one
/// paragraph, so both row alignment and splitting have a known correct answer.
/// Runs every alignment stage (compatibility, section summaries, section
/// matching, row alignment, splits) with the app's prompt builders, schemas
/// and validators, and prints accuracy and token usage.
///
/// `GNOSIS_ALIGNMENT_EVAL_ROWS` is a JSON array of rows; `GNOSIS_ALIGNMENT_EVAL_SOURCE`
/// and `GNOSIS_ALIGNMENT_EVAL_TARGET` name the row fields to use (default `es`, `en`).
#[test]
#[ignore = "paid AI evaluation; requires explicit test credentials/model/data"]
fn live_alignment_real_chapter_evaluation() {
    let (provider_id, key) = live_credentials();
    let model =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_MODEL").expect("set GNOSIS_ALIGNMENT_EVAL_MODEL");
    let rows_path =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_ROWS").expect("set GNOSIS_ALIGNMENT_EVAL_ROWS");
    let source_field =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_SOURCE").unwrap_or_else(|_| "es".to_string());
    let target_field =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_TARGET").unwrap_or_else(|_| "en".to_string());
    let rows: Vec<Value> = serde_json::from_str(&fs::read_to_string(rows_path).unwrap()).unwrap();
    let one_line = |value: &Value| {
        value
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let pairs = rows
        .iter()
        .map(|row| (one_line(&row[&source_field]), one_line(&row[&target_field])))
        .filter(|(source, target)| !source.is_empty() && !target.is_empty())
        .collect::<Vec<_>>();

    let mut job = tests::alignment_test_job();
    job.provider_id = provider_id;
    job.model_id = model.clone();
    job.source_language_code = source_field.clone();
    job.target_base_language_code = target_field.clone();
    job.source_units = parse_target_units(
        &pairs
            .iter()
            .map(|(source, _)| source.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    );
    for unit in &mut job.source_units {
        unit.row_id = Some(format!("r{}", unit.id));
    }
    // Paragraphs of the translation, with the known source rows of each.
    let mut paragraphs = Vec::new();
    let mut truth = Vec::new();
    let mut index = 0;
    while index < pairs.len() {
        if index % 6 == 5 && index + 1 < pairs.len() {
            paragraphs.push(format!("{} {}", pairs[index].1, pairs[index + 1].1));
            truth.push(vec![index + 1, index + 2]);
            index += 2;
        } else {
            paragraphs.push(pairs[index].1.clone());
            truth.push(vec![index + 1]);
            index += 1;
        }
    }
    job.target_units = parse_target_units(&paragraphs.join("\n"));
    assert_eq!(job.target_units.len(), truth.len());
    job.source_sections = build_sections(&job.source_units);
    job.target_sections = build_sections(&job.target_units);
    let started = Instant::now();
    let cache = TempCache::new();
    let mut usage = LiveUsage::default();
    let mut attempts = 0u64;
    let mut requests = 0u64;
    // The app's validated path: an invalid response is requested once more.
    let mut ask = |schema_name: &str,
                   schema: Value,
                   prompt: &str,
                   validate: &dyn Fn(&Value) -> Result<(), String>| {
        requests += 1;
        let path = cache.0.join(format!("{}.json", uuid::Uuid::now_v7()));
        cached_validated_response::<Value>(&path, validate, || {
            attempts += 1;
            let (value, reported) =
                run_json_prompt(&job, &key, schema_name, schema.clone(), prompt)
                    .map_err(String::from)?;
            usage.add(&reported);
            if let Ok(dir) = std::env::var("GNOSIS_ALIGNMENT_EVAL_DUMP") {
                let name = format!("{dir}/{schema_name}-{}", uuid::Uuid::now_v7());
                fs::write(format!("{name}.prompt.txt"), prompt).unwrap();
                fs::write(format!("{name}.response.json"), value.to_string()).unwrap();
            }
            Ok(value)
        })
        .unwrap_or_else(|error| panic!("{schema_name}: {error}"))
    };
    fn shape<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, String> {
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())
    }

    // 1. Compatibility.
    let compatible: CompatibilityResponse = shape(&ask(
        "alignment_compatibility",
        compatibility_schema(),
        &build_compatibility_prompt(&job.source_units, &job.target_units),
        &|value| shape::<CompatibilityResponse>(value).map(|_| ()),
    ))
    .unwrap();

    // 2. Section summaries.
    let mut summaries = Vec::new();
    for (doc_role, sections, units, language) in [
        (
            "source",
            &job.source_sections,
            &job.source_units,
            &source_field,
        ),
        (
            "target",
            &job.target_sections,
            &job.target_units,
            &target_field,
        ),
    ] {
        for section in sections {
            let section_units = units_for_section(units, section);
            let response: SummaryResponse = shape(&ask(
                "same_language_section_summary",
                summary_schema(),
                &build_section_summary_prompt(
                    doc_role,
                    section.section_id,
                    language,
                    &section_units,
                ),
                &|value| {
                    let response = shape::<SummaryResponse>(value)?;
                    if response.section_summary.summary.trim().is_empty() {
                        Err("The section summary was empty.".to_string())
                    } else {
                        Ok(())
                    }
                },
            ))
            .unwrap();
            summaries.push(SectionSummary {
                doc_role: doc_role.to_string(),
                section_id: section.section_id,
                language: language.to_string(),
                summary: response.section_summary.summary,
                section_content_hash: section.content_hash.clone(),
            });
        }
    }
    let (source_summaries, target_summaries): (Vec<_>, Vec<_>) = summaries
        .into_iter()
        .partition(|summary| summary.doc_role == "source");

    // 3. Section matching, scored against the rows each section really holds.
    let rows_of_target_section = |section: &SectionWindow| {
        section
            .unit_ids
            .iter()
            .flat_map(|id| truth[id - 1].iter().copied())
            .collect::<HashSet<_>>()
    };
    let (mut match_agree, mut match_total) = (0, 0);
    for target in &target_summaries {
        let response: SectionMatchResponse = shape(&ask(
            "section_overlap_matches",
            section_match_schema(),
            &build_section_match_prompt(target, &source_summaries),
            &|value| validate_section_matches(&shape(value)?, &source_summaries),
        ))
        .unwrap();
        let target_rows = rows_of_target_section(&job.target_sections[target.section_id - 1]);
        for item in &response.matches {
            let source_rows = job.source_sections[item.source_section_id - 1]
                .unit_ids
                .iter()
                .copied()
                .collect::<HashSet<_>>();
            let truly_overlaps = !target_rows.is_disjoint(&source_rows);
            match_total += 1;
            match_agree += usize::from(item.is_match == truly_overlaps);
        }
    }

    // 4. Row alignment, in blocks of about 40 source rows with the targets
    // that belong there (what corridor selection hands the model).
    let mut aligned = Vec::new();
    let mut block_start = 0;
    while block_start < job.target_units.len() {
        let mut block_end = block_start;
        while block_end < job.target_units.len()
            && truth[block_end].last().unwrap() - truth[block_start][0] < 40
        {
            block_end += 1;
        }
        let targets = job.target_units[block_start..block_end].to_vec();
        let first_source = truth[block_start][0];
        let last_source = *truth[block_end - 1].last().unwrap();
        let sources = job.source_units[first_source - 1..last_source].to_vec();
        let response: AlignmentResponse = shape(&ask(
            "row_alignment_response",
            alignment_schema(),
            &build_row_alignment_prompt(&sources, &targets).unwrap(),
            &|value| validate_alignments(shape(value)?, &sources, &targets).map(|_| ()),
        ))
        .unwrap();
        aligned.extend(validate_alignments(response, &sources, &targets).unwrap());
        block_start = block_end;
    }
    let row_correct = aligned
        .iter()
        .filter(|alignment| alignment.source_ids == truth[alignment.target_id - 1])
        .count();

    // 5. Splits for every target aligned to more than one source row.
    job.alignments = aligned;
    let split_ids = job
        .alignments
        .iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .map(|alignment| alignment.target_id)
        .collect::<Vec<_>>();
    let split_cache = TempCache::new();
    let split_usage = Mutex::new(LiveUsage::default());
    let mut split_targets = Vec::new();
    for batch in splits::split_batches(&job, &split_ids).unwrap() {
        split_targets.extend(
            splits::resolve_split_batch(
                &job,
                &batch,
                &split_cache.0,
                false,
                &|ids, _retry| {
                    let prompt = splits::build_split_prompt(&job, ids)?;
                    let (value, reported) = run_json_prompt(
                        &job,
                        &key,
                        "split_target_response",
                        split_schema(),
                        &prompt,
                    )?;
                    split_usage.lock().unwrap().add(&reported);
                    Ok(value)
                },
                &|_| {},
            )
            .unwrap(),
        );
    }
    job.split_targets = split_targets;
    let split_usage = split_usage.into_inner().unwrap();
    let plan = build_row_translation_plan(&job).unwrap();
    let (mut rows_correct, mut rows_total) = (0, 0);
    for (index, (_, target_text)) in pairs.iter().enumerate() {
        rows_total += 1;
        let row_id = format!("r{}", index + 1);
        rows_correct += usize::from(
            plan.matched_rows
                .get(&row_id)
                .is_some_and(|text| text.trim() == target_text.trim()),
        );
    }

    println!(
        "{}",
        json!({
            "provider": provider_id.as_str(),
            "model": model,
            "sourceRows": job.source_units.len(),
            "targetParagraphs": job.target_units.len(),
            "compatible": compatible.matches,
            "sections": {"source": source_summaries.len(), "target": target_summaries.len()},
            "sectionMatchAgreement": format!("{match_agree}/{match_total}"),
            "rowAlignmentCorrect": format!("{row_correct}/{}", job.target_units.len()),
            "splitTargets": split_ids.len(),
            "rowsWithCorrectText": format!("{rows_correct}/{rows_total}"),
            "calls": usage.calls + split_usage.calls,
            "validationRetries": attempts - requests,
            "inputTokens": usage.input + split_usage.input,
            "cachedTokens": usage.cached + split_usage.cached,
            "outputTokens": usage.output + split_usage.output,
            "elapsedMs": started.elapsed().as_millis(),
        })
    );
    assert!(compatible.matches);
}
