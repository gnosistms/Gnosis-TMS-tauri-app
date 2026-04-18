use super::*;

pub(super) fn list_local_metadata_records<T>(repo_path: &Path, kind: &str) -> Result<Vec<T>, String>
where
    T: DeserializeOwned,
{
    let directory_path = resource_directory_path(repo_path, kind);
    if !directory_path.exists() {
        return Ok(Vec::new());
    }

    let mut file_paths = fs::read_dir(&directory_path)
        .map_err(|error| {
            format!(
                "Could not list the local team-metadata {} directory '{}': {error}",
                kind,
                directory_path.display()
            )
        })?
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    file_paths.sort();

    file_paths
        .into_iter()
        .map(|path| {
            let contents = fs::read_to_string(&path).map_err(|error| {
                format!(
                    "Could not read the local team-metadata file '{}': {error}",
                    path.display()
                )
            })?;
            serde_json::from_str::<T>(&contents).map_err(|error| {
                format!(
                    "Could not parse the local team-metadata file '{}': {error}",
                    path.display()
                )
            })
        })
        .collect()
}

pub(super) fn local_record_has_tombstone(
    repo_path: &Path,
    kind: &str,
    resource_id: &str,
) -> Result<bool, String> {
    let normalized_resource_id = resource_id.trim();
    if normalized_resource_id.is_empty() {
        return Err("Could not determine which team-metadata record to inspect.".to_string());
    }

    let record_path = resource_record_path(repo_path, kind, normalized_resource_id);
    if !record_path.exists() {
        return Ok(false);
    }

    let record_contents = fs::read_to_string(&record_path).map_err(|error| {
        format!(
            "Could not read the local team-metadata file '{}': {error}",
            record_path.display()
        )
    })?;
    let record_value: Value = serde_json::from_str(&record_contents).map_err(|error| {
        format!(
            "Could not parse the local team-metadata file '{}': {error}",
            record_path.display()
        )
    })?;

    Ok(record_value
        .get("recordState")
        .and_then(Value::as_str)
        .map(|value| value.trim() == "tombstone")
        .unwrap_or(false))
}

pub(super) fn read_json_object(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Could not read the local team-metadata file '{}': {error}",
            path.display()
        )
    })?;
    let value = serde_json::from_str::<Value>(&contents).map_err(|error| {
        format!(
            "Could not parse the local team-metadata file '{}': {error}",
            path.display()
        )
    })?;

    match value {
        Value::Object(map) => Ok(Some(map)),
        _ => Err(format!(
            "The local team-metadata file '{}' does not contain a JSON object.",
            path.display()
        )),
    }
}
