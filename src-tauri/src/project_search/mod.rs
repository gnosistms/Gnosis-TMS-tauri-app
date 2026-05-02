use std::{collections::HashMap, fs, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

mod discovery;
mod indexer;
mod query;
mod refresh;
mod schema;
mod scoring;

use indexer::refresh_project_index_current;
use query::search_projects_sync;
use schema::{ensure_project_search_schema, open_project_search_db, project_search_db_path};
#[cfg(test)]
use scoring::{
    build_plain_text_snippet, collect_unique_bigrams, collect_unique_trigrams,
    compute_search_score, normalize_search_text, score_to_number,
    PROJECT_SEARCH_SNIPPET_CHAR_LIMIT,
};

#[cfg(test)]
use indexer::row_search_documents_from_value;
#[cfg(test)]
use refresh::{
    append_diff_name_status_changes, append_status_porcelain_changes,
    extract_chapter_dir_from_repo_path, RepoRefreshPlan,
};

const DEFAULT_SEARCH_LIMIT: usize = 50;
const MAX_SEARCH_LIMIT: usize = 200;
const MAX_CANDIDATES: usize = 500;
const MIN_SEARCH_QUERY_LENGTH: usize = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProjectsInput {
    installation_id: i64,
    query: String,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshProjectSearchIndexInput {
    installation_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProjectsResponse {
    results: Vec<ProjectSearchResult>,
    total: usize,
    has_more: bool,
    index_status: String,
    total_capped: bool,
    query_too_short: bool,
    minimum_query_length: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshProjectSearchIndexResponse {
    repo_count: usize,
    updated_repo_count: usize,
    full_reindex_count: usize,
    dirty_chapter_count: usize,
    index_status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSearchResult {
    result_id: String,
    project_id: String,
    project_title: String,
    repo_name: String,
    chapter_id: String,
    chapter_title: String,
    row_id: String,
    #[serde(skip_serializing)]
    row_order_key: String,
    language_code: String,
    language_name: String,
    snippet_source: String,
    snippet: String,
    match_count: usize,
    exact_phrase: bool,
    score: f64,
}

#[derive(Clone)]
struct IndexedDocument {
    result_id: String,
    project_id: String,
    project_title: String,
    repo_name: String,
    chapter_id: String,
    chapter_title: String,
    row_id: String,
    row_order_key: String,
    language_code: String,
    language_name: String,
    snippet_source: String,
    plain_text: String,
    search_text: String,
    trigram_count: usize,
}

#[derive(Clone)]
struct CandidateDocument {
    document: IndexedDocument,
    token_hits: usize,
    ngram_hits: usize,
    document_ngram_count: usize,
}

#[tauri::command]
pub(crate) async fn search_projects(
    app: AppHandle,
    input: SearchProjectsInput,
) -> Result<SearchProjectsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || search_projects_sync(&app, input))
        .await
        .map_err(|error| format!("The projects search worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn refresh_project_search_index(
    app: AppHandle,
    input: RefreshProjectSearchIndexInput,
) -> Result<RefreshProjectSearchIndexResponse, String> {
    tauri::async_runtime::spawn_blocking(move || refresh_project_search_index_sync(&app, input))
        .await
        .map_err(|error| format!("The projects search indexing worker failed: {error}"))?
}

fn refresh_project_search_index_sync(
    app: &AppHandle,
    input: RefreshProjectSearchIndexInput,
) -> Result<RefreshProjectSearchIndexResponse, String> {
    let db_path = project_search_db_path(app, input.installation_id)?;
    let mut connection = open_project_search_db(&db_path)?;
    ensure_project_search_schema(&connection)?;
    let stats = refresh_project_index_current(app, input.installation_id, &mut connection)?;
    Ok(RefreshProjectSearchIndexResponse {
        repo_count: stats.repo_count,
        updated_repo_count: stats.updated_repo_count,
        full_reindex_count: stats.full_reindex_count,
        dirty_chapter_count: stats.dirty_chapter_count,
        index_status: "ready".to_string(),
    })
}

fn read_project_title(project_json_path: &Path) -> Result<Option<String>, String> {
    let project_value = read_json_value(project_json_path, "project.json")?;
    Ok(read_optional_string(&project_value, "title"))
}

fn read_language_name_map(chapter_value: &Value) -> HashMap<String, String> {
    let mut language_names = HashMap::new();
    let Some(languages) = chapter_value.get("languages").and_then(Value::as_array) else {
        return language_names;
    };

    for language in languages {
        let Some(code) = language
            .get("code")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let name = language
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(code)
            .to_string();
        language_names.insert(code.to_string(), name);
    }
    language_names
}

fn lifecycle_state(value: &Value) -> &str {
    value
        .get("lifecycle")
        .and_then(Value::as_object)
        .and_then(|lifecycle| lifecycle.get("state"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|state| !state.is_empty())
        .unwrap_or("active")
}

fn read_json_value(path: &Path, label: &str) -> Result<Value, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Could not read the {label} '{}': {error}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Could not parse the {label} '{}': {error}", path.display()))
}

fn read_required_string(value: &Value, key: &str, label: &str) -> Result<String, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("The {label} is missing a required '{key}' string."))
}

fn read_optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::{
        append_diff_name_status_changes, append_status_porcelain_changes, build_plain_text_snippet,
        collect_unique_bigrams, collect_unique_trigrams, compute_search_score,
        extract_chapter_dir_from_repo_path, normalize_search_text, row_search_documents_from_value,
        score_to_number, CandidateDocument, IndexedDocument, RepoRefreshPlan,
        PROJECT_SEARCH_SNIPPET_CHAR_LIMIT,
    };

    fn candidate(
        document_text: &str,
        token_hits: usize,
        ngram_hits: usize,
        document_ngram_count: usize,
    ) -> CandidateDocument {
        CandidateDocument {
            token_hits,
            ngram_hits,
            document_ngram_count,
            document: IndexedDocument {
                result_id: "result-1".to_string(),
                project_id: "project-1".to_string(),
                project_title: "Project".to_string(),
                repo_name: "repo".to_string(),
                chapter_id: "chapter-1".to_string(),
                chapter_title: "Chapter".to_string(),
                row_id: "row-1".to_string(),
                row_order_key: "a0".to_string(),
                language_code: "en".to_string(),
                language_name: "English".to_string(),
                snippet_source: "field".to_string(),
                plain_text: document_text.to_string(),
                search_text: normalize_search_text(document_text),
                trigram_count: document_ngram_count,
            },
        }
    }

    #[test]
    fn normalize_search_text_collapses_punctuation_and_spacing() {
        assert_eq!(normalize_search_text("  Hello,\nWorld!  "), "hello world");
    }

    #[test]
    fn collect_unique_bigrams_returns_stable_unique_values() {
        assert_eq!(
            collect_unique_bigrams("hello"),
            vec![
                "he".to_string(),
                "el".to_string(),
                "ll".to_string(),
                "lo".to_string()
            ]
        );
    }

    #[test]
    fn collect_unique_trigrams_returns_stable_unique_values() {
        assert_eq!(
            collect_unique_trigrams("hello"),
            vec!["hel".to_string(), "ell".to_string(), "llo".to_string()]
        );
    }

    #[test]
    fn exact_phrase_scores_higher_than_near_match() {
        let query = normalize_search_text("I like to eat dogs");
        let exact = candidate(
            "I like to eat dogs",
            5,
            12,
            collect_unique_trigrams("I like to eat dogs").len(),
        );
        let near = candidate(
            "I like to see dogs",
            4,
            9,
            collect_unique_trigrams("I like to see dogs").len(),
        );
        let exact_score = score_to_number(compute_search_score(&exact, &query, 5, 12));
        let near_score = score_to_number(compute_search_score(&near, &query, 5, 12));
        assert!(exact_score > near_score);
    }

    #[test]
    fn build_plain_text_snippet_truncates_long_text() {
        let snippet = build_plain_text_snippet(&"a".repeat(400), "");
        assert!(snippet.ends_with("..."));
        assert!(snippet.len() <= PROJECT_SEARCH_SNIPPET_CHAR_LIMIT + 3);
    }

    #[test]
    fn build_plain_text_snippet_keeps_short_text_whole() {
        let text = "a".repeat(PROJECT_SEARCH_SNIPPET_CHAR_LIMIT);
        assert_eq!(build_plain_text_snippet(&text, "needle"), text);
    }

    #[test]
    fn build_plain_text_snippet_centers_long_text_on_search_match() {
        let text = format!(
            "{}search term{}",
            "a".repeat(PROJECT_SEARCH_SNIPPET_CHAR_LIMIT),
            "b".repeat(PROJECT_SEARCH_SNIPPET_CHAR_LIMIT),
        );
        let snippet = build_plain_text_snippet(&text, &normalize_search_text("search term"));
        assert!(snippet.starts_with("..."));
        assert!(snippet.ends_with("..."));
        assert!(snippet.contains("search term"));
        assert!(snippet.find("search term").unwrap() > 100);
        assert!(snippet.find("search term").unwrap() < 250);
    }

    #[test]
    fn row_search_documents_from_value_indexes_non_empty_footnotes() {
        let row_value = serde_json::json!({
            "fields": {
                "es": {
                    "plain_text": "Texto principal",
                    "footnote": "Nota visible"
                },
                "en": {
                    "plain_text": "Reference",
                    "footnote": "   "
                }
            }
        });
        let language_names = std::collections::HashMap::from([
            ("es".to_string(), "Spanish".to_string()),
            ("en".to_string(), "English".to_string()),
        ]);

        let documents = row_search_documents_from_value(&row_value, &language_names);

        assert_eq!(documents.len(), 3);
        assert_eq!(
            documents
                .iter()
                .filter(|document| document.snippet_source == "field")
                .count(),
            2
        );
        assert!(documents.iter().any(|document| {
            document.snippet_source == "footnote" && document.plain_text == "Nota visible"
        }));
    }

    #[test]
    fn append_diff_name_status_changes_tracks_project_metadata_and_renamed_chapters() {
        let mut plan = RepoRefreshPlan::default();
        append_diff_name_status_changes(
            &mut plan,
            "M\tproject.json\nR100\tchapters/old-file/chapter.json\tchapters/new-file/chapter.json\nM\tchapters/new-file/rows/row-1.json\n",
        )
        .unwrap();

        assert!(plan.project_metadata_changed);
        let mut chapter_dirs = plan.touched_chapter_dirs.into_iter().collect::<Vec<_>>();
        chapter_dirs.sort();
        assert_eq!(
            chapter_dirs,
            vec!["new-file".to_string(), "old-file".to_string()]
        );
    }

    #[test]
    fn append_status_porcelain_changes_tracks_dirty_and_untracked_chapters() {
        let mut plan = RepoRefreshPlan::default();
        append_status_porcelain_changes(
            &mut plan,
            " M chapters/ch-1/rows/row-1.json\n?? chapters/ch-2/chapter.json\nR  chapters/ch-old/rows/row-9.json -> chapters/ch-new/rows/row-9.json\n",
        )
        .unwrap();

        let mut chapter_dirs = plan.touched_chapter_dirs.into_iter().collect::<Vec<_>>();
        chapter_dirs.sort();
        assert_eq!(
            chapter_dirs,
            vec![
                "ch-1".to_string(),
                "ch-2".to_string(),
                "ch-new".to_string(),
                "ch-old".to_string(),
            ]
        );
    }

    #[test]
    fn extract_chapter_dir_from_repo_path_reads_repo_relative_chapter_dirs() {
        assert_eq!(
            extract_chapter_dir_from_repo_path("chapters/file-1/rows/row-1.json"),
            Some("file-1".to_string())
        );
        assert_eq!(extract_chapter_dir_from_repo_path("project.json"), None);
        assert_eq!(extract_chapter_dir_from_repo_path("notes/readme.md"), None);
    }
}
