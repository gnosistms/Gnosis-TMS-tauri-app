use std::collections::HashMap;

use tauri::AppHandle;

use super::{
    schema::{ensure_project_search_schema, open_project_search_db, project_search_db_path},
    scoring::{
        build_plain_text_snippet, collect_unique_bigrams, collect_unique_tokens,
        collect_unique_trigrams, compute_search_score, empty_search_response,
        normalize_search_text, resolve_match_count, score_to_number,
    },
    CandidateDocument, IndexedDocument, ProjectSearchResult, SearchProjectsInput,
    SearchProjectsResponse, DEFAULT_SEARCH_LIMIT, MAX_CANDIDATES, MAX_SEARCH_LIMIT,
    MIN_SEARCH_QUERY_LENGTH,
};

pub(super) fn search_projects_sync(
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
      "SELECT result_id, project_id, project_title, repo_name, chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, snippet_source, plain_text, search_text, trigram_count
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
                    snippet_source: row.get(10)?,
                    plain_text: row.get(11)?,
                    search_text: row.get(12)?,
                    trigram_count: row.get::<_, i64>(13)?.max(0) as usize,
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
                snippet_source: candidate.document.snippet_source.clone(),
                snippet: build_plain_text_snippet(
                    &candidate.document.plain_text,
                    &normalized_query,
                ),
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
