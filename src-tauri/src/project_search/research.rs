use super::schema::{ensure_project_search_schema, open_project_search_db, project_search_db_path};
use serde_json::{json, Value};
use tauri::AppHandle;

pub(crate) fn population(
    app: &AppHandle,
    installation_id: i64,
    payload: &Value,
) -> Result<Value, String> {
    let mut connection = open_project_search_db(&project_search_db_path(app, installation_id)?)?;
    ensure_project_search_schema(&connection)?;
    super::indexer::refresh_project_index_current(app, installation_id, &mut connection)?;
    let language = payload["language"]
        .as_str()
        .ok_or("Select a source language.")?;
    let projects = payload["projectIds"]
        .as_array()
        .ok_or("Select at least one project.")?;
    if projects.is_empty() {
        return Err("Select at least one project.".into());
    }
    let mut statement=connection.prepare("SELECT result_id,project_id,project_title,chapter_id,chapter_title,row_id,row_order_key,plain_text FROM search_documents WHERE language_code=?1 AND snippet_source='field' ORDER BY repo_key,chapter_id,row_order_key").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([language], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let (id, project_id, project_title, chapter_id, chapter_title, row_id, order, text) =
            row.map_err(|e| e.to_string())?;
        if !projects.iter().any(|p| p.as_str() == Some(&project_id)) {
            continue;
        }
        items.push(json!({"id":id,"text":text,"reference":{"projectId":project_id,
            "projectTitle":project_title,"chapterId":chapter_id,"chapterTitle":chapter_title,"rowId":row_id,"orderKey":order}}));
    }
    for index in 0..items.len() {
        let before = if index > 0
            && items[index - 1]["reference"]["chapterId"] == items[index]["reference"]["chapterId"]
        {
            vec![items[index - 1]["text"].clone()]
        } else {
            vec![]
        };
        let after = if index + 1 < items.len()
            && items[index + 1]["reference"]["chapterId"] == items[index]["reference"]["chapterId"]
        {
            vec![items[index + 1]["text"].clone()]
        } else {
            vec![]
        };
        items[index]["contextBefore"] = before.into();
        items[index]["contextAfter"] = after.into();
    }
    use sha2::{Digest, Sha256};
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&items).map_err(|e| e.to_string())?)
    );
    Ok(json!({"items":items,"complete":true,"populationFingerprint":fingerprint}))
}
