use super::*;

pub(super) struct TolerantRecordListing<T> {
    pub(super) records: Vec<T>,
    /// File stems of record files that could not be read or parsed. A corrupt record
    /// must not take down the whole listing (or the repair scan, which uses the same
    /// listing) — callers report these through the non-fatal telemetry event.
    pub(super) skipped_record_files: Vec<String>,
}

pub(super) fn list_local_metadata_records<T>(
    repo_path: &Path,
    kind: &str,
) -> Result<TolerantRecordListing<T>, String>
where
    T: DeserializeOwned,
{
    let directory_path = resource_directory_path(repo_path, kind);
    if !directory_path.exists() {
        return Ok(TolerantRecordListing {
            records: Vec::new(),
            skipped_record_files: Vec::new(),
        });
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

    let mut records = Vec::with_capacity(file_paths.len());
    let mut skipped_record_files = Vec::new();
    for path in file_paths {
        let parsed = fs::read_to_string(&path)
            .ok()
            .and_then(|contents| serde_json::from_str::<T>(&contents).ok());
        match parsed {
            Some(record) => records.push(record),
            None => skipped_record_files.push(
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
            ),
        }
    }

    Ok(TolerantRecordListing {
        records,
        skipped_record_files,
    })
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

    let record_path = resource_record_path(repo_path, kind, normalized_resource_id)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn listing_skips_corrupt_record_files_and_reports_them() {
        let repo_path =
            std::env::temp_dir().join(format!("gnosis-team-metadata-records-{}", Uuid::now_v7()));
        let records_dir = resource_directory_path(&repo_path, "project");
        fs::create_dir_all(&records_dir).expect("create records dir");
        fs::write(
            records_dir.join("good.json"),
            r#"{"id":"good","name":"Project"}"#,
        )
        .expect("write good record");
        fs::write(records_dir.join("torn.json"), r#"{"id":"to"#).expect("write torn record");

        #[derive(serde::Deserialize)]
        struct TestRecord {
            id: String,
        }

        let listing = list_local_metadata_records::<TestRecord>(&repo_path, "project")
            .expect("listing should tolerate the corrupt record");
        assert_eq!(
            listing
                .records
                .iter()
                .map(|record| record.id.as_str())
                .collect::<Vec<_>>(),
            vec!["good"]
        );
        assert_eq!(listing.skipped_record_files, vec!["torn".to_string()]);

        let _ = fs::remove_dir_all(repo_path);
    }
}
