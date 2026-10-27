use super::super::book_export;
use super::document::{self, IMAGE_ROOT};
use base64::Engine as _;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

fn checked_bytes(id: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    document::validate_asset_id(id)?;
    crate::constants::ensure_within_import_size_limit(bytes.len() as u64, id)?;
    let (_, bytes) = book_export::validate_book_image(id, bytes)?;
    if format!("{:x}", Sha256::digest(&bytes)) != id.split('.').next().unwrap_or("") {
        return Err("A saved export image does not match its identifier.".into());
    }
    Ok(bytes.into_owned())
}

pub(super) fn local_bytes(app: &AppHandle, id: &str) -> Result<Vec<u8>, String> {
    document::validate_asset_id(id)?;
    let path = book_export::asset_root(app)?.join(id);
    let size = fs::metadata(&path)
        .map_err(|_| "A saved export image is missing. Select it again before saving.")?
        .len();
    crate::constants::ensure_within_import_size_limit(size, id)?;
    checked_bytes(
        id,
        &fs::read(path).map_err(|_| "Could not read a saved export image.")?,
    )
}

pub(super) fn hydrate<F>(app: &AppHandle, document: &Value, mut read: F) -> Result<Value, String>
where
    F: FnMut(&str) -> Result<Vec<u8>, String>,
{
    let root = book_export::asset_root(app)?;
    fs::create_dir_all(&root).map_err(|_| "Could not prepare the saved export images.")?;
    let mut result = document.clone();
    for layout in result["layouts"]
        .as_object_mut()
        .into_iter()
        .flat_map(|layouts| layouts.values_mut())
    {
        for item in layout["items"].as_array_mut().into_iter().flatten() {
            let Some(id) = item["image"]["assetId"].as_str().map(String::from) else {
                continue;
            };
            let mut load = |id: &str| -> Result<Vec<u8>, String> {
                match local_bytes(app, id) {
                    Ok(bytes) => Ok(bytes),
                    Err(_) => {
                        let bytes = checked_bytes(id, &read(id)?)?;
                        fs::write(root.join(id), &bytes)
                            .map_err(|_| "Could not cache a saved export image.")?;
                        Ok(bytes)
                    }
                }
            };
            let bytes = load(&id)?;
            let path = root.join(&id);
            if let Some(prepared) = item["image"]["vellumAssetId"].as_str() {
                load(prepared)?;
                item["image"]["vellumFilePath"] =
                    root.join(prepared).to_string_lossy().into_owned().into();
            }
            item["image"]["filePath"] = path.to_string_lossy().into_owned().into();
            if id.ends_with(".svg") {
                item["image"]["dataUrl"] = format!(
                    "data:image/svg+xml;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&bytes)
                )
                .into();
            }
        }
    }
    Ok(result)
}

pub(super) fn repo_files(
    app: &AppHandle,
    settings: &Value,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut files = vec![(
        document::SETTINGS_PATH.into(),
        // Keep one canonical JSON line: concurrent changes must reach the
        // semantic per-language resolver, even when they edit different fields.
        serde_json::to_vec(settings).map_err(|e| e.to_string())?,
    )];
    files.push((
        format!("{IMAGE_ROOT}/.gitattributes"),
        b"* -text\n".to_vec(),
    ));
    for id in document::assets(settings) {
        files.push((format!("{IMAGE_ROOT}/{id}"), local_bytes(app, &id)?));
    }
    Ok(files)
}

pub(super) fn read_working_image(repo: &Path, id: &str) -> Result<Vec<u8>, String> {
    document::validate_asset_id(id)?;
    let path = safe_repo_file(repo, &format!("{IMAGE_ROOT}/{id}"))?;
    let size = fs::metadata(&path)
        .map_err(|_| "A saved export image is not available locally yet.")?
        .len();
    crate::constants::ensure_within_import_size_limit(size, id)?;
    fs::read(path).map_err(|_| "Could not read a saved export image.".into())
}

pub(super) fn safe_repo_file(repo: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = repo.to_path_buf();
    for part in Path::new(relative).components() {
        if !matches!(part, std::path::Component::Normal(_)) {
            return Err("An export settings path is invalid.".into());
        }
        path.push(part);
        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err("Export settings cannot use symbolic links.".into());
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_images_require_safe_content_and_matching_content_ids() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>"#;
        let canonical = book_export::validate_book_image("logo.svg", svg).unwrap().1;
        let id = format!("{:x}.svg", Sha256::digest(&canonical));
        assert!(checked_bytes(&id, &canonical).is_ok());
        assert!(checked_bytes(&format!("{}.svg", "a".repeat(64)), &canonical).is_err());
        assert!(checked_bytes(&id, br#"<svg><script>x()</script></svg>"#).is_err());
        assert!(checked_bytes("../../outside.svg", svg).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn settings_paths_reject_symlinked_directories_before_snapshot_or_write() {
        let root =
            std::env::temp_dir().join(format!("gnosis-export-path-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(root.join("repo")).unwrap();
        fs::create_dir_all(root.join("outside")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), root.join("repo/.gtms")).unwrap();
        assert!(safe_repo_file(&root.join("repo"), document::SETTINGS_PATH).is_err());
        assert!(safe_repo_file(&root.join("repo"), "../outside").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
