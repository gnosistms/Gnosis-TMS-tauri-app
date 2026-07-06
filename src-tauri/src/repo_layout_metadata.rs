use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::util::atomic_replace;

pub(crate) const REPO_METADATA_RELATIVE_PATH: &str = ".gtms/repo.json";
pub(crate) const REPO_METADATA_SCHEMA_VERSION: u32 = 1;
pub(crate) const STORAGE_LAYOUT_VERSION_V2: u32 = 2;
pub(crate) const MIGRATION_0810: &str = "0.8.10";
// Content-only chapter settings normalization (drops legacy non-object
// `settings`/`linked_glossaries` shapes and `glossary_1`/`glossary_2` keys).
// Unlike 0.8.10 it is git-mergeable and runs inline during project repo sync.
pub(crate) const MIGRATION_0856: &str = "0.8.56";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RepoKind {
    Project,
    Glossary,
    QaList,
}

impl RepoKind {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Glossary => "glossary",
            Self::QaList => "qaList",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "project" => Some(Self::Project),
            "glossary" => Some(Self::Glossary),
            "qaList" | "qa_list" | "qa-list" => Some(Self::QaList),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RepoLayoutMetadata {
    pub(crate) schema_version: u32,
    pub(crate) repo_kind: RepoKind,
    pub(crate) storage_layout_version: u32,
    pub(crate) applied_migrations: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoLayoutMetadataFile {
    schema_version: u32,
    repo_kind: String,
    #[serde(default)]
    storage_layout_version: u32,
    #[serde(default)]
    applied_migrations: Vec<String>,
}

pub(crate) fn new_v2_repo_layout_metadata(repo_kind: RepoKind) -> RepoLayoutMetadata {
    RepoLayoutMetadata {
        schema_version: REPO_METADATA_SCHEMA_VERSION,
        repo_kind,
        storage_layout_version: STORAGE_LAYOUT_VERSION_V2,
        applied_migrations: vec![MIGRATION_0810.to_string()],
    }
}

pub(crate) fn repo_metadata_path(repo_path: &Path) -> std::path::PathBuf {
    repo_path.join(REPO_METADATA_RELATIVE_PATH)
}

pub(crate) fn read_repo_layout_metadata(
    repo_path: &Path,
) -> Result<Option<RepoLayoutMetadata>, String> {
    let metadata_path = repo_metadata_path(repo_path);
    if !metadata_path.exists() {
        return Ok(None);
    }
    parse_repo_layout_metadata_bytes(&fs::read(&metadata_path).map_err(|error| {
        format!(
            "Could not read repo layout metadata '{}': {error}",
            metadata_path.display()
        )
    })?)
    .map(Some)
}

pub(crate) fn write_repo_layout_metadata(
    repo_path: &Path,
    metadata: &RepoLayoutMetadata,
) -> Result<(), String> {
    let metadata_path = repo_metadata_path(repo_path);
    if let Some(parent) = metadata_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create repo metadata folder '{}': {error}",
                parent.display()
            )
        })?;
    }
    let bytes = serialize_repo_layout_metadata(metadata)?;
    let tmp_path = metadata_path.with_extension("json.tmp");
    fs::write(&tmp_path, bytes).map_err(|error| {
        format!(
            "Could not write repo layout metadata temp file '{}': {error}",
            tmp_path.display()
        )
    })?;
    atomic_replace(&tmp_path, &metadata_path).map_err(|error| {
        format!(
            "Could not write repo layout metadata '{}': {error}",
            metadata_path.display()
        )
    })
}

pub(crate) fn parse_repo_layout_metadata_bytes(bytes: &[u8]) -> Result<RepoLayoutMetadata, String> {
    let file: RepoLayoutMetadataFile = serde_json::from_slice(bytes)
        .map_err(|error| format!("Could not parse repo layout metadata: {error}"))?;
    if file.schema_version != REPO_METADATA_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported repo metadata schema version {}.",
            file.schema_version
        ));
    }
    let repo_kind = RepoKind::parse(&file.repo_kind)
        .ok_or_else(|| format!("Unsupported repo kind '{}'.", file.repo_kind))?;
    Ok(RepoLayoutMetadata {
        schema_version: file.schema_version,
        repo_kind,
        storage_layout_version: file.storage_layout_version,
        applied_migrations: normalize_applied_migrations(file.applied_migrations),
    })
}

pub(crate) fn serialize_repo_layout_metadata(
    metadata: &RepoLayoutMetadata,
) -> Result<Vec<u8>, String> {
    if metadata.schema_version != REPO_METADATA_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported repo metadata schema version {}.",
            metadata.schema_version
        ));
    }
    let file = RepoLayoutMetadataFile {
        schema_version: metadata.schema_version,
        repo_kind: metadata.repo_kind.as_str().to_string(),
        storage_layout_version: metadata.storage_layout_version,
        applied_migrations: normalize_applied_migrations(metadata.applied_migrations.clone()),
    };
    let mut bytes = serde_json::to_vec_pretty(&file)
        .map_err(|error| format!("Could not serialize repo layout metadata: {error}"))?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub(crate) fn normalize_repo_kind(value: &str) -> Option<&'static str> {
    RepoKind::parse(value).map(|kind| kind.as_str())
}

fn normalize_applied_migrations(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() || normalized.iter().any(|entry| entry == value) {
            continue;
        }
        normalized.push(value.to_string());
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_layout_metadata_round_trips() {
        let metadata = new_v2_repo_layout_metadata(RepoKind::Project);
        let bytes = serialize_repo_layout_metadata(&metadata).expect("serialize metadata");
        assert_eq!(
            parse_repo_layout_metadata_bytes(&bytes).expect("parse metadata"),
            metadata
        );
    }

    #[test]
    fn repo_kind_accepts_qa_aliases() {
        assert_eq!(normalize_repo_kind("qaList"), Some("qaList"));
        assert_eq!(normalize_repo_kind("qa_list"), Some("qaList"));
        assert_eq!(normalize_repo_kind("qa-list"), Some("qaList"));
    }

    #[test]
    fn invalid_repo_kind_fails() {
        let error = parse_repo_layout_metadata_bytes(
            br#"{"schemaVersion":1,"repoKind":"book","storageLayoutVersion":2}"#,
        )
        .expect_err("invalid kind should fail");
        assert!(error.contains("Unsupported repo kind"));
    }
}
