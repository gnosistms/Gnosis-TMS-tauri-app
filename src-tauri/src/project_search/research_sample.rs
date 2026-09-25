//! Complete, reproducible passage populations for Glossary Research.
//!
//! Project search ranks and caps results for browsing; research needs every
//! matching row instead. Rows are the passages. Only rows in the research
//! language count (chapters without that language are ignored). Rows with
//! identical text are one passage; every copy's reference is kept. Passages
//! are ordered by sha256(seed:text), so a sample of n is the prefix of the
//! ordering and a larger n extends a smaller one.

use std::collections::{BTreeMap, HashMap, HashSet};

use regex::Regex;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::scoring::collect_unique_tokens;
use super::{
    ensure_project_search_schema, open_project_search_db, project_search_db_path,
    refresh_project_index_current,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchPassagesInput {
    pub installation_id: i64,
    pub project_ids: Vec<String>,
    pub language_code: String,
    #[serde(default)]
    pub target_language_code: Option<String>,
    pub forms: Vec<String>,
    /// "count" (population size + a few examples), "sample" or "neighbours".
    pub mode: String,
    #[serde(default)]
    pub n: usize,
    #[serde(default)]
    pub seed: String,
    #[serde(default = "default_refresh")]
    pub refresh_index: bool,
}

fn default_refresh() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PassageOccurrence {
    /// UTF-16 offsets, so the frontend can slice JavaScript strings.
    pub start: usize,
    pub end: usize,
    pub surface: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PassageCopy {
    pub project_id: String,
    pub project_title: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub row_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchPassage {
    pub item_id: String,
    pub text: String,
    pub occurrences: Vec<PassageOccurrence>,
    pub copy_count: usize,
    pub copies: Vec<PassageCopy>,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
    pub existing_translation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Neighbour {
    pub phrase: String,
    pub occurrences: usize,
    pub paragraphs: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchPassagesResponse {
    pub rows: usize,
    pub distinct: usize,
    pub duplicate_groups: usize,
    pub items: Vec<ResearchPassage>,
    pub neighbours: Vec<Neighbour>,
    /// Chapters in the selected projects that have the research language.
    pub matching_chapter_count: usize,
}

struct Row {
    project_id: String,
    project_title: String,
    chapter_id: String,
    chapter_title: String,
    row_id: String,
    row_order_key: String,
    text: String,
}

struct Group {
    text: String,
    spans: Vec<(usize, usize)>,
    rows: Vec<Row>,
}

#[tauri::command]
pub(crate) async fn glossary_research_project_passages(
    app: AppHandle,
    input: ResearchPassagesInput,
) -> Result<ResearchPassagesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || research_passages_sync(&app, input))
        .await
        .map_err(|error| format!("The research search worker failed: {error}"))?
}

fn research_passages_sync(
    app: &AppHandle,
    input: ResearchPassagesInput,
) -> Result<ResearchPassagesResponse, String> {
    let db_path = project_search_db_path(app, input.installation_id)?;
    let mut connection = open_project_search_db(&db_path)?;
    ensure_project_search_schema(&connection)?;
    if input.refresh_index {
        refresh_project_index_current(app, input.installation_id, &mut connection)?;
    }
    research_passages(&connection, &input)
}

pub(crate) fn research_passages(
    connection: &Connection,
    input: &ResearchPassagesInput,
) -> Result<ResearchPassagesResponse, String> {
    if input.project_ids.is_empty() {
        return Err("Select at least one project.".to_string());
    }
    let matching_chapter_count = count_matching_chapters(connection, input)?;
    let groups = population(connection, input)?;
    let rows = groups.values().map(|group| group.rows.len()).sum();
    let mut response = ResearchPassagesResponse {
        rows,
        distinct: groups.len(),
        duplicate_groups: groups.values().filter(|g| g.rows.len() > 1).count(),
        matching_chapter_count,
        ..Default::default()
    };
    let mut ordered: Vec<(&String, &Group)> = groups.iter().collect();
    match input.mode.as_str() {
        "count" => {
            ordered.truncate(3);
            response.items = ordered
                .into_iter()
                .map(|(key, group)| passage(connection, input, key, group, false))
                .collect::<Result<_, _>>()?;
        }
        "sample" => {
            ordered.sort_by_cached_key(|(key, _)| sample_order(&input.seed, key));
            ordered.truncate(input.n);
            response.items = ordered
                .into_iter()
                .map(|(key, group)| passage(connection, input, key, group, true))
                .collect::<Result<_, _>>()?;
        }
        "neighbours" => response.neighbours = neighbours(&groups),
        other => return Err(format!("Unknown research search mode '{other}'.")),
    }
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchProjectsInput {
    pub installation_id: i64,
    pub language_code: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResearchProjectOption {
    pub project_id: String,
    pub title: String,
    /// Whether any file of the project contains the research language.
    pub has_language: bool,
}

/// The team's locally stored projects, from the search index (refreshed first),
/// so the research picker does not depend on which page loaded projects.
#[tauri::command]
pub(crate) async fn glossary_research_list_projects(
    app: AppHandle,
    input: ResearchProjectsInput,
) -> Result<Vec<ResearchProjectOption>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = project_search_db_path(&app, input.installation_id)?;
        let mut connection = open_project_search_db(&db_path)?;
        ensure_project_search_schema(&connection)?;
        refresh_project_index_current(&app, input.installation_id, &mut connection)?;
        research_projects(&connection, &input.language_code)
    })
    .await
    .map_err(|error| format!("The research project list worker failed: {error}"))?
}

pub(crate) fn research_projects(
    connection: &Connection,
    language_code: &str,
) -> Result<Vec<ResearchProjectOption>, String> {
    let mut statement = connection
        .prepare(
            "SELECT project_id, max(project_title), max(language_code = ?1) FROM search_documents \
             WHERE snippet_source = 'field' GROUP BY project_id ORDER BY lower(max(project_title))",
        )
        .map_err(|error| format!("Could not read the search index: {error}"))?;
    let rows = statement
        .query_map([language_code], |row| {
            Ok(ResearchProjectOption {
                project_id: row.get(0)?,
                title: row.get(1)?,
                has_language: row.get::<_, i64>(2)? == 1,
            })
        })
        .map_err(|error| format!("Could not read the search index: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read the search index: {error}"))
}

fn sample_order(seed: &str, key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{seed}:{key}").as_bytes());
    format!("{:x}", hasher.finalize())
}

fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

fn count_matching_chapters(
    connection: &Connection,
    input: &ResearchPassagesInput,
) -> Result<usize, String> {
    let sql = format!(
        "SELECT count(DISTINCT project_id || '/' || chapter_id) FROM search_documents \
         WHERE language_code = ? AND snippet_source = 'field' AND project_id IN ({})",
        placeholders(input.project_ids.len())
    );
    let mut values = vec![input.language_code.clone()];
    values.extend(input.project_ids.iter().cloned());
    connection
        .query_row(&sql, params_from_iter(values.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count as usize)
        .map_err(|error| format!("Could not read the search index: {error}"))
}

/// Case-insensitive whole-word pattern for one form (words joined by any
/// run of non-word characters). Accents are kept: forms are exact spellings.
fn form_pattern(form: &str) -> Option<Regex> {
    let words: Vec<String> = collect_unique_tokens_in_order(form);
    if words.is_empty() {
        return None;
    }
    let body = words
        .iter()
        .map(|word| regex::escape(word))
        .collect::<Vec<_>>()
        .join(r"[^\p{L}\p{N}_]+");
    Regex::new(&format!(
        r"(?i)(?:^|[^\p{{L}}\p{{N}}_])({body})(?:$|[^\p{{L}}\p{{N}}_])"
    ))
    .ok()
}

fn collect_unique_tokens_in_order(value: &str) -> Vec<String> {
    super::scoring::normalize_search_text(value)
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

fn find_spans(text: &str, patterns: &[Regex]) -> Vec<(usize, usize)> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for pattern in patterns {
        let mut from = 0;
        while from <= text.len() {
            let Some(captures) = pattern.captures_at(text, from) else {
                break;
            };
            let group = captures.get(1).expect("group 1");
            spans.push((group.start(), group.end()));
            // Continue just after the match so adjacent occurrences are found.
            from = group.end();
        }
    }
    spans.sort();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in spans {
        match merged.last_mut() {
            Some(last) if start < last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

fn population(
    connection: &Connection,
    input: &ResearchPassagesInput,
) -> Result<BTreeMap<String, Group>, String> {
    let patterns: Vec<Regex> = input.forms.iter().filter_map(|f| form_pattern(f)).collect();
    let mut candidate_ids: HashSet<i64> = HashSet::new();
    for form in &input.forms {
        let tokens = collect_unique_tokens(form);
        if tokens.is_empty() {
            continue;
        }
        let sql = format!(
            "SELECT t.doc_id FROM search_document_tokens t \
             JOIN search_documents d ON d.doc_id = t.doc_id \
             WHERE t.token IN ({}) AND d.language_code = ? AND d.snippet_source = 'field' \
               AND d.project_id IN ({}) \
             GROUP BY t.doc_id HAVING count(DISTINCT t.token) = {}",
            placeholders(tokens.len()),
            placeholders(input.project_ids.len()),
            tokens.len()
        );
        let mut values: Vec<String> = tokens.clone();
        values.push(input.language_code.clone());
        values.extend(input.project_ids.iter().cloned());
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("Could not query the search index: {error}"))?;
        let ids = statement
            .query_map(params_from_iter(values.iter()), |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Could not query the search index: {error}"))?;
        for id in ids {
            candidate_ids.insert(id.map_err(|error| error.to_string())?);
        }
    }
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    let mut ids: Vec<i64> = candidate_ids.into_iter().collect();
    ids.sort_unstable();
    for chunk in ids.chunks(500) {
        let sql = format!(
            "SELECT project_id, project_title, chapter_id, chapter_title, row_id, row_order_key, plain_text \
             FROM search_documents WHERE doc_id IN ({}) ORDER BY project_id, chapter_id, row_order_key",
            placeholders(chunk.len())
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("Could not read the search index: {error}"))?;
        let rows = statement
            .query_map(params_from_iter(chunk.iter()), |row| {
                Ok(Row {
                    project_id: row.get(0)?,
                    project_title: row.get(1)?,
                    chapter_id: row.get(2)?,
                    chapter_title: row.get(3)?,
                    row_id: row.get(4)?,
                    row_order_key: row.get(5)?,
                    text: row.get(6)?,
                })
            })
            .map_err(|error| format!("Could not read the search index: {error}"))?;
        for row in rows {
            let row = row.map_err(|error| error.to_string())?;
            let spans = find_spans(&row.text, &patterns);
            if spans.is_empty() {
                continue; // token hit, but not the whole form as written
            }
            let key = sample_order("", &row.text)[..16].to_string();
            groups
                .entry(key)
                .or_insert_with(|| Group {
                    text: row.text.clone(),
                    spans,
                    rows: Vec::new(),
                })
                .rows
                .push(row);
        }
    }
    Ok(groups)
}

fn utf16_offset(text: &str, byte: usize) -> usize {
    text[..byte].encode_utf16().count()
}

fn neighbour_text(
    connection: &Connection,
    language: &str,
    row: &Row,
    before: bool,
) -> Result<Option<String>, String> {
    let sql = if before {
        "SELECT plain_text FROM search_documents WHERE project_id = ?1 AND chapter_id = ?2 \
         AND language_code = ?3 AND snippet_source = 'field' AND row_order_key < ?4 \
         ORDER BY row_order_key DESC LIMIT 1"
    } else {
        "SELECT plain_text FROM search_documents WHERE project_id = ?1 AND chapter_id = ?2 \
         AND language_code = ?3 AND snippet_source = 'field' AND row_order_key > ?4 \
         ORDER BY row_order_key ASC LIMIT 1"
    };
    match connection.query_row(
        sql,
        [
            &row.project_id,
            &row.chapter_id,
            &language.to_string(),
            &row.row_order_key,
        ],
        |r| r.get::<_, String>(0),
    ) {
        Ok(text) => Ok(Some(text)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Could not read neighbouring rows: {error}")),
    }
}

fn clip(text: String, max_chars: usize, keep_end: bool) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text;
    }
    if keep_end {
        format!(
            "…{}",
            text.chars().skip(count - max_chars).collect::<String>()
        )
    } else {
        format!("{}…", text.chars().take(max_chars).collect::<String>())
    }
}

fn passage(
    connection: &Connection,
    input: &ResearchPassagesInput,
    key: &str,
    group: &Group,
    with_context: bool,
) -> Result<ResearchPassage, String> {
    let first = &group.rows[0];
    let mut context_before = Vec::new();
    let mut context_after = Vec::new();
    let mut existing_translation = None;
    if with_context {
        if let Some(text) = neighbour_text(connection, &input.language_code, first, true)? {
            context_before.push(clip(text, 600, true));
        }
        if let Some(text) = neighbour_text(connection, &input.language_code, first, false)? {
            context_after.push(clip(text, 600, false));
        }
        if let Some(target) = input
            .target_language_code
            .as_deref()
            .filter(|t| !t.is_empty())
        {
            existing_translation = connection
                .query_row(
                    "SELECT plain_text FROM search_documents WHERE project_id = ?1 AND chapter_id = ?2 \
                     AND row_id = ?3 AND language_code = ?4 AND snippet_source = 'field' LIMIT 1",
                    [&first.project_id, &first.chapter_id, &first.row_id, &target.to_string()],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .filter(|text| !text.trim().is_empty());
        }
    }
    Ok(ResearchPassage {
        item_id: key.to_string(),
        text: group.text.clone(),
        occurrences: group
            .spans
            .iter()
            .map(|(start, end)| PassageOccurrence {
                start: utf16_offset(&group.text, *start),
                end: utf16_offset(&group.text, *end),
                surface: group.text[*start..*end].to_string(),
            })
            .collect(),
        copy_count: group.rows.len(),
        copies: group
            .rows
            .iter()
            .map(|row| PassageCopy {
                project_id: row.project_id.clone(),
                project_title: row.project_title.clone(),
                chapter_id: row.chapter_id.clone(),
                chapter_title: row.chapter_title.clone(),
                row_id: row.row_id.clone(),
            })
            .collect(),
        context_before,
        context_after,
        existing_translation,
    })
}

/// One- and two-word neighbours of every occurrence, over the whole
/// population (occurrences and distinct passages).
fn neighbours(groups: &BTreeMap<String, Group>) -> Vec<Neighbour> {
    let word = Regex::new(r"[\p{L}\p{N}_]+").expect("word regex");
    let mut counts: HashMap<String, (usize, HashSet<&str>)> = HashMap::new();
    for (key, group) in groups {
        let words: Vec<(usize, usize, String)> = word
            .find_iter(&group.text)
            .map(|m| (m.start(), m.end(), m.as_str().to_lowercase()))
            .collect();
        for (start, end) in &group.spans {
            let Some(first) = words.iter().position(|w| w.0 >= *start) else {
                continue;
            };
            let Some(last) = words.iter().rposition(|w| w.1 <= *end) else {
                continue;
            };
            if last < first {
                continue;
            }
            let core = words[first..=last]
                .iter()
                .map(|w| w.2.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let mut phrases = Vec::new();
            for size in 1..=2 {
                if first >= size {
                    let left = words[first - size..first]
                        .iter()
                        .map(|w| w.2.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");
                    phrases.push(format!("{left} {core}"));
                }
                if last + size < words.len() {
                    let right = words[last + 1..=last + size]
                        .iter()
                        .map(|w| w.2.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");
                    phrases.push(format!("{core} {right}"));
                }
            }
            for phrase in phrases {
                let entry = counts.entry(phrase).or_insert_with(|| (0, HashSet::new()));
                entry.0 += 1;
                entry.1.insert(key.as_str());
            }
        }
    }
    let mut result: Vec<Neighbour> = counts
        .into_iter()
        .filter(|(_, (occurrences, _))| *occurrences >= 2)
        .map(|(phrase, (occurrences, paragraphs))| Neighbour {
            phrase,
            occurrences,
            paragraphs: paragraphs.len(),
        })
        .collect();
    result.sort_by(|a, b| {
        b.occurrences
            .cmp(&a.occurrences)
            .then(a.phrase.cmp(&b.phrase))
    });
    result.truncate(200);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        ensure_project_search_schema(&connection).unwrap();
        let rows = [
            ("p1", "c1", "r1", "a", "es", "Fue un resultado fatal."),
            ("p1", "c1", "r1", "a", "en", "It was a disastrous result."),
            (
                "p1",
                "c1",
                "r2",
                "b",
                "es",
                "La rueda fatal gira. Errores fatales.",
            ),
            ("p1", "c1", "r3", "c", "es", "Nada que ver aquí."),
            ("p1", "c2", "r4", "a", "es", "Fue un resultado fatal."),
            ("p1", "c3", "r5", "a", "en", "fatal in English only"),
            ("p2", "c9", "r9", "a", "es", "Otro proyecto fatal."),
        ];
        for (i, (project, chapter, row, order, language, text)) in rows.iter().enumerate() {
            connection.execute(
                "INSERT INTO search_documents (doc_id, result_id, repo_key, project_id, repo_name, project_title, \
                 chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, plain_text, \
                 search_text, trigram_count, text_hash, updated_at_unix) \
                 VALUES (?1, ?2, 'k', ?3, 'repo', 'Project', ?4, 'Chapter', ?5, ?6, ?7, ?7, ?8, ?8, 0, '', 0)",
                rusqlite::params![i as i64, format!("r{i}"), project, chapter, row, order, language, text],
            ).unwrap();
            for token in collect_unique_tokens(text) {
                connection
                    .execute(
                        "INSERT INTO search_document_tokens (doc_id, token) VALUES (?1, ?2)",
                        rusqlite::params![i as i64, token],
                    )
                    .unwrap();
            }
        }
        connection
    }

    fn input(mode: &str, n: usize) -> ResearchPassagesInput {
        ResearchPassagesInput {
            installation_id: 1,
            project_ids: vec!["p1".into()],
            language_code: "es".into(),
            target_language_code: Some("en".into()),
            forms: vec!["fatal".into(), "fatales".into()],
            mode: mode.into(),
            n,
            seed: "s".into(),
            refresh_index: false,
        }
    }

    #[test]
    fn population_is_complete_language_filtered_and_deduplicated() {
        let response = research_passages(&db(), &input("count", 0)).unwrap();
        assert_eq!(
            response.rows, 3,
            "two identical rows plus one; English rows ignored"
        );
        assert_eq!(response.distinct, 2);
        assert_eq!(response.duplicate_groups, 1);
        assert_eq!(response.matching_chapter_count, 2);
    }

    #[test]
    fn samples_are_prefixes_with_context_and_existing_translation() {
        let one = research_passages(&db(), &input("sample", 1)).unwrap();
        let two = research_passages(&db(), &input("sample", 2)).unwrap();
        assert_eq!(one.items[0].item_id, two.items[0].item_id);
        let plural = two
            .items
            .iter()
            .find(|i| i.text.contains("fatales"))
            .unwrap();
        assert_eq!(plural.occurrences.len(), 2);
        let single = two.items.iter().find(|i| i.copy_count == 2).unwrap();
        assert_eq!(
            single.existing_translation.as_deref(),
            Some("It was a disastrous result.")
        );
        assert_eq!(
            single.context_after,
            vec!["La rueda fatal gira. Errores fatales.".to_string()]
        );
        let occurrence = &single.occurrences[0];
        assert_eq!(&single.text[occurrence.start..occurrence.end], "fatal");
    }

    #[test]
    fn projects_are_listed_with_their_research_language() {
        let projects = research_projects(&db(), "es").unwrap();
        assert_eq!(projects.len(), 2);
        assert!(projects.iter().all(|p| p.has_language));
        assert!(research_projects(&db(), "ja")
            .unwrap()
            .iter()
            .all(|p| !p.has_language));
    }

    #[test]
    fn neighbours_count_distinct_passages_and_need_two_occurrences() {
        let response = research_passages(&db(), &input("neighbours", 0)).unwrap();
        // "resultado fatal" is in two identical rows: one passage, one occurrence.
        assert!(!response
            .neighbours
            .iter()
            .any(|n| n.phrase == "resultado fatal"));
        let mut with_projects = input("neighbours", 0);
        with_projects.project_ids = vec!["p1".into(), "p2".into()];
        with_projects.forms = vec!["fatal".into()];
        let response = research_passages(&db(), &with_projects).unwrap();
        assert!(response.neighbours.iter().all(|n| n.occurrences >= 2));
    }
}
