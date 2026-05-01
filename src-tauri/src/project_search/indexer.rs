use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::{
    discovery::{discover_project_repos, load_indexed_repo_states, RepoRecord},
    refresh::{plan_repo_refresh, RepoRefreshPlan},
    scoring::{
        collect_unique_bigrams, collect_unique_tokens, collect_unique_trigrams,
        normalize_search_text,
    },
};
use super::{
    lifecycle_state, read_json_value, read_language_name_map, read_optional_string,
    read_required_string,
};
use crate::storage_paths::installation_data_dir;

pub(super) struct ProjectSearchIndexRefreshStats {
    pub(super) repo_count: usize,
    pub(super) updated_repo_count: usize,
    pub(super) full_reindex_count: usize,
    pub(super) dirty_chapter_count: usize,
}

impl Default for ProjectSearchIndexRefreshStats {
    fn default() -> Self {
        Self {
            repo_count: 0,
            updated_repo_count: 0,
            full_reindex_count: 0,
            dirty_chapter_count: 0,
        }
    }
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
                   result_id, repo_key, project_id, repo_name, project_title, chapter_dir, chapter_id, chapter_title, row_id, row_order_key, language_code, language_name, snippet_source, plain_text, search_text, trigram_count, text_hash, updated_at_unix
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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
        snippet_source: &str,
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
            "{}:{}:{}:{}:{}",
            repo.repo_key, chapter_id, row_id, language_code, snippet_source
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
                snippet_source,
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

#[derive(Clone)]
pub(super) struct RowSearchDocument {
    pub(super) language_code: String,
    pub(super) language_name: String,
    pub(super) snippet_source: String,
    pub(super) plain_text: String,
}

pub(super) fn refresh_project_index_current(
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
        for document in row_search_documents_from_value(&row_value, &language_names) {
            inserter.insert_field_document(
                repo,
                chapter_dir,
                &chapter_id,
                &chapter_title,
                &row_id,
                &row_order_key,
                &document.language_code,
                &document.language_name,
                &document.snippet_source,
                &document.plain_text,
            )?;
        }
    }

    Ok(())
}

pub(super) fn row_search_documents_from_value(
    row_value: &Value,
    language_names: &HashMap<String, String>,
) -> Vec<RowSearchDocument> {
    let Some(fields) = row_value.get("fields").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut documents = Vec::new();
    for (language_code, field_value) in fields {
        let language_name = language_names
            .get(language_code)
            .cloned()
            .unwrap_or_else(|| language_code.to_uppercase());
        let plain_text = field_value
            .get("plain_text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !plain_text.is_empty() {
            documents.push(RowSearchDocument {
                language_code: language_code.clone(),
                language_name: language_name.clone(),
                snippet_source: "field".to_string(),
                plain_text,
            });
        }

        let footnote = field_value
            .get("footnote")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if !footnote.is_empty() {
            documents.push(RowSearchDocument {
                language_code: language_code.clone(),
                language_name,
                snippet_source: "footnote".to_string(),
                plain_text: footnote,
            });
        }
    }

    documents
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
