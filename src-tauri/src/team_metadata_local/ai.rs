use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::repo_sync_shared::{git_output, read_current_head_oid};

const TEAM_AI_PROVIDER_IDS: [&str; 4] = ["openai", "gemini", "claude", "deepseek"];

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalTeamAiProviderMetadata {
    configured: bool,
    key_version: i64,
    algorithm: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalTeamAiSecretsMetadata {
    schema_version: i64,
    updated_at: Option<String>,
    updated_by: Option<String>,
    providers: BTreeMap<String, Option<LocalTeamAiProviderMetadata>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamAiMetadataSnapshot {
    current_head_oid: Option<String>,
    settings: Option<Value>,
    secrets: LocalTeamAiSecretsMetadata,
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn positive_integer(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64).filter(|value| *value > 0)
}

fn empty_secrets_metadata() -> LocalTeamAiSecretsMetadata {
    LocalTeamAiSecretsMetadata {
        schema_version: 1,
        updated_at: None,
        updated_by: None,
        providers: TEAM_AI_PROVIDER_IDS
            .into_iter()
            .map(|provider_id| (provider_id.to_string(), None))
            .collect(),
    }
}

fn normalize_settings(value: Option<Value>) -> Result<Option<Value>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if !value.is_object() {
        return Err("The committed team AI settings are malformed.".to_string());
    }
    Ok(Some(value))
}

fn normalize_secrets(value: Option<Value>) -> Result<LocalTeamAiSecretsMetadata, String> {
    let Some(value) = value else {
        return Ok(empty_secrets_metadata());
    };
    let Some(record) = value.as_object() else {
        return Err("The committed team AI secret metadata is malformed.".to_string());
    };
    let provider_values = record.get("providers").and_then(Value::as_object);
    let providers = TEAM_AI_PROVIDER_IDS
        .into_iter()
        .map(|provider_id| {
            let provider = provider_values
                .and_then(|values| values.get(provider_id))
                .and_then(Value::as_object);
            let key_version = provider.and_then(|entry| positive_integer(entry.get("keyVersion")));
            let wrapped_key = provider
                .and_then(|entry| entry.get("brokerWrappedKey"))
                .and_then(Value::as_object);
            let algorithm = wrapped_key.and_then(|entry| optional_string(entry.get("algorithm")));
            let ciphertext_is_present = wrapped_key
                .and_then(|entry| optional_string(entry.get("ciphertext")))
                .is_some();
            let metadata = match (key_version, algorithm, ciphertext_is_present) {
                (Some(key_version), Some(algorithm), true) => Some(LocalTeamAiProviderMetadata {
                    configured: true,
                    key_version,
                    algorithm,
                }),
                _ => None,
            };
            (provider_id.to_string(), metadata)
        })
        .collect();

    Ok(LocalTeamAiSecretsMetadata {
        schema_version: positive_integer(record.get("schemaVersion")).unwrap_or(1),
        updated_at: optional_string(record.get("updatedAt")),
        updated_by: optional_string(record.get("updatedBy")),
        providers,
    })
}

fn read_committed_json(
    repo_path: &Path,
    commit_oid: &str,
    relative_path: &str,
) -> Result<Option<Value>, String> {
    let listed_path = git_output(
        repo_path,
        &["ls-tree", "--name-only", commit_oid, "--", relative_path],
        None,
    )
    .map_err(|_| format!("Could not inspect committed team AI metadata at {commit_oid}."))?;
    if listed_path.trim().is_empty() {
        return Ok(None);
    }
    let revision = format!("{commit_oid}:{relative_path}");
    let contents = git_output(repo_path, &["show", revision.as_str()], None)
        .map_err(|_| format!("Could not read committed team AI metadata from {relative_path}."))?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|_| format!("The committed team AI metadata in {relative_path} is malformed."))
}

pub(super) fn load_local_team_ai_metadata_snapshot(
    repo_path: &Path,
) -> Result<LocalTeamAiMetadataSnapshot, String> {
    let current_head_oid = read_current_head_oid(repo_path)
        .ok_or_else(|| "Could not resolve the committed team-metadata revision.".to_string())?;
    let settings = normalize_settings(read_committed_json(
        repo_path,
        &current_head_oid,
        "ai/settings.json",
    )?)?;
    let secrets = normalize_secrets(read_committed_json(
        repo_path,
        &current_head_oid,
        "ai/secrets.json",
    )?)?;
    Ok(LocalTeamAiMetadataSnapshot {
        current_head_oid: Some(current_head_oid),
        settings,
        secrets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRepo(PathBuf);

    impl TestRepo {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "gnosis-team-ai-metadata-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(path.join("ai")).expect("create test repo");
            git_output(&path, &["init"], None).expect("init repo");
            git_output(&path, &["config", "user.name", "Gnosis Test"], None)
                .expect("configure name");
            git_output(
                &path,
                &["config", "user.email", "gnosis-test@example.com"],
                None,
            )
            .expect("configure email");
            git_output(&path, &["config", "commit.gpgsign", "false"], None)
                .expect("disable signing");
            Self(path)
        }

        fn commit_settings(&self, model_id: &str, message: &str) -> String {
            fs::write(
                self.0.join("ai/settings.json"),
                serde_json::to_vec(&json!({
                    "schemaVersion": 1,
                    "actionPreferences": {
                        "unified": { "providerId": "openai", "modelId": model_id }
                    }
                }))
                .expect("serialize settings"),
            )
            .expect("write settings");
            git_output(&self.0, &["add", "ai/settings.json"], None).expect("stage settings");
            git_output(&self.0, &["commit", "-m", message], None).expect("commit settings");
            read_current_head_oid(&self.0).expect("head oid")
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn secrets_normalization_returns_versions_without_ciphertext() {
        let metadata = normalize_secrets(Some(json!({
            "schemaVersion": 1,
            "updatedAt": "2026-08-20T12:00:00Z",
            "providers": {
                "openai": {
                    "keyVersion": 7,
                    "brokerWrappedKey": {
                        "algorithm": "rsa-oaep-sha256-v1",
                        "ciphertext": "encrypted-secret"
                    }
                }
            }
        })))
        .expect("normalize secrets");

        assert_eq!(
            metadata.providers["openai"].as_ref().unwrap().key_version,
            7
        );
        let serialized = serde_json::to_string(&metadata).expect("serialize metadata");
        assert!(!serialized.contains("encrypted-secret"));
        assert!(!serialized.contains("ciphertext"));
        assert!(!serialized.contains("brokerWrappedKey"));
    }

    #[test]
    fn missing_secrets_produce_an_empty_provider_summary() {
        let metadata = normalize_secrets(None).expect("normalize missing secrets");
        assert!(metadata.providers.values().all(Option::is_none));
    }

    #[test]
    fn committed_reads_stay_pinned_to_the_captured_revision() {
        let repo = TestRepo::new();
        let first_oid = repo.commit_settings("gpt-first", "first settings");
        let second_oid = repo.commit_settings("gpt-second", "second settings");
        assert_ne!(first_oid, second_oid);

        let settings = read_committed_json(&repo.0, &first_oid, "ai/settings.json")
            .expect("read captured settings")
            .expect("settings exist");

        assert_eq!(
            settings.pointer("/actionPreferences/unified/modelId"),
            Some(&json!("gpt-first"))
        );
    }
}
