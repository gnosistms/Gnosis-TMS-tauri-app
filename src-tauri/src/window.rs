use base64::Engine as _;
use serde::Serialize;
use std::{fs, path::Path};
use tauri::Manager;

pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalDroppedFilePayload {
    name: String,
    mime_type: String,
    data_base64: String,
}

#[tauri::command]
pub(crate) fn read_local_dropped_file(path: String) -> Result<LocalDroppedFilePayload, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("The dropped file path is missing.".to_string());
    }

    let file_path = Path::new(trimmed_path);
    let metadata = fs::metadata(file_path).map_err(|error| {
        format!(
            "Could not read the dropped file '{}': {error}",
            file_path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "The dropped item '{}' is not a file.",
            file_path.display()
        ));
    }

    let bytes = fs::read(file_path).map_err(|error| {
        format!(
            "Could not read the dropped file '{}': {error}",
            file_path.display()
        )
    })?;
    let name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("image")
        .to_string();

    Ok(LocalDroppedFilePayload {
        name,
        mime_type: mime_type_for_path(file_path).to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("apng") => "image/apng",
        _ => "application/octet-stream",
    }
}
