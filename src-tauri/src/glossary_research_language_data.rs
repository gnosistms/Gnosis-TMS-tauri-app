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
use rand::{rngs::StdRng, seq::SliceRandom, Rng, SeedableRng};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const BASE_URL: &str = "https://gnosis.sgp1.digitaloceanspaces.com/research-data/v1/";
const MANIFEST_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?
        .join("research-data")
        .join("v1");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))?;
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

/// The data folder for an app language code, and whether its text is converted from
/// Traditional to Simplified Chinese first (the Chinese data is in Simplified script).
fn resolve_language(code: &str) -> (String, bool) {
    let lower = code.to_lowercase();
    let traditional = matches!(lower.as_str(), "zh-hant" | "zh-tw" | "zh-hk" | "zh-mo");
    let base = lower.split('-').next().unwrap_or("").to_string();
    let base = match base.as_str() {
        "no" | "nn" => "nb".to_string(),
        _ => base,
    };
    (base, traditional)
}

type CharMap = Arc<HashMap<char, String>>;

fn conversion_cache() -> &'static Mutex<Option<CharMap>> {
    static CACHE: OnceLock<Mutex<Option<CharMap>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Traditional → Simplified characters (from the Chinese data's `t2s.tsv.gz`).
fn to_simplified(app: &AppHandle, text: &str) -> Result<String, String> {
    let map = {
        let cached = conversion_cache()
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        match cached {
            Some(map) => map,
            None => {
                let entry = language_entry(app, "zh")?.ok_or("No research data for Chinese.")?;
                let file = entry
                    .get("traditionalToSimplified")
                    .ok_or("The Chinese data has no Traditional conversion table.")?;
                let path = ensure_file(app, "zh", file)?;
                let reader = BufReader::new(GzDecoder::new(
                    fs::File::open(&path).map_err(|e| e.to_string())?,
                ));
                let mut map = HashMap::new();
                for line in reader.lines() {
                    let line = line.map_err(|e| e.to_string())?;
                    if let Some((from, to)) = line.split_once('\t') {
                        if let Some(c) = from.chars().next() {
                            map.insert(c, to.to_string());
                        }
                    }
                }
                let map = Arc::new(map);
                *conversion_cache().lock().map_err(|e| e.to_string())? = Some(map.clone());
                map
            }
        }
    };
    Ok(text
        .chars()
        .map(|c| map.get(&c).cloned().unwrap_or_else(|| c.to_string()))
        .collect())
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
        .unwrap_or(false)
        // A copy from before corpus counts were calibrated is replaced at once.
        && fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .map(|value| value.get("calibration").is_some())
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
            Err(error) => {
                return Err(format!(
                    "The research data list could not be downloaded: {error}"
                ))
            }
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
    let file = entry
        .get("file")
        .and_then(Value::as_str)
        .ok_or("manifest entry without a file")?;
    let expected = entry
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or("manifest entry without a checksum")?;
    let total = entry.get("bytes").and_then(Value::as_u64).unwrap_or(0);
    if file.contains("..") {
        return Err("Invalid file in the research data list.".into());
    }
    let path = data_root(app)?.join(file);
    let marker = path.with_extension("sha256");
    if path.exists()
        && fs::read_to_string(&marker)
            .map(|s| s.trim() == expected)
            .unwrap_or(false)
    {
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
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Download of {file} failed: {error}"))?;
        if read == 0 {
            break;
        }
        out.write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        received += read as u64;
        if received - reported >= 2 << 20 {
            reported = received;
            let _ = app.emit(
                "glossary-research-data-progress",
                DownloadProgress {
                    language: language.to_string(),
                    file: file.to_string(),
                    received,
                    total,
                },
            );
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
    let _ = app.emit(
        "glossary-research-data-progress",
        DownloadProgress {
            language: language.to_string(),
            file: file.to_string(),
            received,
            total: received,
        },
    );
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
    Ok(manifest
        .get("languages")
        .and_then(|l| l.get(language))
        .cloned())
}

/// Make sure a language's data is on this computer (downloading it the first time).
#[tauri::command]
pub(crate) async fn glossary_research_language_data(
    app: AppHandle,
    language: String,
) -> Result<LanguageData, String> {
    let (language, traditional) = resolve_language(&safe_language(&language)?);
    tauri::async_runtime::spawn_blocking(move || {
        if traditional {
            to_simplified(&app, "")?;
        }
        let Some(entry) = language_entry(&app, &language)? else {
            return Ok(LanguageData {
                language,
                available: false,
                corpus: None,
                sentences: None,
                tokens: None,
                frequency_source: None,
                sentences_source: None,
            });
        };
        let frequency = entry.get("frequency").ok_or("manifest without frequency")?;
        let sentences = entry.get("sentences").ok_or("manifest without sentences")?;
        ensure_file(&app, &language, frequency)?;
        ensure_file(&app, &language, sentences)?;
        Ok(LanguageData {
            language,
            available: true,
            corpus: sentences
                .get("corpus")
                .and_then(Value::as_str)
                .map(str::to_string),
            sentences: sentences.get("sentences").and_then(Value::as_u64),
            tokens: sentences.get("tokens").and_then(Value::as_u64),
            frequency_source: frequency
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string),
            sentences_source: sentences
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string),
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
    if let Some(table) = frequency_cache()
        .lock()
        .map_err(|e| e.to_string())?
        .get(language)
    {
        return Ok(table.clone());
    }
    let entry = language_entry(app, language)?
        .ok_or_else(|| format!("No research data for language '{language}'."))?;
    let path = ensure_file(
        app,
        language,
        entry.get("frequency").ok_or("manifest without frequency")?,
    )?;
    let reader = BufReader::new(GzDecoder::new(
        fs::File::open(&path).map_err(|e| e.to_string())?,
    ));
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
    frequency_cache()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(language.to_string(), table.clone());
    Ok(table)
}

/// Zipf score of each word (0 when the word is below the list's threshold).
#[tauri::command]
pub(crate) async fn glossary_research_zipf(
    app: AppHandle,
    language: String,
    words: Vec<String>,
) -> Result<Vec<f32>, String> {
    let (language, traditional) = resolve_language(&safe_language(&language)?);
    tauri::async_runtime::spawn_blocking(move || {
        let table = frequency_table(&app, &language)?;
        let mut scores = Vec::with_capacity(words.len());
        for word in &words {
            let key = if traditional {
                to_simplified(&app, word.trim())?
            } else {
                word.trim().to_string()
            };
            scores.push(*table.get(&key.to_lowercase()).unwrap_or(&0.0));
        }
        Ok(scores)
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
    /// Calibration of sentence counts to the list's Zipf scale (zipf ≈ log10(hits) + offset).
    zipf_offset: Option<f64>,
    corpus: Option<String>,
}

/// Characters that belong to a word when matching at word edges: letters, digits,
/// combining marks (vowel signs, decomposed accents) and the zero-width joiners
/// that Persian and other scripts write inside compounds.
const WORD_CHARS: &str = r"\p{L}\p{N}\p{M}_\x{200C}\x{200D}";

/// Languages written without spaces between words: match inside text, not at word edges.
fn unspaced(language: &str) -> bool {
    matches!(
        language.split('-').next().unwrap_or(""),
        "zh" | "ja" | "th" | "lo" | "km" | "my"
    )
}

/// A seeded uniform draw of at most `limit` items from a stream of any length
/// (reservoir sampling): every item has the same chance, wherever it is in the
/// file, and only `limit` items are held at a time. The same seed on the same
/// stream gives the same draw. Returns (items seen, items drawn) in random order.
fn seeded_draw<I>(items: I, limit: usize, seed: &str) -> Result<(usize, Vec<String>), String>
where
    I: Iterator<Item = Result<String, String>>,
{
    let digest = Sha256::digest(seed.as_bytes());
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&digest);
    let mut rng = StdRng::from_seed(bytes);
    let mut seen = 0usize;
    let mut kept: Vec<String> = Vec::with_capacity(limit.min(10_000));
    for item in items {
        let item = item?;
        seen += 1;
        if kept.len() < limit {
            kept.push(item);
        } else if limit > 0 {
            let slot = rng.gen_range(0..seen);
            if slot < limit {
                kept[slot] = item;
            }
        }
    }
    kept.shuffle(&mut rng);
    Ok((seen, kept))
}

/// A seeded random sample of general-corpus sentences that contain any of the forms.
#[tauri::command]
pub(crate) async fn glossary_research_general_sentences(
    app: AppHandle,
    input: SentencesInput,
) -> Result<SentencesResult, String> {
    let (language, traditional) = resolve_language(&safe_language(&input.language)?);
    tauri::async_runtime::spawn_blocking(move || {
        let entry = language_entry(&app, &language)?
            .ok_or_else(|| format!("No research data for language '{language}'."))?;
        let sentences = entry.get("sentences").ok_or("manifest without sentences")?;
        let path = ensure_file(&app, &language, sentences)?;
        let mut forms: Vec<String> = Vec::new();
        for form in &input.forms {
            let form = if traditional {
                to_simplified(&app, form.trim())?
            } else {
                form.trim().to_string()
            };
            if !form.is_empty() {
                forms.push(regex::escape(&form));
            }
        }
        if forms.is_empty() {
            return Err("No forms to search for.".into());
        }
        let alternation = forms.join("|");
        let pattern = if unspaced(&language) {
            format!("(?:{alternation})")
        } else {
            format!(r"(?:^|[^{WORD_CHARS}])(?:{alternation})(?:[^{WORD_CHARS}]|$)")
        };
        let matcher = RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .map_err(|error| error.to_string())?;
        let reader = BufReader::new(GzDecoder::new(
            fs::File::open(&path).map_err(|e| e.to_string())?,
        ));
        let matching = reader
            .lines()
            .map(|line| line.map_err(|e| e.to_string()))
            .filter(|line| line.as_ref().map_or(true, |line| matcher.is_match(line)));
        let (hits, kept) = seeded_draw(matching, input.limit, &input.seed)?;
        Ok(SentencesResult {
            hits,
            sample: kept,
            corpus_sentences: sentences.get("sentences").and_then(Value::as_u64),
            corpus_tokens: sentences.get("tokens").and_then(Value::as_u64),
            zipf_offset: sentences.get("zipfOffset").and_then(Value::as_f64),
            corpus: sentences
                .get("corpus")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// How often each phrase occurs in the general corpus, counted as a whole.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CorpusCount {
    phrase: String,
    /// Corpus sentences containing the phrase as a whole (at word edges in spaced scripts).
    hits: u64,
    /// Zipf from those sentences and the corpus size; 0 when the phrase does not occur.
    zipf: f32,
}

fn corpus_count_cache() -> &'static Mutex<HashMap<String, u64>> {
    static CACHE: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CountProgress {
    language: String,
    done: u64,
    total: u64,
    words: usize,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '\u{200C}' || c == '\u{200D}' || unicode_general_mark(c)
}

/// Combining marks (vowel signs, decomposed accents) belong to the word they sit on.
fn unicode_general_mark(c: char) -> bool {
    // Combining Diacritical Marks and the common Indic/Thai vowel-sign blocks.
    matches!(c as u32, 0x0300..=0x036F | 0x0483..=0x0489 | 0x0591..=0x05C7 | 0x0610..=0x061A | 0x064B..=0x065F
        | 0x0670 | 0x06D6..=0x06ED | 0x0900..=0x0903 | 0x093A..=0x094F | 0x0951..=0x0957 | 0x0962..=0x0963
        | 0x0981..=0x0983 | 0x09BC..=0x09D7 | 0x0A01..=0x0A83 | 0x0ABC..=0x0ACD | 0x0B01..=0x0B57 | 0x0B82..=0x0BD7
        | 0x0C00..=0x0C56 | 0x0C81..=0x0CD6 | 0x0D00..=0x0D57 | 0x0D81..=0x0DF3 | 0x0E31 | 0x0E34..=0x0E3A
        | 0x0E47..=0x0E4E | 0x0EB1 | 0x0EB4..=0x0EBC | 0x0EC8..=0x0ECD | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF
        | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

/// Sentences containing each phrase as a whole, in one pass over the corpus: each
/// sentence is lower-cased once, one literal search finds candidate matches
/// (longest phrases first), and word edges are checked by hand in spaced scripts.
fn count_whole_phrases(
    path: &Path,
    language: &str,
    phrases: &[String],
    progress: impl Fn(u64),
) -> Result<Vec<u64>, String> {
    let mut order: Vec<usize> = (0..phrases.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(phrases[i].chars().count()));
    let alternation = order
        .iter()
        .map(|&i| regex::escape(&phrases[i]))
        .collect::<Vec<_>>()
        .join("|");
    let matcher = RegexBuilder::new(&alternation)
        .build()
        .map_err(|error| error.to_string())?;
    let index_of: HashMap<&str, usize> = phrases
        .iter()
        .enumerate()
        .map(|(i, p)| (p.as_str(), i))
        .collect();
    let check_edges = !unspaced(language);
    let mut counts = vec![0u64; phrases.len()];
    let mut seen = vec![false; phrases.len()];
    let reader = BufReader::new(GzDecoder::new(
        fs::File::open(path).map_err(|e| e.to_string())?,
    ));
    let mut lines = 0u64;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?.to_lowercase();
        lines += 1;
        if lines.is_multiple_of(100_000) {
            progress(lines);
        }
        let mut hit_any = false;
        for found in matcher.find_iter(&line) {
            if check_edges {
                let before = line[..found.start()].chars().next_back();
                let after = line[found.end()..].chars().next();
                if before.is_some_and(is_word_char) || after.is_some_and(is_word_char) {
                    continue;
                }
            }
            if let Some(&i) = index_of.get(found.as_str()) {
                if !seen[i] {
                    seen[i] = true;
                    counts[i] += 1;
                    hit_any = true;
                }
            }
        }
        if hit_any {
            seen.iter_mut().for_each(|flag| *flag = false);
        }
    }
    progress(lines);
    Ok(counts)
}

/// Zipf from a sentence count: on the frequency list's scale when the language is
/// calibrated (zipf ≈ log10(hits) + offset), else from the corpus size.
fn corpus_zipf(hits: u64, offset: Option<f64>, tokens: u64) -> f32 {
    match offset {
        Some(offset) if hits > 0 => ((hits as f64).log10() + offset) as f32,
        _ => zipf_from_hits(hits, tokens),
    }
}

fn zipf_from_hits(hits: u64, tokens: u64) -> f32 {
    if hits == 0 || tokens == 0 {
        return 0.0;
    }
    ((hits as f64 / tokens as f64) * 1e9).log10() as f32
}

/// Counts each phrase as a whole in the language's general corpus, in one pass.
/// Used where a frequency list cannot score compounds: lists that count
/// syllables (Vietnamese) and scripts written without spaces.
#[tauri::command]
pub(crate) async fn glossary_research_corpus_zipf(
    app: AppHandle,
    language: String,
    phrases: Vec<String>,
) -> Result<Vec<CorpusCount>, String> {
    let (language, traditional) = resolve_language(&safe_language(&language)?);
    tauri::async_runtime::spawn_blocking(move || {
        let entry = language_entry(&app, &language)?
            .ok_or_else(|| format!("No research data for language '{language}'."))?;
        let sentences = entry.get("sentences").ok_or("manifest without sentences")?;
        let tokens = sentences.get("tokens").and_then(Value::as_u64).unwrap_or(0);
        let offset = sentences.get("zipfOffset").and_then(Value::as_f64);
        let mut searched: Vec<String> = Vec::with_capacity(phrases.len());
        for phrase in &phrases {
            let phrase = phrase.trim();
            let phrase = if traditional {
                to_simplified(&app, phrase)?
            } else {
                phrase.to_string()
            };
            searched.push(phrase.to_lowercase());
        }
        let key = |phrase: &str| format!("{language}\u{0}{phrase}");
        let missing: Vec<String> = {
            let cache = corpus_count_cache().lock().map_err(|e| e.to_string())?;
            let mut unique: Vec<String> = searched
                .iter()
                .filter(|p| !p.is_empty() && !cache.contains_key(&key(p)))
                .cloned()
                .collect();
            unique.sort();
            unique.dedup();
            unique
        };
        if !missing.is_empty() {
            let path = ensure_file(&app, &language, sentences)?;
            let total = sentences
                .get("sentences")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            let counts = count_whole_phrases(&path, &language, &missing, |done| {
                let _ = app.emit(
                    "glossary-research-count-progress",
                    CountProgress {
                        language: language.clone(),
                        done,
                        total,
                        words: missing.len(),
                    },
                );
            })?;
            let mut cache = corpus_count_cache().lock().map_err(|e| e.to_string())?;
            for (phrase, count) in missing.iter().zip(counts) {
                cache.insert(key(phrase), count);
            }
        }
        let cache = corpus_count_cache().lock().map_err(|e| e.to_string())?;
        Ok(phrases
            .iter()
            .zip(&searched)
            .map(|(original, phrase)| {
                let hits = if phrase.is_empty() {
                    0
                } else {
                    *cache.get(&key(phrase)).unwrap_or(&0)
                };
                CorpusCount {
                    phrase: original.clone(),
                    hits,
                    zipf: corpus_zipf(hits, offset, tokens),
                }
            })
            .collect())
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
    fn traditional_chinese_uses_the_chinese_data() {
        assert_eq!(resolve_language("zh-Hant"), ("zh".to_string(), true));
        assert_eq!(resolve_language("zh-Hans"), ("zh".to_string(), false));
        assert_eq!(resolve_language("pt-BR"), ("pt".to_string(), false));
        assert_eq!(resolve_language("no"), ("nb".to_string(), false));
    }

    #[test]
    fn whole_phrases_are_counted_once_per_sentence_at_word_edges() {
        use flate2::{write::GzEncoder, Compression};
        let dir = std::env::temp_dir().join(format!("gtms-count-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, lines: &[&str]| {
            let path = dir.join(name);
            let mut encoder = GzEncoder::new(fs::File::create(&path).unwrap(), Compression::fast());
            for line in lines {
                writeln!(encoder, "{line}").unwrap();
            }
            encoder.finish().unwrap();
            path
        };
        let vi = write(
            "vi.gz",
            &[
                "Nước Trong Suốt như gương, trong suốt cả ngày.",
                "Nước trongsuốt.",
                "chương trong suốtnăm",
                "Đó là sự phù phiếm.",
            ],
        );
        let counts = count_whole_phrases(
            &vi,
            "vi",
            &["trong suốt".into(), "phù phiếm".into(), "phù".into()],
            |_| {},
        )
        .unwrap();
        assert_eq!(
            counts,
            vec![1, 1, 0],
            "once per sentence, whole words only, the longer phrase wins"
        );
        let fa = write("fa.gz", &["او خود\u{200C}پسندی دارد", "او پسندی دارد"]);
        assert_eq!(
            count_whole_phrases(&fa, "fa", &["پسندی".into()], |_| {}).unwrap(),
            vec![1],
            "a ZWNJ joins the compound"
        );
        let zh = write("zh.gz", &["他很爱慕虚荣。", "虚荣心很强"]);
        assert_eq!(
            count_whole_phrases(&zh, "zh", &["虚荣".into()], |_| {}).unwrap(),
            vec![2]
        );
        assert!(zipf_from_hits(0, 1000) == 0.0);
        assert!((corpus_zipf(100, Some(1.5), 0) - 3.5).abs() < 1e-6);
        assert!(corpus_zipf(0, Some(1.5), 0) == 0.0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_draw_is_uniform_over_the_whole_stream_and_repeatable() {
        let stream = |n: usize| (0..n).map(|i| Ok(i.to_string()));
        let (seen, first) = seeded_draw(stream(200_000), 100, "1:es:íntimo").unwrap();
        assert_eq!(seen, 200_000);
        assert_eq!(first.len(), 100);
        assert_eq!(
            seeded_draw(stream(200_000), 100, "1:es:íntimo").unwrap().1,
            first,
            "same seed, same draw"
        );
        assert_ne!(
            seeded_draw(stream(200_000), 100, "2:es:íntimo").unwrap().1,
            first
        );
        // Items from late in the stream are drawn as often as early ones.
        let mut late = 0usize;
        for round in 0..200 {
            let (_, drawn) = seeded_draw(stream(100_000), 100, &format!("round {round}")).unwrap();
            late += drawn
                .iter()
                .filter(|item| item.parse::<usize>().unwrap() >= 50_000)
                .count();
        }
        let share = late as f64 / 20_000.0;
        assert!(
            (0.47..0.53).contains(&share),
            "second half drawn {share:.3} of the time"
        );
        let (seen, few) = seeded_draw(stream(7), 100, "x").unwrap();
        assert_eq!(
            (seen, few.len()),
            (7, 7),
            "fewer items than the limit: all of them"
        );
        assert!(seeded_draw(stream(5), 0, "x").unwrap().1.is_empty());
    }

    #[test]
    fn unspaced_scripts() {
        assert!(unspaced("ja"));
        assert!(unspaced("zh-Hans"));
        assert!(!unspaced("vi"));
        assert!(!unspaced("en"));
    }
}
