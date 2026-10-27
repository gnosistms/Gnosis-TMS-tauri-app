//! Human-guided research. Old glossary research code and data are independent.
pub(crate) mod dle;
mod dle_cache;
mod evidence;
mod storage;
mod tools;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudioInput {
    installation_id: i64,
    glossary_id: String,
    #[serde(default)]
    study_id: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    output_path: String,
    expected_revision: Option<u64>,
}

#[tauri::command]
pub(crate) async fn glossary_studio_storage(
    app: AppHandle,
    operation: String,
    input: StudioInput,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = storage::root(&app, input.installation_id, &input.glossary_id)?;
        match operation.as_str() {
            "list" => storage::list(&root),
            "load" => storage::read(&root, &input.study_id),
            "manifest" => storage::read_manifest(&root, &input.study_id),
            "export" => storage::export(
                &root,
                &input.study_id,
                std::path::Path::new(&input.output_path),
            ),
            "artifact-write" => storage::write_artifacts(&root, &input.study_id, &input.value),
            "artifact-read" => evidence::read(&root, &input.study_id, &input.value),
            "save" => storage::save_receipt(&root, &input.value, input.expected_revision),
            "delete" => {
                storage::safe_id(&input.study_id)?;
                let prefix = format!(
                    "{}:{}:{}:",
                    input.installation_id, input.glossary_id, input.study_id
                );
                cancel_scope(&prefix)?;
                storage::delete(&root, &input.study_id)
            }
            _ => Err("Unknown research storage operation.".into()),
        }
    })
    .await
    .map_err(|e| format!("Research storage worker failed: {e}"))?
}

struct Work {
    cancel: Arc<AtomicBool>,
    consumers: HashSet<String>,
    result: Option<Result<Value, String>>,
    metrics: Value,
}
#[derive(Default)]
struct JobRegistry {
    consumers: HashMap<String, String>,
    work: HashMap<String, Work>,
}
static JOBS: OnceLock<Mutex<JobRegistry>> = OnceLock::new();
fn jobs() -> &'static Mutex<JobRegistry> {
    JOBS.get_or_init(|| Mutex::new(JobRegistry::default()))
}

fn claim_job(identity: String) -> Result<(String, bool, Arc<AtomicBool>), String> {
    let mut map = jobs().lock().map_err(|_| "Research jobs are busy.")?;
    let id = uuid::Uuid::now_v7().to_string();
    let start_worker = !map.work.contains_key(&identity);
    let work = map.work.entry(identity.clone()).or_insert_with(|| Work {
        cancel: Arc::new(AtomicBool::new(false)),
        consumers: HashSet::new(),
        result: None,
        metrics: json!({}),
    });
    // A blocking provider call may still be running after Pause. Reattach to
    // that execution, with a fresh handle that old polls cannot consume.
    if work.cancel.swap(false, Ordering::AcqRel) {
        work.metrics["resumedInFlight"] = json!(true);
    }
    work.consumers.insert(id.clone());
    let cancel = work.cancel.clone();
    map.consumers.insert(id.clone(), identity);
    Ok((id, start_worker, cancel))
}

fn cancel_scope(prefix: &str) -> Result<(), String> {
    let mut map = jobs().lock().map_err(|_| "Research jobs are busy.")?;
    map.work.retain(|identity, work| {
        if identity.starts_with(prefix) {
            work.cancel.store(true, Ordering::Release);
            false
        } else {
            true
        }
    });
    map.consumers
        .retain(|_, identity| !identity.starts_with(prefix));
    Ok(())
}

// None means the old worker observed cancellation before it started, but a
// caller has since resumed. Retry within this execution instead of publishing
// that obsolete cancellation into the new handle.
fn finish_job(
    identity: &str,
    cancel: &Arc<AtomicBool>,
    result: Result<Value, String>,
    metrics: Value,
) -> Result<Option<Vec<String>>, String> {
    let mut map = jobs().lock().map_err(|_| "Research jobs are busy.")?;
    let Some(work) = map.work.get_mut(identity) else {
        return Ok(Some(Vec::new()));
    };
    if !Arc::ptr_eq(cancel, &work.cancel) {
        return Ok(Some(Vec::new()));
    }
    if work.consumers.is_empty() {
        map.work.remove(identity);
        return Ok(Some(Vec::new()));
    }
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "Research paused.")
    {
        return Ok(None);
    }
    let resumed = work.metrics["resumedInFlight"] == true;
    work.result = Some(result);
    work.metrics = metrics;
    if resumed {
        work.metrics["resumedInFlight"] = json!(true);
    }
    Ok(Some(work.consumers.iter().cloned().collect()))
}

pub(crate) fn validate_term_id(id: &str) -> Result<(), String> {
    storage::safe_id(id).map(|_| ())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolInput {
    pub installation_id: i64,
    pub glossary_id: String,
    pub study_id: String,
    pub step: String,
    pub signature: String,
    pub kind: String,
    pub payload: Value,
}

#[tauri::command]
pub(crate) fn start_glossary_studio_tool(
    app: AppHandle,
    input: ToolInput,
) -> Result<String, String> {
    storage::safe_id(&input.glossary_id)?;
    storage::safe_id(&input.study_id)?;
    use sha2::{Digest, Sha256};
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!({"kind":input.kind,"payload":input.payload}))
                .map_err(|e| e.to_string())?
        )
    );
    let identity = format!(
        "{}:{}:{}:{}",
        input.installation_id, input.glossary_id, input.study_id, fingerprint
    );
    let study_root = storage::root(&app, input.installation_id, &input.glossary_id)?;
    if !study_root
        .join(format!("{}.json", input.study_id))
        .is_file()
    {
        return Err("This research was deleted. Start a new study.".into());
    }
    let cache = study_root.join(&input.study_id).join("tools");
    let (id, start_worker, cancel) = claim_job(identity.clone())?;
    if !start_worker {
        return Ok(id);
    }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        loop {
            let mut metrics = json!({"toolCacheHit": false});
            let worker_app = app.clone();
            let worker_input = input.clone();
            let worker_cancel = cancel.clone();
            let mut result = if cache.join(format!("{fingerprint}.json")).exists() {
                metrics["toolCacheHit"] = json!(true);
                storage::read(&cache, &fingerprint).map(|value| value["result"].clone())
            } else if input.kind == "dle" {
                match dle::glossary_studio_fetch_dle(
                    app.clone(),
                    input.payload["path"].as_str().unwrap_or("").to_string(),
                )
                .await
                {
                    Ok(value) => serde_json::to_value(value).map_err(|e| e.to_string()),
                    Err(error) => Err(error),
                }
            } else {
                match tauri::async_runtime::spawn_blocking(move || {
                    let mut metrics = json!({"toolCacheHit": false});
                    let result =
                        tools::run(&worker_app, &worker_input, &worker_cancel, &mut metrics);
                    (result, metrics)
                })
                .await
                {
                    Ok((result, worker_metrics)) => {
                        metrics = worker_metrics;
                        result
                    }
                    Err(error) => Err(format!("Research worker failed: {error}")),
                }
            };
            metrics["executionMs"] = json!(started.elapsed().as_millis());
            // A cache read must not replace the original execution's usage/timing.
            if let (Ok(value), false) = (&result, metrics["toolCacheHit"] == true) {
                let cache_value =
                    json!({"schemaVersion":1,"id":fingerprint,"result":value,"metrics":metrics});
                if let Err(error) =
                    storage::save_tool_result(&study_root, &input.study_id, &cache_value)
                {
                    result = Err(error);
                }
            }
            let succeeded = result.is_ok();
            match finish_job(&identity, &cancel, result, metrics) {
                Ok(None) => continue,
                Ok(Some(consumers)) => {
                    for job_id in consumers {
                        let _ = app.emit("glossary-research-studio-progress", json!({
                            "jobId":job_id,"installationId":input.installation_id,"glossaryId":input.glossary_id,
                            "studyId":input.study_id,"step":input.step,"signature":input.signature,
                            "status":if succeeded {"complete"} else {"failed"}
                        }));
                    }
                }
                Err(_) => {}
            }
            break;
        }
    });
    Ok(id)
}

#[tauri::command]
pub(crate) fn glossary_studio_job(job_id: String, cancel: bool) -> Result<Value, String> {
    let mut map = jobs().lock().map_err(|_| "Research jobs are busy.")?;
    if cancel {
        if let Some(identity) = map.consumers.remove(&job_id) {
            if let Some(work) = map.work.get_mut(&identity) {
                work.consumers.remove(&job_id);
                if work.consumers.is_empty() {
                    work.cancel.store(true, Ordering::Release);
                    // Running work retains its identity for an immediate resume.
                    if work.result.is_some() {
                        map.work.remove(&identity);
                    }
                }
            }
        }
        return Ok(json!({"complete":true,"cancelled":true}));
    }
    let identity = map
        .consumers
        .get(&job_id)
        .cloned()
        .ok_or("Research was interrupted. Resume the saved study.")?;
    let work = map
        .work
        .get_mut(&identity)
        .ok_or("Research was interrupted. Resume the saved study.")?;
    if let Some(result) = work.result.clone() {
        let metrics = work.metrics.clone();
        work.consumers.remove(&job_id);
        if work.consumers.is_empty() {
            map.work.remove(&identity);
        }
        map.consumers.remove(&job_id);
        return result.map(|value| json!({"complete":true,"value":value,"metrics":metrics}));
    }
    Ok(json!({"complete":false}))
}

#[cfg(test)]
mod job_tests {
    use super::*;

    #[test]
    fn immediate_resume_reuses_the_running_execution_with_a_new_consumer() {
        let identity = uuid::Uuid::now_v7().to_string();
        let (first, new, cancel) = claim_job(identity.clone()).unwrap();
        assert!(new);
        glossary_studio_job(first.clone(), true).unwrap();
        assert!(cancel.load(Ordering::Acquire));
        let (resumed, new, resumed_cancel) = claim_job(identity.clone()).unwrap();
        assert!(
            !new,
            "an identical resume must not start a second AI execution"
        );
        assert_ne!(
            first, resumed,
            "old polls must not consume the resumed handle's result"
        );
        assert!(Arc::ptr_eq(&cancel, &resumed_cancel));
        assert!(!cancel.load(Ordering::Acquire));
        assert!(glossary_studio_job(first, false).is_err());
        let result = json!({"ok":true});
        let recipients = finish_job(&identity, &cancel, Ok(result.clone()), json!({}))
            .unwrap()
            .unwrap();
        assert_eq!(recipients, vec![resumed.clone()]);
        let receipt = glossary_studio_job(resumed, false).unwrap();
        assert_eq!(receipt["value"], result);
        assert_eq!(receipt["metrics"]["resumedInFlight"], true);
        assert!(!jobs().lock().unwrap().work.contains_key(&identity));
    }

    #[test]
    fn cancelling_an_absent_job_is_idempotent_but_polling_still_reports_interruption() {
        let id = uuid::Uuid::now_v7().to_string();
        assert!(glossary_studio_job(id.clone(), true).unwrap()["complete"] == true);
        assert!(glossary_studio_job(id, false).is_err());
    }

    #[test]
    fn cancellation_discards_consumers_and_cleans_up_when_their_worker_finishes() {
        for result in [
            None,
            Some(Ok(json!({"ok":true}))),
            Some(Err("AI failed".into())),
        ] {
            let identity = uuid::Uuid::now_v7().to_string();
            let (id, _, cancel) = claim_job(identity.clone()).unwrap();
            let finished = result.is_some();
            if let Some(result) = result {
                finish_job(&identity, &cancel, result, json!({})).unwrap();
            }
            assert!(glossary_studio_job(id.clone(), true).unwrap()["complete"] == true);
            assert!(cancel.load(Ordering::Acquire));
            assert!(!jobs().lock().unwrap().consumers.contains_key(&id));
            assert_eq!(
                jobs().lock().unwrap().work.contains_key(&identity),
                !finished
            );
            assert!(glossary_studio_job(id.clone(), false).is_err());
            assert!(glossary_studio_job(id, true).is_ok());
            if !finished {
                finish_job(
                    &identity,
                    &cancel,
                    Err("Research paused.".into()),
                    json!({}),
                )
                .unwrap();
            }
            assert!(!jobs().lock().unwrap().work.contains_key(&identity));
        }
    }

    #[test]
    fn completed_jobs_return_diagnostics_without_changing_the_tool_result() {
        let identity = uuid::Uuid::now_v7().to_string();
        let (id, _, cancel) = claim_job(identity.clone()).unwrap();
        let result = json!({"choices":[{"passed":true}]});
        let metrics = json!({"executionMs":1234,"toolCacheHit":false,
            "usage":{"input_tokens":120,"output_tokens":30}});
        finish_job(&identity, &cancel, Ok(result.clone()), metrics.clone()).unwrap();
        let receipt = glossary_studio_job(id.clone(), false).unwrap();
        assert_eq!(receipt["value"], result);
        assert_eq!(receipt["metrics"], metrics);
        assert!(glossary_studio_job(id, false).is_err());
    }

    #[test]
    fn cancelling_one_consumer_does_not_cancel_or_consume_another_consumers_result() {
        let identity = uuid::Uuid::now_v7().to_string();
        let (first, _, cancel) = claim_job(identity.clone()).unwrap();
        let (second, new, _) = claim_job(identity.clone()).unwrap();
        assert!(!new);
        glossary_studio_job(first.clone(), true).unwrap();
        assert!(!cancel.load(Ordering::Acquire));
        finish_job(&identity, &cancel, Ok(json!({"answer":42})), json!({})).unwrap();
        assert!(glossary_studio_job(first, false).is_err());
        assert_eq!(
            glossary_studio_job(second, false).unwrap()["value"]["answer"],
            42
        );
    }

    #[test]
    fn a_resumed_worker_retries_an_obsolete_pre_start_cancellation() {
        let identity = uuid::Uuid::now_v7().to_string();
        let (first, _, cancel) = claim_job(identity.clone()).unwrap();
        glossary_studio_job(first, true).unwrap();
        let (resumed, new, _) = claim_job(identity.clone()).unwrap();
        assert!(!new);
        assert!(finish_job(
            &identity,
            &cancel,
            Err("Research paused.".into()),
            json!({})
        )
        .unwrap()
        .is_none());
        assert_eq!(
            glossary_studio_job(resumed.clone(), false).unwrap()["complete"],
            false
        );
        finish_job(&identity, &cancel, Ok(json!({"ok":true})), json!({})).unwrap();
        assert_eq!(
            glossary_studio_job(resumed, false).unwrap()["value"]["ok"],
            true
        );
    }

    #[test]
    fn scope_cancellation_is_isolated_and_old_workers_cannot_publish_into_recreated_work() {
        let team = uuid::Uuid::now_v7().to_string();
        let prefix = format!("{team}:g:s:");
        let identity = format!("{prefix}request");
        let other_identity = format!("{team}:g:other:request");
        let (old, _, old_cancel) = claim_job(identity.clone()).unwrap();
        let (other, _, other_cancel) = claim_job(other_identity.clone()).unwrap();
        cancel_scope(&prefix).unwrap();
        assert!(old_cancel.load(Ordering::Acquire));
        assert!(!other_cancel.load(Ordering::Acquire));
        assert!(glossary_studio_job(old, false).is_err());
        let (fresh, new, fresh_cancel) = claim_job(identity.clone()).unwrap();
        assert!(new);
        assert!(
            finish_job(&identity, &old_cancel, Ok(json!({"stale":true})), json!({}))
                .unwrap()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            glossary_studio_job(fresh.clone(), false).unwrap()["complete"],
            false
        );
        finish_job(
            &identity,
            &fresh_cancel,
            Ok(json!({"fresh":true})),
            json!({}),
        )
        .unwrap();
        assert_eq!(
            glossary_studio_job(fresh, false).unwrap()["value"]["fresh"],
            true
        );
        finish_job(
            &other_identity,
            &other_cancel,
            Ok(json!({"other":true})),
            json!({}),
        )
        .unwrap();
        assert_eq!(
            glossary_studio_job(other, false).unwrap()["value"]["other"],
            true
        );
    }
}
