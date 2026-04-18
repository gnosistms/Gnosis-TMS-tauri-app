use super::*;

pub(crate) fn save_gtms_editor_language_image_url_sync(
    app: &AppHandle,
    input: SaveEditorLanguageImageUrlInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let next_image = Some(StoredFieldImage {
        kind: "url".to_string(),
        url: Some(validate_editor_image_url(&input.url)?),
        path: None,
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let row_changed = updated_row_text != original_row_text;
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    if let Some(relative_path) = replaced_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        let mut next_row = original_row_file.clone();
        let mut paths_to_commit = vec![relative_row_json.clone()];

        if row_changed {
            write_text_file(&row_json_path, &updated_row_text)?;
            next_row = serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        }

        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            remove_repo_file_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
            paths_to_commit.push(relative_path.to_string());
        }

        if row_changed {
            git_output(&repo_path, &["add", &relative_row_json])?;
        }

        if row_changed || paths_to_commit.len() > 1 {
            let commit_paths: Vec<&str> = paths_to_commit.iter().map(String::as_str).collect();
            git_commit_as_signed_in_user_with_metadata(
                app,
                &repo_path,
                &format!("Update row {} {} image", input.row_id, input.language_code),
                &commit_paths,
                CommitMetadata {
                    operation: Some("editor-update"),
                    status_note: None,
                    ai_model: None,
                },
            )?;
        }

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn upload_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: UploadEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let bytes = decode_uploaded_image_bytes(&input.data_base64)?;
    let extension = validated_uploaded_image_extension(&input.filename, &bytes)?;
    let relative_image_path = relative_uploaded_image_path(
        &input.chapter_id,
        &input.row_id,
        &input.language_code,
        &input.filename,
        extension,
    );
    let absolute_image_path = repo_path.join(&relative_image_path);
    let next_image = Some(StoredFieldImage {
        kind: "upload".to_string(),
        url: None,
        path: Some(relative_image_path.clone()),
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone())
        .filter(|path| path != &relative_image_path);
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_image_path)?;
    if let Some(relative_path) = replaced_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_binary_file(&absolute_image_path, &bytes)?;
        write_text_file(&row_json_path, &updated_row_text)?;
        let next_row: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;

        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            remove_repo_file_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(
            &repo_path,
            &["add", &relative_row_json, &relative_image_path],
        )?;
        let mut commit_paths = vec![relative_row_json.clone(), relative_image_path.clone()];
        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            commit_paths.push(relative_path.to_string());
        }
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn remove_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: RemoveEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let removed_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    if current_image.is_none() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "saved".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, None)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    if let Some(relative_path) = removed_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_text_file(&row_json_path, &updated_row_text)?;
        let next_row: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;

        if let Some(relative_path) = removed_uploaded_path.as_deref() {
            remove_repo_file_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(&repo_path, &["add", &relative_row_json])?;
        let mut commit_paths = vec![relative_row_json.clone()];
        if let Some(relative_path) = removed_uploaded_path.as_deref() {
            commit_paths.push(relative_path.to_string());
        }
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn row_language_stored_image(
    row: &StoredRowFile,
    language_code: &str,
) -> Option<StoredFieldImage> {
    row.fields
        .get(language_code)
        .and_then(|field| normalize_editor_field_image_value(&field.image))
}

pub(super) fn row_uploaded_image_relative_paths(row: &StoredRowFile) -> Vec<String> {
    row.fields
        .values()
        .filter_map(|field| normalize_editor_field_image_value(&field.image))
        .filter_map(|image| {
            if image.kind == "upload" {
                image.path
            } else {
                None
            }
        })
        .collect()
}

fn normalize_uploaded_image_extension(extension: &str) -> Option<&'static str> {
    match extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("jpg"),
        "png" | "apng" => Some("png"),
        "gif" => Some("gif"),
        "svg" => Some("svg"),
        "webp" => Some("webp"),
        "avif" => Some("avif"),
        "bmp" => Some("bmp"),
        "ico" => Some("ico"),
        _ => None,
    }
}

fn svg_document_root_is_svg(bytes: &[u8]) -> bool {
    let mut reader = XmlReader::from_reader(bytes);
    reader.trim_text(true);
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(XmlEvent::Start(event)) | Ok(XmlEvent::Empty(event)) => {
                return event.name().as_ref() == b"svg";
            }
            Ok(XmlEvent::Decl(_))
            | Ok(XmlEvent::DocType(_))
            | Ok(XmlEvent::Comment(_))
            | Ok(XmlEvent::PI(_))
            | Ok(XmlEvent::Text(_))
            | Ok(XmlEvent::CData(_)) => {
                buffer.clear();
                continue;
            }
            Ok(XmlEvent::Eof) | Err(_) => return false,
            _ => {
                buffer.clear();
            }
        }
    }
}

fn detected_uploaded_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        if bytes
            .windows(4)
            .any(|window| window == b"avif" || window == b"avis")
        {
            return Some("avif");
        }
    }
    if svg_document_root_is_svg(bytes) {
        return Some("svg");
    }

    None
}

fn validated_uploaded_image_extension(
    filename: &str,
    bytes: &[u8],
) -> Result<&'static str, String> {
    let detected_extension = detected_uploaded_image_extension(bytes)
        .ok_or_else(|| "The uploaded file is not a valid supported image.".to_string())?;
    let filename_extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .and_then(normalize_uploaded_image_extension);

    if let Some(filename_extension) = filename_extension {
        if filename_extension != detected_extension {
            return Err(
                "The uploaded file extension does not match its image contents.".to_string(),
            );
        }
    }

    Ok(detected_extension)
}

fn decode_uploaded_image_bytes(data_base64: &str) -> Result<Vec<u8>, String> {
    let normalized_data = data_base64.trim();
    if normalized_data.is_empty() {
        return Err("The uploaded image data is empty.".to_string());
    }

    base64::engine::general_purpose::STANDARD
        .decode(normalized_data)
        .map_err(|error| format!("Could not decode the uploaded image data: {error}"))
}

pub(super) fn validate_editor_image_url(value: &str) -> Result<String, String> {
    let normalized_url = value.trim();
    if normalized_url.is_empty() {
        return Err("Enter an image URL.".to_string());
    }

    let parsed_url = url::Url::parse(normalized_url)
        .map_err(|error| format!("The image URL is invalid: {error}"))?;
    match parsed_url.scheme() {
        "http" | "https" => Ok(normalized_url.to_string()),
        _ => Err("Only http:// and https:// image URLs are supported.".to_string()),
    }
}

pub(super) fn write_binary_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }

    fs::write(path, bytes).map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

fn remove_empty_parent_directories(path: &Path, stop_at: &Path) -> Result<(), String> {
    let mut current = path.parent();
    while let Some(parent) = current {
        if parent == stop_at {
            break;
        }
        match fs::remove_dir(parent) {
            Ok(()) => current = parent.parent(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = parent.parent();
            }
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => break,
            Err(error) => {
                return Err(format!(
                    "Could not remove empty directory '{}': {error}",
                    parent.display()
                ));
            }
        }
    }

    Ok(())
}

pub(super) fn remove_repo_file_from_disk(
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let absolute_path = repo_path.join(relative_path);
    match fs::remove_file(&absolute_path) {
        Ok(()) => remove_empty_parent_directories(&absolute_path, repo_path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove '{}': {error}",
            absolute_path.display()
        )),
    }
}

#[derive(Clone)]
pub(super) struct RepoFileSnapshot {
    relative_path: String,
    absolute_path: PathBuf,
    original_bytes: Option<Vec<u8>>,
}

pub(super) fn capture_repo_file_snapshot(
    repo_path: &Path,
    relative_path: &str,
) -> Result<RepoFileSnapshot, String> {
    let absolute_path = repo_path.join(relative_path);
    let original_bytes = match fs::read(&absolute_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not read '{}': {error}",
                absolute_path.display()
            ));
        }
    };

    Ok(RepoFileSnapshot {
        relative_path: relative_path.to_string(),
        absolute_path,
        original_bytes,
    })
}

pub(super) fn push_repo_file_snapshot(
    snapshots: &mut Vec<RepoFileSnapshot>,
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    if snapshots
        .iter()
        .any(|snapshot| snapshot.relative_path == relative_path)
    {
        return Ok(());
    }

    snapshots.push(capture_repo_file_snapshot(repo_path, relative_path)?);
    Ok(())
}

pub(super) fn restore_repo_file_snapshot_on_disk(
    repo_path: &Path,
    snapshot: &RepoFileSnapshot,
) -> Result<(), String> {
    if let Some(original_bytes) = snapshot.original_bytes.as_deref() {
        write_binary_file(&snapshot.absolute_path, original_bytes)?;
        return Ok(());
    }

    remove_repo_file_from_disk(repo_path, &snapshot.relative_path)
}

fn sync_repo_file_snapshot_to_index(
    repo_path: &Path,
    snapshot: &RepoFileSnapshot,
) -> Result<(), String> {
    if snapshot.original_bytes.is_some() {
        git_output(repo_path, &["add", &snapshot.relative_path])?;
    } else {
        git_output(
            repo_path,
            &[
                "rm",
                "--cached",
                "--ignore-unmatch",
                &snapshot.relative_path,
            ],
        )?;
    }
    Ok(())
}

fn rollback_repo_file_snapshots(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
) -> Result<(), String> {
    let mut errors = Vec::new();

    for snapshot in snapshots.iter().rev() {
        if let Err(error) = restore_repo_file_snapshot_on_disk(repo_path, snapshot) {
            errors.push(error);
            continue;
        }
        if let Err(error) = sync_repo_file_snapshot_to_index(repo_path, snapshot) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

pub(super) fn with_repo_file_rollback<T, F>(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
    operation: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    match operation() {
        Ok(value) => Ok(value),
        Err(error) => match rollback_repo_file_snapshots(repo_path, snapshots) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!("{error} Rollback failed: {rollback_error}")),
        },
    }
}

fn relative_uploaded_image_path(
    chapter_id: &str,
    row_id: &str,
    language_code: &str,
    filename: &str,
    extension: &str,
) -> String {
    let upload_directory = format!("row-{row_id}-{language_code}-{}", uuid::Uuid::now_v7());
    let file_name = sanitized_uploaded_image_file_name(filename, extension);
    format!("chapters/{chapter_id}/images/{upload_directory}/{file_name}")
}

fn sanitized_uploaded_image_file_name(filename: &str, extension: &str) -> String {
    let original_name = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .unwrap_or_default();
    let matching_extension = Path::new(original_name)
        .extension()
        .and_then(|value| value.to_str())
        .and_then(normalize_uploaded_image_extension);

    if matching_extension == Some(extension) {
        let sanitized_name = sanitize_uploaded_image_file_name_component(original_name);
        if !matches!(sanitized_name.as_str(), "" | "." | "..") {
            return sanitized_name;
        }
    }

    let base_name = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let sanitized_base_name = sanitize_uploaded_image_file_name_component(base_name);
    let final_base_name = match sanitized_base_name.as_str() {
        "" | "." | ".." => "image",
        _ => sanitized_base_name.as_str(),
    };

    format!("{final_base_name}.{extension}")
}

fn sanitize_uploaded_image_file_name_component(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect()
}

pub(super) fn file_bytes_equal(path: &Path, bytes: &[u8]) -> bool {
    fs::read(path)
        .map(|existing| existing == bytes)
        .unwrap_or(false)
}

pub(super) fn load_historical_blob_bytes(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let request = format!("{commit_sha}:{relative_path}\n");
    let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
    let Some(header_end) = output.iter().position(|byte| *byte == b'\n') else {
        return Err(format!(
            "Could not parse the historical blob header for '{}'.",
            relative_path
        ));
    };
    let header = str::from_utf8(&output[..header_end]).map_err(|error| {
        format!(
            "Could not decode the historical blob header for '{}': {error}",
            relative_path
        )
    })?;
    if header.ends_with(" missing") {
        return Err(format!(
            "Could not find the historical file '{}' at commit '{}'.",
            relative_path, commit_sha
        ));
    }

    let mut header_parts = header.split_whitespace();
    let _object_name = header_parts.next().unwrap_or_default();
    let object_type = header_parts.next().unwrap_or_default();
    let object_size = header_parts
        .next()
        .ok_or_else(|| {
            format!(
                "Could not parse the historical blob size for '{}'.",
                relative_path
            )
        })?
        .parse::<usize>()
        .map_err(|error| {
            format!(
                "Could not decode the historical blob size for '{}': {error}",
                relative_path
            )
        })?;
    if object_type != "blob" {
        return Err(format!(
            "Expected a blob for historical file '{}', found '{}'.",
            relative_path, object_type
        ));
    }

    let body_start = header_end + 1;
    let body_end = body_start
        .checked_add(object_size)
        .ok_or_else(|| format!("Historical blob size overflow for '{}'.", relative_path))?;
    if body_end > output.len() {
        return Err(format!(
            "The historical blob output was truncated for '{}'.",
            relative_path
        ));
    }

    Ok(output[body_start..body_end].to_vec())
}

fn normalize_editor_field_image_kind(value: &str) -> Option<&'static str> {
    match value.trim() {
        "url" => Some("url"),
        "upload" => Some("upload"),
        _ => None,
    }
}

fn normalize_editor_field_image_parts(
    kind: &str,
    url: Option<&str>,
    path: Option<&str>,
) -> Option<StoredFieldImage> {
    match normalize_editor_field_image_kind(kind)? {
        "url" => {
            let normalized_url = url.unwrap_or_default().trim();
            if normalized_url.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "url".to_string(),
                url: Some(normalized_url.to_string()),
                path: None,
            })
        }
        "upload" => {
            let normalized_path = path.unwrap_or_default().trim();
            if normalized_path.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "upload".to_string(),
                url: None,
                path: Some(normalized_path.to_string()),
            })
        }
        _ => None,
    }
}

pub(super) fn normalize_editor_field_image_value(
    value: &Option<StoredFieldImage>,
) -> Option<StoredFieldImage> {
    value.as_ref().and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, image.url.as_deref(), image.path.as_deref())
    })
}

pub(super) fn normalize_editor_field_image_input(
    value: Option<&EditorFieldImageInput>,
) -> Option<StoredFieldImage> {
    value.and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, Some(&image.url), Some(&image.path))
    })
}

pub(super) fn editor_field_image_from_stored(
    repo_path: &Path,
    value: &Option<StoredFieldImage>,
) -> Option<EditorFieldImage> {
    let image = normalize_editor_field_image_value(value)?;
    let file_name = image
        .path
        .as_deref()
        .and_then(editor_uploaded_image_file_name_from_relative_path);
    let file_path = image
        .path
        .as_deref()
        .map(|relative_path| repo_path.join(relative_path).to_string_lossy().to_string());

    Some(EditorFieldImage {
        kind: image.kind,
        url: image.url,
        path: image.path,
        file_path,
        file_name,
    })
}

fn editor_uploaded_image_file_name_from_relative_path(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

fn apply_editor_field_image_update(
    row_value: &mut Value,
    language_code: &str,
    image: Option<StoredFieldImage>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    let field_value = fields_object
        .entry(language_code.to_string())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert(
        "image".to_string(),
        serde_json::to_value(image)
            .map_err(|error| format!("Could not serialize the row image metadata: {error}"))?,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("gnosis-tms-{name}-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_restores_original_bytes() {
        let repo_path = temp_test_dir("snapshot-restores-bytes");
        let relative_path = "chapters/chapter-1/images/row-1-vi-upload/example.png";
        let absolute_path = repo_path.join(relative_path);

        write_binary_file(&absolute_path, b"original").expect("original file should be written");
        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"changed").expect("changed file should be written");
        restore_repo_file_snapshot_on_disk(&repo_path, &snapshot)
            .expect("snapshot should restore bytes");

        assert_eq!(
            fs::read(&absolute_path).expect("file should exist"),
            b"original"
        );

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_removes_new_files_when_they_were_originally_missing() {
        let repo_path = temp_test_dir("snapshot-removes-new-file");
        let relative_path = "chapters/chapter-1/images/row-1-vi-upload/example.png";
        let absolute_path = repo_path.join(relative_path);

        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"created").expect("new file should be written");
        restore_repo_file_snapshot_on_disk(&repo_path, &snapshot)
            .expect("snapshot should remove new file");

        assert!(!absolute_path.exists(), "new file should be removed");
        assert!(
            !absolute_path
                .parent()
                .expect("upload directory should exist")
                .exists(),
            "empty upload directory should be removed"
        );

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn sanitized_uploaded_image_file_name_preserves_matching_original_name() {
        assert_eq!(
            sanitized_uploaded_image_file_name(" original photo.PNG ", "png"),
            "original photo.PNG"
        );
    }

    #[test]
    fn sanitized_uploaded_image_file_name_appends_detected_extension_when_missing() {
        assert_eq!(
            sanitized_uploaded_image_file_name("original photo", "png"),
            "original photo.png"
        );
    }

    #[test]
    fn sanitized_uploaded_image_file_name_strips_directory_parts_and_sanitizes_invalid_chars() {
        assert_eq!(
            sanitized_uploaded_image_file_name("../unsafe:photo.png", "png"),
            "unsafe_photo.png"
        );
    }

    #[test]
    fn relative_uploaded_image_path_keeps_original_file_name_in_upload_directory() {
        let relative_path =
            relative_uploaded_image_path("chapter-1", "row-1", "vi", "original photo.png", "png");

        assert!(
            relative_path.starts_with("chapters/chapter-1/images/row-row-1-vi-"),
            "unexpected path: {relative_path}"
        );
        assert!(
            relative_path.ends_with("/original photo.png"),
            "unexpected path: {relative_path}"
        );
    }
}
