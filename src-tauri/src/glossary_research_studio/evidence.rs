//! Immutable evidence pieces. Only a manifest commit makes new pieces current.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub(super) fn write(root: &Path, id: &str, values: &Value) -> Result<Value, String> {
    let values = values
        .as_array()
        .ok_or("Evidence pieces must be an array.")?;
    let dir = root.join(super::storage::safe_id(id)?).join("evidence");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut refs = Vec::new();
    for value in values {
        let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        let hash = digest(&bytes);
        let path = dir.join(format!("{hash}.json"));
        if path.exists() {
            let existing = fs::read(&path).map_err(|e| e.to_string())?;
            if digest(&existing) != hash {
                return Err(
                    "Saved research evidence is corrupt; the existing file was preserved.".into(),
                );
            }
        } else {
            let temp = dir.join(format!("{hash}.tmp"));
            fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
            fs::rename(temp, path).map_err(|e| e.to_string())?;
        }
        refs.push(json!({"_studioArtifact": hash, "bytes": bytes.len()}));
    }
    Ok(refs.into())
}

pub(super) fn read(root: &Path, id: &str, reference: &Value) -> Result<Value, String> {
    let hash = reference["_studioArtifact"]
        .as_str()
        .filter(|s| valid_hash(s))
        .ok_or("Invalid research evidence reference.")?;
    let path = root
        .join(super::storage::safe_id(id)?)
        .join("evidence")
        .join(format!("{hash}.json"));
    let bytes =
        fs::read(path).map_err(|e| format!("Saved research evidence is unavailable: {e}"))?;
    if digest(&bytes) != hash {
        return Err("Saved research evidence failed its integrity check.".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("Saved research evidence could not be read: {e}"))
}

pub(super) fn expand(root: &Path, id: &str, value: Value) -> Result<Value, String> {
    fn visit(root: &Path, id: &str, value: Value, depth: usize) -> Result<Value, String> {
        if depth > 64 {
            return Err("Research evidence references are nested too deeply.".into());
        }
        match value {
            Value::Object(map) if map.contains_key("_studioArtifact") => {
                visit(root, id, read(root, id, &Value::Object(map))?, depth + 1)
            }
            Value::Object(map) => map
                .into_iter()
                .map(|(k, v)| Ok((k, visit(root, id, v, depth + 1)?)))
                .collect::<Result<serde_json::Map<_, _>, String>>()
                .map(Value::Object),
            Value::Array(rows) => rows
                .into_iter()
                .map(|v| visit(root, id, v, depth + 1))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            other => Ok(other),
        }
    }
    visit(root, id, value, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pieces_are_immutable_verified_and_exportable() {
        let dir = std::env::temp_dir().join(format!("studio-pieces-{}", uuid::Uuid::now_v7()));
        let values = json!([{"text":"Complete cited evidence"}, [1,2,3]]);
        let refs = write(&dir, "study", &values).unwrap();
        assert_eq!(refs, write(&dir, "study", &values).unwrap());
        assert_eq!(expand(&dir, "study", refs.clone()).unwrap(), values);
        assert!(read(&dir, "study", &json!({"_studioArtifact":"../outside"})).is_err());
        let path = dir.join("study/evidence").join(format!(
            "{}.json",
            refs[0]["_studioArtifact"].as_str().unwrap()
        ));
        fs::write(&path, "corrupt").unwrap();
        assert!(read(&dir, "study", &refs[0]).is_err());
        assert!(write(&dir, "study", &values).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "corrupt");
        fs::remove_dir_all(dir).unwrap();
    }
}
