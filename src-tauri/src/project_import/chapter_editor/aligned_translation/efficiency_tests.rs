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

// Opt-in only. A caller supplies OPENAI_API_KEY and GNOSIS_ALIGNMENT_EVAL_MODEL;
// fixtures are synthetic, no app storage or real translation documents are read.
#[test]
#[ignore = "paid OpenAI evaluation; requires explicit test credentials/model"]
fn live_alignment_and_split_batch_evaluation() {
    let key = std::env::var("OPENAI_API_KEY").expect("set OPENAI_API_KEY securely");
    let model =
        std::env::var("GNOSIS_ALIGNMENT_EVAL_MODEL").expect("set GNOSIS_ALIGNMENT_EVAL_MODEL");
    let mut job = fixture(20);
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
#[ignore = "paid OpenAI evaluation; requires explicit test credentials/model"]
fn live_alignment_boundary_evaluation() {
    let key = std::env::var("OPENAI_API_KEY").expect("set OPENAI_API_KEY securely");
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
