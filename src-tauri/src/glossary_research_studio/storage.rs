use crate::storage_paths::installation_data_dir;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;

static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 120
        || id.starts_with('.')
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid research study identifier.".into());
    }
    Ok(id)
}

pub(super) fn root(app: &AppHandle, installation: i64, glossary: &str) -> Result<PathBuf, String> {
    Ok(installation_data_dir(app, installation)?
        .join("research-studio")
        .join(safe_id(glossary)?))
}

pub(super) fn read(root: &Path, id: &str) -> Result<Value, String> {
    super::evidence::expand(root, id, read_manifest(root, id)?)
}

pub(super) fn export(root: &Path, id: &str, output: &Path) -> Result<Value, String> {
    if !output.is_absolute() || output.file_name().is_none() || output.is_dir() {
        return Err("Choose a file location for the research export.".into());
    }
    let value = read(root, id)?;
    crate::repo_resource_storage::write_json_pretty(output, &value)
        .map_err(|error| format!("Could not export research: {error}"))?;
    Ok(Value::Null)
}

pub(super) fn read_manifest(root: &Path, id: &str) -> Result<Value, String> {
    let path = root.join(format!("{}.json", safe_id(id)?));
    let text =
        fs::read_to_string(&path).map_err(|e| format!("Could not read saved research: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Saved research could not be read: {e}"))
}

pub(super) fn write_artifacts(root: &Path, id: &str, values: &Value) -> Result<Value, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Research storage is busy.".to_string())?;
    if !root.join(format!("{}.json", safe_id(id)?)).is_file() {
        return Err("This research was deleted. Its evidence was not recreated.".into());
    }
    super::evidence::write(root, id, values)
}

pub(super) fn save(root: &Path, value: &Value, expected: Option<u64>) -> Result<Value, String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Research storage is busy.".to_string())?;
    save_locked(root, value, expected)
}

pub(super) fn save_receipt(
    root: &Path,
    value: &Value,
    expected: Option<u64>,
) -> Result<Value, String> {
    let saved = save(root, value, expected)?;
    Ok(serde_json::json!({
        "id": saved["id"],
        "revision": saved["revision"],
        "updatedAt": saved["updatedAt"],
    }))
}

fn save_locked(root: &Path, value: &Value, expected: Option<u64>) -> Result<Value, String> {
    let id = safe_id(value["id"].as_str().ok_or("Research has no ID.")?)?;
    if value["schemaVersion"] != 1 {
        return Err("Unsupported research data version.".into());
    }
    let path = root.join(format!("{id}.json"));
    let previous = if path.exists() {
        read_manifest(root, id)?
    } else {
        if expected.is_some_and(|revision| revision > 0) {
            return Err(
                "This research was deleted in another window. Its files were not recreated.".into(),
            );
        }
        serde_json::json!({"revision":0})
    };
    let revision = previous["revision"].as_u64().unwrap_or(0);
    if expected.is_some_and(|r| r != revision) {
        return Err("This research was changed in another window. Reopen it before saving.".into());
    }
    if value["_storageVersion"] == 2 && previous["_storageVersion"] != 2 && path.exists() {
        let archive = root.join(id).join("legacy");
        fs::create_dir_all(&archive).map_err(|e| e.to_string())?;
        let backup = archive.join(format!("revision-{revision}.json"));
        if !backup.exists() {
            fs::copy(&path, backup)
                .map_err(|e| format!("Could not preserve original research: {e}"))?;
        }
    }
    let mut value = value.clone();
    value["revision"] = (revision + 1).into();
    fs::create_dir_all(root).map_err(|e| format!("Could not create research storage: {e}"))?;
    let tmp = root.join(format!("{id}.json.tmp"));
    let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| format!("Could not save research: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not finish saving research: {e}"))?;
    Ok(value)
}

pub(super) fn save_tool_result(root: &Path, study_id: &str, value: &Value) -> Result<(), String> {
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Research storage is busy.".to_string())?;
    if !root.join(format!("{}.json", safe_id(study_id)?)).is_file() {
        // A tool may finish after its study has been deleted in another window.
        return Ok(());
    }
    save_locked(&root.join(study_id).join("tools"), value, None).map(|_| ())
}

pub(super) fn delete(root: &Path, id: &str) -> Result<Value, String> {
    let id = safe_id(id)?;
    let _lock = WRITE_LOCK
        .lock()
        .map_err(|_| "Research storage is busy.".to_string())?;
    if !root.exists() {
        return Ok(Value::Null);
    }
    // Detach surviving studies; deleting a study never deletes another study.
    let mut linked = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("Could not read saved research: {e}"))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(other) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if other == id {
            continue;
        }
        let mut study = read_manifest(root, other)?;
        let mut changed = false;
        if study["parentId"] == id {
            if let Some(object) = study.as_object_mut() {
                object.remove("parentId");
                object.remove("queueItemId");
            }
            changed = true;
        }
        if let Some(queue) = study["queue"].as_array_mut() {
            for item in queue {
                if item["studyId"] == id {
                    if let Some(object) = item.as_object_mut() {
                        object.remove("studyId");
                    }
                    changed = true;
                }
            }
        }
        if changed {
            linked.push(study);
        }
    }
    let cache = root.join(id);
    match fs::remove_dir_all(&cache) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Could not delete research evidence: {e}")),
    }
    for name in [format!("{id}.json.tmp"), format!("{id}.json")] {
        match fs::remove_file(root.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Could not delete saved research: {e}")),
        }
    }
    for study in linked {
        save_locked(root, &study, study["revision"].as_u64())?;
    }
    Ok(Value::Null)
}

pub(super) fn list(root: &Path) -> Result<Value, String> {
    if !root.exists() {
        return Ok(serde_json::json!([]));
    }
    let mut rows = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let value = read_manifest(root, id)?;
        rows.push(serde_json::json!({"id":id,"term":value["scope"]["term"],
            "step":value["step"],"status":value["status"],"updatedAt":value["updatedAt"]}));
    }
    rows.sort_by(|a, b| b["updatedAt"].as_str().cmp(&a["updatedAt"].as_str()));
    Ok(rows.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_ids_and_revision_checks() {
        for id in ["../escape", "", ".hidden", "a/b", "a\\b"] {
            assert!(safe_id(id).is_err());
        }
        let dir = std::env::temp_dir().join(format!("studio-{}", uuid::Uuid::now_v7()));
        let study = serde_json::json!({"id":"test","schemaVersion":1,"revision":0});
        assert_eq!(save(&dir, &study, Some(0)).unwrap()["revision"], 1);
        assert!(save(&dir, &study, Some(0)).is_err());
        assert_eq!(read(&dir, "test").unwrap()["revision"], 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_receipt_is_small_and_preserves_durable_evidence_and_revision_checks() {
        let dir = std::env::temp_dir().join(format!("studio-receipt-{}", uuid::Uuid::now_v7()));
        let study = serde_json::json!({
            "id": "receipt", "schemaVersion": 1, "revision": 0,
            "updatedAt": "2026-10-16T00:00:00.000Z",
            "passages": [{"id":"p", "text":"full evidence ".repeat(10_000)}],
            "testHistory": [{"passed":true, "translation":"complete paragraph"}],
        });
        let receipt = save_receipt(&dir, &study, Some(0)).unwrap();
        assert_eq!(receipt["id"], "receipt");
        assert_eq!(receipt["revision"], 1);
        assert_eq!(receipt["updatedAt"], study["updatedAt"]);
        assert!(serde_json::to_vec(&receipt).unwrap().len() < 200);
        let saved = read(&dir, "receipt").unwrap();
        assert_eq!(saved["passages"], study["passages"]);
        assert_eq!(saved["testHistory"], study["testHistory"]);
        assert_eq!(saved["revision"], 1);
        assert!(save_receipt(&dir, &study, Some(0)).is_err());
        assert_eq!(read(&dir, "receipt").unwrap(), saved);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deletion_removes_only_selected_files_and_rejects_late_writes() {
        let dir = std::env::temp_dir().join(format!("studio-delete-{}", uuid::Uuid::now_v7()));
        let study = serde_json::json!({"id":"selected","schemaVersion":1,"revision":0});
        let saved = save(&dir, &study, Some(0)).unwrap();
        let other = serde_json::json!({"id":"other","schemaVersion":1});
        save(&dir, &other, Some(0)).unwrap();
        let artifact = serde_json::json!({"id":"evidence","schemaVersion":1,"result":"witness"});
        save_tool_result(&dir, "selected", &artifact).unwrap();
        save_tool_result(&dir, "other", &artifact).unwrap();
        fs::write(dir.join("selected.json.tmp"), "unfinished").unwrap();
        assert!(delete(&dir, "../escape").is_err());
        delete(&dir, "selected").unwrap();
        assert!(!dir.join("selected.json").exists());
        assert!(!dir.join("selected.json.tmp").exists());
        assert!(!dir.join("selected").exists());
        assert!(dir.join("other/tools/evidence.json").exists());
        assert!(save(&dir, &saved, saved["revision"].as_u64()).is_err());
        save_tool_result(&dir, "selected", &artifact).unwrap();
        assert!(!dir.join("selected").exists());
        delete(&dir, "selected").unwrap(); // Retry is harmless.
        assert_eq!(list(&dir).unwrap().as_array().unwrap().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn deleting_split_studies_detaches_links_and_preserves_other_research() {
        let dir = std::env::temp_dir().join(format!("studio-links-{}", uuid::Uuid::now_v7()));
        save(
            &dir,
            &serde_json::json!({"id":"parent","schemaVersion":1,
            "queue":[{"id":"split","studyId":"child","status":"queued","forms":["worlds"]}]}),
            Some(0),
        )
        .unwrap();
        save(
            &dir,
            &serde_json::json!({"id":"child","schemaVersion":1,
            "parentId":"parent","queueItemId":"split","passages":["witness"]}),
            Some(0),
        )
        .unwrap();
        delete(&dir, "child").unwrap();
        let parent = read(&dir, "parent").unwrap();
        assert!(parent["queue"][0].get("studyId").is_none());
        assert_eq!(parent["queue"][0]["status"], "queued");
        assert_eq!(parent["revision"], 2);
        save(
            &dir,
            &serde_json::json!({"id":"child","schemaVersion":1,
            "parentId":"parent","queueItemId":"split","passages":["witness"]}),
            Some(0),
        )
        .unwrap();
        delete(&dir, "parent").unwrap();
        let child = read(&dir, "child").unwrap();
        assert!(child.get("parentId").is_none());
        assert!(child.get("queueItemId").is_none());
        assert_eq!(child["passages"][0], "witness");
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod piece_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn export_writes_complete_json_to_the_selected_file_and_preserves_the_study() {
        let dir = std::env::temp_dir().join(format!("studio-export-{}", uuid::Uuid::now_v7()));
        let original = save(&dir, &json!({"schemaVersion":1,"id":"s","scope":{"term":"ilustre"},"evidence":"Complete quoted evidence"}), Some(0)).unwrap();
        let refs = write_artifacts(&dir, "s", &json!([original["evidence"]])).unwrap();
        let mut next = original.clone();
        next["_storageVersion"] = 2.into();
        next["evidence"] = refs[0].clone();
        save_receipt(&dir, &next, Some(1)).unwrap();
        let before = read(&dir, "s").unwrap();
        let selected = dir.join("chosen folder").join("ilustre.json");
        export(&dir, "s", &selected).unwrap();
        let exported: Value = serde_json::from_slice(&fs::read(&selected).unwrap()).unwrap();
        assert_eq!(exported, before);
        assert_eq!(exported["evidence"], "Complete quoted evidence");
        assert_eq!(read(&dir, "s").unwrap(), before);
        assert!(export(&dir, "s", Path::new("relative.json")).is_err());
        assert!(export(&dir, "s", &dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn manifest_migration_preserves_original_and_history_does_not_read_evidence() {
        let dir = std::env::temp_dir().join(format!("studio-manifest-{}", uuid::Uuid::now_v7()));
        let old = save(&dir,&json!({"schemaVersion":1,"id":"s","scope":{"term":"tenebroso"},"step":"4.5","evidence":"Original complete evidence"}),Some(0)).unwrap();
        let refs = write_artifacts(&dir, "s", &json!([old["evidence"]])).unwrap();
        assert_eq!(
            read(&dir, "s").unwrap(),
            old,
            "writing pieces alone cannot change the checkpoint"
        );
        let mut next = old.clone();
        next["_storageVersion"] = 2.into();
        next["evidence"] = refs[0].clone();
        let receipt = save_receipt(&dir, &next, Some(1)).unwrap();
        assert_eq!(receipt["revision"], 2);
        assert_eq!(read(&dir, "s").unwrap()["evidence"], old["evidence"]);
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(dir.join("s/legacy/revision-1.json")).unwrap()
            )
            .unwrap(),
            old
        );
        assert!(save_receipt(&dir, &next, Some(1)).is_err());
        fs::remove_dir_all(dir.join("s/evidence")).unwrap();
        assert_eq!(list(&dir).unwrap()[0]["term"], "tenebroso");
        assert!(
            read(&dir, "s").is_err(),
            "missing evidence must never silently become a summary"
        );
        delete(&dir, "s").unwrap();
        assert!(write_artifacts(&dir, "s", &json!(["late result"])).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
