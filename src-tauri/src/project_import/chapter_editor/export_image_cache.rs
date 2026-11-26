//! Downloaded originals of remote export images, kept on disk so that exporting
//! a book in a second format (EPUB, then PDF or DOCX) does not fetch its images
//! again. Converted PDF images have a separate bounded folder under the same cache root.
use crate::util::atomic_replace;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, Runtime};

// An image replaced at the same address is picked up once its copy expires.
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

// Unset (as in tests) means nothing is cached.
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();
static PRUNE_LOCK: Mutex<()> = Mutex::new(());
pub(super) const PDF_PREPARED_DIR: &str = "pdf-prepared";
// An uncompressed print-size 8-bit RGBA image is under 24 MiB at 2040 × 2820.
const MAX_PREPARED_BYTES: u64 = 32 * 1024 * 1024;

pub(super) fn directory() -> Option<&'static Path> {
    CACHE_DIR.get().map(PathBuf::as_path)
}

// A single atomic entry holds the prepared bytes and their checksum. A damaged
// or partially restored cache can always be rebuilt from the original.
pub(super) fn read_prepared_pdf(dir: &Path, key: &str) -> Option<Vec<u8>> {
    let mut bytes = read_entry(
        &dir.join(PDF_PREPARED_DIR),
        key,
        MAX_PREPARED_BYTES + 32,
        Lifetime::ContentAddressed,
    )?;
    let end = bytes.len().checked_sub(32)?;
    if Sha256::digest(&bytes[..end])[..] != bytes[end..] {
        return None;
    }
    bytes.truncate(end);
    // Keys include the source contents and conversion settings. These copies
    // stay valid until space is needed, with recently used files evicted last.
    let path = entry_path(&dir.join(PDF_PREPARED_DIR), key);
    if let Ok(file) = fs::File::options().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
    Some(bytes)
}

pub(super) fn remember_prepared_pdf(dir: &Path, key: &str, bytes: &[u8]) {
    if bytes.len() as u64 > MAX_PREPARED_BYTES {
        return;
    }
    let mut entry = Vec::with_capacity(bytes.len() + 32);
    entry.extend_from_slice(bytes);
    entry.extend_from_slice(&Sha256::digest(bytes));
    write_entry(
        &dir.join(PDF_PREPARED_DIR),
        key,
        &entry,
        Lifetime::ContentAddressed,
        MAX_TOTAL_BYTES,
    );
}

pub(crate) fn initialize_export_image_cache<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(dir) = app.path().app_cache_dir() {
        let _ = CACHE_DIR.set(dir.join("export-images"));
    }
}

pub(super) fn fresh_download_stamp(dir: &Path, url: &str) -> Option<(SystemTime, u64)> {
    let metadata = fs::metadata(entry_path(dir, url)).ok()?;
    if expired(&metadata, SystemTime::now()) {
        return None;
    }
    Some((metadata.modified().ok()?, metadata.len()))
}

pub(super) fn cached_download(url: &str, max_bytes: u64) -> Option<Vec<u8>> {
    read_entry(
        CACHE_DIR.get()?,
        url,
        max_bytes,
        Lifetime::Download(SystemTime::now()),
    )
}

pub(super) fn remember_download(url: &str, data: &[u8]) {
    if let Some(dir) = CACHE_DIR.get() {
        if is_image_bytes(data) {
            write_entry(
                dir,
                url,
                data,
                Lifetime::Download(SystemTime::now()),
                MAX_TOTAL_BYTES,
            );
        }
    }
}

// Only images are kept: a sign-in or error page served in place of an image (as
// on hotel Wi-Fi) is fetched again on the next export.
fn is_image_bytes(data: &[u8]) -> bool {
    if image::guess_format(data).is_ok() {
        return true;
    }
    let head = String::from_utf8_lossy(&data[..data.len().min(1024)]).to_ascii_lowercase();
    !head.contains("<html") && std::str::from_utf8(data).is_ok_and(|text| text.contains("<svg"))
}

fn entry_path(dir: &Path, url: &str) -> PathBuf {
    dir.join(format!("{:x}", Sha256::digest(url.as_bytes())))
}

fn expired(metadata: &fs::Metadata, now: SystemTime) -> bool {
    metadata.modified().map_or(true, |modified| {
        now.duration_since(modified).is_ok_and(|age| age > MAX_AGE)
    })
}

#[derive(Clone, Copy)]
enum Lifetime {
    Download(SystemTime),
    ContentAddressed,
}

impl Lifetime {
    fn stale(self, metadata: &fs::Metadata) -> bool {
        matches!(self, Self::Download(now) if expired(metadata, now))
    }
}

fn read_entry(dir: &Path, url: &str, max_bytes: u64, lifetime: Lifetime) -> Option<Vec<u8>> {
    let path = entry_path(dir, url);
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() > max_bytes || lifetime.stale(&metadata) {
        let _ = fs::remove_file(&path);
        return None;
    }
    fs::read(&path).ok()
}

fn write_entry(dir: &Path, url: &str, data: &[u8], lifetime: Lifetime, max_total_bytes: u64) {
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = entry_path(dir, url);
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::now_v7()));
    if fs::write(&temporary, data).is_err() || atomic_replace(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
        return;
    }
    let _guard = PRUNE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    prune(dir, lifetime, max_total_bytes);
}

/// Removes expired copies, then the oldest ones until the folder fits its budget.
fn prune(dir: &Path, lifetime: Lifetime, max_total_bytes: u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        // Leave active writes alone and reclaim abandoned temporary files.
        if entry.path().extension().is_some_and(|ext| ext == "tmp") {
            if expired(&metadata, SystemTime::now()) {
                let _ = fs::remove_file(entry.path());
            }
            continue;
        }
        if lifetime.stale(&metadata) {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((modified, metadata.len(), entry.path()));
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
    for (_, len, path) in files {
        if total <= max_total_bytes {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total -= len;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    fn cache_dir() -> PathBuf {
        std::env::temp_dir().join(format!("gnosis-export-images-{}", uuid::Uuid::now_v7()))
    }

    fn set_age(dir: &Path, url: &str, now: SystemTime, age: Duration) {
        fs::File::options()
            .write(true)
            .open(entry_path(dir, url))
            .unwrap()
            .set_modified(now - age)
            .unwrap();
    }

    #[test]
    fn a_downloaded_image_is_reused_for_its_url_only() {
        let dir = cache_dir();
        let now = SystemTime::now();
        write_entry(
            &dir,
            "https://example.com/a.png",
            PNG,
            Lifetime::Download(now),
            MAX_TOTAL_BYTES,
        );
        assert_eq!(
            read_entry(
                &dir,
                "https://example.com/a.png",
                1024,
                Lifetime::Download(now)
            )
            .as_deref(),
            Some(PNG)
        );
        assert_eq!(
            read_entry(
                &dir,
                "https://example.com/b.png",
                1024,
                Lifetime::Download(now)
            ),
            None
        );
        // No temporary files are left behind.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn expired_and_oversized_copies_are_fetched_again() {
        let dir = cache_dir();
        let now = SystemTime::now();
        let url = "https://example.com/a.png";
        write_entry(&dir, url, PNG, Lifetime::Download(now), MAX_TOTAL_BYTES);
        assert_eq!(read_entry(&dir, url, 4, Lifetime::Download(now)), None);
        assert!(!entry_path(&dir, url).exists());

        write_entry(&dir, url, PNG, Lifetime::Download(now), MAX_TOTAL_BYTES);
        set_age(&dir, url, now, MAX_AGE - Duration::from_secs(60));
        assert!(read_entry(&dir, url, 1024, Lifetime::Download(now)).is_some());
        set_age(&dir, url, now, MAX_AGE + Duration::from_secs(60));
        assert_eq!(read_entry(&dir, url, 1024, Lifetime::Download(now)), None);
        assert!(!entry_path(&dir, url).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_oldest_copies_go_first_when_the_folder_is_full() {
        let dir = cache_dir();
        let now = SystemTime::now();
        let urls = ["https://example.com/1", "https://example.com/2"];
        for (index, url) in urls.iter().enumerate() {
            write_entry(&dir, url, PNG, Lifetime::Download(now), MAX_TOTAL_BYTES);
            set_age(
                &dir,
                url,
                now,
                Duration::from_secs(60 * (10 - index as u64)),
            );
        }
        // Room for two copies: adding a third removes the oldest.
        write_entry(
            &dir,
            "https://example.com/3",
            PNG,
            Lifetime::Download(now),
            2 * PNG.len() as u64,
        );
        assert!(!entry_path(&dir, urls[0]).exists());
        assert!(entry_path(&dir, urls[1]).exists());
        assert!(entry_path(&dir, "https://example.com/3").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prepared_image_eviction_respects_reads_and_the_separate_download_budget() {
        let root = cache_dir();
        let now = SystemTime::now();
        let prepared = root.join(PDF_PREPARED_DIR);
        write_entry(
            &root,
            "original",
            PNG,
            Lifetime::Download(now),
            MAX_TOTAL_BYTES,
        );
        for key in ["a", "b"] {
            remember_prepared_pdf(&root, key, PNG);
            set_age(&prepared, key, now, MAX_AGE + Duration::from_secs(60));
        }
        assert_eq!(read_prepared_pdf(&root, "a").as_deref(), Some(PNG));
        let active = prepared.join("writing.tmp");
        let abandoned = prepared.join("abandoned.tmp");
        fs::write(&active, PNG).unwrap();
        fs::write(&abandoned, PNG).unwrap();
        fs::File::options()
            .write(true)
            .open(&abandoned)
            .unwrap()
            .set_modified(now - MAX_AGE - Duration::from_secs(60))
            .unwrap();

        prune(&prepared, Lifetime::ContentAddressed, PNG.len() as u64 + 32);
        assert!(read_prepared_pdf(&root, "a").is_some());
        assert!(read_prepared_pdf(&root, "b").is_none());
        assert!(entry_path(&root, "original").exists());
        assert!(active.exists());
        assert!(!abandoned.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_image_bytes_are_kept() {
        assert!(is_image_bytes(PNG));
        assert!(is_image_bytes(b"\xff\xd8\xff\xe0"));
        assert!(is_image_bytes(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(is_image_bytes(
            b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"
        ));
        assert!(!is_image_bytes(
            b"<!DOCTYPE html><html><body>Sign in</body></html>"
        ));
        assert!(!is_image_bytes(b"<!doctype html><html><svg></svg></html>"));
        assert!(!is_image_bytes(b"Not found"));
    }
}
