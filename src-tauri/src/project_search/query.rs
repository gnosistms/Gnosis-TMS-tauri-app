use std::collections::{HashMap, HashSet};

use tauri::AppHandle;

use super::{
    schema::{
        ensure_project_search_schema, open_project_search_db, project_search_db_path,
        project_search_index_has_documents, project_search_index_requires_refresh,
    },
    scoring::{
        build_plain_text_snippet, collect_unique_bigrams, collect_unique_tokens,
        collect_unique_trigrams, compute_search_score, empty_search_response,
        normalize_search_text, score_to_number,
    },
    CandidateDocument, IndexedDocument, ProjectSearchDocumentMatch, ProjectSearchExcerpt,
    ProjectSearchMatchBand, ProjectSearchQualityTier, ProjectSearchRowResult, SearchProjectsInput,
    SearchProjectsResponse, MAX_RESULT_ROWS, MIN_SEARCH_QUERY_LENGTH,
};

type LogicalRowKey = (String, String, String);

const PROJECT_SEARCH_BORDERLINE_STRONG_ROW_LIMIT: usize = 50;
const PROJECT_SEARCH_QUALITY_KNEE_MULTIPLIER: f64 = 4.0;

pub(super) fn search_projects_sync(
    app: &AppHandle,
    input: SearchProjectsInput,
) -> Result<SearchProjectsResponse, String> {
    if input.query.trim().is_empty() {
        return Ok(empty_search_response(false, false));
    }

    let normalized_query = normalize_search_text(&input.query);
    let query_character_count = normalized_query.chars().count();
    if query_character_count < MIN_SEARCH_QUERY_LENGTH {
        return Ok(empty_search_response(true, false));
    }

    let db_path = project_search_db_path(app, input.installation_id)?;
    let connection = open_project_search_db(&db_path)?;
    ensure_project_search_schema(&connection)?;
    let requires_refresh = project_search_index_requires_refresh(&connection)?;
    let has_documents = project_search_index_has_documents(&connection)?;
    if requires_refresh && !has_documents {
        let mut response = empty_search_response(false, false);
        response.index_status = "indexing".to_string();
        return Ok(response);
    }

    let mut response =
        search_projects_in_connection(&connection, &normalized_query, query_character_count)?;
    if requires_refresh {
        response.index_status = "stale".to_string();
    }
    Ok(response)
}

pub(super) fn search_projects_in_connection(
    connection: &rusqlite::Connection,
    normalized_query: &str,
    query_character_count: usize,
) -> Result<SearchProjectsResponse, String> {
    let use_bigram_index = query_character_count == MIN_SEARCH_QUERY_LENGTH;
    let query_tokens = if use_bigram_index {
        Vec::new()
    } else {
        collect_unique_tokens(normalized_query)
    };
    let query_ngrams = if use_bigram_index {
        collect_unique_bigrams(normalized_query)
    } else {
        collect_unique_trigrams(normalized_query)
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
    let (candidate_ids, total_capped) =
        select_candidate_document_ids_in_connection(connection, candidate_ids, MAX_RESULT_ROWS)?;

    let mut by_id_statement = connection
    .prepare(
      "SELECT result_id, project_id, project_title, repo_name, chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, snippet_source, plain_text, search_text, trigram_count
       FROM search_documents
       WHERE doc_id = ?1",
    )
    .map_err(|error| format!("Could not prepare project search document lookup: {error}"))?;

    let mut ranked_results = Vec::<ProjectSearchDocumentMatch>::new();
    for doc_id in candidate_ids {
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
            normalized_query,
            query_token_count,
            query_ngram_count,
        );
        if score.exact_phrase || score.token_coverage > 0.0 || score.ngram_dice > 0.0 {
            let match_band = score.match_band();
            ranked_results.push(ProjectSearchDocumentMatch {
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
                snippet: build_plain_text_snippet(&candidate.document.plain_text, normalized_query),
                exact_phrase: score.exact_phrase,
                score: score_to_number(score),
                match_band,
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

    let mut results = aggregate_project_search_rows(ranked_results);
    let strong_total = classify_project_search_row_quality(&mut results);
    #[cfg(debug_assertions)]
    emit_project_search_quality_diagnostics(normalized_query, &results, strong_total);
    let total = results.len();
    Ok(SearchProjectsResponse {
        results,
        total,
        strong_total,
        weaker_total: total.saturating_sub(strong_total),
        index_status: "ready".to_string(),
        total_capped,
        query_too_short: false,
        minimum_query_length: MIN_SEARCH_QUERY_LENGTH,
    })
}

fn load_logical_row_keys(
    connection: &rusqlite::Connection,
    document_ids: Vec<i64>,
) -> Result<HashMap<i64, LogicalRowKey>, String> {
    const SQLITE_PARAMETER_BATCH_SIZE: usize = 500;
    let mut logical_row_keys = HashMap::with_capacity(document_ids.len());

    for document_id_batch in document_ids.chunks(SQLITE_PARAMETER_BATCH_SIZE) {
        let placeholders = (1..=document_id_batch.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT doc_id, project_id, chapter_id, row_id
             FROM search_documents
             WHERE doc_id IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("Could not prepare project search row-key lookup: {error}"))?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(document_id_batch), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    (row.get(1)?, row.get(2)?, row.get(3)?),
                ))
            })
            .map_err(|error| format!("Could not run project search row-key lookup: {error}"))?;
        for row in rows {
            let (document_id, row_key) = row.map_err(|error| {
                format!("Could not decode a project search row-key lookup: {error}")
            })?;
            logical_row_keys.insert(document_id, row_key);
        }
    }

    Ok(logical_row_keys)
}

fn load_document_ids_for_logical_rows(
    connection: &rusqlite::Connection,
    logical_row_keys: &HashSet<LogicalRowKey>,
) -> Result<HashSet<i64>, String> {
    const SQLITE_PARAMETER_BATCH_SIZE: usize = 500;
    let row_ids = logical_row_keys
        .iter()
        .map(|(_, _, row_id)| row_id.as_str())
        .collect::<Vec<_>>();
    let mut document_ids = HashSet::new();

    for row_id_batch in row_ids.chunks(SQLITE_PARAMETER_BATCH_SIZE) {
        let placeholders = (1..=row_id_batch.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT doc_id, project_id, chapter_id, row_id
             FROM search_documents
             WHERE row_id IN ({placeholders})"
        );
        let mut statement = connection.prepare(&sql).map_err(|error| {
            format!("Could not prepare selected project search row lookup: {error}")
        })?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(row_id_batch), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    (row.get(1)?, row.get(2)?, row.get(3)?),
                ))
            })
            .map_err(|error| {
                format!("Could not run selected project search row lookup: {error}")
            })?;
        for row in rows {
            let (document_id, row_key) = row.map_err(|error| {
                format!("Could not decode a selected project search row: {error}")
            })?;
            if logical_row_keys.contains(&row_key) {
                document_ids.insert(document_id);
            }
        }
    }

    Ok(document_ids)
}

fn select_candidate_document_ids_in_connection(
    connection: &rusqlite::Connection,
    ranked_candidates: Vec<(i64, usize)>,
    maximum_rows: usize,
) -> Result<(Vec<i64>, bool), String> {
    const ROW_KEY_LOOKUP_BATCH_SIZE: usize = 500;
    let mut selected_row_keys = HashSet::<LogicalRowKey>::new();
    let mut total_capped = false;

    'candidate_batches: for candidate_batch in ranked_candidates.chunks(ROW_KEY_LOOKUP_BATCH_SIZE) {
        let row_keys = load_logical_row_keys(
            connection,
            candidate_batch.iter().map(|(doc_id, _)| *doc_id).collect(),
        )?;
        for (doc_id, _) in candidate_batch {
            let Some(row_key) = row_keys.get(doc_id) else {
                continue;
            };
            if selected_row_keys.contains(row_key) {
                continue;
            }
            if selected_row_keys.len() >= maximum_rows {
                total_capped = true;
                break 'candidate_batches;
            }
            selected_row_keys.insert(row_key.clone());
        }
    }

    if !total_capped {
        return Ok((
            ranked_candidates
                .into_iter()
                .map(|(document_id, _)| document_id)
                .collect(),
            false,
        ));
    }

    let selected_document_ids = load_document_ids_for_logical_rows(connection, &selected_row_keys)?;
    Ok((
        ranked_candidates
            .into_iter()
            .filter_map(|(document_id, _)| {
                selected_document_ids
                    .contains(&document_id)
                    .then_some(document_id)
            })
            .collect(),
        true,
    ))
}

#[cfg(test)]
pub(super) fn select_candidate_document_ids(
    ranked_candidates: Vec<(i64, usize)>,
    logical_row_key_by_doc_id: &HashMap<i64, LogicalRowKey>,
    maximum_rows: usize,
) -> (Vec<i64>, bool) {
    let mut selected_row_keys = HashSet::<LogicalRowKey>::new();
    let mut selected_document_ids = Vec::new();
    let mut total_capped = false;

    for (doc_id, _) in ranked_candidates {
        let Some(row_key) = logical_row_key_by_doc_id.get(&doc_id) else {
            continue;
        };
        if selected_row_keys.contains(row_key) {
            selected_document_ids.push(doc_id);
        } else if selected_row_keys.len() < maximum_rows {
            selected_row_keys.insert(row_key.clone());
            selected_document_ids.push(doc_id);
        } else {
            total_capped = true;
        }
    }

    (selected_document_ids, total_capped)
}

pub(super) fn aggregate_project_search_rows(
    ranked_results: Vec<ProjectSearchDocumentMatch>,
) -> Vec<ProjectSearchRowResult> {
    let mut row_indexes = HashMap::<(String, String, String), usize>::new();
    let mut rows = Vec::<ProjectSearchRowResult>::new();

    for result in ranked_results {
        let row_key = (
            result.project_id.clone(),
            result.chapter_id.clone(),
            result.row_id.clone(),
        );
        let excerpt = ProjectSearchExcerpt {
            result_id: result.result_id,
            language_code: result.language_code,
            language_name: result.language_name,
            snippet_source: result.snippet_source,
            snippet: result.snippet,
            exact_phrase: result.exact_phrase,
            score: result.score,
        };

        if let Some(row_index) = row_indexes.get(&row_key).copied() {
            let row = &mut rows[row_index];
            row.score = row.score.max(result.score);
            row.match_band = row.match_band.max(result.match_band);
            row.excerpts.push(excerpt);
            continue;
        }

        row_indexes.insert(row_key, rows.len());
        rows.push(ProjectSearchRowResult {
            project_id: result.project_id,
            project_title: result.project_title,
            repo_name: result.repo_name,
            chapter_id: result.chapter_id,
            chapter_title: result.chapter_title,
            row_id: result.row_id,
            row_order_key: result.row_order_key,
            excerpts: vec![excerpt],
            score: result.score,
            quality_tier: ProjectSearchQualityTier::Strong,
            match_band: result.match_band,
        });
    }

    for row in &mut rows {
        row.excerpts.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.language_name.cmp(&right.language_name))
                .then_with(|| left.snippet_source.cmp(&right.snippet_source))
                .then_with(|| left.result_id.cmp(&right.result_id))
        });
    }

    rows.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.project_title.cmp(&right.project_title))
            .then_with(|| left.chapter_title.cmp(&right.chapter_title))
            .then_with(|| left.row_order_key.cmp(&right.row_order_key))
            .then_with(|| left.row_id.cmp(&right.row_id))
    });
    rows
}

pub(super) fn classify_project_search_row_quality(rows: &mut [ProjectSearchRowResult]) -> usize {
    let Some(best_band) = rows.iter().map(|row| row.match_band).max() else {
        return 0;
    };
    let band_scores = rows
        .iter()
        .filter(|row| row.match_band == best_band)
        .map(|row| row.score)
        .collect::<Vec<_>>();
    let strong_band_count = if best_band <= ProjectSearchMatchBand::PartialToken {
        strong_project_search_row_count(&band_scores)
    } else {
        band_scores.len()
    };

    let mut remaining_strong_in_band = strong_band_count;
    for row in rows.iter_mut() {
        let is_strong = row.match_band == best_band && remaining_strong_in_band > 0;
        row.quality_tier = if is_strong {
            remaining_strong_in_band -= 1;
            ProjectSearchQualityTier::Strong
        } else {
            ProjectSearchQualityTier::Weaker
        };
    }
    strong_band_count
}

pub(super) fn strong_project_search_row_count(scores: &[f64]) -> usize {
    if scores.is_empty() {
        return 0;
    }

    let considered_count = scores.len().min(PROJECT_SEARCH_BORDERLINE_STRONG_ROW_LIMIT);
    let positive_gaps = scores[..considered_count]
        .windows(2)
        .map(|pair| pair[0] - pair[1])
        .filter(|gap| *gap > 0.0)
        .collect::<Vec<_>>();
    let median_gap = median(&positive_gaps);
    let knee_boundary = if median_gap > 0.0 {
        scores[..considered_count]
            .windows(2)
            .enumerate()
            .filter_map(|(index, pair)| {
                let gap = pair[0] - pair[1];
                (gap >= median_gap * PROJECT_SEARCH_QUALITY_KNEE_MULTIPLIER)
                    .then_some((index + 1, gap))
            })
            .max_by(|left, right| {
                left.1
                    .partial_cmp(&right.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| right.0.cmp(&left.0))
            })
            .map(|(boundary, _)| boundary)
    } else {
        None
    };

    let mut strong_count = knee_boundary.unwrap_or(considered_count).max(1);
    while strong_count < scores.len() && scores[strong_count] == scores[strong_count - 1] {
        strong_count += 1;
    }
    strong_count
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let midpoint = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[midpoint - 1] + sorted[midpoint]) / 2.0
    } else {
        sorted[midpoint]
    }
}

#[cfg(debug_assertions)]
fn emit_project_search_quality_diagnostics(
    normalized_query: &str,
    rows: &[ProjectSearchRowResult],
    strong_count: usize,
) {
    let Ok(requested_query) = std::env::var("GNOSIS_PROJECT_SEARCH_DIAGNOSTIC_QUERY") else {
        return;
    };
    if normalize_search_text(&requested_query) != normalized_query {
        return;
    }

    eprintln!(
        "[project-search-quality] query={normalized_query:?} rows={} strong={} weaker={}",
        rows.len(),
        strong_count,
        rows.len().saturating_sub(strong_count),
    );
    for (index, row) in rows.iter().enumerate() {
        let next_drop = rows
            .get(index + 1)
            .map(|next| row.score - next.score)
            .unwrap_or(0.0);
        let exact_phrase = row.excerpts.iter().any(|excerpt| excerpt.exact_phrase);
        eprintln!(
            "[project-search-quality] rank={} row={} score={:.6} next_drop={:.6} exact={} band={:?} tier={:?}",
            index + 1,
            row.row_id,
            row.score,
            next_drop,
            exact_phrase,
            row.match_band,
            row.quality_tier,
        );
    }
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
