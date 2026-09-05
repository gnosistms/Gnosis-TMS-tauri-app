//! Public attribution for offline work. This cache never grants remote access.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct LocalAuthor {
    pub(crate) login: String,
    pub(crate) name: Option<String>,
}

impl LocalAuthor {
    // Deserialize only public fields, never serialize a BrokerSession here.
    pub(crate) fn from_session(raw: &[u8]) -> Result<Self, String> {
        let mut author: Self = serde_json::from_slice(raw)
            .map_err(|_| "The saved GitHub author could not be decoded.")?;
        author.login = author.login.trim().to_lowercase();
        if author.login.is_empty() {
            return Err("The saved GitHub author is missing a login.".into());
        }
        Ok(author)
    }
}

#[derive(Serialize, Deserialize)]
struct CachedAuthor {
    snapshot_sha256: String,
    author: Option<LocalAuthor>,
}

fn snapshot_hash(snapshot: &Path) -> Result<String, String> {
    fs::read(snapshot)
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
        .map_err(|_| "Could not verify the offline GitHub author cache.".into())
}

// A missing, damaged, or outdated cache is a cache miss, never an identity.
pub(crate) fn read(snapshot: &Path) -> Option<LocalAuthor> {
    let bytes = fs::read(snapshot.with_extension("author.json")).ok()?;
    let cached: CachedAuthor = serde_json::from_slice(&bytes).ok()?;
    if cached.snapshot_sha256 != snapshot_hash(snapshot).ok()? {
        return None;
    }
    cached
        .author
        .filter(|author| !author.login.trim().is_empty())
}

/// Publish the public projection before publishing its encrypted snapshot. A
/// crash between the two renames leaves a hash mismatch, not a stale account or
/// a resurrected signed-out identity. Opening the vault repairs that cache.
pub(crate) fn write(
    snapshot_source: &Path,
    snapshot_destination: &Path,
    author: Option<LocalAuthor>,
) -> Result<(), String> {
    let cached = CachedAuthor {
        snapshot_sha256: snapshot_hash(snapshot_source)?,
        author,
    };
    let bytes = serde_json::to_vec(&cached)
        .map_err(|_| "Could not encode the offline GitHub author cache.")?;
    let path = snapshot_destination.with_extension("author.json");
    if fs::read(&path).ok().as_deref() == Some(bytes.as_slice()) {
        return Ok(());
    }
    let pending = snapshot_destination.with_extension("author.pending");
    let mut file = fs::File::create(&pending)
        .map_err(|_| "Could not prepare the offline GitHub author cache.")?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| "Could not save the offline GitHub author cache.")?;
    drop(file);
    fs::rename(&pending, &path)
        .map_err(|_| "Could not publish the offline GitHub author cache.".into())
}
