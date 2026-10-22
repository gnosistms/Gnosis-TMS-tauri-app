//! Public dictionary evidence is reusable across studies and language pairs.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, sync::Mutex};

static CACHE_WRITE: Mutex<()> = Mutex::new(());

pub(super) fn key(request_url: &str) -> String {
    format!("{:x}", Sha256::digest(request_url.as_bytes()))
}

fn official_url(value: &Value) -> bool {
    value
        .as_str()
        .and_then(|s| url::Url::parse(s).ok())
        .is_some_and(|url| {
            url.scheme() == "https"
                && url.host_str() == Some("dle.rae.es")
                && url.username().is_empty()
                && url.password().is_none()
        })
}

pub(super) fn usable(result: &Value) -> bool {
    if !official_url(&result["url"]) {
        return false;
    }
    match result["status"].as_str() {
        Some("not_found") => {
            result["entry"].is_null()
                && result["message"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty())
        }
        Some("found") => {
            let entry = &result["entry"];
            match entry["kind"].as_str() {
                Some("articles") => entry["articles"].as_array().is_some_and(|articles| {
                    !articles.is_empty()
                        && articles.iter().all(|a| {
                            a["headword"].as_str().is_some_and(|s| !s.trim().is_empty())
                                && (a["senses"].as_array().is_some_and(|s| !s.is_empty())
                                    || a["complexForms"].as_array().is_some_and(|s| !s.is_empty()))
                        })
                }),
                Some("complex") => {
                    entry["form"].as_str().is_some_and(|s| !s.trim().is_empty())
                        && entry["senses"].as_array().is_some_and(|s| !s.is_empty())
                }
                _ => false,
            }
        }
        _ => false,
    }
}

pub(super) fn load(root: &Path, request_url: &str) -> Result<Option<Value>, String> {
    let path = root.join(format!("{}.json", key(request_url)));
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read saved DLE evidence: {e}")),
    };
    let record: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Saved DLE evidence could not be read: {e}"))?;
    if record["schemaVersion"] != 1
        || record["requestUrl"] != request_url
        || record["retrievedAt"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_none()
        || !usable(&record["result"])
    {
        return Err("Saved DLE evidence is invalid. Prepare or refresh the dictionary cache before continuing.".into());
    }
    let mut result = record["result"].clone();
    result["neededPerson"] = false.into();
    result["cache"] = json!({"reused":true,"retrievedAt":record["retrievedAt"],"provenance":record["provenance"]});
    Ok(Some(result))
}

pub(super) fn save(root: &Path, request_url: &str, result: &Value) -> Result<(), String> {
    if !usable(result) {
        return Ok(());
    }
    let _lock = CACHE_WRITE
        .lock()
        .map_err(|_| "Dictionary evidence storage is busy.")?;
    fs::create_dir_all(root)
        .map_err(|e| format!("Could not create dictionary evidence storage: {e}"))?;
    let path = root.join(format!("{}.json", key(request_url)));
    let tmp = root.join(format!("{}.{}.tmp", key(request_url), uuid::Uuid::now_v7()));
    let record = json!({"schemaVersion":1,"requestUrl":request_url,"retrievedAt":chrono::Utc::now().to_rfc3339(),
        "provenance":{"kind":"live-dle-lookup"},"result":result});
    let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| format!("Could not save dictionary evidence: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not finish saving dictionary evidence: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn found() -> Value {
        json!({"status":"found","url":"https://dle.rae.es/test",
        "entry":{"kind":"articles","articles":[{"headword":"test","senses":[{"definition":"Fixture definition","number":"1"}],"html":"<p>Complete fixture evidence</p>"}]},"neededPerson":true})
    }
    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("gnosis-dle-cache-{}", uuid::Uuid::now_v7()))
    }
    #[test]
    fn successful_evidence_survives_reuse_without_requiring_a_person() {
        let root = root();
        let original = found();
        let url = "https://dle.rae.es/test";
        assert!(load(&root, url).unwrap().is_none());
        save(&root, url, &original).unwrap();
        let reused = load(&root, url).unwrap().unwrap();
        assert_eq!(reused["entry"], original["entry"]);
        assert_eq!(reused["url"], original["url"]);
        assert_eq!(reused["neededPerson"], false);
        assert_eq!(reused["cache"]["reused"], true);
        assert!(reused["cache"]["retrievedAt"].as_str().is_some());
        assert!(load(&root, "https://dle.rae.es/other").unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn challenges_errors_and_unattributed_payloads_never_become_evidence() {
        let root = root();
        let url = "https://dle.rae.es/test";
        for result in [
            json!({"status":"needs_person","url":url}),
            json!({"status":"unreachable","url":url}),
            json!({"status":"found","url":url,"entry":{"html":"Verify you are human"}}),
            json!({"status":"not_found","url":url}),
            json!({"status":"found","url":"https://other.test/test","entry":found()["entry"]}),
        ] {
            save(&root, url, &result).unwrap();
            assert!(!root.exists());
        }
    }
    #[test]
    fn verified_negative_and_complex_entries_can_be_reused() {
        let root = root();
        let url = "https://dle.rae.es/test";
        let negative = json!({"status":"not_found","url":url,"entry":null,"message":"Verified dictionary no-entry response"});
        save(&root, url, &negative).unwrap();
        assert_eq!(load(&root, url).unwrap().unwrap()["status"], "not_found");
        let complex = json!({"status":"found","url":"https://dle.rae.es/?id=ABC#complex","entry":{"kind":"complex","form":"test phrase","senses":[{"definition":"Fixture phrase"}]}});
        save(&root, complex["url"].as_str().unwrap(), &complex).unwrap();
        assert_eq!(
            load(&root, complex["url"].as_str().unwrap())
                .unwrap()
                .unwrap()["entry"],
            complex["entry"]
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn malformed_or_mismatched_cache_cannot_masquerade_as_a_lookup() {
        let root = root();
        let url = "https://dle.rae.es/test";
        save(&root, url, &found()).unwrap();
        let path = root.join(format!("{}.json", key(url)));
        let mut record: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        record["requestUrl"] = "https://dle.rae.es/other".into();
        fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
        assert!(load(&root, url).is_err());
        fs::write(&path, b"{").unwrap();
        assert!(load(&root, url).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
