//! Per-language data for Glossary Research's frequency checks, downloaded on demand.
//!
//! Nothing ships with the app. On first use of a language the app downloads, from the
//! research-data folder on DigitalOcean Spaces:
//!   frequency.tsv.gz  word<TAB>Zipf (wordfreq, or Leipzig word counts where wordfreq has no list)
//!   sentences.txt.gz  one sentence per line (a Leipzig Corpora Collection news corpus)
//! Both are checked against the SHA-256 in `manifest.json` and kept in
//! <app data>/research-data/v1/<language>/. See plans/glossary-research-procedure-2026-10.md.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use flate2::read::GzDecoder;
use rand::{rngs::StdRng, seq::SliceRandom, SeedableRng};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const BASE_URL: &str = "https://gnosis.sgp1.digitaloceanspaces.com/research-data/v1/";
const MANIFEST_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
/// Matching sentences kept before the seeded draw; enough for any sample size we use.
const MAX_MATCHES: usize = 50_000;

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?
        .join("research-data")
        .join("v1");
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

fn safe_language(code: &str) -> Result<String, String> {
    let ok = !code.is_empty()
        && code.len() <= 16
        && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(code.to_string())
    } else {
        Err(format!("Invalid language code '{code}'."))
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(None)
        .build()
        .map_err(|error| error.to_string())
}

fn manifest(app: &AppHandle) -> Result<Value, String> {
    let path = data_root(app)?.join("manifest.json");
    let fresh = fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|time| SystemTime::now().duration_since(time).ok())
        .map(|age| age < MANIFEST_MAX_AGE)
        .unwrap_or(false);
    if !fresh {
        let downloaded = client()?
            .get(format!("{BASE_URL}manifest.json"))
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.text());
        match downloaded {
            Ok(text) if serde_json::from_str::<Value>(&text).is_ok() => {
                let _ = fs::write(&path, text);
            }
            // Offline: an older copy still works.
            _ if path.exists() => {}
            Ok(_) => return Err("The research data list could not be read.".into()),
            Err(error) => return Err(format!("The research data list could not be downloaded: {error}")),
        }
    }
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    language: String,
    file: String,
    received: u64,
    total: u64,
}

/// The local copy of one manifest file, downloaded and verified if missing or stale.
fn ensure_file(app: &AppHandle, language: &str, entry: &Value) -> Result<PathBuf, String> {
    let file = entry.get("file").and_then(Value::as_str).ok_or("manifest entry without a file")?;
    let expected = entry.get("sha256").and_then(Value::as_str).ok_or("manifest entry without a checksum")?;
    let total = entry.get("bytes").and_then(Value::as_u64).unwrap_or(0);
    if file.contains("..") {
        return Err("Invalid file in the research data list.".into());
    }
    let path = data_root(app)?.join(file);
    let marker = path.with_extension("sha256");
    if path.exists() && fs::read_to_string(&marker).map(|s| s.trim() == expected).unwrap_or(false) {
        return Ok(path);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let partial = path.with_extension("part");
    let mut response = client()?
        .get(format!("{BASE_URL}{file}"))
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Could not download {file}: {error}"))?;
    let mut out = fs::File::create(&partial).map_err(|error| error.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    let mut received: u64 = 0;
    let mut reported: u64 = 0;
    loop {
        let read = response.read(&mut buffer).map_err(|error| format!("Download of {file} failed: {error}"))?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
        received += read as u64;
        if received - reported >= 2 << 20 {
            reported = received;
            let _ = app.emit("glossary-research-data-progress", DownloadProgress {
                language: language.to_string(), file: file.to_string(), received, total,
            });
        }
    }
    drop(out);
    let actual = sha256_file(&partial)?;
    if actual != expected {
        let _ = fs::remove_file(&partial);
        return Err(format!("{file} did not match its checksum; try again."));
    }
    fs::rename(&partial, &path).map_err(|error| error.to_string())?;
    fs::write(&marker, expected).map_err(|error| error.to_string())?;
    let _ = app.emit("glossary-research-data-progress", DownloadProgress {
        language: language.to_string(), file: file.to_string(), received, total: received,
    });
    Ok(path)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanguageData {
    language: String,
    available: bool,
    corpus: Option<String>,
    sentences: Option<u64>,
    tokens: Option<u64>,
    frequency_source: Option<String>,
    sentences_source: Option<String>,
}

fn language_entry(app: &AppHandle, language: &str) -> Result<Option<Value>, String> {
    let manifest = manifest(app)?;
    Ok(manifest.get("languages").and_then(|l| l.get(language)).cloned())
}

/// Make sure a language's data is on this computer (downloading it the first time).
#[tauri::command]
pub(crate) async fn glossary_research_language_data(app: AppHandle, language: String) -> Result<LanguageData, String> {
    let language = safe_language(&language)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(entry) = language_entry(&app, &language)? else {
            return Ok(LanguageData {
                language, available: false, corpus: None, sentences: None, tokens: None,
                frequency_source: None, sentences_source: None,
            });
        };
        let frequency = entry.get("frequency").ok_or("manifest without frequency")?;
        let sentences = entry.get("sentences").ok_or("manifest without sentences")?;
        ensure_file(&app, &language, frequency)?;
        ensure_file(&app, &language, sentences)?;
        Ok(LanguageData {
            language,
            available: true,
            corpus: sentences.get("corpus").and_then(Value::as_str).map(str::to_string),
            sentences: sentences.get("sentences").and_then(Value::as_u64),
            tokens: sentences.get("tokens").and_then(Value::as_u64),
            frequency_source: frequency.get("source").and_then(Value::as_str).map(str::to_string),
            sentences_source: sentences.get("source").and_then(Value::as_str).map(str::to_string),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

type FrequencyTable = Arc<HashMap<String, f32>>;

fn frequency_cache() -> &'static Mutex<HashMap<String, FrequencyTable>> {
    static CACHE: OnceLock<Mutex<HashMap<String, FrequencyTable>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn frequency_table(app: &AppHandle, language: &str) -> Result<FrequencyTable, String> {
    if let Some(table) = frequency_cache().lock().map_err(|e| e.to_string())?.get(language) {
        return Ok(table.clone());
    }
    let entry = language_entry(app, language)?.ok_or_else(|| format!("No research data for language '{language}'."))?;
    let path = ensure_file(app, language, entry.get("frequency").ok_or("manifest without frequency")?)?;
    let reader = BufReader::new(GzDecoder::new(fs::File::open(&path).map_err(|e| e.to_string())?));
    let mut table = HashMap::new();
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Some((word, zipf)) = line.split_once('\t') {
            if let Ok(value) = zipf.parse::<f32>() {
                table.entry(word.to_string()).or_insert(value);
            }
        }
    }
    let table = Arc::new(table);
    frequency_cache().lock().map_err(|e| e.to_string())?.insert(language.to_string(), table.clone());
    Ok(table)
}

/// Zipf score of each word (0 when the word is below the list's threshold).
#[tauri::command]
pub(crate) async fn glossary_research_zipf(app: AppHandle, language: String, words: Vec<String>) -> Result<Vec<f32>, String> {
    let language = safe_language(&language)?;
    tauri::async_runtime::spawn_blocking(move || {
        let table = frequency_table(&app, &language)?;
        Ok(words
            .iter()
            .map(|word| *table.get(&word.trim().to_lowercase()).unwrap_or(&0.0))
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SentencesInput {
    language: String,
    forms: Vec<String>,
    limit: usize,
    seed: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SentencesResult {
    /// Sentences of the corpus containing any of the forms.
    hits: usize,
    /// A seeded random draw of at most `limit` of them.
    sample: Vec<String>,
    corpus_sentences: Option<u64>,
    corpus_tokens: Option<u64>,
    corpus: Option<String>,
}

/// Languages written without spaces between words: match inside text, not at word edges.
fn unspaced(language: &str) -> bool {
    matches!(language.split('-').next().unwrap_or(""), "zh" | "ja" | "th" | "lo" | "km" | "my")
}

/// A seeded random sample of general-corpus sentences that contain any of the forms.
#[tauri::command]
pub(crate) async fn glossary_research_general_sentences(app: AppHandle, input: SentencesInput) -> Result<SentencesResult, String> {
    let language = safe_language(&input.language)?;
    tauri::async_runtime::spawn_blocking(move || {
        let entry = language_entry(&app, &language)?.ok_or_else(|| format!("No research data for language '{language}'."))?;
        let sentences = entry.get("sentences").ok_or("manifest without sentences")?;
        let path = ensure_file(&app, &language, sentences)?;
        let forms: Vec<String> = input
            .forms
            .iter()
            .map(|form| regex::escape(form.trim()))
            .filter(|form| !form.is_empty())
            .collect();
        if forms.is_empty() {
            return Err("No forms to search for.".into());
        }
        let alternation = forms.join("|");
        let pattern = if unspaced(&language) {
            format!("(?:{alternation})")
        } else {
            format!(r"(?:^|[^\p{{L}}\p{{N}}_])(?:{alternation})(?:[^\p{{L}}\p{{N}}_]|$)")
        };
        let matcher = RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|error| error.to_string())?;
        let reader = BufReader::new(GzDecoder::new(fs::File::open(&path).map_err(|e| e.to_string())?));
        let mut hits = 0usize;
        let mut kept = Vec::new();
        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            if matcher.is_match(&line) {
                hits += 1;
                if kept.len() < MAX_MATCHES {
                    kept.push(line);
                }
            }
        }
        let digest = Sha256::digest(input.seed.as_bytes());
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&digest);
        kept.shuffle(&mut StdRng::from_seed(seed));
        kept.truncate(input.limit);
        Ok(SentencesResult {
            hits,
            sample: kept,
            corpus_sentences: sentences.get("sentences").and_then(Value::as_u64),
            corpus_tokens: sentences.get("tokens").and_then(Value::as_u64),
            corpus: sentences.get("corpus").and_then(Value::as_str).map(str::to_string),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_codes_are_restricted() {
        assert!(safe_language("es").is_ok());
        assert!(safe_language("zh-Hant").is_ok());
        assert!(safe_language("../x").is_err());
        assert!(safe_language("").is_err());
    }

    #[test]
    fn unspaced_scripts() {
        assert!(unspaced("ja"));
        assert!(unspaced("zh-Hans"));
        assert!(!unspaced("vi"));
        assert!(!unspaced("en"));
    }
}
