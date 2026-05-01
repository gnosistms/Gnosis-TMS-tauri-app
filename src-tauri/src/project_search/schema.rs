use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;
use tauri::AppHandle;

use crate::storage_paths::installation_data_dir;

pub(super) fn project_search_db_path(
    app: &AppHandle,
    installation_id: i64,
) -> Result<PathBuf, String> {
    let search_dir = installation_data_dir(app, installation_id)?.join("search");
    fs::create_dir_all(&search_dir).map_err(|error| {
        format!(
            "Could not create the local search folder '{}': {error}",
            search_dir.display()
        )
    })?;
    Ok(search_dir.join("project-search.sqlite3"))
}

pub(super) fn open_project_search_db(db_path: &Path) -> Result<Connection, String> {
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

pub(super) fn ensure_project_search_schema(connection: &Connection) -> Result<(), String> {
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
         snippet_source TEXT NOT NULL DEFAULT 'field',
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
    if !table_has_column(connection, "search_documents", "snippet_source")? {
        connection
            .execute(
                "ALTER TABLE search_documents ADD COLUMN snippet_source TEXT NOT NULL DEFAULT 'field'",
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
