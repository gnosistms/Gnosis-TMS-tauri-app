use std::{
  collections::BTreeSet,
  fs,
  path::{Path, PathBuf},
  process::Command,
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::storage_paths::local_glossary_repo_root;

const GLOSSARY_GITATTRIBUTES: &str = "* text=auto eol=lf\n";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLifecycle {
  state: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryLanguage {
  code: String,
  name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryLanguages {
  source: StoredGlossaryLanguage,
  target: StoredGlossaryLanguage,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredGlossaryFile {
  glossary_id: String,
  title: String,
  lifecycle: StoredLifecycle,
  languages: StoredGlossaryLanguages,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredGlossaryTermFile {
  term_id: String,
  source_terms: Vec<String>,
  target_terms: Vec<String>,
  #[serde(default)]
  notes_to_translators: String,
  #[serde(default)]
  footnote: String,
  #[serde(default)]
  untranslated: bool,
  lifecycle: StoredLifecycle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalGlossariesInput {
  installation_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryEditorDataInput {
  installation_id: i64,
  repo_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateLocalGlossaryInput {
  installation_id: i64,
  title: String,
  source_language_code: String,
  source_language_name: String,
  target_language_code: String,
  target_language_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGlossaryTermInput {
  installation_id: i64,
  repo_name: String,
  term_id: Option<String>,
  source_terms: Vec<String>,
  target_terms: Vec<String>,
  notes_to_translators: String,
  footnote: String,
  untranslated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGlossaryTermInput {
  installation_id: i64,
  repo_name: String,
  term_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryLanguageInfo {
  code: String,
  name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalGlossarySummary {
  glossary_id: String,
  repo_name: String,
  title: String,
  source_language: GlossaryLanguageInfo,
  target_language: GlossaryLanguageInfo,
  lifecycle_state: String,
  term_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryTermEditorRecord {
  term_id: String,
  source_terms: Vec<String>,
  target_terms: Vec<String>,
  notes_to_translators: String,
  footnote: String,
  untranslated: bool,
  lifecycle_state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadGlossaryEditorDataResponse {
  glossary_id: String,
  title: String,
  source_language: GlossaryLanguageInfo,
  target_language: GlossaryLanguageInfo,
  lifecycle_state: String,
  term_count: usize,
  terms: Vec<GlossaryTermEditorRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGlossaryTermResponse {
  glossary_id: String,
  term_count: usize,
  term: GlossaryTermEditorRecord,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGlossaryTermResponse {
  glossary_id: String,
  term_id: String,
  term_count: usize,
}

#[tauri::command]
pub(crate) async fn list_local_gtms_glossaries(
  app: AppHandle,
  input: ListLocalGlossariesInput,
) -> Result<Vec<LocalGlossarySummary>, String> {
  tauri::async_runtime::spawn_blocking(move || list_local_gtms_glossaries_sync(&app, input))
    .await
    .map_err(|error| format!("The local glossary worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_glossary_editor_data(
  app: AppHandle,
  input: LoadGlossaryEditorDataInput,
) -> Result<LoadGlossaryEditorDataResponse, String> {
  tauri::async_runtime::spawn_blocking(move || load_gtms_glossary_editor_data_sync(&app, input))
    .await
    .map_err(|error| format!("The glossary load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_local_gtms_glossary(
  app: AppHandle,
  input: CreateLocalGlossaryInput,
) -> Result<LocalGlossarySummary, String> {
  tauri::async_runtime::spawn_blocking(move || create_local_gtms_glossary_sync(&app, input))
    .await
    .map_err(|error| format!("The glossary creation worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_gtms_glossary_term(
  app: AppHandle,
  input: UpsertGlossaryTermInput,
) -> Result<UpsertGlossaryTermResponse, String> {
  tauri::async_runtime::spawn_blocking(move || upsert_gtms_glossary_term_sync(&app, input))
    .await
    .map_err(|error| format!("The glossary term worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gtms_glossary_term(
  app: AppHandle,
  input: DeleteGlossaryTermInput,
) -> Result<DeleteGlossaryTermResponse, String> {
  tauri::async_runtime::spawn_blocking(move || delete_gtms_glossary_term_sync(&app, input))
    .await
    .map_err(|error| format!("The glossary term delete worker failed: {error}"))?
}

fn list_local_gtms_glossaries_sync(
  app: &AppHandle,
  input: ListLocalGlossariesInput,
) -> Result<Vec<LocalGlossarySummary>, String> {
  let repo_root = local_glossary_repo_root(app, input.installation_id)?;
  let mut summaries = Vec::new();

  for entry in fs::read_dir(&repo_root)
    .map_err(|error| format!("Could not read the local glossary repo folder: {error}"))?
  {
    let entry = entry.map_err(|error| format!("Could not read a glossary repo entry: {error}"))?;
    let repo_path = entry.path();
    if !repo_path.is_dir() {
      continue;
    }

    if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
      continue;
    }

    let glossary_json_path = repo_path.join("glossary.json");
    if !glossary_json_path.exists() {
      continue;
    }

    let glossary_file: StoredGlossaryFile = read_json_file(&glossary_json_path, "glossary.json")?;
    let terms = load_glossary_terms(&repo_path.join("terms"))?;
    let active_term_count = terms
      .iter()
      .filter(|term| term.lifecycle.state == "active")
      .count();

    summaries.push(LocalGlossarySummary {
      glossary_id: glossary_file.glossary_id,
      repo_name: repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string(),
      title: glossary_file.title,
      source_language: GlossaryLanguageInfo {
        code: glossary_file.languages.source.code,
        name: glossary_file.languages.source.name,
      },
      target_language: GlossaryLanguageInfo {
        code: glossary_file.languages.target.code,
        name: glossary_file.languages.target.name,
      },
      lifecycle_state: glossary_file.lifecycle.state,
      term_count: active_term_count,
    });
  }

  summaries.sort_by(|left, right| {
    left
      .title
      .to_lowercase()
      .cmp(&right.title.to_lowercase())
      .then_with(|| left.repo_name.cmp(&right.repo_name))
  });

  Ok(summaries)
}

fn load_gtms_glossary_editor_data_sync(
  app: &AppHandle,
  input: LoadGlossaryEditorDataInput,
) -> Result<LoadGlossaryEditorDataResponse, String> {
  let repo_path = glossary_repo_path(app, input.installation_id, &input.repo_name)?;
  let glossary_file = read_glossary_file(&repo_path)?;
  let terms = load_glossary_terms(&repo_path.join("terms"))?;

  let active_terms = terms
    .into_iter()
    .filter(|term| term.lifecycle.state == "active")
    .map(map_term_record)
    .collect::<Vec<_>>();

  Ok(LoadGlossaryEditorDataResponse {
    glossary_id: glossary_file.glossary_id,
    title: glossary_file.title,
    source_language: GlossaryLanguageInfo {
      code: glossary_file.languages.source.code,
      name: glossary_file.languages.source.name,
    },
    target_language: GlossaryLanguageInfo {
      code: glossary_file.languages.target.code,
      name: glossary_file.languages.target.name,
    },
    lifecycle_state: glossary_file.lifecycle.state,
    term_count: active_terms.len(),
    terms: active_terms,
  })
}

fn create_local_gtms_glossary_sync(
  app: &AppHandle,
  input: CreateLocalGlossaryInput,
) -> Result<LocalGlossarySummary, String> {
  let title = input.title.trim();
  if title.is_empty() {
    return Err("Enter a glossary name.".to_string());
  }

  let source_language_code = input.source_language_code.trim().to_lowercase();
  if source_language_code.is_empty() {
    return Err("Enter a source language code.".to_string());
  }

  let source_language_name = input.source_language_name.trim();
  if source_language_name.is_empty() {
    return Err("Enter a source language name.".to_string());
  }

  let target_language_code = input.target_language_code.trim().to_lowercase();
  if target_language_code.is_empty() {
    return Err("Enter a target language code.".to_string());
  }

  let target_language_name = input.target_language_name.trim();
  if target_language_name.is_empty() {
    return Err("Enter a target language name.".to_string());
  }

  let repo_root = local_glossary_repo_root(app, input.installation_id)?;
  let repo_name = unique_glossary_repo_name(&repo_root, &slugify_repo_name(title));
  let repo_path = repo_root.join(&repo_name);
  fs::create_dir(&repo_path)
    .map_err(|error| format!("Could not create the local glossary repo '{}': {error}", repo_path.display()))?;

  git_output(&repo_path, &["init"])?;
  let _ = git_output(&repo_path, &["symbolic-ref", "HEAD", "refs/heads/main"]);

  ensure_gitattributes(&repo_path.join(".gitattributes"))?;

  let glossary_file = StoredGlossaryFile {
    glossary_id: Uuid::now_v7().to_string(),
    title: title.to_string(),
    lifecycle: StoredLifecycle {
      state: "active".to_string(),
    },
    languages: StoredGlossaryLanguages {
      source: StoredGlossaryLanguage {
        code: source_language_code.clone(),
        name: source_language_name.to_string(),
      },
      target: StoredGlossaryLanguage {
        code: target_language_code.clone(),
        name: target_language_name.to_string(),
      },
    },
  };

  write_json_pretty(&repo_path.join("glossary.json"), &glossary_file)?;
  git_output(&repo_path, &["add", ".gitattributes", "glossary.json"])?;
  git_output(
    &repo_path,
    &["commit", "-m", "Initialize glossary", "--", ".gitattributes", "glossary.json"],
  )?;

  Ok(LocalGlossarySummary {
    glossary_id: glossary_file.glossary_id,
    repo_name,
    title: glossary_file.title,
    source_language: GlossaryLanguageInfo {
      code: source_language_code,
      name: source_language_name.to_string(),
    },
    target_language: GlossaryLanguageInfo {
      code: target_language_code,
      name: target_language_name.to_string(),
    },
    lifecycle_state: "active".to_string(),
    term_count: 0,
  })
}

fn upsert_gtms_glossary_term_sync(
  app: &AppHandle,
  input: UpsertGlossaryTermInput,
) -> Result<UpsertGlossaryTermResponse, String> {
  let repo_path = glossary_repo_path(app, input.installation_id, &input.repo_name)?;
  let glossary_file = read_glossary_file(&repo_path)?;
  ensure_gitattributes(&repo_path.join(".gitattributes"))?;

  let sanitized_source_terms = sanitize_term_values(&input.source_terms);
  if sanitized_source_terms.is_empty() {
    return Err("Enter at least one source term.".to_string());
  }

  let mut sanitized_target_terms = sanitize_term_values(&input.target_terms);
  if input.untranslated && sanitized_target_terms.is_empty() {
    sanitized_target_terms = sanitized_source_terms.clone();
  }

  let term_id = input
    .term_id
    .clone()
    .unwrap_or_else(|| Uuid::now_v7().to_string());
  let term_path = repo_path.join("terms").join(format!("{term_id}.json"));
  let mut term_value = if term_path.exists() {
    let original_text = fs::read_to_string(&term_path)
      .map_err(|error| format!("Could not read term file '{}': {error}", term_path.display()))?;
    serde_json::from_str::<Value>(&original_text)
      .map_err(|error| format!("Could not parse term file '{}': {error}", term_path.display()))?
  } else {
    json!({})
  };

  let term_object = term_value
    .as_object_mut()
    .ok_or_else(|| "The term file is not a JSON object.".to_string())?;
  term_object.insert("term_id".to_string(), Value::String(term_id.clone()));
  term_object.insert(
    "source_terms".to_string(),
    Value::Array(
      sanitized_source_terms
        .iter()
        .cloned()
        .map(Value::String)
        .collect(),
    ),
  );
  term_object.insert(
    "target_terms".to_string(),
    Value::Array(
      sanitized_target_terms
        .iter()
        .cloned()
        .map(Value::String)
        .collect(),
    ),
  );
  term_object.insert(
    "notes_to_translators".to_string(),
    Value::String(input.notes_to_translators.trim().to_string()),
  );
  term_object.insert("footnote".to_string(), Value::String(input.footnote.trim().to_string()));
  term_object.insert("untranslated".to_string(), Value::Bool(input.untranslated));
  let lifecycle_value = term_object
    .entry("lifecycle".to_string())
    .or_insert_with(|| json!({ "state": "active" }));
  let lifecycle_object = lifecycle_value
    .as_object_mut()
    .ok_or_else(|| "The term lifecycle is not a JSON object.".to_string())?;
  lifecycle_object.insert("state".to_string(), Value::String("active".to_string()));

  write_json_pretty(&term_path, &term_value)?;

  let relative_term_path = term_path
    .strip_prefix(&repo_path)
    .map_err(|error| format!("Could not resolve the term path for git: {error}"))?
    .to_string_lossy()
    .to_string();
  git_output(&repo_path, &["add", ".gitattributes", &relative_term_path])?;
  let commit_message = if input.term_id.is_some() {
    format!("Update glossary term {}", term_id)
  } else {
    format!("Add glossary term {}", term_id)
  };
  git_output(
    &repo_path,
    &["commit", "-m", &commit_message, "--", ".gitattributes", &relative_term_path],
  )?;

  let term_count = load_glossary_terms(&repo_path.join("terms"))?
    .into_iter()
    .filter(|term| term.lifecycle.state == "active")
    .count();

  Ok(UpsertGlossaryTermResponse {
    glossary_id: glossary_file.glossary_id,
    term_count,
    term: GlossaryTermEditorRecord {
      term_id,
      source_terms: sanitized_source_terms,
      target_terms: sanitized_target_terms,
      notes_to_translators: input.notes_to_translators.trim().to_string(),
      footnote: input.footnote.trim().to_string(),
      untranslated: input.untranslated,
      lifecycle_state: "active".to_string(),
    },
  })
}

fn delete_gtms_glossary_term_sync(
  app: &AppHandle,
  input: DeleteGlossaryTermInput,
) -> Result<DeleteGlossaryTermResponse, String> {
  let repo_path = glossary_repo_path(app, input.installation_id, &input.repo_name)?;
  let glossary_file = read_glossary_file(&repo_path)?;
  let term_path = repo_path.join("terms").join(format!("{}.json", input.term_id));
  if !term_path.exists() {
    return Err("The glossary term could not be found.".to_string());
  }

  let relative_term_path = term_path
    .strip_prefix(&repo_path)
    .map_err(|error| format!("Could not resolve the term path for git: {error}"))?
    .to_string_lossy()
    .to_string();
  git_output(&repo_path, &["rm", &relative_term_path])?;
  git_output(
    &repo_path,
    &["commit", "-m", &format!("Delete glossary term {}", input.term_id), "--", &relative_term_path],
  )?;

  let term_count = load_glossary_terms(&repo_path.join("terms"))?
    .into_iter()
    .filter(|term| term.lifecycle.state == "active")
    .count();

  Ok(DeleteGlossaryTermResponse {
    glossary_id: glossary_file.glossary_id,
    term_id: input.term_id,
    term_count,
  })
}

fn glossary_repo_path(app: &AppHandle, installation_id: i64, repo_name: &str) -> Result<PathBuf, String> {
  let repo_root = local_glossary_repo_root(app, installation_id)?;
  let repo_path = repo_root.join(repo_name);
  if !repo_path.exists() {
    return Err("The local glossary repo is not available yet.".to_string());
  }
  if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err("The local glossary repo is missing or invalid.".to_string());
  }
  if !repo_path.join("glossary.json").exists() {
    return Err("The local glossary repo is missing glossary.json.".to_string());
  }
  Ok(repo_path)
}

fn read_glossary_file(repo_path: &Path) -> Result<StoredGlossaryFile, String> {
  read_json_file(&repo_path.join("glossary.json"), "glossary.json")
}

fn load_glossary_terms(terms_path: &Path) -> Result<Vec<StoredGlossaryTermFile>, String> {
  if !terms_path.exists() {
    return Ok(Vec::new());
  }

  let mut terms = Vec::new();
  for entry in fs::read_dir(terms_path)
    .map_err(|error| format!("Could not read the glossary terms folder: {error}"))?
  {
    let entry = entry.map_err(|error| format!("Could not read a glossary term entry: {error}"))?;
    let path = entry.path();
    if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
      continue;
    }
    terms.push(read_json_file(&path, "glossary term")?);
  }

  terms.sort_by(|left, right| {
    first_term_label(left)
      .cmp(&first_term_label(right))
      .then_with(|| left.term_id.cmp(&right.term_id))
  });
  Ok(terms)
}

fn first_term_label(term: &StoredGlossaryTermFile) -> String {
  term
    .source_terms
    .first()
    .cloned()
    .unwrap_or_else(|| term.term_id.clone())
    .to_lowercase()
}

fn map_term_record(term: StoredGlossaryTermFile) -> GlossaryTermEditorRecord {
  GlossaryTermEditorRecord {
    term_id: term.term_id,
    source_terms: term.source_terms,
    target_terms: term.target_terms,
    notes_to_translators: term.notes_to_translators,
    footnote: term.footnote,
    untranslated: term.untranslated,
    lifecycle_state: term.lifecycle.state,
  }
}

fn sanitize_term_values(values: &[String]) -> Vec<String> {
  let mut seen = BTreeSet::new();
  let mut sanitized = Vec::new();
  for value in values {
    let trimmed = value.trim();
    if trimmed.is_empty() {
      continue;
    }
    if seen.insert(trimmed.to_string()) {
      sanitized.push(trimmed.to_string());
    }
  }
  sanitized
}

fn slugify_repo_name(value: &str) -> String {
  let slug = value
    .trim()
    .to_lowercase()
    .chars()
    .map(|character| {
      if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
        character
      } else {
        '-'
      }
    })
    .collect::<String>()
    .split('-')
    .filter(|segment| !segment.is_empty())
    .collect::<Vec<_>>()
    .join("-");

  let slug = if slug.is_empty() {
    "glossary".to_string()
  } else {
    slug
  };

  slug.chars().take(100).collect()
}

fn unique_glossary_repo_name(repo_root: &Path, base_name: &str) -> String {
  if !repo_root.join(base_name).exists() {
    return base_name.to_string();
  }

  for suffix in 2.. {
    let suffix_text = format!("-{suffix}");
    let max_base_len = 100usize.saturating_sub(suffix_text.len());
    let trimmed_base = base_name.chars().take(max_base_len).collect::<String>();
    let candidate = format!("{trimmed_base}{suffix_text}");
    if !repo_root.join(&candidate).exists() {
      return candidate;
    }
  }

  unreachable!("glossary repo name search should always find a candidate");
}

fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
  let text = fs::read_to_string(path)
    .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
  serde_json::from_str(&text)
    .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

fn ensure_gitattributes(path: &Path) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }

  write_text_file(path, GLOSSARY_GITATTRIBUTES)
}

fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_path)
    .output()
    .map_err(|error| format!("Could not run git {}: {error}", args.join(" ")))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
      stderr
    } else if !stdout.is_empty() {
      stdout
    } else {
      format!("exit status {}", output.status)
    };
    return Err(format!("git {} failed: {detail}", args.join(" ")));
  }

  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
  let json = serde_json::to_string_pretty(value)
    .map_err(|error| format!("Could not serialize '{}': {error}", path.display()))?;
  write_text_file(path, &format!("{json}\n"))
}

fn write_text_file(path: &Path, contents: &str) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
  }
  fs::write(path, contents)
    .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}
