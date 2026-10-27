use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

const WORDPRESS_IMAGE_CACHE_FILE: &str = "wordpress-image-cache-v2.json";
const WORDPRESS_IMAGE_CACHE_VERSION: u8 = 2;
const MAX_WORDPRESS_IMAGE_CACHE_ENTRIES: usize = 10_000;

static WORDPRESS_IMAGE_CACHE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedWordPressImage {
    pub(crate) attachment_id: u64,
    pub(crate) source_url: String,
    pub(crate) natural_width: Option<u64>,
    pub(crate) natural_height: Option<u64>,
}

#[derive(Clone, Debug, Hash, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "identity", rename_all = "camelCase")]
pub(crate) enum WordPressImageCacheKey {
    Local(String),
    WordPressRemote(String),
}

impl WordPressImageCacheKey {
    pub(crate) fn local(content_hash: impl Into<String>) -> Self {
        Self::Local(content_hash.into())
    }

    pub(crate) fn wordpress_remote(identity: impl Into<String>) -> Self {
        Self::WordPressRemote(identity.into())
    }

    fn is_valid(&self) -> bool {
        match self {
            Self::Local(identity) | Self::WordPressRemote(identity) => !identity.trim().is_empty(),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WordPressImageCacheEntry {
    site_id: String,
    key: WordPressImageCacheKey,
    #[serde(flatten)]
    image: CachedWordPressImage,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WordPressImageCache {
    version: u8,
    entries: Vec<WordPressImageCacheEntry>,
}

impl Default for WordPressImageCache {
    fn default() -> Self {
        Self {
            version: WORDPRESS_IMAGE_CACHE_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Clone)]
struct CacheMutation {
    image: Option<CachedWordPressImage>,
    sequence: u64,
}

pub(crate) struct WordPressImageCacheSession {
    path: Option<PathBuf>,
    site_id: String,
    entries: HashMap<WordPressImageCacheKey, CachedWordPressImage>,
    mutations: HashMap<WordPressImageCacheKey, CacheMutation>,
    next_mutation_sequence: u64,
}

impl WordPressImageCacheSession {
    pub(crate) fn open(app: &AppHandle, site_id: &str) -> Result<Self, String> {
        Self::open_at_path(cache_path(app)?, site_id)
    }

    fn open_at_path(path: PathBuf, site_id: &str) -> Result<Self, String> {
        let cache = with_cache_file_lock(&path, || read_cache(&path))?;
        let entries = cache
            .entries
            .into_iter()
            .filter(|entry| entry.site_id == site_id)
            .map(|entry| (entry.key, entry.image))
            .collect();
        Ok(Self {
            path: Some(path),
            site_id: site_id.to_string(),
            entries,
            mutations: HashMap::new(),
            next_mutation_sequence: 0,
        })
    }

    pub(crate) fn unavailable(site_id: &str) -> Self {
        Self {
            path: None,
            site_id: site_id.to_string(),
            entries: HashMap::new(),
            mutations: HashMap::new(),
            next_mutation_sequence: 0,
        }
    }

    pub(crate) fn get(&self, key: &WordPressImageCacheKey) -> Option<&CachedWordPressImage> {
        self.entries.get(key)
    }

    pub(crate) fn upsert(&mut self, key: WordPressImageCacheKey, image: CachedWordPressImage) {
        self.entries.insert(key.clone(), image.clone());
        self.record_mutation(key, Some(image));
    }

    pub(crate) fn remove(&mut self, key: &WordPressImageCacheKey) {
        self.entries.remove(key);
        self.record_mutation(key.clone(), None);
    }

    fn record_mutation(
        &mut self,
        key: WordPressImageCacheKey,
        image: Option<CachedWordPressImage>,
    ) {
        let sequence = self.next_mutation_sequence;
        self.next_mutation_sequence = self.next_mutation_sequence.saturating_add(1);
        self.mutations
            .insert(key, CacheMutation { image, sequence });
    }

    pub(crate) fn commit(&mut self) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            self.mutations.clear();
            return Ok(());
        };
        if self.mutations.is_empty() {
            return Ok(());
        }
        let mutations = self.mutations.clone();
        with_cache_file_lock(path, || {
            let mut cache = read_cache(path)?;
            apply_mutations(&mut cache, &self.site_id, &mutations);
            write_cache(path, &cache)
        })?;
        self.mutations.clear();
        Ok(())
    }
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
    Ok(app_data_dir.join(WORDPRESS_IMAGE_CACHE_FILE))
}

fn process_cache_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    WORDPRESS_IMAGE_CACHE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Could not lock the WordPress image cache.".to_string())
}

fn lock_path(path: &Path) -> PathBuf {
    path.with_extension("json.lock")
}

fn with_cache_file_lock<T>(
    path: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _process_guard = process_cache_lock()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Could not resolve the WordPress image cache folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the WordPress image cache folder: {error}"))?;
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(lock_path(path))
        .map_err(|error| format!("Could not open the WordPress image cache lock: {error}"))?;
    lock_file
        .lock()
        .map_err(|error| format!("Could not lock the WordPress image cache file: {error}"))?;
    operation()
}

fn read_cache(path: &Path) -> Result<WordPressImageCache, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WordPressImageCache::default());
        }
        Err(error) => {
            return Err(format!("Could not read the WordPress image cache: {error}"));
        }
    };
    let Ok(mut cache) = serde_json::from_str::<WordPressImageCache>(&raw) else {
        return Ok(WordPressImageCache::default());
    };
    if cache.version != WORDPRESS_IMAGE_CACHE_VERSION {
        return Ok(WordPressImageCache::default());
    }
    cache.entries.retain(|entry| {
        !entry.site_id.trim().is_empty()
            && entry.key.is_valid()
            && !entry.image.source_url.trim().is_empty()
            && entry.image.attachment_id > 0
    });
    Ok(cache)
}

fn write_cache(path: &Path, cache: &WordPressImageCache) -> Result<(), String> {
    if cache.entries.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Could not remove the WordPress image cache: {error}"
            )),
        };
    }
    let contents = serde_json::to_string(cache)
        .map_err(|error| format!("Could not encode the WordPress image cache: {error}"))?;
    let temporary_path = path.with_extension(format!("json.{}.tmp", Uuid::now_v7()));
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Could not write the WordPress image cache: {error}"))?;
    let result = crate::util::atomic_replace(&temporary_path, path)
        .map_err(|error| format!("Could not save the WordPress image cache: {error}"));
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn apply_mutations(
    cache: &mut WordPressImageCache,
    site_id: &str,
    mutations: &HashMap<WordPressImageCacheKey, CacheMutation>,
) {
    cache
        .entries
        .retain(|entry| entry.site_id != site_id || !mutations.contains_key(&entry.key));

    let mut upserts = mutations
        .iter()
        .filter_map(|(key, mutation)| {
            mutation
                .image
                .as_ref()
                .map(|image| (mutation.sequence, key, image))
        })
        .collect::<Vec<_>>();
    upserts.sort_unstable_by_key(|(sequence, _, _)| *sequence);
    for (_, key, image) in upserts {
        cache.entries.push(WordPressImageCacheEntry {
            site_id: site_id.to_string(),
            key: key.clone(),
            image: image.clone(),
        });
    }
    if cache.entries.len() > MAX_WORDPRESS_IMAGE_CACHE_ENTRIES {
        let remove_count = cache.entries.len() - MAX_WORDPRESS_IMAGE_CACHE_ENTRIES;
        cache.entries.drain(..remove_count);
    }
}

fn remove_cached_site_at_path(path: &Path, site_id: &str) -> Result<(), String> {
    with_cache_file_lock(path, || {
        let mut cache = read_cache(path)?;
        cache.entries.retain(|entry| entry.site_id != site_id);
        write_cache(path, &cache)
    })
}

pub(crate) fn remove_cached_site(app: &AppHandle, site_id: &str) -> Result<(), String> {
    remove_cached_site_at_path(&cache_path(app)?, site_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cache_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "gnosis-wordpress-image-cache-{label}-{}.json",
            Uuid::now_v7()
        ))
    }

    fn image(id: u64, url: &str) -> CachedWordPressImage {
        CachedWordPressImage {
            attachment_id: id,
            source_url: url.to_string(),
            natural_width: Some(1200),
            natural_height: Some(800),
        }
    }

    fn local(identity: &str) -> WordPressImageCacheKey {
        WordPressImageCacheKey::local(identity)
    }

    fn remote(identity: &str) -> WordPressImageCacheKey {
        WordPressImageCacheKey::wordpress_remote(identity)
    }

    fn open(path: &Path, site_id: &str) -> WordPressImageCacheSession {
        WordPressImageCacheSession::open_at_path(path.to_path_buf(), site_id).unwrap()
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(lock_path(path));
    }

    #[test]
    fn cached_images_are_scoped_by_site_and_typed_identity() {
        let path = test_cache_path("scope");
        let mut site_a = open(&path, "site-a");
        site_a.upsert(local("shared"), image(1, "https://a/1.jpg"));
        site_a.upsert(remote("shared"), image(2, "https://a/2.jpg"));
        site_a.commit().unwrap();
        let mut site_b = open(&path, "site-b");
        site_b.upsert(remote("shared"), image(3, "https://b/3.jpg"));
        site_b.commit().unwrap();

        let site_a = open(&path, "site-a");
        let site_b = open(&path, "site-b");
        assert_eq!(
            site_a.get(&local("shared")),
            Some(&image(1, "https://a/1.jpg"))
        );
        assert_eq!(
            site_a.get(&remote("shared")),
            Some(&image(2, "https://a/2.jpg"))
        );
        assert_eq!(
            site_b.get(&remote("shared")),
            Some(&image(3, "https://b/3.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn one_session_batches_many_mutations_into_one_commit() {
        let path = test_cache_path("session");
        let mut session = open(&path, "site-a");
        session.upsert(remote("one"), image(1, "https://a/1.jpg"));
        session.upsert(remote("two"), image(2, "https://a/2.jpg"));
        assert!(!path.exists());
        session.commit().unwrap();

        assert_eq!(open(&path, "site-a").entries.len(), 2);
        cleanup(&path);
    }

    #[test]
    fn repeated_mutations_for_one_key_are_coalesced_to_the_final_value() {
        let path = test_cache_path("coalesced");
        let mut session = open(&path, "site-a");
        let key = remote("one");
        session.upsert(key.clone(), image(1, "https://a/1.jpg"));
        session.remove(&key);
        session.upsert(key.clone(), image(9, "https://a/9.jpg"));

        assert_eq!(session.mutations.len(), 1);
        session.commit().unwrap();
        assert_eq!(
            open(&path, "site-a").get(&key),
            Some(&image(9, "https://a/9.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn stale_sessions_merge_their_deltas_at_commit() {
        let path = test_cache_path("merge");
        let mut first = open(&path, "site-a");
        let mut second = open(&path, "site-a");
        first.upsert(remote("one"), image(1, "https://a/1.jpg"));
        second.upsert(remote("two"), image(2, "https://a/2.jpg"));
        first.commit().unwrap();
        second.commit().unwrap();

        let reopened = open(&path, "site-a");
        assert_eq!(
            reopened.get(&remote("one")),
            Some(&image(1, "https://a/1.jpg"))
        );
        assert_eq!(
            reopened.get(&remote("two")),
            Some(&image(2, "https://a/2.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn updating_the_same_key_replaces_metadata_and_moves_it_to_the_end() {
        let path = test_cache_path("replace");
        let mut session = open(&path, "site-a");
        session.upsert(remote("one"), image(1, "https://a/1.jpg"));
        session.upsert(remote("two"), image(2, "https://a/2.jpg"));
        session.commit().unwrap();

        let mut session = open(&path, "site-a");
        session.upsert(remote("one"), image(9, "https://a/9.jpg"));
        session.commit().unwrap();
        let cache = read_cache(&path).unwrap();
        assert_eq!(cache.entries.len(), 2);
        assert_eq!(
            cache.entries.last().map(|entry| &entry.key),
            Some(&remote("one"))
        );
        assert_eq!(
            open(&path, "site-a").get(&remote("one")),
            Some(&image(9, "https://a/9.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn corrupt_cache_is_a_miss_and_is_repaired_by_commit() {
        let path = test_cache_path("corrupt");
        fs::write(&path, "{not json").unwrap();
        let mut session = open(&path, "site-a");
        assert_eq!(session.get(&local("hash-a")), None);
        session.upsert(local("hash-a"), image(1, "https://a/1.jpg"));
        session.commit().unwrap();
        assert_eq!(
            open(&path, "site-a").get(&local("hash-a")),
            Some(&image(1, "https://a/1.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn removing_a_site_preserves_other_sites() {
        let path = test_cache_path("remove-site");
        let mut site_a = open(&path, "site-a");
        site_a.upsert(local("a"), image(1, "https://a/1.jpg"));
        site_a.commit().unwrap();
        let mut site_b = open(&path, "site-b");
        site_b.upsert(remote("b"), image(2, "https://b/2.jpg"));
        site_b.commit().unwrap();

        remove_cached_site_at_path(&path, "site-a").unwrap();
        assert_eq!(open(&path, "site-a").get(&local("a")), None);
        assert_eq!(
            open(&path, "site-b").get(&remote("b")),
            Some(&image(2, "https://b/2.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn removing_one_image_preserves_other_entries_for_the_site() {
        let path = test_cache_path("remove-image");
        let mut session = open(&path, "site-a");
        session.upsert(remote("a"), image(1, "https://a/1.jpg"));
        session.upsert(remote("b"), image(2, "https://a/2.jpg"));
        session.commit().unwrap();

        let mut session = open(&path, "site-a");
        session.remove(&remote("a"));
        session.commit().unwrap();
        let reopened = open(&path, "site-a");
        assert_eq!(reopened.get(&remote("a")), None);
        assert_eq!(
            reopened.get(&remote("b")),
            Some(&image(2, "https://a/2.jpg"))
        );
        cleanup(&path);
    }

    #[test]
    fn cache_cap_evicts_the_oldest_entries() {
        let path = test_cache_path("cap");
        let mut session = open(&path, "site-a");
        for index in 0..=MAX_WORDPRESS_IMAGE_CACHE_ENTRIES {
            session.upsert(
                local(&format!("hash-{index}")),
                image(index as u64 + 1, &format!("https://a/{index}.jpg")),
            );
        }
        session.commit().unwrap();

        let cache = read_cache(&path).unwrap();
        assert_eq!(cache.entries.len(), MAX_WORDPRESS_IMAGE_CACHE_ENTRIES);
        assert_eq!(open(&path, "site-a").get(&local("hash-0")), None);
        assert!(open(&path, "site-a")
            .get(&local(&format!("hash-{MAX_WORDPRESS_IMAGE_CACHE_ENTRIES}")))
            .is_some());
        cleanup(&path);
    }
}
