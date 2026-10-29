//! Detects when an image being inserted into a row is already used elsewhere in
//! the project, and remembers images the user reuses on purpose (for example a
//! separator image). Read-only for the repo: the allowlist is a local preference.
use super::images::{
    normalize_editor_field_image_value, normalize_uploaded_image_extension, uploaded_path_identity,
    validate_editor_image_url,
};
use super::*;
use crate::short_path_names::allocate_short_image_filename;
use std::sync::Mutex;
use tauri::Manager;

const ALLOWLIST_DIR: &str = "image-reuse-allowlist-v1";
static ALLOWLIST_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FindEditorImageReuseInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    image: EditorImageReuseCandidate,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum EditorImageReuseCandidate {
    Url {
        url: String,
    },
    // The frontend already holds the bytes, so it sends their fingerprint rather
    // than shipping the whole image over IPC a second time.
    #[serde(rename_all = "camelCase")]
    Upload {
        file_name: String,
        byte_length: u64,
        sha256: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorImageReuseResponse {
    image_key: String,
    chapters: Vec<EditorImageReuseChapter>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorImageReuseChapter {
    chapter_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AllowEditorImageReuseInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    image_key: String,
}

#[derive(Default, Deserialize, Serialize)]
struct ImageReuseAllowlist {
    #[serde(default)]
    images: BTreeSet<String>,
}

pub(crate) fn find_gtms_editor_image_reuse_sync(
    app: &AppHandle,
    input: FindEditorImageReuseInput,
) -> Result<EditorImageReuseResponse, String> {
    let allowlist = allowlist_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        &input.repo_name,
    )?;
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    find_image_reuse(&allowlist, &repo_path, &input)
}

pub(crate) fn allow_gtms_editor_image_reuse_sync(
    app: &AppHandle,
    input: AllowEditorImageReuseInput,
) -> Result<(), String> {
    let path = allowlist_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        &input.repo_name,
    )?;
    allow_image_reuse(&path, &input.image_key)
}

fn find_image_reuse(
    allowlist: &Path,
    repo_path: &Path,
    input: &FindEditorImageReuseInput,
) -> Result<EditorImageReuseResponse, String> {
    let image_key = image_reuse_key(&input.image)?;
    let chapters = if read_allowlist(allowlist).contains(&image_key) {
        Vec::new()
    } else {
        find_image_reuse_chapters(repo_path, &input.chapter_id, &input.row_id, &input.image)?
    };
    Ok(EditorImageReuseResponse {
        image_key,
        chapters,
    })
}

fn image_reuse_key(image: &EditorImageReuseCandidate) -> Result<String, String> {
    match image {
        EditorImageReuseCandidate::Url { url } => {
            Ok(format!("url:{}", validate_editor_image_url(url)?))
        }
        EditorImageReuseCandidate::Upload { sha256, .. } => {
            Ok(format!("upload:{}", normalized_sha256(sha256)?))
        }
    }
}

fn normalized_sha256(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(value)
    } else {
        Err("The image fingerprint is invalid.".to_string())
    }
}

fn valid_image_key(key: &str) -> bool {
    match key.split_once(':') {
        Some(("url", url)) => validate_editor_image_url(url).is_ok_and(|valid| valid == url),
        Some(("upload", sha256)) => normalized_sha256(sha256).is_ok_and(|valid| valid == sha256),
        _ => false,
    }
}

enum RowImageMatcher {
    Url {
        url: String,
        needle: String,
    },
    Upload {
        identities: BTreeSet<String>,
        needles: Vec<String>,
    },
}

impl RowImageMatcher {
    // A substring test on the raw row JSON is enough to skip parsing almost
    // every row; only rows that mention the image are decoded and checked.
    fn may_match(&self, row_text: &str) -> bool {
        match self {
            Self::Url { needle, .. } => row_text.contains(needle.as_str()),
            Self::Upload { needles, .. } => needles
                .iter()
                .any(|needle| row_text.contains(needle.as_str())),
        }
    }

    fn matches(&self, image: &StoredFieldImage) -> bool {
        match self {
            Self::Url { url, .. } => {
                image.kind == "url" && image.url.as_deref() == Some(url.as_str())
            }
            Self::Upload { identities, .. } => {
                image.kind == "upload"
                    && image
                        .path
                        .as_deref()
                        .and_then(|path| uploaded_path_identity(path).ok())
                        .is_some_and(|identity| identities.contains(&identity))
            }
        }
    }
}

fn find_image_reuse_chapters(
    repo_path: &Path,
    target_chapter_id: &str,
    target_row_id: &str,
    image: &EditorImageReuseCandidate,
) -> Result<Vec<EditorImageReuseChapter>, String> {
    let chapter_dirs = chapter_dirs(&repo_path.join("chapters"));
    let matcher = match image {
        EditorImageReuseCandidate::Url { url } => {
            let url = validate_editor_image_url(url)?;
            RowImageMatcher::Url {
                needle: json_string_body(&url),
                url,
            }
        }
        EditorImageReuseCandidate::Upload {
            file_name,
            byte_length,
            sha256,
        } => {
            let identities = matching_uploaded_image_identities(
                repo_path,
                &chapter_dirs,
                file_name,
                *byte_length,
                &normalized_sha256(sha256)?,
            );
            if identities.is_empty() {
                return Ok(Vec::new());
            }
            let needles = identities
                .iter()
                .filter_map(|identity| identity.rsplit('/').next())
                .map(json_string_body)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            RowImageMatcher::Upload {
                identities,
                needles,
            }
        }
    };

    let mut chapters = Vec::new();
    for chapter_dir in chapter_dirs {
        let Ok(chapter) =
            read_json_file::<StoredChapterFile>(&chapter_dir.join("chapter.json"), "chapter.json")
        else {
            continue;
        };
        if chapter.lifecycle.state == "deleted" {
            continue;
        }
        let excluded_row_id = (chapter.chapter_id == target_chapter_id).then_some(target_row_id);
        if chapter_rows_use_image(&chapter_dir.join("rows"), &matcher, excluded_row_id) {
            chapters.push(EditorImageReuseChapter {
                chapter_id: chapter.chapter_id,
                title: chapter.title,
            });
        }
    }
    Ok(chapters)
}

fn chapter_dirs(chapters_root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(chapters_root) else {
        return Vec::new();
    };
    let mut dirs = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    dirs.sort();
    dirs
}

fn chapter_rows_use_image(
    rows_dir: &Path,
    matcher: &RowImageMatcher,
    excluded_row_id: Option<&str>,
) -> bool {
    let Ok(entries) = fs::read_dir(rows_dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        if !matcher.may_match(&text) {
            continue;
        }
        let Ok(row) = serde_json::from_str::<StoredRowFile>(&text) else {
            continue;
        };
        if row.lifecycle.state == "deleted" || excluded_row_id == Some(row.row_id.as_str()) {
            continue;
        }
        if row
            .fields
            .values()
            .filter_map(|field| normalize_editor_field_image_value(&field.image))
            .any(|image| matcher.matches(&image))
        {
            return true;
        }
    }
    false
}

/// Stored uploads (in any chapter's image folder) that have the same name, size
/// and contents as the image being inserted. Only same-name, same-size files are
/// read and hashed.
fn matching_uploaded_image_identities(
    repo_path: &Path,
    chapter_dirs: &[PathBuf],
    file_name: &str,
    byte_length: u64,
    sha256: &str,
) -> BTreeSet<String> {
    let target = UploadNameKey::new(file_name);
    let mut identities = BTreeSet::new();
    for chapter_dir in chapter_dirs {
        for path in image_files(&chapter_dir.join("images")) {
            let same_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| target.matches(&UploadNameKey::new(name)));
            if !same_name
                || !fs::metadata(&path).is_ok_and(|metadata| metadata.len() == byte_length)
                || fs::read(&path)
                    .ok()
                    .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
                    .as_deref()
                    != Some(sha256)
            {
                continue;
            }
            if let Some(identity) = repo_relative_path(repo_path, &path)
                .ok()
                .and_then(|relative| uploaded_path_identity(&relative).ok())
            {
                identities.insert(identity);
            }
        }
    }
    identities
}

fn image_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        // DirEntry::file_type does not follow symlinks, so linked files and
        // folders are skipped like the upload path validator rejects them.
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => files.extend(image_files(&entry.path())),
            Ok(kind) if kind.is_file() => files.push(entry.path()),
            _ => {}
        }
    }
    files
}

/// The file-name part of image identity. Uploads are stored under a sanitized,
/// length-limited name with a `-2`, `-3`, ... suffix on collision, so names are
/// compared in that sanitized form without the collision suffix.
#[derive(Debug, PartialEq, Eq)]
struct UploadNameKey {
    base: String,
    extension: Option<String>,
}

impl UploadNameKey {
    fn new(file_name: &str) -> Self {
        let sanitized = allocate_short_image_filename(file_name, "", std::iter::empty::<&str>());
        let (base, extension) = match sanitized.rsplit_once('.') {
            Some((base, extension)) if !base.is_empty() && !extension.is_empty() => {
                (base, Some(extension))
            }
            _ => (sanitized.as_str(), None),
        };
        Self {
            base: without_collision_suffix(base).to_string(),
            extension: extension.map(|extension| {
                normalize_uploaded_image_extension(extension)
                    .unwrap_or(extension)
                    .to_string()
            }),
        }
    }

    // An upload without an extension is stored with its detected one.
    fn matches(&self, stored: &Self) -> bool {
        self.base == stored.base && (self.extension.is_none() || self.extension == stored.extension)
    }
}

fn without_collision_suffix(base: &str) -> &str {
    match base.rsplit_once('-') {
        Some((stem, suffix))
            if !stem.is_empty()
                && !suffix.is_empty()
                && suffix.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            stem
        }
        _ => base,
    }
}

fn json_string_body(value: &str) -> String {
    let quoted = serde_json::to_string(value).unwrap_or_default();
    quoted
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
        .to_string()
}

fn allowlist_path(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
) -> Result<PathBuf, String> {
    let project = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo_name.trim());
    let key = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([installation_id, project]))
                .map_err(|error| error.to_string())?
        )
    );
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "The local image settings are unavailable.".to_string())?
        .join(ALLOWLIST_DIR)
        .join(format!("{key}.json")))
}

fn read_allowlist(path: &Path) -> BTreeSet<String> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ImageReuseAllowlist>(&bytes).ok())
        .map(|allowlist| allowlist.images)
        .unwrap_or_default()
}

fn allow_image_reuse(path: &Path, image_key: &str) -> Result<(), String> {
    if !valid_image_key(image_key) {
        return Err("The image could not be identified.".to_string());
    }
    let _guard = ALLOWLIST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut images = read_allowlist(path);
    if !images.insert(image_key.to_string()) {
        return Ok(());
    }
    let dir = path
        .parent()
        .ok_or_else(|| "The local image settings are unavailable.".to_string())?;
    fs::create_dir_all(dir).map_err(|_| "Could not save the image setting.".to_string())?;
    let tmp = dir.join(format!("{}.tmp", uuid::Uuid::now_v7()));
    let bytes =
        serde_json::to_vec(&ImageReuseAllowlist { images }).map_err(|error| error.to_string())?;
    fs::write(&tmp, bytes).map_err(|_| "Could not save the image setting.".to_string())?;
    crate::util::atomic_replace(&tmp, path).map_err(|_| {
        let _ = fs::remove_file(&tmp);
        "Could not save the image setting.".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nseparator";

    struct TestRepo {
        path: PathBuf,
    }

    impl TestRepo {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "gnosis-tms-image-reuse-{name}-{}",
                uuid::Uuid::now_v7()
            ));
            fs::create_dir_all(&path).expect("temp repo should be created");
            Self { path }
        }

        fn chapter(&self, folder: &str, chapter_id: &str, title: &str, state: &str) {
            let chapter_path = self.path.join("chapters").join(folder);
            fs::create_dir_all(chapter_path.join("rows")).expect("chapter rows should be created");
            fs::write(
                chapter_path.join("chapter.json"),
                serde_json::to_string_pretty(&json!({
                    "chapter_id": chapter_id,
                    "title": title,
                    "lifecycle": { "state": state },
                }))
                .expect("chapter should serialize"),
            )
            .expect("chapter should be written");
        }

        fn row(&self, folder: &str, row_id: &str, state: &str, images: &[(&str, Value)]) {
            let fields = images
                .iter()
                .map(|(language_code, image)| {
                    (
                        language_code.to_string(),
                        json!({ "plain_text": "", "image": image }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            fs::write(
                self.path
                    .join("chapters")
                    .join(folder)
                    .join("rows")
                    .join(format!("{row_id}.json")),
                serde_json::to_string_pretty(&json!({
                    "row_id": row_id,
                    "lifecycle": { "state": state },
                    "structure": { "order_key": "0001" },
                    "status": { "review_state": "draft" },
                    "origin": { "source_row_number": 1 },
                    "fields": fields,
                }))
                .expect("row should serialize"),
            )
            .expect("row should be written");
        }

        fn image(&self, folder: &str, file_name: &str, bytes: &[u8]) -> String {
            let images = self.path.join("chapters").join(folder).join("images");
            fs::create_dir_all(&images).expect("images folder should be created");
            fs::write(images.join(file_name), bytes).expect("image should be written");
            format!("chapters/{folder}/images/{file_name}")
        }

        fn find(&self, chapter_id: &str, row_id: &str, image: Value) -> EditorImageReuseResponse {
            let input: FindEditorImageReuseInput = serde_json::from_value(json!({
                "installationId": 1,
                "repoName": "project",
                "projectId": "project-1",
                "chapterId": chapter_id,
                "rowId": row_id,
                "image": image,
            }))
            .expect("input should decode");
            find_image_reuse(&self.allowlist(), &self.path, &input).expect("lookup should succeed")
        }

        fn allowlist(&self) -> PathBuf {
            self.path.join("app-data").join("allowlist.json")
        }

        fn titles(&self, chapter_id: &str, row_id: &str, image: Value) -> Vec<String> {
            self.find(chapter_id, row_id, image)
                .chapters
                .into_iter()
                .map(|chapter| chapter.title)
                .collect()
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn url_image(url: &str) -> Value {
        json!({ "kind": "url", "url": url })
    }

    fn upload_image(path: &str) -> Value {
        json!({ "kind": "upload", "path": path })
    }

    fn upload_candidate(file_name: &str, bytes: &[u8]) -> Value {
        json!({
            "kind": "upload",
            "fileName": file_name,
            "byteLength": bytes.len(),
            "sha256": format!("{:x}", Sha256::digest(bytes)),
        })
    }

    #[test]
    fn upload_name_keys_ignore_sanitizing_and_collision_suffixes() {
        let stored = UploadNameKey::new("my-photo-2.png");
        assert!(UploadNameKey::new("My Photo.PNG").matches(&stored));
        assert!(UploadNameKey::new("my photo.png").matches(&UploadNameKey::new("my-photo.png")));
        assert!(UploadNameKey::new("photo.jpeg").matches(&UploadNameKey::new("photo.jpg")));
        assert!(UploadNameKey::new("photo").matches(&UploadNameKey::new("photo.png")));
        assert!(!UploadNameKey::new("photo.png").matches(&UploadNameKey::new("photo.gif")));
        assert!(!UploadNameKey::new("other.png").matches(&stored));
        // Long names are truncated before the collision suffix is appended.
        assert!(UploadNameKey::new("a very long separator image name.png")
            .matches(&UploadNameKey::new("a-very-long-separator-2.png")));
    }

    #[test]
    fn url_reuse_lists_other_chapters_and_other_rows_of_the_current_chapter() {
        let repo = TestRepo::new("url");
        let url = "https://example.com/separator.png";
        repo.chapter("one", "chapter-1", "Chapter One", "active");
        repo.chapter("two", "chapter-2", "Chapter Two", "active");
        repo.chapter("three", "chapter-3", "Chapter Three", "active");
        repo.row("one", "row-1", "active", &[("en", url_image(url))]);
        repo.row("two", "row-2", "active", &[("vi", url_image(url))]);
        repo.row(
            "three",
            "row-3",
            "active",
            &[("en", url_image("https://example.com/other.png"))],
        );

        let response = repo.find("chapter-2", "row-9", json!({ "kind": "url", "url": url }));
        assert_eq!(response.image_key, format!("url:{url}"));
        assert_eq!(
            response.chapters,
            vec![
                EditorImageReuseChapter {
                    chapter_id: "chapter-1".into(),
                    title: "Chapter One".into()
                },
                EditorImageReuseChapter {
                    chapter_id: "chapter-2".into(),
                    title: "Chapter Two".into()
                },
            ]
        );
    }

    #[test]
    fn url_reuse_ignores_the_target_row_and_deleted_rows_or_chapters() {
        let repo = TestRepo::new("url-excluded");
        let url = "https://example.com/separator.png";
        repo.chapter("one", "chapter-1", "Chapter One", "active");
        repo.chapter("gone", "chapter-2", "Deleted Chapter", "deleted");
        repo.row("one", "row-1", "active", &[("en", url_image(url))]);
        repo.row("one", "row-2", "deleted", &[("en", url_image(url))]);
        repo.row("gone", "row-3", "active", &[("en", url_image(url))]);

        assert!(repo.titles("chapter-1", "row-1", url_image(url)).is_empty());
        assert_eq!(
            repo.titles("chapter-9", "row-9", url_image(url)),
            vec!["Chapter One"]
        );
    }

    #[test]
    fn upload_reuse_needs_a_matching_name_and_matching_contents() {
        let repo = TestRepo::new("upload");
        repo.chapter("one", "chapter-1", "Chapter One", "active");
        repo.chapter("two", "chapter-2", "Chapter Two", "active");
        let same = repo.image("one", "separator-2.png", PNG_BYTES);
        let different_bytes = repo.image("two", "separator.png", b"\x89PNG\r\n\x1a\nother!!!!");
        repo.row("one", "row-1", "active", &[("en", upload_image(&same))]);
        repo.row(
            "two",
            "row-2",
            "active",
            &[("en", upload_image(&different_bytes))],
        );

        assert_eq!(
            repo.titles(
                "chapter-3",
                "row-9",
                upload_candidate("Separator.png", PNG_BYTES)
            ),
            vec!["Chapter One"]
        );
        assert!(repo
            .titles(
                "chapter-3",
                "row-9",
                upload_candidate("renamed.png", PNG_BYTES)
            )
            .is_empty());
    }

    #[test]
    fn upload_reuse_ignores_unreferenced_image_files() {
        let repo = TestRepo::new("upload-orphan");
        repo.chapter("one", "chapter-1", "Chapter One", "active");
        repo.image("one", "separator.png", PNG_BYTES);
        repo.row("one", "row-1", "active", &[]);

        assert!(repo
            .titles(
                "chapter-2",
                "row-9",
                upload_candidate("separator.png", PNG_BYTES)
            )
            .is_empty());
    }

    #[test]
    fn allowed_images_are_not_reported() {
        let repo = TestRepo::new("allowlist");
        let url = "https://example.com/separator.png";
        repo.chapter("one", "chapter-1", "Chapter One", "active");
        repo.row("one", "row-1", "active", &[("en", url_image(url))]);
        assert_eq!(
            repo.titles("chapter-2", "row-9", url_image(url)),
            vec!["Chapter One"]
        );

        let key = repo.find("chapter-2", "row-9", url_image(url)).image_key;
        allow_image_reuse(&repo.allowlist(), &key).expect("allow should succeed");
        allow_image_reuse(&repo.allowlist(), &key).expect("allowing twice should succeed");

        let response = repo.find("chapter-2", "row-9", url_image(url));
        assert_eq!(response.image_key, key);
        assert!(response.chapters.is_empty());
    }

    #[test]
    fn allowlist_rejects_malformed_keys() {
        let repo = TestRepo::new("allowlist-invalid");
        for key in [
            "",
            "url:",
            "url:ftp://example.com/a.png",
            "upload:abc",
            "other:x",
        ] {
            assert!(allow_image_reuse(&repo.allowlist(), key).is_err(), "{key}");
        }
        assert!(read_allowlist(&repo.allowlist()).is_empty());
    }
}
