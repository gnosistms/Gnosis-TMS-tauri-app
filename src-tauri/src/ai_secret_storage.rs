use std::fs;
use std::path::{Path, PathBuf};

use iota_stronghold::Client;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;

use crate::ai::types::AiProviderId;

const AI_SECRET_SNAPSHOT_FILENAME: &str = "ai-provider-secrets.hold";
const AI_SECRET_CLIENT_ID: &[u8] = b"ai-provider-secrets";

pub(crate) fn load_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
) -> Result<Option<String>, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    load_ai_provider_secret_at_path(&snapshot_path, provider_id)
}

pub(crate) fn save_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
    api_key: &str,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    save_ai_provider_secret_at_path(&snapshot_path, provider_id, api_key)
}

pub(crate) fn clear_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    clear_ai_provider_secret_at_path(&snapshot_path, provider_id)
}

fn stronghold_snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve the encrypted AI key store path: {error}"))?;
    fs::create_dir_all(&local_data_dir)
        .map_err(|error| format!("Could not create the encrypted AI key store folder: {error}"))?;
    Ok(local_data_dir.join(AI_SECRET_SNAPSHOT_FILENAME))
}

fn stronghold_password(snapshot_path: &Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"gnosis-tms-ai-provider-secrets");
    hasher.update(snapshot_path.to_string_lossy().as_bytes());
    hasher.finalize().to_vec()
}

fn open_stronghold(snapshot_path: &Path) -> Result<Stronghold, String> {
    Stronghold::new(snapshot_path, stronghold_password(snapshot_path))
        .map_err(|error| format!("Could not open the encrypted AI key store: {error}"))
}

fn load_or_create_client(stronghold: &Stronghold) -> Result<Client, String> {
    stronghold
        .get_client(AI_SECRET_CLIENT_ID)
        .or_else(|_| stronghold.load_client(AI_SECRET_CLIENT_ID))
        .or_else(|_| stronghold.create_client(AI_SECRET_CLIENT_ID))
        .map_err(|error| format!("Could not access the encrypted AI key store: {error}"))
}

fn provider_secret_key(provider_id: AiProviderId) -> String {
    format!("ai-provider/{}/api-key", provider_id.as_str())
}

fn load_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
) -> Result<Option<String>, String> {
    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    let maybe_secret = client
        .store()
        .get(provider_secret_key(provider_id).as_bytes())
        .map_err(|error| format!("Could not load the saved AI API key: {error}"))?;

    let Some(secret) = maybe_secret else {
        return Ok(None);
    };

    let decoded_secret = String::from_utf8(secret)
        .map_err(|_| "The saved AI API key could not be decoded.".to_string())?;
    if decoded_secret.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(decoded_secret))
}

fn save_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
    api_key: &str,
) -> Result<(), String> {
    let normalized_key = api_key.trim();
    if normalized_key.is_empty() {
        return clear_ai_provider_secret_at_path(snapshot_path, provider_id);
    }

    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    client
        .store()
        .insert(
            provider_secret_key(provider_id).into_bytes(),
            normalized_key.as_bytes().to_vec(),
            None,
        )
        .map_err(|error| format!("Could not save the AI API key: {error}"))?;
    stronghold
        .save()
        .map_err(|error| format!("Could not persist the encrypted AI key store: {error}"))?;

    Ok(())
}

fn clear_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
) -> Result<(), String> {
    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    client
        .store()
        .delete(provider_secret_key(provider_id).as_bytes())
        .map_err(|error| format!("Could not clear the saved AI API key: {error}"))?;
    stronghold
        .save()
        .map_err(|error| format!("Could not persist the encrypted AI key store: {error}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{provider_secret_key, stronghold_password};
    use crate::ai::types::AiProviderId;

    #[test]
    fn stronghold_password_is_stable_and_32_bytes() {
        let snapshot_path = PathBuf::from("/tmp/gnosis-tms-ai-provider-secrets.hold");
        let first = stronghold_password(&snapshot_path);
        let second = stronghold_password(&snapshot_path);

        assert_eq!(first, second);
        assert_eq!(first.len(), 32);
    }

    #[test]
    fn provider_secret_key_namespaces_the_provider() {
        assert_eq!(
            provider_secret_key(AiProviderId::OpenAi),
            "ai-provider/openai/api-key"
        );
    }
}
