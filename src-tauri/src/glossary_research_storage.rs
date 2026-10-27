//! Local storage for Glossary Research runs (never synced; this computer only).
//!
//! Layout: <installation>/research/<glossary-id>/<run-id>/<stage>.json
//! Each stage file is a checkpoint, so an interrupted run can resume and a
//! finished report can be reopened without new AI calls.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::storage_paths::installation_data_dir;

fn safe_name(value: &str, what: &str) -> Result<String, String> {
    let ok = !value.is_empty()
        && value.len() <= 120
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !value.starts_with('.');
    if ok {
        Ok(value.to_string())
    } else {
        Err(format!("Invalid research {what} '{value}'."))
    }
}

fn research_root(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
    Ok(installation_data_dir(app, installation_id)?.join("research"))
}

fn run_dir(root: &Path, glossary_id: &str, run_id: &str) -> Result<PathBuf, String> {
    Ok(root
        .join(safe_name(glossary_id, "glossary id")?)
        .join(safe_name(run_id, "run id")?))
}

fn write_atomically(path: &Path, value: &Value) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
    fs::write(&temporary, text)
        .and_then(|_| fs::rename(&temporary, path))
        .map_err(|error| format!("Could not save research data: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchStageInput {
    pub installation_id: i64,
    pub glossary_id: String,
    pub run_id: String,
    pub stage: String,
    #[serde(default)]
    pub value: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchRunSummary {
    pub run_id: String,
    pub meta: Value,
}

pub(crate) fn save_stage(root: &Path, input: &ResearchStageInput) -> Result<(), String> {
    let dir = run_dir(root, &input.glossary_id, &input.run_id)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the research folder: {error}"))?;
    let path = dir.join(format!("{}.json", safe_name(&input.stage, "stage")?));
    match &input.value {
        Some(value) => write_atomically(&path, value),
        None => match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not clear research data: {error}")),
        },
    }
}

/// All stage files of a run, keyed by stage name.
pub(crate) fn load_run(root: &Path, glossary_id: &str, run_id: &str) -> Result<Value, String> {
    let dir = run_dir(root, glossary_id, run_id)?;
    let mut stages = serde_json::Map::new();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Value::Object(stages))
        }
        Err(error) => return Err(format!("Could not read the research folder: {error}")),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stage) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let text = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read research data: {error}"))?;
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            stages.insert(stage.to_string(), value);
        }
    }
    Ok(Value::Object(stages))
}

/// Runs of one glossary with their `meta` stage, newest first.
pub(crate) fn list_runs(root: &Path, glossary_id: &str) -> Result<Vec<ResearchRunSummary>, String> {
    let dir = root.join(safe_name(glossary_id, "glossary id")?);
    let mut runs = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(runs);
    };
    for entry in entries.flatten() {
        let Some(run_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if safe_name(&run_id, "run id").is_err() {
            continue;
        }
        let meta = fs::read_to_string(entry.path().join("meta.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null);
        runs.push(ResearchRunSummary { run_id, meta });
    }
    runs.sort_by(|a, b| b.run_id.cmp(&a.run_id));
    Ok(runs)
}

pub(crate) fn delete_run(root: &Path, glossary_id: &str, run_id: &str) -> Result<(), String> {
    let dir = run_dir(root, glossary_id, run_id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not delete the research run: {error}")),
    }
}

#[tauri::command]
pub(crate) fn save_glossary_research_stage(
    app: AppHandle,
    input: ResearchStageInput,
) -> Result<(), String> {
    save_stage(&research_root(&app, input.installation_id)?, &input)
}

#[tauri::command]
pub(crate) fn load_glossary_research_run(
    app: AppHandle,
    installation_id: i64,
    glossary_id: String,
    run_id: String,
) -> Result<Value, String> {
    load_run(
        &research_root(&app, installation_id)?,
        &glossary_id,
        &run_id,
    )
}

#[tauri::command]
pub(crate) fn list_glossary_research_runs(
    app: AppHandle,
    installation_id: i64,
    glossary_id: String,
) -> Result<Vec<ResearchRunSummary>, String> {
    list_runs(&research_root(&app, installation_id)?, &glossary_id)
}

#[tauri::command]
pub(crate) fn delete_glossary_research_run(
    app: AppHandle,
    installation_id: i64,
    glossary_id: String,
    run_id: String,
) -> Result<(), String> {
    delete_run(
        &research_root(&app, installation_id)?,
        &glossary_id,
        &run_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(stage: &str, value: Option<Value>) -> ResearchStageInput {
        ResearchStageInput {
            installation_id: 1,
            glossary_id: "g-1".into(),
            run_id: "2026-09-25T10-00-00_fatal".into(),
            stage: stage.into(),
            value,
        }
    }

    #[test]
    fn stages_round_trip_list_and_clear() {
        let root = std::env::temp_dir().join(format!("gtms-research-{}", std::process::id()));
        save_stage(&root, &input("meta", Some(json!({"term": "fatal"})))).unwrap();
        save_stage(
            &root,
            &input("forms", Some(json!({"confirmed": ["fatal"]}))),
        )
        .unwrap();
        let run = load_run(&root, "g-1", "2026-09-25T10-00-00_fatal").unwrap();
        assert_eq!(run["forms"]["confirmed"][0], "fatal");
        save_stage(&root, &input("forms", None)).unwrap();
        let run = load_run(&root, "g-1", "2026-09-25T10-00-00_fatal").unwrap();
        assert!(run.get("forms").is_none());
        let runs = list_runs(&root, "g-1").unwrap();
        assert_eq!(runs[0].meta["term"], "fatal");
        delete_run(&root, "g-1", "2026-09-25T10-00-00_fatal").unwrap();
        assert!(list_runs(&root, "g-1").unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn names_cannot_escape_the_research_folder() {
        let root = std::env::temp_dir();
        assert!(save_stage(&root, &input("../../x", Some(json!(1)))).is_err());
        assert!(load_run(&root, "..", "x").is_err());
        assert!(load_run(&root, "g", "a/b").is_err());
    }
}
