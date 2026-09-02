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
use schema::{
    ensure_project_search_schema, mark_project_search_index_refresh_completed,
    open_project_search_db, project_search_db_path,
};
#[cfg(test)]
use scoring::{
    build_plain_text_snippet, collect_unique_bigrams, collect_unique_tokens,
    collect_unique_trigrams, compute_search_score, normalize_search_text, score_to_number,
    PROJECT_SEARCH_SNIPPET_CHAR_LIMIT,
};

#[cfg(test)]
use indexer::row_search_documents_from_value;
#[cfg(test)]
use refresh::{
    append_diff_name_status_changes, append_status_porcelain_changes,
    extract_chapter_dir_from_repo_path, RepoRefreshPlan,
};

const MAX_RESULT_ROWS: usize = 500;
const MIN_SEARCH_QUERY_LENGTH: usize = 2;
const PROJECT_SEARCH_CONTENT_VERSION: i64 = 2;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProjectsInput {
    installation_id: i64,
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshProjectSearchIndexInput {
    installation_id: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchProjectsResponse {
    results: Vec<ProjectSearchRowResult>,
    total: usize,
    strong_total: usize,
    weaker_total: usize,
    index_status: String,
    total_capped: bool,
    query_too_short: bool,
    minimum_query_length: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProjectSearchQualityTier {
    Strong,
    Weaker,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum ProjectSearchMatchBand {
    Fuzzy,
    PartialToken,
    FullToken,
    OrderedTokens,
    ExactPhrase,
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

#[derive(Clone)]
struct ProjectSearchDocumentMatch {
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
    snippet: String,
    exact_phrase: bool,
    score: f64,
    match_band: ProjectSearchMatchBand,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSearchExcerpt {
    #[serde(skip_serializing)]
    result_id: String,
    language_code: String,
    language_name: String,
    snippet_source: String,
    snippet: String,
    exact_phrase: bool,
    #[serde(skip_serializing)]
    score: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSearchRowResult {
    project_id: String,
    project_title: String,
    repo_name: String,
    chapter_id: String,
    chapter_title: String,
    row_id: String,
    row_order_key: String,
    excerpts: Vec<ProjectSearchExcerpt>,
    score: f64,
    quality_tier: ProjectSearchQualityTier,
    #[serde(skip_serializing)]
    match_band: ProjectSearchMatchBand,
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
    mark_project_search_index_refresh_completed(&connection)?;
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
        collect_unique_bigrams, collect_unique_tokens, collect_unique_trigrams,
        compute_search_score, extract_chapter_dir_from_repo_path, normalize_search_text,
        query::{
            aggregate_project_search_rows, classify_project_search_row_quality,
            search_projects_in_connection, select_candidate_document_ids,
            strong_project_search_row_count,
        },
        row_search_documents_from_value,
        schema::{
            ensure_project_search_schema, mark_project_search_index_refresh_completed,
            project_search_index_has_documents, project_search_index_requires_refresh,
        },
        score_to_number, CandidateDocument, IndexedDocument, ProjectSearchDocumentMatch,
        ProjectSearchMatchBand, ProjectSearchQualityTier, RepoRefreshPlan, MIN_SEARCH_QUERY_LENGTH,
        PROJECT_SEARCH_CONTENT_VERSION, PROJECT_SEARCH_SNIPPET_CHAR_LIMIT,
    };

    const PROJECT_SEARCH_QUALITY_GOLDEN_JSON: &str =
        include_str!("../../../tests/fixtures/project-search-quality/golden.json");

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProjectSearchQualityGoldenFixture {
        cases: Vec<ProjectSearchQualityGoldenCase>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProjectSearchQualityGoldenCase {
        name: String,
        query: String,
        excerpts: Vec<ProjectSearchQualityGoldenExcerpt>,
        strong_row_ids: Vec<String>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ProjectSearchQualityGoldenExcerpt {
        row_id: String,
        row_order_key: String,
        language_code: String,
        language_name: String,
        snippet_source: String,
        text: String,
    }

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

    fn document_match(
        row_id: &str,
        row_order_key: &str,
        language_code: &str,
        language_name: &str,
        snippet_source: &str,
        score: f64,
    ) -> ProjectSearchDocumentMatch {
        ProjectSearchDocumentMatch {
            result_id: format!("{row_id}:{language_code}:{snippet_source}"),
            project_id: "project-1".to_string(),
            project_title: "Project".to_string(),
            repo_name: "repo".to_string(),
            chapter_id: "chapter-1".to_string(),
            chapter_title: "Chapter".to_string(),
            row_id: row_id.to_string(),
            row_order_key: row_order_key.to_string(),
            language_code: language_code.to_string(),
            language_name: language_name.to_string(),
            snippet_source: snippet_source.to_string(),
            snippet: format!("{language_name} {snippet_source}"),
            exact_phrase: true,
            score,
            match_band: ProjectSearchMatchBand::ExactPhrase,
        }
    }

    fn scored_fixture_match(
        query: &str,
        excerpt: &ProjectSearchQualityGoldenExcerpt,
    ) -> ProjectSearchDocumentMatch {
        let normalized_query = normalize_search_text(query);
        let normalized_document = normalize_search_text(&excerpt.text);
        let query_tokens = collect_unique_tokens(&normalized_query);
        let document_tokens = collect_unique_tokens(&normalized_document)
            .into_iter()
            .collect::<std::collections::HashSet<_>>();
        let token_hits = query_tokens
            .iter()
            .filter(|token| document_tokens.contains(*token))
            .count();
        let use_bigrams = normalized_query.chars().count() == MIN_SEARCH_QUERY_LENGTH;
        let query_ngrams = if use_bigrams {
            collect_unique_bigrams(&normalized_query)
        } else {
            collect_unique_trigrams(&normalized_query)
        };
        let document_ngrams = if use_bigrams {
            collect_unique_bigrams(&normalized_document)
        } else {
            collect_unique_trigrams(&normalized_document)
        };
        let document_ngram_set = document_ngrams
            .iter()
            .collect::<std::collections::HashSet<_>>();
        let ngram_hits = query_ngrams
            .iter()
            .filter(|ngram| document_ngram_set.contains(ngram))
            .count();
        let candidate = CandidateDocument {
            token_hits,
            ngram_hits,
            document_ngram_count: document_ngrams.len(),
            document: IndexedDocument {
                result_id: format!(
                    "{}:{}:{}",
                    excerpt.row_id, excerpt.language_code, excerpt.snippet_source
                ),
                project_id: "project-1".to_string(),
                project_title: "Project".to_string(),
                repo_name: "repo".to_string(),
                chapter_id: "chapter-1".to_string(),
                chapter_title: "Chapter".to_string(),
                row_id: excerpt.row_id.clone(),
                row_order_key: excerpt.row_order_key.clone(),
                language_code: excerpt.language_code.clone(),
                language_name: excerpt.language_name.clone(),
                snippet_source: excerpt.snippet_source.clone(),
                plain_text: excerpt.text.clone(),
                search_text: normalized_document,
                trigram_count: document_ngrams.len(),
            },
        };
        let score = compute_search_score(
            &candidate,
            &normalized_query,
            query_tokens.len(),
            query_ngrams.len(),
        );
        ProjectSearchDocumentMatch {
            result_id: candidate.document.result_id,
            project_id: candidate.document.project_id,
            project_title: candidate.document.project_title,
            repo_name: candidate.document.repo_name,
            chapter_id: candidate.document.chapter_id,
            chapter_title: candidate.document.chapter_title,
            row_id: candidate.document.row_id,
            row_order_key: candidate.document.row_order_key,
            language_code: candidate.document.language_code,
            language_name: candidate.document.language_name,
            snippet_source: candidate.document.snippet_source,
            snippet: candidate.document.plain_text,
            exact_phrase: score.exact_phrase,
            score: score_to_number(score),
            match_band: score.match_band(),
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
    fn schema_upgrade_preserves_existing_index_and_marks_it_for_refresh() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE indexed_repos (
                   repo_key TEXT PRIMARY KEY,
                   project_id TEXT NOT NULL,
                   repo_name TEXT NOT NULL,
                   project_title TEXT NOT NULL,
                   head_sha TEXT NOT NULL,
                   last_indexed_at INTEGER NOT NULL
                 );
                 INSERT INTO indexed_repos VALUES (
                   'repo-1', 'project-1', 'repo-1', 'Project', 'head', 1
                 );",
            )
            .unwrap();

        ensure_project_search_schema(&connection).unwrap();

        let repo_count = connection
            .query_row("SELECT COUNT(*) FROM indexed_repos", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        let content_version = connection
            .query_row(
                "SELECT content_version FROM indexed_repos WHERE repo_key = 'repo-1'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(repo_count, 1);
        assert_eq!(content_version, 1);
        assert!(project_search_index_requires_refresh(&connection).unwrap());
    }

    #[test]
    fn current_index_version_does_not_require_refresh() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        ensure_project_search_schema(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO indexed_repos (
                   repo_key, project_id, repo_name, project_title, head_sha,
                   last_indexed_at, content_version
                 ) VALUES ('repo-1', 'project-1', 'repo-1', 'Project', 'head', 1, ?1)",
                [PROJECT_SEARCH_CONTENT_VERSION],
            )
            .unwrap();

        assert!(!project_search_index_requires_refresh(&connection).unwrap());
    }

    #[test]
    fn empty_index_requires_refresh() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        ensure_project_search_schema(&connection).unwrap();

        assert!(project_search_index_requires_refresh(&connection).unwrap());
        assert!(!project_search_index_has_documents(&connection).unwrap());
    }

    #[test]
    fn completed_empty_index_is_ready() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        ensure_project_search_schema(&connection).unwrap();

        mark_project_search_index_refresh_completed(&connection).unwrap();

        assert!(!project_search_index_requires_refresh(&connection).unwrap());
        assert!(!project_search_index_has_documents(&connection).unwrap());
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
    fn aggregate_project_search_rows_keeps_all_excerpts_and_orders_rows() {
        let rows = aggregate_project_search_rows(vec![
            document_match("row-2", "b0", "vi", "Vietnamese", "field", 15.0),
            document_match("row-1", "a0", "vi", "Vietnamese", "footnote", 20.0),
            document_match("row-1", "a0", "en", "English", "field", 25.0),
        ]);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].row_id, "row-1");
        assert_eq!(rows[0].score, 25.0);
        assert_eq!(rows[0].excerpts.len(), 2);
        assert_eq!(rows[0].excerpts[0].language_name, "English");
        assert_eq!(rows[0].excerpts[1].language_name, "Vietnamese");
        assert_eq!(rows[1].row_id, "row-2");
    }

    #[test]
    fn project_search_quality_boundary_matches_golden_cases() {
        let fixture: ProjectSearchQualityGoldenFixture =
            serde_json::from_str(PROJECT_SEARCH_QUALITY_GOLDEN_JSON).unwrap();
        for case in fixture.cases {
            let mut matches = case
                .excerpts
                .iter()
                .map(|excerpt| scored_fixture_match(&case.query, excerpt))
                .collect::<Vec<_>>();
            matches.sort_by(|left, right| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut rows = aggregate_project_search_rows(matches);
            classify_project_search_row_quality(&mut rows);
            let strong_row_ids = rows
                .iter()
                .filter(|row| row.quality_tier == ProjectSearchQualityTier::Strong)
                .map(|row| row.row_id.clone())
                .collect::<Vec<_>>();
            assert_eq!(strong_row_ids, case.strong_row_ids, "{}", case.name);
        }
    }

    #[test]
    fn project_search_quality_fallback_caps_borderline_results_without_splitting_ties() {
        let gradual_scores = (0..75)
            .map(|index| 1000.0 - index as f64 * 0.1)
            .collect::<Vec<_>>();
        assert_eq!(strong_project_search_row_count(&gradual_scores), 50);

        let tied_scores = vec![100.0; 55];
        assert_eq!(strong_project_search_row_count(&tied_scores), 55);
        assert_eq!(strong_project_search_row_count(&[100.0]), 1);
    }

    #[test]
    fn project_search_quality_uses_a_clear_borderline_score_knee() {
        assert_eq!(
            strong_project_search_row_count(&[300.0, 298.0, 296.0, 120.0, 118.0]),
            3,
        );
    }

    #[test]
    fn project_search_quality_is_assigned_after_row_aggregation() {
        let mut exact_excerpt = document_match("row-1", "a0", "en", "English", "field", 100.0);
        exact_excerpt.match_band = ProjectSearchMatchBand::ExactPhrase;
        let mut fuzzy_excerpt = document_match("row-1", "a0", "vi", "Vietnamese", "field", 95.0);
        fuzzy_excerpt.match_band = ProjectSearchMatchBand::Fuzzy;
        let mut weak_row = document_match("row-2", "b0", "en", "English", "field", 90.0);
        weak_row.match_band = ProjectSearchMatchBand::Fuzzy;
        let mut rows = aggregate_project_search_rows(vec![exact_excerpt, fuzzy_excerpt, weak_row]);

        let strong_total = classify_project_search_row_quality(&mut rows);

        assert_eq!(rows.len(), 2);
        assert_eq!(strong_total, 1);
        assert_eq!(rows[0].quality_tier, ProjectSearchQualityTier::Strong);
        assert_eq!(rows[1].quality_tier, ProjectSearchQualityTier::Weaker);
    }

    #[test]
    fn project_search_candidate_cap_counts_rows_and_keeps_selected_row_excerpts() {
        let ranked_candidates = vec![(1, 100), (2, 99), (3, 98), (4, 97)];
        let row_keys = std::collections::HashMap::from([
            (1, ("p".to_string(), "c".to_string(), "row-1".to_string())),
            (2, ("p".to_string(), "c".to_string(), "row-2".to_string())),
            (3, ("p".to_string(), "c".to_string(), "row-1".to_string())),
            (4, ("p".to_string(), "c".to_string(), "row-3".to_string())),
        ]);

        let (document_ids, total_capped) =
            select_candidate_document_ids(ranked_candidates, &row_keys, 2);

        assert_eq!(document_ids, vec![1, 2, 3]);
        assert!(total_capped);
    }

    #[test]
    #[ignore = "requires GNOSIS_PROJECT_SEARCH_CALIBRATION_DB and local corpus data"]
    fn project_search_calibration_report_for_local_corpus() {
        let database_path = std::env::var("GNOSIS_PROJECT_SEARCH_CALIBRATION_DB")
            .expect("GNOSIS_PROJECT_SEARCH_CALIBRATION_DB must point to a search index");
        let queries = std::env::var("GNOSIS_PROJECT_SEARCH_CALIBRATION_QUERIES")
            .unwrap_or_else(|_| "Drukpa|cuerpo astral|đức phật".to_string());
        let include_details = std::env::var("GNOSIS_PROJECT_SEARCH_CALIBRATION_DETAILS")
            .is_ok_and(|value| value == "1");
        let database_uri = format!(
            "file:{}?mode=ro&immutable=1",
            database_path.replace(' ', "%20")
        );
        let connection = rusqlite::Connection::open_with_flags(
            database_uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                | rusqlite::OpenFlags::SQLITE_OPEN_URI
                | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();

        for query in queries
            .split('|')
            .map(str::trim)
            .filter(|query| !query.is_empty())
        {
            let started_at = std::time::Instant::now();
            let normalized_query = normalize_search_text(query);
            let response = search_projects_in_connection(
                &connection,
                &normalized_query,
                normalized_query.chars().count(),
            )
            .unwrap();
            let mut band_counts = std::collections::BTreeMap::<String, usize>::new();
            for row in &response.results {
                *band_counts
                    .entry(format!("{:?}", row.match_band))
                    .or_insert(0) += 1;
            }
            eprintln!(
                "CALIBRATION query={query:?} elapsed_ms={} total={} strong={} weaker={} capped={} bands={band_counts:?}",
                started_at.elapsed().as_millis(),
                response.total,
                response.strong_total,
                response.weaker_total,
                response.total_capped,
            );
            for (rank, row) in response
                .results
                .iter()
                .take(if include_details { 12 } else { 0 })
                .enumerate()
            {
                let snippet = row
                    .excerpts
                    .first()
                    .map(|excerpt| excerpt.snippet.chars().take(100).collect::<String>())
                    .unwrap_or_default();
                eprintln!(
                    "CALIBRATION rank={} tier={:?} band={:?} score={:.3} project={:?} chapter={:?} row={} snippet={snippet:?}",
                    rank + 1,
                    row.quality_tier,
                    row.match_band,
                    row.score,
                    row.project_title,
                    row.chapter_title,
                    row.row_id,
                );
            }
        }
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
                    "footnote": "Nota visible",
                    "image_caption": "Pie de foto"
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

        assert_eq!(documents.len(), 4);
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
        assert!(documents.iter().any(|document| {
            document.snippet_source == "image-caption" && document.plain_text == "Pie de foto"
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
