use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    local_repo_sync_state::read_local_repo_sync_state,
    repo_sync_shared::{git_output, read_current_head_oid},
    storage_paths::installation_data_dir,
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
    snippet: String,
    match_count: usize,
    exact_phrase: bool,
    score: f64,
}

#[derive(Clone)]
struct RepoRecord {
    repo_key: String,
    project_id: String,
    repo_name: String,
    project_title: String,
    repo_path: PathBuf,
    head_sha: String,
}

#[derive(Clone)]
struct IndexedRepoState {
    project_id: String,
    repo_name: String,
    project_title: String,
    head_sha: String,
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

#[derive(Clone, Copy)]
struct SearchScore {
    exact_phrase: bool,
    token_coverage: f64,
    ngram_dice: f64,
    ordered_tokens: bool,
    prefix_bonus: bool,
    length_penalty: f64,
}

#[derive(Default)]
struct ProjectSearchIndexRefreshStats {
    repo_count: usize,
    updated_repo_count: usize,
    full_reindex_count: usize,
    dirty_chapter_count: usize,
}

#[derive(Default)]
struct RepoRefreshPlan {
    project_metadata_changed: bool,
    touched_chapter_dirs: HashSet<String>,
    requires_full_reindex: bool,
}

struct SearchDocumentInserter<'conn> {
    connection: &'conn Connection,
    insert_document: rusqlite::Statement<'conn>,
    insert_token: rusqlite::Statement<'conn>,
    insert_bigram: rusqlite::Statement<'conn>,
    insert_trigram: rusqlite::Statement<'conn>,
}

impl<'conn> SearchDocumentInserter<'conn> {
    fn new(connection: &'conn Connection) -> Result<Self, String> {
        let insert_document = connection
            .prepare(
                "INSERT INTO search_documents (
                   result_id, repo_key, project_id, repo_name, project_title, chapter_dir, chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, plain_text, search_text, trigram_count, text_hash, updated_at_unix
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )
            .map_err(|error| format!("Could not prepare project search document insert: {error}"))?;
        let insert_token = connection
            .prepare("INSERT OR IGNORE INTO search_document_tokens (doc_id, token) VALUES (?1, ?2)")
            .map_err(|error| format!("Could not prepare project search token insert: {error}"))?;
        let insert_bigram = connection
            .prepare(
                "INSERT OR IGNORE INTO search_document_bigrams (doc_id, bigram) VALUES (?1, ?2)",
            )
            .map_err(|error| format!("Could not prepare project search bigram insert: {error}"))?;
        let insert_trigram = connection
            .prepare(
                "INSERT OR IGNORE INTO search_document_trigrams (doc_id, trigram) VALUES (?1, ?2)",
            )
            .map_err(|error| format!("Could not prepare project search trigram insert: {error}"))?;
        Ok(Self {
            connection,
            insert_document,
            insert_token,
            insert_bigram,
            insert_trigram,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_field_document(
        &mut self,
        repo: &RepoRecord,
        chapter_dir: &str,
        chapter_id: &str,
        chapter_title: &str,
        row_id: &str,
        row_order_key: &str,
        language_code: &str,
        language_name: &str,
        plain_text: &str,
    ) -> Result<(), String> {
        let trimmed_plain_text = plain_text.trim();
        if trimmed_plain_text.is_empty() {
            return Ok(());
        }

        let search_text = normalize_search_text(trimmed_plain_text);
        if search_text.is_empty() {
            return Ok(());
        }

        let result_id = format!(
            "{}:{}:{}:{}",
            repo.repo_key, chapter_id, row_id, language_code
        );
        let trigrams = collect_unique_trigrams(&search_text);
        let trigram_count = trigrams.len();
        let updated_at_unix = current_unix_timestamp();
        let text_hash = hash_text(trimmed_plain_text);
        self.insert_document
            .execute(params![
                result_id,
                repo.repo_key,
                repo.project_id,
                repo.repo_name,
                repo.project_title,
                chapter_dir,
                chapter_id,
                chapter_title,
                row_id,
                row_order_key,
                language_code,
                language_name,
                trimmed_plain_text,
                search_text,
                trigram_count as i64,
                text_hash,
                updated_at_unix as i64,
            ])
            .map_err(|error| format!("Could not insert a project search document: {error}"))?;
        let doc_id = self.connection.last_insert_rowid();
        for token in collect_unique_tokens(trimmed_plain_text) {
            self.insert_token
                .execute(params![doc_id, token])
                .map_err(|error| format!("Could not insert a project search token: {error}"))?;
        }
        for bigram in collect_unique_bigrams(&search_text) {
            self.insert_bigram
                .execute(params![doc_id, bigram])
                .map_err(|error| format!("Could not insert a project search bigram: {error}"))?;
        }
        for trigram in trigrams {
            self.insert_trigram
                .execute(params![doc_id, trigram])
                .map_err(|error| format!("Could not insert a project search trigram: {error}"))?;
        }
        Ok(())
    }
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

fn search_projects_sync(
    app: &AppHandle,
    input: SearchProjectsInput,
) -> Result<SearchProjectsResponse, String> {
    if input.query.trim().is_empty() {
        return Ok(empty_search_response(false, false));
    }

    let normalized_query = normalize_search_text(&input.query);
    let query_character_count = normalized_query.chars().count();
    let limit = input
        .limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let offset = input.offset.unwrap_or(0);
    if query_character_count < MIN_SEARCH_QUERY_LENGTH {
        return Ok(empty_search_response(true, false));
    }

    let db_path = project_search_db_path(app, input.installation_id)?;
    let connection = open_project_search_db(&db_path)?;
    ensure_project_search_schema(&connection)?;

    let use_bigram_index = query_character_count == MIN_SEARCH_QUERY_LENGTH;
    let query_tokens = if use_bigram_index {
        Vec::new()
    } else {
        collect_unique_tokens(&normalized_query)
    };
    let query_ngrams = if use_bigram_index {
        collect_unique_bigrams(&normalized_query)
    } else {
        collect_unique_trigrams(&normalized_query)
    };
    let query_ngram_count = query_ngrams.len();
    let query_token_count = query_tokens.len();

    let mut token_hits_by_doc_id = HashMap::<i64, usize>::new();
    if !query_tokens.is_empty() {
        let mut statement = connection
            .prepare("SELECT doc_id FROM search_document_tokens WHERE token = ?1")
            .map_err(|error| format!("Could not prepare project search token query: {error}"))?;
        for token in &query_tokens {
            let rows = statement
                .query_map([token.as_str()], |row| row.get::<_, i64>(0))
                .map_err(|error| format!("Could not run project search token query: {error}"))?;
            for row in rows {
                let doc_id = row.map_err(|error| {
                    format!("Could not decode a project search token hit: {error}")
                })?;
                *token_hits_by_doc_id.entry(doc_id).or_insert(0) += 1;
            }
        }
    }

    let mut ngram_hits_by_doc_id = HashMap::<i64, usize>::new();
    if !query_ngrams.is_empty() {
        let mut statement = if use_bigram_index {
            connection
                .prepare("SELECT doc_id FROM search_document_bigrams WHERE bigram = ?1")
                .map_err(|error| {
                    format!("Could not prepare project search bigram query: {error}")
                })?
        } else {
            connection
                .prepare("SELECT doc_id FROM search_document_trigrams WHERE trigram = ?1")
                .map_err(|error| {
                    format!("Could not prepare project search trigram query: {error}")
                })?
        };
        for ngram in &query_ngrams {
            let rows = statement
                .query_map([ngram.as_str()], |row| row.get::<_, i64>(0))
                .map_err(|error| {
                    if use_bigram_index {
                        format!("Could not run project search bigram query: {error}")
                    } else {
                        format!("Could not run project search trigram query: {error}")
                    }
                })?;
            for row in rows {
                let doc_id = row.map_err(|error| {
                    if use_bigram_index {
                        format!("Could not decode a project search bigram hit: {error}")
                    } else {
                        format!("Could not decode a project search trigram hit: {error}")
                    }
                })?;
                *ngram_hits_by_doc_id.entry(doc_id).or_insert(0) += 1;
            }
        }
    }

    let mut preliminary_candidates = HashMap::<i64, usize>::new();
    for (doc_id, count) in &token_hits_by_doc_id {
        *preliminary_candidates.entry(*doc_id).or_insert(0) += count.saturating_mul(100);
    }
    for (doc_id, count) in &ngram_hits_by_doc_id {
        *preliminary_candidates.entry(*doc_id).or_insert(0) += count.saturating_mul(10);
    }

    if preliminary_candidates.is_empty() {
        return Ok(empty_search_response(false, false));
    }

    let mut candidate_ids = preliminary_candidates.into_iter().collect::<Vec<_>>();
    candidate_ids.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let total_capped = candidate_ids.len() > MAX_CANDIDATES;
    candidate_ids.truncate(MAX_CANDIDATES);

    let mut by_id_statement = connection
    .prepare(
      "SELECT result_id, project_id, project_title, repo_name, chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, plain_text, search_text, trigram_count
       FROM search_documents
       WHERE doc_id = ?1",
    )
    .map_err(|error| format!("Could not prepare project search document lookup: {error}"))?;

    let mut ranked_results = Vec::<ProjectSearchResult>::new();
    for (doc_id, _) in candidate_ids {
        let Some(document) = by_id_statement
            .query_row([doc_id], |row| {
                Ok(IndexedDocument {
                    result_id: row.get(0)?,
                    project_id: row.get(1)?,
                    project_title: row.get(2)?,
                    repo_name: row.get(3)?,
                    chapter_id: row.get(4)?,
                    chapter_title: row.get(5)?,
                    row_id: row.get(6)?,
                    row_order_key: row.get(7)?,
                    language_code: row.get(8)?,
                    language_name: row.get(9)?,
                    plain_text: row.get(10)?,
                    search_text: row.get(11)?,
                    trigram_count: row.get::<_, i64>(12)?.max(0) as usize,
                })
            })
            .optional()
            .map_err(|error| {
                format!("Could not read an indexed project search document: {error}")
            })?
        else {
            continue;
        };

        let candidate = CandidateDocument {
            token_hits: *token_hits_by_doc_id.get(&doc_id).unwrap_or(&0),
            ngram_hits: *ngram_hits_by_doc_id.get(&doc_id).unwrap_or(&0),
            document_ngram_count: if use_bigram_index {
                collect_unique_bigrams(&document.search_text).len()
            } else {
                document.trigram_count
            },
            document,
        };
        let score = compute_search_score(
            &candidate,
            &normalized_query,
            query_token_count,
            query_ngram_count,
        );
        if score.exact_phrase || score.token_coverage > 0.0 || score.ngram_dice > 0.0 {
            ranked_results.push(ProjectSearchResult {
                result_id: candidate.document.result_id.clone(),
                project_id: candidate.document.project_id.clone(),
                project_title: candidate.document.project_title.clone(),
                repo_name: candidate.document.repo_name.clone(),
                chapter_id: candidate.document.chapter_id.clone(),
                chapter_title: candidate.document.chapter_title.clone(),
                row_id: candidate.document.row_id.clone(),
                row_order_key: candidate.document.row_order_key.clone(),
                language_code: candidate.document.language_code.clone(),
                language_name: candidate.document.language_name.clone(),
                snippet: build_plain_text_snippet(&candidate.document.plain_text),
                match_count: resolve_match_count(&candidate, &normalized_query),
                exact_phrase: score.exact_phrase,
                score: score_to_number(score),
            });
        }
    }

    ranked_results.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.project_title.cmp(&right.project_title))
            .then_with(|| left.chapter_title.cmp(&right.chapter_title))
            .then_with(|| left.row_order_key.cmp(&right.row_order_key))
            .then_with(|| left.row_id.cmp(&right.row_id))
            .then_with(|| left.language_name.cmp(&right.language_name))
    });

    let total = if total_capped {
        MAX_CANDIDATES
    } else {
        ranked_results.len()
    };
    let results = ranked_results
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    Ok(SearchProjectsResponse {
        has_more: offset.saturating_add(results.len()) < total,
        results,
        total,
        index_status: "ready".to_string(),
        total_capped,
        query_too_short: false,
        minimum_query_length: MIN_SEARCH_QUERY_LENGTH,
    })
}

fn refresh_project_index_current(
    app: &AppHandle,
    installation_id: i64,
    connection: &mut Connection,
) -> Result<ProjectSearchIndexRefreshStats, String> {
    let repo_root = installation_data_dir(app, installation_id)?.join("projects");
    fs::create_dir_all(&repo_root).map_err(|error| {
        format!(
            "Could not create the local project repo folder '{}': {error}",
            repo_root.display()
        )
    })?;

    let repos = discover_project_repos(&repo_root)?;
    let indexed_repos = load_indexed_repo_states(connection)?;
    let active_repo_keys = repos
        .iter()
        .map(|repo| repo.repo_key.clone())
        .collect::<HashSet<_>>();
    let mut stats = ProjectSearchIndexRefreshStats {
        repo_count: repos.len(),
        ..ProjectSearchIndexRefreshStats::default()
    };

    for repo in &repos {
        let indexed_state = indexed_repos.get(&repo.repo_key);
        let metadata_changed = indexed_state
            .map(|state| {
                state.project_id != repo.project_id
                    || state.repo_name != repo.repo_name
                    || state.project_title != repo.project_title
            })
            .unwrap_or(false);

        if indexed_state.is_none() {
            reindex_repo(connection, repo)?;
            stats.updated_repo_count += 1;
            stats.full_reindex_count += 1;
            continue;
        }

        let plan = plan_repo_refresh(repo, indexed_state)?;
        let head_changed = indexed_state
            .map(|state| state.head_sha != repo.head_sha)
            .unwrap_or(true);
        let needs_update = head_changed
            || metadata_changed
            || plan.project_metadata_changed
            || !plan.touched_chapter_dirs.is_empty();
        if !needs_update {
            continue;
        }

        stats.updated_repo_count += 1;
        stats.dirty_chapter_count += plan.touched_chapter_dirs.len();

        if plan.requires_full_reindex {
            reindex_repo(connection, repo)?;
            stats.full_reindex_count += 1;
            continue;
        }

        if apply_incremental_repo_refresh(connection, repo, &plan, metadata_changed).is_err() {
            reindex_repo(connection, repo)?;
            stats.full_reindex_count += 1;
        }
    }

    let missing_repo_keys = indexed_repos
        .keys()
        .filter(|repo_key| !active_repo_keys.contains(*repo_key))
        .cloned()
        .collect::<Vec<_>>();
    for repo_key in missing_repo_keys {
        remove_repo_from_index(connection, &repo_key)?;
    }

    Ok(stats)
}

fn discover_project_repos(repo_root: &Path) -> Result<Vec<RepoRecord>, String> {
    let mut repos = Vec::new();
    if !repo_root.exists() {
        return Ok(repos);
    }

    for entry in fs::read_dir(repo_root).map_err(|error| {
        format!(
            "Could not read the local project repo folder '{}': {error}",
            repo_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a local project repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
            continue;
        }
        let project_json_path = repo_path.join("project.json");
        if !project_json_path.exists() {
            continue;
        }

        let sync_state = read_local_repo_sync_state(&repo_path).ok().flatten();
        if sync_state
            .as_ref()
            .and_then(|state| state.kind.as_deref())
            .map(str::trim)
            .filter(|kind| !kind.is_empty() && *kind != "project")
            .is_some()
        {
            continue;
        }

        let repo_name = sync_state
            .as_ref()
            .and_then(|state| state.current_repo_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                repo_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("project")
                    .to_string()
            });
        let project_id = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| repo_name.clone());
        let repo_key = project_id.clone();
        let project_title =
            read_project_title(&project_json_path)?.unwrap_or_else(|| repo_name.clone());
        let head_sha = read_current_head_oid(&repo_path).unwrap_or_default();
        repos.push(RepoRecord {
            repo_key,
            project_id,
            repo_name,
            project_title,
            repo_path,
            head_sha,
        });
    }

    Ok(repos)
}

fn load_indexed_repo_states(
    connection: &Connection,
) -> Result<HashMap<String, IndexedRepoState>, String> {
    let mut indexed_repos = HashMap::<String, IndexedRepoState>::new();
    let mut statement = connection
        .prepare(
            "SELECT repo_key, project_id, repo_name, project_title, head_sha FROM indexed_repos",
        )
        .map_err(|error| format!("Could not prepare indexed repo scan: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                IndexedRepoState {
                    project_id: row.get(1)?,
                    repo_name: row.get(2)?,
                    project_title: row.get(3)?,
                    head_sha: row.get(4)?,
                },
            ))
        })
        .map_err(|error| format!("Could not load indexed repo state: {error}"))?;
    for row in rows {
        let (repo_key, state) =
            row.map_err(|error| format!("Could not decode indexed repo state: {error}"))?;
        indexed_repos.insert(repo_key, state);
    }
    Ok(indexed_repos)
}

fn plan_repo_refresh(
    repo: &RepoRecord,
    indexed_state: Option<&IndexedRepoState>,
) -> Result<RepoRefreshPlan, String> {
    let mut plan = RepoRefreshPlan::default();
    let Some(indexed_state) = indexed_state else {
        plan.requires_full_reindex = true;
        return Ok(plan);
    };

    let indexed_head = indexed_state.head_sha.trim();
    let current_head = repo.head_sha.trim();
    if indexed_head.is_empty() || current_head.is_empty() {
        plan.requires_full_reindex = true;
        return Ok(plan);
    }

    if indexed_head != current_head {
        let diff_range = format!("{indexed_head}..{current_head}");
        match git_output(
            &repo.repo_path,
            &[
                "diff",
                "--name-status",
                "--find-renames",
                &diff_range,
                "--",
                "project.json",
                "chapters",
            ],
            None,
        ) {
            Ok(output) => append_diff_name_status_changes(&mut plan, &output)?,
            Err(_) => {
                plan.requires_full_reindex = true;
                return Ok(plan);
            }
        }
    }

    match git_output(
        &repo.repo_path,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            "project.json",
            "chapters",
        ],
        None,
    ) {
        Ok(output) => append_status_porcelain_changes(&mut plan, &output)?,
        Err(_) => {
            plan.requires_full_reindex = true;
        }
    }

    Ok(plan)
}

fn apply_incremental_repo_refresh(
    connection: &mut Connection,
    repo: &RepoRecord,
    plan: &RepoRefreshPlan,
    metadata_changed: bool,
) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|error| {
        format!("Could not start project search incremental transaction: {error}")
    })?;

    if metadata_changed || plan.project_metadata_changed {
        update_repo_document_metadata_tx(&transaction, repo)?;
    }

    let mut touched_chapter_dirs = plan
        .touched_chapter_dirs
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    touched_chapter_dirs.sort();
    for chapter_dir in &touched_chapter_dirs {
        remove_chapter_from_index_tx(&transaction, &repo.repo_key, chapter_dir)?;
    }

    let mut inserter = SearchDocumentInserter::new(&transaction)?;
    for chapter_dir in &touched_chapter_dirs {
        index_chapter_dir_from_disk(repo, chapter_dir, &mut inserter)?;
    }

    upsert_indexed_repo_state_tx(&transaction, repo)?;
    drop(inserter);
    transaction.commit().map_err(|error| {
        format!("Could not commit the project search incremental transaction: {error}")
    })?;
    Ok(())
}

fn reindex_repo(connection: &mut Connection, repo: &RepoRecord) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start project search reindex transaction: {error}"))?;

    remove_repo_from_index_tx(&transaction, &repo.repo_key)?;
    let mut inserter = SearchDocumentInserter::new(&transaction)?;
    index_all_repo_chapters(repo, &mut inserter)?;
    upsert_indexed_repo_state_tx(&transaction, repo)?;
    drop(inserter);
    transaction.commit().map_err(|error| {
        format!("Could not commit the project search reindex transaction: {error}")
    })?;
    Ok(())
}

fn index_all_repo_chapters(
    repo: &RepoRecord,
    inserter: &mut SearchDocumentInserter<'_>,
) -> Result<(), String> {
    let chapters_root = repo.repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read chapter folders for '{}': {error}",
            repo.repo_path.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let chapter_path = entry.path();
        if !chapter_path.is_dir() {
            continue;
        }
        let chapter_dir = entry.file_name().to_string_lossy().trim().to_string();
        if chapter_dir.is_empty() {
            continue;
        }
        index_chapter_path(repo, &chapter_dir, &chapter_path, inserter)?;
    }

    Ok(())
}

fn index_chapter_dir_from_disk(
    repo: &RepoRecord,
    chapter_dir: &str,
    inserter: &mut SearchDocumentInserter<'_>,
) -> Result<(), String> {
    let chapter_path = repo.repo_path.join("chapters").join(chapter_dir);
    if !chapter_path.is_dir() {
        return Ok(());
    }

    index_chapter_path(repo, chapter_dir, &chapter_path, inserter)
}

fn index_chapter_path(
    repo: &RepoRecord,
    chapter_dir: &str,
    chapter_path: &Path,
    inserter: &mut SearchDocumentInserter<'_>,
) -> Result<(), String> {
    let chapter_json_path = chapter_path.join("chapter.json");
    if !chapter_json_path.exists() {
        return Ok(());
    }

    let chapter_value = read_json_value(&chapter_json_path, "chapter.json")?;
    if lifecycle_state(&chapter_value) == "deleted" {
        return Ok(());
    }

    let chapter_id = read_required_string(&chapter_value, "chapter_id", "chapter.json")?;
    let chapter_title =
        read_optional_string(&chapter_value, "title").unwrap_or_else(|| "File".to_string());
    let language_names = read_language_name_map(&chapter_value);
    let rows_root = chapter_path.join("rows");
    if !rows_root.exists() {
        return Ok(());
    }

    for row_entry in fs::read_dir(&rows_root).map_err(|error| {
        format!(
            "Could not read row files for '{}': {error}",
            rows_root.display()
        )
    })? {
        let row_entry =
            row_entry.map_err(|error| format!("Could not read a row file entry: {error}"))?;
        let row_path = row_entry.path();
        if !row_path.is_file() {
            continue;
        }

        let row_value = read_json_value(&row_path, "row file")?;
        if lifecycle_state(&row_value) == "deleted" {
            continue;
        }

        let row_id = read_required_string(&row_value, "row_id", "row file")?;
        let row_order_key = row_value
            .get("structure")
            .and_then(Value::as_object)
            .and_then(|structure| structure.get("order_key"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let Some(fields) = row_value.get("fields").and_then(Value::as_object) else {
            continue;
        };

        for (language_code, field_value) in fields {
            let plain_text = field_value
                .get("plain_text")
                .and_then(Value::as_str)
                .unwrap_or("");
            let language_name = language_names
                .get(language_code)
                .cloned()
                .unwrap_or_else(|| language_code.to_uppercase());
            inserter.insert_field_document(
                repo,
                chapter_dir,
                &chapter_id,
                &chapter_title,
                &row_id,
                &row_order_key,
                language_code,
                &language_name,
                plain_text,
            )?;
        }
    }

    Ok(())
}

fn upsert_indexed_repo_state_tx(connection: &Connection, repo: &RepoRecord) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO indexed_repos (repo_key, project_id, repo_name, project_title, head_sha, last_indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(repo_key) DO UPDATE SET
               project_id = excluded.project_id,
               repo_name = excluded.repo_name,
               project_title = excluded.project_title,
               head_sha = excluded.head_sha,
               last_indexed_at = excluded.last_indexed_at",
            params![
                repo.repo_key,
                repo.project_id,
                repo.repo_name,
                repo.project_title,
                repo.head_sha,
                current_unix_timestamp() as i64,
            ],
        )
        .map_err(|error| format!("Could not update indexed repo state: {error}"))?;
    Ok(())
}

fn update_repo_document_metadata_tx(
    connection: &Connection,
    repo: &RepoRecord,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE search_documents
             SET project_id = ?1,
                 repo_name = ?2,
                 project_title = ?3
             WHERE repo_key = ?4",
            params![
                repo.project_id,
                repo.repo_name,
                repo.project_title,
                repo.repo_key
            ],
        )
        .map_err(|error| format!("Could not update project search metadata: {error}"))?;
    Ok(())
}

fn remove_repo_from_index(connection: &Connection, repo_key: &str) -> Result<(), String> {
    remove_repo_from_index_tx(connection, repo_key)
}

fn remove_chapter_from_index_tx(
    connection: &Connection,
    repo_key: &str,
    chapter_dir: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM search_document_tokens
             WHERE doc_id IN (
               SELECT doc_id FROM search_documents WHERE repo_key = ?1 AND chapter_dir = ?2
             )",
            params![repo_key, chapter_dir],
        )
        .map_err(|error| format!("Could not remove stale project search tokens: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_document_bigrams
             WHERE doc_id IN (
               SELECT doc_id FROM search_documents WHERE repo_key = ?1 AND chapter_dir = ?2
             )",
            params![repo_key, chapter_dir],
        )
        .map_err(|error| format!("Could not remove stale project search bigrams: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_document_trigrams
             WHERE doc_id IN (
               SELECT doc_id FROM search_documents WHERE repo_key = ?1 AND chapter_dir = ?2
             )",
            params![repo_key, chapter_dir],
        )
        .map_err(|error| format!("Could not remove stale project search trigrams: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_documents WHERE repo_key = ?1 AND chapter_dir = ?2",
            params![repo_key, chapter_dir],
        )
        .map_err(|error| format!("Could not remove stale project search documents: {error}"))?;
    Ok(())
}

fn remove_repo_from_index_tx(connection: &Connection, repo_key: &str) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM search_document_tokens
       WHERE doc_id IN (SELECT doc_id FROM search_documents WHERE repo_key = ?1)",
            [repo_key],
        )
        .map_err(|error| format!("Could not remove stale project search tokens: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_document_bigrams
       WHERE doc_id IN (SELECT doc_id FROM search_documents WHERE repo_key = ?1)",
            [repo_key],
        )
        .map_err(|error| format!("Could not remove stale project search bigrams: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_document_trigrams
       WHERE doc_id IN (SELECT doc_id FROM search_documents WHERE repo_key = ?1)",
            [repo_key],
        )
        .map_err(|error| format!("Could not remove stale project search trigrams: {error}"))?;
    connection
        .execute(
            "DELETE FROM search_documents WHERE repo_key = ?1",
            [repo_key],
        )
        .map_err(|error| format!("Could not remove stale project search documents: {error}"))?;
    connection
        .execute("DELETE FROM indexed_repos WHERE repo_key = ?1", [repo_key])
        .map_err(|error| format!("Could not remove stale indexed repo state: {error}"))?;
    Ok(())
}

fn project_search_db_path(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
    let search_dir = installation_data_dir(app, installation_id)?.join("search");
    fs::create_dir_all(&search_dir).map_err(|error| {
        format!(
            "Could not create the local search folder '{}': {error}",
            search_dir.display()
        )
    })?;
    Ok(search_dir.join("project-search.sqlite3"))
}

fn open_project_search_db(db_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(db_path).map_err(|error| {
        format!(
            "Could not open the project search database '{}': {error}",
            db_path.display()
        )
    })?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
       PRAGMA synchronous = NORMAL;
       PRAGMA foreign_keys = OFF;",
        )
        .map_err(|error| format!("Could not configure the project search database: {error}"))?;
    Ok(connection)
}

fn ensure_project_search_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS indexed_repos (
         repo_key TEXT PRIMARY KEY,
         project_id TEXT NOT NULL,
         repo_name TEXT NOT NULL,
         project_title TEXT NOT NULL,
         head_sha TEXT NOT NULL,
         last_indexed_at INTEGER NOT NULL
       );
       CREATE TABLE IF NOT EXISTS search_documents (
         doc_id INTEGER PRIMARY KEY,
         result_id TEXT NOT NULL UNIQUE,
         repo_key TEXT NOT NULL,
         project_id TEXT NOT NULL,
         repo_name TEXT NOT NULL,
         project_title TEXT NOT NULL,
         chapter_dir TEXT NOT NULL DEFAULT '',
         chapter_id TEXT NOT NULL,
         chapter_title TEXT NOT NULL,
         row_id TEXT NOT NULL,
         row_order_key TEXT NOT NULL,
         language_code TEXT NOT NULL,
         language_name TEXT NOT NULL,
         plain_text TEXT NOT NULL,
         search_text TEXT NOT NULL,
         trigram_count INTEGER NOT NULL,
         text_hash TEXT NOT NULL,
         updated_at_unix INTEGER NOT NULL
       );
       CREATE INDEX IF NOT EXISTS search_documents_repo_idx
         ON search_documents(repo_key);
       CREATE INDEX IF NOT EXISTS search_documents_chapter_idx
         ON search_documents(chapter_id);
       CREATE INDEX IF NOT EXISTS search_documents_language_idx
         ON search_documents(language_code);
       CREATE TABLE IF NOT EXISTS search_document_tokens (
         doc_id INTEGER NOT NULL,
         token TEXT NOT NULL,
         PRIMARY KEY (doc_id, token)
       );
       CREATE INDEX IF NOT EXISTS search_document_tokens_token_idx
         ON search_document_tokens(token);
       CREATE TABLE IF NOT EXISTS search_document_bigrams (
         doc_id INTEGER NOT NULL,
         bigram TEXT NOT NULL,
         PRIMARY KEY (doc_id, bigram)
       );
       CREATE INDEX IF NOT EXISTS search_document_bigrams_bigram_idx
         ON search_document_bigrams(bigram);
       CREATE TABLE IF NOT EXISTS search_document_trigrams (
         doc_id INTEGER NOT NULL,
         trigram TEXT NOT NULL,
         PRIMARY KEY (doc_id, trigram)
       );
       CREATE INDEX IF NOT EXISTS search_document_trigrams_trigram_idx
         ON search_document_trigrams(trigram);",
        )
        .map_err(|error| format!("Could not initialize the project search schema: {error}"))?;

    if !table_has_column(connection, "search_documents", "chapter_dir")? {
        connection
            .execute(
                "ALTER TABLE search_documents ADD COLUMN chapter_dir TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|error| format!("Could not migrate the project search schema: {error}"))?;
        clear_project_search_index_tables(connection)?;
    }

    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS search_documents_repo_chapter_dir_idx
               ON search_documents(repo_key, chapter_dir);",
        )
        .map_err(|error| format!("Could not finalize the project search schema: {error}"))?;
    Ok(())
}

fn table_has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|error| format!("Could not inspect the project search schema: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Could not read the project search schema: {error}"))?;
    for row in rows {
        let current_column =
            row.map_err(|error| format!("Could not decode the project search schema: {error}"))?;
        if current_column == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn clear_project_search_index_tables(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "DELETE FROM search_document_tokens;
             DELETE FROM search_document_bigrams;
             DELETE FROM search_document_trigrams;
             DELETE FROM search_documents;
             DELETE FROM indexed_repos;",
        )
        .map_err(|error| {
            format!("Could not reset the project search index after migration: {error}")
        })
}

fn append_diff_name_status_changes(plan: &mut RepoRefreshPlan, output: &str) -> Result<(), String> {
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let columns = line.split('\t').collect::<Vec<_>>();
        if columns.is_empty() {
            continue;
        }

        let status = columns[0];
        let is_rename_or_copy = matches!(status.chars().next(), Some('R' | 'C'));
        if is_rename_or_copy {
            if columns.len() < 3 {
                return Err(format!(
                    "Could not parse a project search rename diff row: '{line}'"
                ));
            }
            record_repo_relative_path_change(plan, columns[1]);
            record_repo_relative_path_change(plan, columns[2]);
            continue;
        }

        if columns.len() < 2 {
            return Err(format!(
                "Could not parse a project search diff row: '{line}'"
            ));
        }
        record_repo_relative_path_change(plan, columns[1]);
    }

    Ok(())
}

fn append_status_porcelain_changes(plan: &mut RepoRefreshPlan, output: &str) -> Result<(), String> {
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        if line.len() < 4 {
            return Err(format!(
                "Could not parse a project search git status row: '{line}'"
            ));
        }
        let path_value = line[3..].trim();
        if path_value.is_empty() {
            continue;
        }

        if let Some((left, right)) = path_value.split_once(" -> ") {
            record_repo_relative_path_change(plan, left);
            record_repo_relative_path_change(plan, right);
            continue;
        }

        record_repo_relative_path_change(plan, path_value);
    }

    Ok(())
}

fn record_repo_relative_path_change(plan: &mut RepoRefreshPlan, path: &str) {
    let normalized_path = path.trim().replace('\\', "/");
    if normalized_path.is_empty() {
        return;
    }
    if normalized_path == "project.json" {
        plan.project_metadata_changed = true;
        return;
    }
    if let Some(chapter_dir) = extract_chapter_dir_from_repo_path(&normalized_path) {
        plan.touched_chapter_dirs.insert(chapter_dir);
    }
}

fn extract_chapter_dir_from_repo_path(path: &str) -> Option<String> {
    let mut segments = path.split('/');
    match (segments.next(), segments.next()) {
        (Some("chapters"), Some(chapter_dir)) if !chapter_dir.trim().is_empty() => {
            Some(chapter_dir.trim().to_string())
        }
        _ => None,
    }
}

fn normalize_search_text(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_was_space = true;

    for character in value.chars() {
        if character.is_whitespace() {
            if !previous_was_space {
                normalized.push(' ');
                previous_was_space = true;
            }
            continue;
        }

        if character.is_alphanumeric() {
            for lower in character.to_lowercase() {
                normalized.push(lower);
            }
            previous_was_space = false;
            continue;
        }

        if !previous_was_space {
            normalized.push(' ');
            previous_was_space = true;
        }
    }

    normalized.trim().to_string()
}

fn collect_unique_tokens(value: &str) -> Vec<String> {
    let normalized = normalize_search_text(value);
    let mut seen = HashSet::new();
    let mut tokens = Vec::new();
    for token in normalized.split_whitespace() {
        if !token.is_empty() && seen.insert(token.to_string()) {
            tokens.push(token.to_string());
        }
    }
    tokens
}

fn collect_unique_bigrams(value: &str) -> Vec<String> {
    collect_unique_ngrams(value, 2)
}

fn collect_unique_trigrams(value: &str) -> Vec<String> {
    collect_unique_ngrams(value, 3)
}

fn collect_unique_ngrams(value: &str, size: usize) -> Vec<String> {
    let normalized = normalize_search_text(value);
    let characters = normalized.chars().collect::<Vec<_>>();
    if size < 2 || characters.len() < size {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut ngrams = Vec::new();
    for index in 0..=characters.len() - size {
        let ngram = characters[index..index + size].iter().collect::<String>();
        if seen.insert(ngram.clone()) {
            ngrams.push(ngram);
        }
    }
    ngrams
}

fn compute_search_score(
    candidate: &CandidateDocument,
    normalized_query: &str,
    query_token_count: usize,
    query_ngram_count: usize,
) -> SearchScore {
    let exact_phrase = candidate.document.search_text.contains(normalized_query);
    let token_coverage = if query_token_count == 0 {
        0.0
    } else {
        candidate.token_hits as f64 / query_token_count as f64
    };
    let ngram_dice = if query_ngram_count == 0 || candidate.document_ngram_count == 0 {
        0.0
    } else {
        (2.0 * candidate.ngram_hits as f64)
            / (query_ngram_count + candidate.document_ngram_count) as f64
    };
    let ordered_tokens = query_token_count > 0
        && tokens_appear_in_order(
            &candidate.document.search_text,
            &collect_unique_tokens(normalized_query),
        );
    let prefix_bonus = query_token_count > 0
        && query_has_prefix_match(
            &candidate.document.search_text,
            &collect_unique_tokens(normalized_query),
        );
    let length_penalty = {
        let document_length = candidate.document.search_text.chars().count() as f64;
        let query_length = normalized_query.chars().count().max(1) as f64;
        (document_length - query_length).abs() / query_length
    };

    SearchScore {
        exact_phrase,
        token_coverage,
        ngram_dice,
        ordered_tokens,
        prefix_bonus,
        length_penalty,
    }
}

fn score_to_number(score: SearchScore) -> f64 {
    (if score.exact_phrase { 1000.0 } else { 0.0 })
        + (250.0 * score.token_coverage)
        + (180.0 * score.ngram_dice)
        + (if score.ordered_tokens { 60.0 } else { 0.0 })
        + (if score.prefix_bonus { 25.0 } else { 0.0 })
        - (15.0 * score.length_penalty)
}

fn tokens_appear_in_order(document: &str, query_tokens: &[String]) -> bool {
    let mut from_index = 0usize;
    for token in query_tokens {
        let Some(position) = document[from_index..].find(token) else {
            return false;
        };
        from_index += position + token.len();
    }
    true
}

fn query_has_prefix_match(document: &str, query_tokens: &[String]) -> bool {
    let document_tokens = document.split_whitespace().collect::<Vec<_>>();
    query_tokens.iter().any(|query_token| {
        document_tokens
            .iter()
            .any(|document_token| document_token.starts_with(query_token))
    })
}

fn resolve_match_count(candidate: &CandidateDocument, normalized_query: &str) -> usize {
    let exact_matches = count_exact_substrings(&candidate.document.search_text, normalized_query);
    if exact_matches > 0 {
        return exact_matches;
    }
    candidate.token_hits.max(candidate.ngram_hits).max(1)
}

fn empty_search_response(query_too_short: bool, total_capped: bool) -> SearchProjectsResponse {
    SearchProjectsResponse {
        results: Vec::new(),
        total: 0,
        has_more: false,
        index_status: "ready".to_string(),
        total_capped,
        query_too_short,
        minimum_query_length: MIN_SEARCH_QUERY_LENGTH,
    }
}

fn count_exact_substrings(document: &str, needle: &str) -> usize {
    if needle.is_empty() || document.is_empty() {
        return 0;
    }

    let mut count = 0usize;
    let mut from_index = 0usize;
    while let Some(position) = document[from_index..].find(needle) {
        count += 1;
        from_index += position + needle.len();
    }
    count
}

fn build_plain_text_snippet(plain_text: &str) -> String {
    let trimmed = plain_text.trim();
    if trimmed.chars().count() <= 140 {
        return trimmed.to_string();
    }

    let snippet = trimmed
        .chars()
        .take(140)
        .collect::<String>()
        .trim()
        .to_string();
    format!("{snippet}...")
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

fn hash_text(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    let hash = digest.finalize();
    let mut output = String::with_capacity(hash.len() * 2);
    for byte in hash {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

trait OptionalRow<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_diff_name_status_changes, append_status_porcelain_changes, build_plain_text_snippet,
        collect_unique_bigrams, collect_unique_trigrams, compute_search_score,
        extract_chapter_dir_from_repo_path, normalize_search_text, score_to_number,
        CandidateDocument, IndexedDocument, RepoRefreshPlan,
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
        let snippet = build_plain_text_snippet(&"a".repeat(200));
        assert!(snippet.ends_with("..."));
        assert!(snippet.len() < 160);
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
