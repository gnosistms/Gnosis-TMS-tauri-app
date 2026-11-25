use crate::util::atomic_replace;
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use url::Url;

pub(super) type Shortlinks = HashMap<String, Vec<Url>>;

const CACHE_FILE: &str = "pdf-shortlinks-v2.json";
static CACHE_LOCK: Mutex<()> = Mutex::new(());
static UPGRADE_ATTEMPTS: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const UPGRADE_INTERVAL: Duration = Duration::from_secs(3600);

pub(super) fn resolve(
    app_data: &Path,
    urls: Vec<String>,
    upgrade: impl Fn(&str, &[Url]) -> bool,
    discover: impl FnOnce(Vec<String>) -> Shortlinks,
) -> (Shortlinks, io::Result<()>) {
    resolve_cached(app_data, CACHE_FILE, urls, upgrade, discover)
}

pub(super) fn compact_sections(
    app_data: &Path,
    urls: Vec<String>,
    discover: impl FnOnce(Vec<String>) -> Shortlinks,
) -> (Shortlinks, io::Result<()>) {
    resolve_cached(
        app_data,
        "pdf-compact-sections-v1.json",
        urls,
        |_, _| false,
        discover,
    )
}

fn resolve_cached(
    app_data: &Path,
    file: &str,
    mut urls: Vec<String>,
    upgrade: impl Fn(&str, &[Url]) -> bool,
    discover: impl FnOnce(Vec<String>) -> Shortlinks,
) -> (Shortlinks, io::Result<()>) {
    let mut unique = HashSet::new();
    urls.retain(|url| unique.insert(url.clone()));
    if urls.is_empty() {
        return (Shortlinks::new(), Ok(()));
    }
    let path = app_data.join(file);
    let (mut resolved, mut missing) = (Shortlinks::new(), Vec::new());
    let loaded = {
        let _guard = CACHE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        load_or_migrate(app_data, &path).map(|mut cached| {
            for url in urls.iter().cloned() {
                if let Some(links) = cached.remove(&url) {
                    if upgrade(&url, &links) && should_try_upgrade(&url) {
                        missing.push(url.clone());
                    }
                    resolved.insert(url, links);
                } else {
                    missing.push(url);
                }
            }
        })
    };
    if loaded.is_err() {
        missing = urls;
    }
    if missing.is_empty() {
        return (resolved, loaded);
    }
    let discovered = discover(missing);
    let saved = if discovered.is_empty() {
        loaded
    } else {
        let _guard = CACHE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        load_or_migrate(app_data, &path).and_then(|mut cached| {
            if merge(&mut cached, &discovered) {
                write_cache(&path, &cached)?;
            }
            Ok(())
        })
    };
    merge(&mut resolved, &discovered);
    (resolved, saved)
}

fn should_try_upgrade(url: &str) -> bool {
    let now = Instant::now();
    let mut attempts = UPGRADE_ATTEMPTS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    attempts.retain(|_, started| now.duration_since(*started) < UPGRADE_INTERVAL);
    if attempts.contains_key(url) {
        return false;
    }
    attempts.insert(url.into(), now);
    true
}

fn load_or_migrate(app_data: &Path, path: &Path) -> io::Result<Shortlinks> {
    match read_cache(path) {
        Ok(entries) => return Ok(entries),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    if path.file_name().is_none_or(|name| name != CACHE_FILE) {
        return Ok(Shortlinks::new());
    }
    let mut entries = Shortlinks::new();
    let mut imported = Vec::new();
    for installation in child_directories(&app_data.join("installations")).filter(|path| {
        path.file_name()
            .is_some_and(|name| name.to_string_lossy().starts_with("installation-"))
    }) {
        for project in child_directories(&installation.join("pdf-shortlinks-v1")) {
            for entry in fs::read_dir(project).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "json")
                    && entry.file_type().is_ok_and(|kind| kind.is_file())
                {
                    if let Ok(saved) = read_cache(&path) {
                        merge(&mut entries, &saved);
                        imported.push(path);
                    }
                }
            }
        }
    }
    if !imported.is_empty() {
        write_cache(path, &entries)?;
        for old_path in imported {
            let _ = fs::remove_file(old_path);
        }
    }
    Ok(entries)
}

fn child_directories(path: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_type().ok()?.is_dir().then(|| entry.path()))
}

fn read_cache(path: &Path) -> io::Result<Shortlinks> {
    let saved: HashMap<String, Vec<String>> = serde_json::from_slice(&fs::read(path)?)?;
    Ok(saved
        .into_iter()
        .filter_map(|(original, links)| {
            let links: Vec<_> = links
                .into_iter()
                .filter_map(|link| Url::parse(&link).ok())
                .filter(|link| {
                    matches!(link.scheme(), "https" | "http")
                        && link.host().is_some()
                        && link.username().is_empty()
                        && link.password().is_none()
                })
                .collect();
            (!links.is_empty()).then_some((original, links))
        })
        .collect())
}

fn merge(cache: &mut Shortlinks, discovered: &Shortlinks) -> bool {
    let mut changed = false;
    for (url, candidates) in discovered {
        let links = cache.entry(url.clone()).or_default();
        for link in candidates {
            if !links.contains(link) {
                links.push(link.clone());
                changed = true;
            }
        }
    }
    changed
}

fn write_cache(path: &Path, entries: &Shortlinks) -> io::Result<()> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }
    let serialized: HashMap<_, Vec<_>> = entries
        .iter()
        .map(|(url, links)| (url, links.iter().map(Url::as_str).collect()))
        .collect();
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::now_v7()));
    let result = fs::write(&temporary, serde_json::to_vec(&serialized)?)
        .and_then(|()| atomic_replace(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINAL: &str = "https://example.org/articles/long-title";
    const SECTION: &str = "https://example.org/articles/long-title#section";

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("gnosis-shortlinks-{}", uuid::Uuid::now_v7())))
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn candidate(original: &str, shortlink: &str) -> Shortlinks {
        Shortlinks::from([(original.into(), vec![Url::parse(shortlink).unwrap()])])
    }

    #[test]
    fn reuses_verified_exact_urls_and_retries_failed_lookups() {
        let directory = TestDirectory::new();
        let verified = candidate(ORIGINAL, "https://wp.me/example");
        resolve(
            &directory.0,
            vec![ORIGINAL.into(), SECTION.into(), ORIGINAL.into()],
            |_, _| false,
            |urls| {
                assert_eq!(urls, [ORIGINAL, SECTION]);
                verified.clone()
            },
        )
        .1
        .unwrap();

        let (links, saved) = resolve(
            &directory.0,
            vec![ORIGINAL.into()],
            |_, _| false,
            |_| panic!("Cache hit should skip discovery"),
        );
        saved.unwrap();
        assert_eq!(links, verified);
        let (links, saved) = resolve(
            &directory.0,
            vec![SECTION.into()],
            |_, _| false,
            |urls| {
                assert_eq!(urls, [SECTION]);
                Shortlinks::new()
            },
        );
        saved.unwrap();
        assert!(links.is_empty());
    }

    #[test]
    fn merges_legacy_files_across_installations_before_removing_their_copies() {
        let directory = TestDirectory::new();
        let base = directory.0.join("installations");
        let first = base.join("installation-1/pdf-shortlinks-v1/project/chapter.json");
        let second = base.join("installation-2/pdf-shortlinks-v1/project/chapter.json");
        let verified = candidate(ORIGINAL, "https://wp.me/example");
        write_cache(&first, &verified).unwrap();
        let mut other = verified.clone();
        other.extend(candidate(SECTION, "https://wp.me/section"));
        write_cache(&second, &other).unwrap();
        let (links, saved) = resolve(
            &directory.0,
            vec![ORIGINAL.into(), SECTION.into()],
            |_, _| false,
            |_| panic!("Both URLs should be imported"),
        );
        saved.unwrap();
        assert_eq!(links, other);
        assert_eq!(read_cache(&directory.0.join(CACHE_FILE)).unwrap(), other);
        assert!(!first.exists());
        assert!(!second.exists());
    }

    #[test]
    fn overlapping_exports_merge_their_discoveries() {
        let directory = TestDirectory::new();
        resolve(
            &directory.0,
            vec![ORIGINAL.into()],
            |_, _| false,
            |_| {
                resolve(
                    &directory.0,
                    vec![SECTION.into()],
                    |_, _| false,
                    |_| candidate(SECTION, "https://wp.me/section"),
                )
                .1
                .unwrap();
                candidate(ORIGINAL, "https://wp.me/example")
            },
        )
        .1
        .unwrap();
        assert_eq!(read_cache(&directory.0.join(CACHE_FILE)).unwrap().len(), 2);
    }

    #[test]
    fn keeps_cached_fallbacks_when_an_upgrade_fails() {
        let directory = TestDirectory::new();
        let original = "https://vi.wikipedia.org/wiki/Test#Cached_upgrade";
        let cached = candidate(
            original,
            "https://vi.wikipedia.org/?curid=42#Cached_upgrade",
        );
        write_cache(&directory.0.join(CACHE_FILE), &cached).unwrap();
        let (found, saved) = resolve(
            &directory.0,
            vec![original.into()],
            |_, _| true,
            |urls| {
                assert_eq!(urls, [original]);
                Shortlinks::new()
            },
        );
        saved.unwrap();
        assert_eq!(found, cached);
        assert_eq!(read_cache(&directory.0.join(CACHE_FILE)).unwrap(), cached);
        let (found, _) = resolve(
            &directory.0,
            vec![original.into()],
            |_, _| true,
            |_| {
                panic!("An immediate retry should use the cached fallback");
            },
        );
        assert_eq!(found, cached);
    }
}
