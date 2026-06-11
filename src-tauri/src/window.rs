use crate::constants::ensure_within_import_size_limit;
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

/// Expands a leading `~/` to the user's home directory. Real drag-and-drop
/// paths are always absolute; this only matters for hand-typed paths (the
/// Add files paste-link tab accepts them).
fn expand_user_home(path: &str) -> String {
    let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) else {
        return path.to_string();
    };

    let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    match std::env::var(home_var) {
        Ok(home) if !home.trim().is_empty() => {
            Path::new(&home).join(rest).to_string_lossy().into_owned()
        }
        _ => path.to_string(),
    }
}

#[tauri::command]
pub(crate) fn read_local_dropped_file(path: String) -> Result<LocalDroppedFilePayload, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("The dropped file path is missing.".to_string());
    }

    let expanded_path = expand_user_home(trimmed_path);
    let file_path = Path::new(&expanded_path);
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
    ensure_within_import_size_limit(metadata.len(), &name_for_path(file_path))?;

    let bytes = fs::read(file_path).map_err(|error| {
        format!(
            "Could not read the dropped file '{}': {error}",
            file_path.display()
        )
    })?;
    let name = name_for_path(file_path);

    Ok(LocalDroppedFilePayload {
        name,
        mime_type: mime_type_for_path(file_path).to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn name_for_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("file")
        .to_string()
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
        Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        Some("html") | Some("htm") => "text/html",
        Some("txt") => "text/plain",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::expand_user_home;

    #[test]
    fn expand_user_home_resolves_home_relative_paths() {
        let home_var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let home = std::env::var(home_var).expect("test environment should have a home dir");

        let expanded = expand_user_home("~/Desktop/file.html");
        assert!(expanded.starts_with(&home));
        assert!(
            expanded.ends_with("Desktop/file.html") || expanded.ends_with("Desktop\\file.html")
        );
    }

    #[test]
    fn expand_user_home_leaves_other_paths_alone() {
        assert_eq!(expand_user_home("/tmp/file.html"), "/tmp/file.html");
        assert_eq!(
            expand_user_home("C:\\Docs\\file.html"),
            "C:\\Docs\\file.html"
        );
        assert_eq!(expand_user_home("~file"), "~file");
    }
}
