//! Provider-independent credential persistence. OS key material never enters IPC.
use fs2::FileExt;
use iota_stronghold::{engine::snapshot::try_set_encrypt_work_factor, ClientError};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;
use zeroize::Zeroizing;

use crate::local_author::{self, LocalAuthor};

const CLIENT: &[u8] = b"ai-provider-secrets";
pub(crate) const SESSION_KEY: &str = "broker/session";
type Records = BTreeMap<Vec<u8>, Zeroizing<Vec<u8>>>;

#[derive(Clone)]
struct Paths {
    snapshot: PathBuf,
    legacy: Option<PathBuf>,
    session: Option<PathBuf>,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorageStatus {
    pub(crate) mode: &'static str,
    pub(crate) message: String,
}

trait CredentialStore {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String>;
    fn write(&self, key: &[u8]) -> Result<(), String>;
}
mod os_store;
use os_store::OsCredentialStore;

struct Vault {
    paths: Paths,
    records: Records,
    author: Option<LocalAuthor>,
    key: Option<Zeroizing<Vec<u8>>>,
    _lock: Option<File>,
}
fn lock_file(path: &Path) -> Result<File, String> {
    let parent = path
        .parent()
        .ok_or("Could not resolve credential storage folder.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not create credential storage folder.")?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.with_extension("lock"))
        .map_err(|_| "Could not open credential storage lock.")?;
    file.try_lock_exclusive().map_err(|_| {
        "Credential storage is in use by another Gnosis TMS process. Close that process and retry."
    })?;
    Ok(file)
}
fn read_snapshot(path: &Path, password: &[u8]) -> Result<Records, String> {
    try_set_encrypt_work_factor(0).map_err(|_| "Could not initialize credential encryption.")?;
    let hold = Stronghold::new(path, password.to_vec()).map_err(|_| "The credential vault could not be decrypted. Its key may be missing or the file may be damaged.")?;
    let client = match hold.load_client(CLIENT) {
        Ok(client) => client,
        Err(ClientError::ClientDataNotPresent) => return Ok(Records::new()),
        Err(_) => return Err("Could not read the credential vault.".into()),
    };
    let store = client.store();
    let mut records = Records::new();
    for key in store
        .keys()
        .map_err(|_| "Could not list saved credentials.")?
    {
        if let Some(value) = store
            .get(&key)
            .map_err(|_| "Could not read saved credentials.")?
        {
            records.insert(key, Zeroizing::new(value));
        }
    }
    Ok(records)
}
fn legacy_password(path: &Path) -> Zeroizing<Vec<u8>> {
    let mut hash = Sha256::new();
    hash.update(b"gnosis-tms-ai-provider-secrets");
    hash.update(path.to_string_lossy().as_bytes());
    Zeroizing::new(hash.finalize().to_vec())
}
fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Secure migration cleanup is incomplete. Gnosis TMS could not remove an old credential file. Check folder permissions and retry.".into()),
    }
}
fn author_from_records(records: &Records) -> Result<Option<LocalAuthor>, String> {
    records
        .get(SESSION_KEY.as_bytes())
        .map(|raw| LocalAuthor::from_session(raw))
        .transpose()
}
fn cached_author(paths: &Paths) -> Option<LocalAuthor> {
    if paths.snapshot.exists() || paths.snapshot.with_extension("pending").exists() {
        return local_author::read(&paths.snapshot);
    }
    // Before the first migration, the existing plaintext login is the only
    // public attribution source. Never consult it once a v3 snapshot exists.
    let raw = Zeroizing::new(fs::read(paths.session.as_ref()?).ok()?);
    LocalAuthor::from_session(&raw).ok()
}
impl Vault {
    fn open(paths: Paths, store: &dyn CredentialStore) -> Result<Self, String> {
        let lock = lock_file(&paths.snapshot)?;
        let pending = paths.snapshot.with_extension("pending");
        let key = match store.read()? {
            Some(key) if key.len() == 32 => key,
            Some(_) => return Err("The OS credential vault key is invalid. Restore it or use session-only storage; the existing vault has been preserved.".into()),
            None if paths.snapshot.exists() || pending.exists() => return Err("The OS credential vault key is missing. Restore it or use session-only storage; the existing vault has been preserved.".into()),
            None => {
                let mut key = Zeroizing::new(vec![0; 32]);
                OsRng.try_fill_bytes(&mut key).map_err(|_| "Could not generate a secure vault key.")?;
                store.write(&key)?;
                if store.read()?.as_deref() != Some(&*key) { return Err("Could not verify the OS credential vault key.".into()); }
                key
            }
        };
        // A complete pending write is recoverable if publication was interrupted.
        if !paths.snapshot.exists() && pending.exists() {
            if read_snapshot(&pending, &key).is_ok() {
                fs::rename(&pending, &paths.snapshot)
                    .map_err(|_| "Could not finish credential vault migration.")?;
            } else {
                // Do not mistake a wrong OS key or damaged pending snapshot for
                // an empty vault. Preserve it for recovery, just like the final file.
                return Err("The pending credential vault could not be decrypted. Restore its OS key or use session-only storage; existing files were preserved.".into());
            }
        }
        let exists = paths.snapshot.exists();
        let records = if exists {
            read_snapshot(&paths.snapshot, &key)?
        } else {
            let mut records = match paths.legacy.as_ref().filter(|p| p.exists()) {
                Some(path) => read_snapshot(path, &legacy_password(path))?,
                None => Records::new(),
            };
            if let Some(path) = paths.session.as_ref().filter(|p| p.exists()) {
                let raw = Zeroizing::new(
                    fs::read(path)
                        .map_err(|_| "Could not read the old broker login for migration.")?,
                );
                let session: crate::broker_auth::BrokerSession = serde_json::from_slice(&raw)
                    .map_err(|_| {
                        "The old broker login could not be migrated. Its file has been preserved."
                    })?;
                if session.session_token.is_empty() || session.login.is_empty() {
                    return Err(
                        "The old broker login is incomplete. Its file has been preserved.".into(),
                    );
                }
                records.insert(SESSION_KEY.as_bytes().to_vec(), raw);
            }
            records
        };
        let author = author_from_records(&records)?;
        let vault = Self {
            paths,
            records,
            author,
            key: Some(key),
            _lock: Some(lock),
        };
        if !exists {
            vault.persist(&vault.records)?;
        } else {
            // Seed older v3 installations and repair interrupted cache writes.
            local_author::write(
                &vault.paths.snapshot,
                &vault.paths.snapshot,
                vault.author.clone(),
            )?;
        }
        vault.cleanup()?;
        Ok(vault)
    }
    fn session_only(paths: Paths) -> Self {
        // Only public attribution is read; no OS unlock or persistent write.
        // This also works on read-only filesystems.
        let author = cached_author(&paths);
        Self {
            paths,
            records: Records::new(),
            author,
            key: None,
            _lock: None,
        }
    }
    fn cleanup(&self) -> Result<(), String> {
        if self.key.is_none() {
            return Ok(());
        }
        for path in [&self.paths.legacy, &self.paths.session]
            .into_iter()
            .flatten()
        {
            remove_if_exists(path)?;
            if self.paths.session.as_ref() == Some(path) {
                remove_if_exists(&path.with_extension("json.tmp"))?;
            }
        }
        remove_if_exists(&self.paths.snapshot.with_extension("pending"))
    }
    fn persist(&self, records: &Records) -> Result<(), String> {
        let Some(key) = &self.key else {
            return Ok(());
        };
        let pending = self.paths.snapshot.with_extension("pending");
        remove_if_exists(&pending)?;
        try_set_encrypt_work_factor(0)
            .map_err(|_| "Could not initialize credential encryption.")?;
        let hold = Stronghold::new(&pending, key.to_vec())
            .map_err(|_| "Could not prepare encrypted credential storage.")?;
        let client = hold
            .create_client(CLIENT)
            .map_err(|_| "Could not prepare encrypted credential storage.")?;
        for (name, value) in records {
            client
                .store()
                .insert(name.clone(), value.to_vec(), None)
                .map_err(|_| "Could not encrypt saved credentials.")?;
        }
        hold.save().map_err(|_| {
            "Could not write encrypted credentials. The previous vault is unchanged."
        })?;
        // Windows FlushFileBuffers requires GENERIC_WRITE. Do not truncate the
        // snapshot while reopening it for the durability flush.
        OpenOptions::new()
            .write(true)
            .open(&pending)
            .and_then(|f| f.sync_all())
            .map_err(|_| "Could not finish writing encrypted credentials.")?;
        if read_snapshot(&pending, key)? != *records {
            return Err(
                "Credential migration verification failed; previous credentials were preserved."
                    .into(),
            );
        }
        local_author::write(
            &pending,
            &self.paths.snapshot,
            author_from_records(records)?,
        )?;
        // Never remove the destination to make rename succeed. On failure the
        // prior snapshot remains authoritative, including on Windows.
        fs::rename(&pending, &self.paths.snapshot).map_err(|_| {
            "Could not replace the encrypted vault. The previous vault is unchanged; retry saving."
        })?;
        #[cfg(unix)]
        if let Some(parent) = self.paths.snapshot.parent() {
            let _ = File::open(parent).and_then(|f| f.sync_all());
        }
        Ok(())
    }
    fn update(&mut self, changes: &[(String, Option<String>)]) -> Result<(), String> {
        self.cleanup()?;
        let mut next = self.records.clone();
        for (key, value) in changes {
            match value {
                Some(value) => {
                    next.insert(
                        key.as_bytes().to_vec(),
                        Zeroizing::new(value.as_bytes().to_vec()),
                    );
                }
                None => {
                    next.remove(key.as_bytes());
                }
            }
        }
        let author = if changes.iter().any(|(key, _)| key == SESSION_KEY) {
            author_from_records(&next)?
        } else {
            self.author.clone()
        };
        self.persist(&next)?;
        self.records = next;
        self.author = author;
        Ok(())
    }
    fn status(&self) -> StorageStatus {
        if self.key.is_some() {
            StorageStatus {
                mode: "persistent",
                message: String::new(),
            }
        } else {
            StorageStatus { mode: "session_only", message: "Keys and login are stored only for this app session. Sign in and enter personal keys again after closing Gnosis TMS. Existing vault files are preserved; any legacy migration remains incomplete.".into() }
        }
    }
}
#[derive(Default)]
struct Vaults {
    paths: BTreeMap<PathBuf, Paths>,
    open: BTreeMap<PathBuf, Vault>,
    failures: BTreeMap<PathBuf, String>,
}
impl Vaults {
    fn use_session_only(&mut self, path: &Path) -> Result<StorageStatus, String> {
        if let Some(vault) = self.open.get_mut(path) {
            // Keep the last successfully saved records usable in this run.
            // Dropping the encryption key disables every persistent mutation;
            // release the file lock without touching the existing snapshot.
            vault.key = None;
            vault._lock = None;
        } else {
            let paths = self
                .paths
                .get(path)
                .cloned()
                .ok_or("Credential storage has not been initialized.")?;
            self.open
                .insert(path.to_path_buf(), Vault::session_only(paths));
        }
        self.failures.remove(path);
        self.open
            .get(path)
            .map(Vault::status)
            .ok_or_else(|| "Credential storage is unavailable.".into())
    }
    fn open(&mut self, path: &Path, store: &dyn CredentialStore) -> Result<&mut Vault, String> {
        if !self.open.contains_key(path) {
            if let Some(error) = self.failures.get(path) {
                return Err(error.clone());
            }
            let paths = self
                .paths
                .get(path)
                .cloned()
                .ok_or("Credential storage has not been initialized.")?;
            match Vault::open(paths, store) {
                Ok(vault) => {
                    self.open.insert(path.to_path_buf(), vault);
                }
                Err(error) => {
                    self.failures.insert(path.to_path_buf(), error.clone());
                    return Err(error);
                }
            }
        }
        self.open
            .get_mut(path)
            .ok_or_else(|| "Credential storage is unavailable.".into())
    }
}
fn vaults() -> &'static Mutex<Vaults> {
    static VAULTS: OnceLock<Mutex<Vaults>> = OnceLock::new();
    VAULTS.get_or_init(|| Mutex::new(Vaults::default()))
}

pub(crate) fn app_path(app: &AppHandle) -> Result<PathBuf, String> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not resolve credential storage.")?;
    // Development builds never migrate or unlock the production credential vault.
    let development = cfg!(debug_assertions);
    let snapshot = local.join(if development {
        "credentials-development-v3.hold"
    } else {
        "credentials-v3.hold"
    });
    let paths = Paths {
        snapshot: snapshot.clone(),
        legacy: (!development).then(|| local.join("ai-provider-secrets-v2.hold")),
        session: if development {
            None
        } else {
            Some(
                app.path()
                    .app_data_dir()
                    .map_err(|_| "Could not resolve saved broker login.")?
                    .join("broker-auth-session.json"),
            )
        },
    };
    vaults()
        .lock()
        .map_err(|_| "Credential storage is unavailable.")?
        .paths
        .insert(snapshot.clone(), paths);
    Ok(snapshot)
}
fn with_vault<T>(
    path: &Path,
    operation: impl FnOnce(&mut Vault) -> Result<T, String>,
) -> Result<T, String> {
    let mut vaults = vaults()
        .lock()
        .map_err(|_| "Credential storage is unavailable.")?;
    operation(vaults.open(path, &OsCredentialStore::new(path))?)
}
pub(crate) fn read(path: &Path, key: &str) -> Result<Option<String>, String> {
    with_vault(path, |vault| {
        vault
            .records
            .get(key.as_bytes())
            .map(|value| {
                String::from_utf8(value.to_vec())
                    .map_err(|_| "A saved credential could not be decoded.".into())
            })
            .transpose()
    })
}
pub(crate) fn read_local_author(path: &Path) -> Result<Option<LocalAuthor>, String> {
    let vaults = vaults()
        .lock()
        .map_err(|_| "Credential storage is unavailable.")?;
    // Attribution never opens the vault or contacts the OS credential store.
    // An open session (including an explicit sign-out) is authoritative.
    if let Some(vault) = vaults.open.get(path) {
        return Ok(vault.author.clone());
    }
    Ok(vaults.paths.get(path).and_then(cached_author))
}
pub(crate) fn update(path: &Path, changes: &[(String, Option<String>)]) -> Result<(), String> {
    with_vault(path, |vault| vault.update(changes))
}
pub(crate) fn clear_team(path: &Path, installation: i64) -> Result<(), String> {
    let prefix = format!("team-ai/{installation}/");
    with_vault(path, |vault| {
        let changes = vault
            .records
            .keys()
            .filter(|key| key.starts_with(prefix.as_bytes()))
            .map(|key| (String::from_utf8_lossy(key).into_owned(), None))
            .collect::<Vec<_>>();
        vault.update(&changes)
    })
}
pub(crate) fn replace_session(
    path: &Path,
    session: Option<&str>,
    clear_teams: bool,
) -> Result<(), String> {
    with_vault(path, |vault| {
        let mut changes = vault
            .records
            .keys()
            .filter(|key| clear_teams && key.starts_with(b"team-ai/"))
            .map(|key| (String::from_utf8_lossy(key).into_owned(), None))
            .collect::<Vec<_>>();
        changes.push((SESSION_KEY.into(), session.map(str::to_owned)));
        let result = vault.update(&changes);
        for (_, value) in &mut changes {
            if let Some(value) = value {
                zeroize::Zeroize::zeroize(value);
            }
        }
        result
    })
}
pub(crate) fn status(path: &Path) -> StorageStatus {
    with_vault(path, |vault| Ok(vault.status())).unwrap_or_else(|message| StorageStatus {
        mode: "locked",
        message,
    })
}
#[tauri::command]
pub(crate) async fn load_credential_storage_status(
    app: AppHandle,
    retry: Option<bool>,
) -> Result<StorageStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app_path(&app)?;
        if retry == Some(true) {
            vaults()
                .lock()
                .map_err(|_| "Credential storage is unavailable.")?
                .failures
                .remove(&path);
        }
        Ok(status(&path))
    })
    .await
    .map_err(|_| "Could not check credential storage.")?
}

#[tauri::command]
pub(crate) async fn use_session_only_credential_storage(
    app: AppHandle,
) -> Result<StorageStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app_path(&app)?;
        vaults()
            .lock()
            .map_err(|_| "Credential storage is unavailable.")?
            .use_session_only(&path)
    })
    .await
    .map_err(|_| "Could not open session-only storage.")?
}

#[cfg(test)]
pub(crate) fn test_locked_session(path: &Path, session: &crate::broker_auth::BrokerSession) {
    let paths = Paths {
        snapshot: path.into(),
        legacy: None,
        session: None,
    };
    let raw = Zeroizing::new(serde_json::to_vec(session).unwrap());
    let records = [(SESSION_KEY.as_bytes().to_vec(), raw)]
        .into_iter()
        .collect();
    let vault = Vault {
        paths: paths.clone(),
        author: author_from_records(&records).unwrap(),
        records,
        key: Some(Zeroizing::new(vec![7; 32])),
        _lock: Some(lock_file(path).unwrap()),
    };
    vault.persist(&vault.records).unwrap();
    drop(vault);
    let mut vaults = vaults().lock().unwrap();
    vaults.open.remove(path);
    vaults.paths.insert(path.into(), paths);
    vaults
        .failures
        .insert(path.into(), "Storage locked for test".into());
}

#[cfg(test)]
pub(crate) fn test_select_session_only(path: &Path) {
    assert_eq!(
        vaults()
            .lock()
            .unwrap()
            .use_session_only(path)
            .unwrap()
            .mode,
        "session_only"
    );
}

#[cfg(test)]
pub(crate) fn test_path(path: &Path) {
    let mut vaults = vaults().lock().unwrap();
    vaults.open.remove(path);
    let paths = Paths {
        snapshot: path.to_path_buf(),
        legacy: None,
        session: None,
    };
    let vault = Vault::session_only(paths.clone());
    vaults.paths.insert(path.to_path_buf(), paths);
    vaults.open.insert(path.to_path_buf(), vault);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct MockStore {
        key: RefCell<Option<Vec<u8>>>,
        denied: Cell<bool>,
        reads: Cell<usize>,
    }
    impl CredentialStore for MockStore {
        fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
            self.reads.set(self.reads.get() + 1);
            if self.denied.get() {
                return Err("Storage locked for test".into());
            }
            Ok(self.key.borrow().clone().map(Zeroizing::new))
        }
        fn write(&self, key: &[u8]) -> Result<(), String> {
            if self.denied.get() {
                return Err("Storage denied for test".into());
            }
            *self.key.borrow_mut() = Some(key.to_vec());
            Ok(())
        }
    }
    struct Fixture {
        root: PathBuf,
        paths: Paths,
        store: MockStore,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("gnosis-vault-test-{}", uuid::Uuid::now_v7()));
            fs::create_dir_all(&root).unwrap();
            Self {
                paths: Paths {
                    snapshot: root.join("v3.hold"),
                    legacy: Some(root.join("v2.hold")),
                    session: Some(root.join("broker-auth-session.json")),
                },
                root,
                store: MockStore::default(),
            }
        }
        fn open(&self) -> Result<Vault, String> {
            Vault::open(self.paths.clone(), &self.store)
        }
        fn legacy(&self) -> Records {
            let path = self.paths.legacy.as_ref().unwrap();
            let records = [
                ("ai-provider/openai/api-key", "personal-synthetic"),
                ("team-ai/42/openai/api-key", "team-synthetic"),
                ("team-ai/42/openai/key-version", "9"),
                ("team-ai/81/gemini/api-key", "second-team-synthetic"),
                ("team-ai/42/member-private-key-pem", "private-synthetic"),
                ("wordpress-connections/user", "wordpress-synthetic"),
            ]
            .into_iter()
            .map(|(k, v)| (k.as_bytes().to_vec(), Zeroizing::new(v.as_bytes().to_vec())))
            .collect::<Records>();
            let vault = Vault {
                paths: Paths {
                    snapshot: path.clone(),
                    legacy: None,
                    session: None,
                },
                records: records.clone(),
                author: None,
                key: Some(legacy_password(path)),
                _lock: Some(lock_file(path).unwrap()),
            };
            vault.persist(&records).unwrap();
            records
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn random_key_persists_and_warm_reads_need_no_os_calls() {
        let fixture = Fixture::new();
        let mut vault = fixture.open().unwrap();
        vault
            .update(&[(
                "ai-provider/openai/api-key".into(),
                Some("synthetic-secret".into()),
            )])
            .unwrap();
        assert_eq!(fixture.store.reads.get(), 2);
        assert_eq!(
            vault.records[b"ai-provider/openai/api-key".as_slice()].as_slice(),
            b"synthetic-secret"
        );
        assert_eq!(fixture.store.reads.get(), 2);
        assert!(!fs::read(&fixture.paths.snapshot)
            .unwrap()
            .windows(16)
            .any(|b| b == b"synthetic-secret"));
        assert!(read_snapshot(
            &fixture.paths.snapshot,
            &legacy_password(&fixture.paths.snapshot)
        )
        .is_err());
        drop(vault);
        let restored = fixture.open().unwrap();
        assert_eq!(
            restored.records[b"ai-provider/openai/api-key".as_slice()].as_slice(),
            b"synthetic-secret"
        );
    }
    #[test]
    fn migration_preserves_every_record_and_broker_login_then_removes_old_files() {
        let fixture = Fixture::new();
        let records = fixture.legacy();
        let login =
            br#"{"sessionToken":"synthetic-token","login":"tester","name":null,"avatarUrl":null}"#;
        fs::write(fixture.paths.session.as_ref().unwrap(), login).unwrap();
        fs::write(
            fixture
                .paths
                .session
                .as_ref()
                .unwrap()
                .with_extension("json.tmp"),
            login,
        )
        .unwrap();
        let vault = fixture.open().unwrap();
        for (key, value) in records {
            assert_eq!(vault.records[&key], value);
        }
        assert_eq!(vault.records[SESSION_KEY.as_bytes()].as_slice(), login);
        assert!(!fixture.paths.legacy.as_ref().unwrap().exists());
        assert!(!fixture.paths.session.as_ref().unwrap().exists());
        assert!(!fixture
            .paths
            .session
            .as_ref()
            .unwrap()
            .with_extension("json.tmp")
            .exists());
    }
    #[test]
    fn missing_or_denied_os_key_never_replaces_an_existing_vault() {
        let fixture = Fixture::new();
        drop(fixture.open().unwrap());
        let bytes = fs::read(&fixture.paths.snapshot).unwrap();
        fixture.store.denied.set(true);
        assert!(fixture.open().is_err());
        fixture.store.denied.set(false);
        *fixture.store.key.borrow_mut() = None;
        assert!(fixture.open().err().unwrap().contains("missing"));
        assert_eq!(bytes, fs::read(&fixture.paths.snapshot).unwrap());
        assert!(fixture.store.key.borrow().is_none());
    }
    #[test]
    fn corrupt_legacy_or_login_is_preserved() {
        let fixture = Fixture::new();
        fs::write(fixture.paths.legacy.as_ref().unwrap(), b"damaged").unwrap();
        assert!(fixture.open().is_err());
        assert!(!fixture.paths.snapshot.exists());
        assert_eq!(
            fs::read(fixture.paths.legacy.as_ref().unwrap()).unwrap(),
            b"damaged"
        );
        fs::remove_file(fixture.paths.legacy.as_ref().unwrap()).unwrap();
        fs::write(fixture.paths.session.as_ref().unwrap(), b"invalid json").unwrap();
        assert!(fixture.open().is_err());
        assert!(!fixture.paths.snapshot.exists());
    }
    #[test]
    fn interrupted_publication_recovers_verified_pending_snapshot() {
        let fixture = Fixture::new();
        fixture.legacy();
        let vault = fixture.open().unwrap();
        let expected = vault.records.clone();
        drop(vault);
        fs::rename(
            &fixture.paths.snapshot,
            fixture.paths.snapshot.with_extension("pending"),
        )
        .unwrap();
        assert_eq!(fixture.open().unwrap().records, expected);
        assert!(fixture.paths.snapshot.exists());
    }
    #[test]
    fn successful_migration_never_reimports_stale_legacy_data() {
        let fixture = Fixture::new();
        fixture.legacy();
        let mut vault = fixture.open().unwrap();
        vault
            .update(&[("team-ai/42/openai/api-key".into(), None)])
            .unwrap();
        drop(vault);
        fixture.legacy();
        let reopened = fixture.open().unwrap();
        assert!(!reopened
            .records
            .contains_key(b"team-ai/42/openai/api-key".as_slice()));
        assert!(!fixture.paths.legacy.as_ref().unwrap().exists());
    }
    #[test]
    fn session_only_never_reads_or_modifies_existing_files() {
        let fixture = Fixture::new();
        fixture.legacy();
        let old = fs::read(fixture.paths.legacy.as_ref().unwrap()).unwrap();
        let mut vault = Vault::session_only(fixture.paths.clone());
        vault
            .update(&[("local".into(), Some("session-secret".into()))])
            .unwrap();
        assert_eq!(vault.status().mode, "session_only");
        assert!(!fixture.paths.snapshot.exists());
        assert_eq!(
            old,
            fs::read(fixture.paths.legacy.as_ref().unwrap()).unwrap()
        );
        drop(vault);
        assert!(Vault::session_only(fixture.paths.clone())
            .records
            .is_empty());
    }
    #[test]
    fn cleanup_failure_is_reported_and_new_snapshot_remains_authoritative() {
        let fixture = Fixture::new();
        drop(fixture.open().unwrap());
        fs::create_dir(fixture.paths.legacy.as_ref().unwrap()).unwrap();
        assert!(fixture
            .open()
            .err()
            .unwrap()
            .contains("cleanup is incomplete"));
        assert!(fixture.paths.snapshot.exists());
        fs::remove_dir(fixture.paths.legacy.as_ref().unwrap()).unwrap();
        assert!(fixture.open().is_ok());
    }
    #[test]
    fn failed_save_preserves_memory_and_last_committed_snapshot() {
        let fixture = Fixture::new();
        let mut vault = fixture.open().unwrap();
        vault
            .update(&[("key".into(), Some("before".into()))])
            .unwrap();
        fs::create_dir(fixture.paths.snapshot.with_extension("pending")).unwrap();
        assert!(vault
            .update(&[("key".into(), Some("after".into()))])
            .is_err());
        assert_eq!(vault.records[b"key".as_slice()].as_slice(), b"before");
        assert_eq!(
            read_snapshot(&fixture.paths.snapshot, vault.key.as_ref().unwrap()).unwrap()
                [b"key".as_slice()]
            .as_slice(),
            b"before"
        );
    }
    #[test]
    fn session_only_recovers_an_open_vault_after_write_failure_without_changing_disk() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        let mut manager = Vaults::default();
        manager.paths.insert(path.clone(), fixture.paths.clone());
        manager
            .open(path, &fixture.store)
            .unwrap()
            .update(&[("key".into(), Some("before".into()))])
            .unwrap();
        let snapshot = fs::read(path).unwrap();
        let public_cache = fs::read(path.with_extension("author.json")).unwrap();
        // A directory at the pending-file location deterministically simulates
        // failed writes on every platform (including elevated test processes).
        let pending = path.with_extension("pending");
        fs::create_dir(&pending).unwrap();
        assert!(manager
            .open(path, &fixture.store)
            .unwrap()
            .update(&[("key".into(), Some("failed".into()))])
            .is_err());
        assert_eq!(manager.use_session_only(path).unwrap().mode, "session_only");
        let vault = manager.open(path, &fixture.store).unwrap();
        assert!(vault.key.is_none());
        assert!(vault._lock.is_none());
        assert_eq!(vault.records[b"key".as_slice()].as_slice(), b"before");
        vault
            .update(&[("key".into(), Some("memory-only".into()))])
            .unwrap();
        assert_eq!(vault.records[b"key".as_slice()].as_slice(), b"memory-only");
        vault.update(&[("key".into(), None)]).unwrap();
        assert!(vault.records.is_empty());
        assert_eq!(manager.use_session_only(path).unwrap().mode, "session_only");
        assert_eq!(fs::read(path).unwrap(), snapshot);
        assert_eq!(
            fs::read(path.with_extension("author.json")).unwrap(),
            public_cache
        );
        assert!(pending.is_dir());
        drop(manager);
        fs::remove_dir(pending).unwrap();
        assert_eq!(
            fixture.open().unwrap().records[b"key".as_slice()].as_slice(),
            b"before"
        );
    }
    #[test]
    fn public_author_tracks_migration_account_changes_and_sign_out_without_tokens() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        let first =
            r#"{"sessionToken":"synthetic-private-token","login":"Alice","name":"Alice Example"}"#;
        fs::write(fixture.paths.session.as_ref().unwrap(), first).unwrap();
        assert_eq!(cached_author(&fixture.paths).unwrap().login, "alice");
        let mut vault = fixture.open().unwrap();
        assert_eq!(local_author::read(path).unwrap().login, "alice");
        let cache = fs::read_to_string(path.with_extension("author.json")).unwrap();
        assert!(!cache.contains("synthetic-private-token"));
        assert!(!cache.contains("sessionToken"));
        let second = r#"{"sessionToken":"second-private-token","login":"bob","name":null}"#;
        vault
            .update(&[(SESSION_KEY.into(), Some(second.into()))])
            .unwrap();
        assert_eq!(local_author::read(path).unwrap().login, "bob");
        assert_eq!(vault.author.as_ref().unwrap().login, "bob");
        vault.update(&[(SESSION_KEY.into(), None)]).unwrap();
        assert!(local_author::read(path).is_none());
        assert!(vault.author.is_none());
        drop(vault);
        assert!(fixture.open().unwrap().author.is_none());
    }
    #[test]
    fn public_author_cache_is_repaired_on_unlock_and_rejects_interrupted_changes() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        let mut vault = fixture.open().unwrap();
        let login = r#"{"sessionToken":"synthetic","login":"alice","name":null}"#;
        vault
            .update(&[(SESSION_KEY.into(), Some(login.into()))])
            .unwrap();
        let alice_cache = fs::read(path.with_extension("author.json")).unwrap();
        drop(vault);
        fs::remove_file(path.with_extension("author.json")).unwrap();
        // Existing v3 installations seed the new public cache on unlock.
        let mut vault = fixture.open().unwrap();
        assert_eq!(local_author::read(path).unwrap().login, "alice");
        vault.update(&[(SESSION_KEY.into(), None)]).unwrap();
        drop(vault);
        // A stale projection cannot resurrect the old user after sign-out.
        fs::write(path.with_extension("author.json"), alice_cache).unwrap();
        assert!(cached_author(&fixture.paths).is_none());
        assert!(fixture.open().unwrap().author.is_none());
        // Nor can a cache for a not-yet-published snapshot activate its author.
        let pending = path.with_extension("pending");
        fs::write(&pending, b"different-ciphertext").unwrap();
        local_author::write(
            &pending,
            path,
            Some(LocalAuthor::from_session(login.as_bytes()).unwrap()),
        )
        .unwrap();
        assert!(local_author::read(path).is_none());
    }
    #[test]
    fn author_cache_write_failure_cannot_commit_a_different_account() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        let mut vault = fixture.open().unwrap();
        let first = r#"{"sessionToken":"synthetic-first","login":"alice","name":null}"#;
        vault
            .update(&[(SESSION_KEY.into(), Some(first.into()))])
            .unwrap();
        let before = fs::read(path).unwrap();
        fs::create_dir(path.with_extension("author.pending")).unwrap();
        let second = r#"{"sessionToken":"synthetic-second","login":"bob","name":null}"#;
        assert!(vault
            .update(&[(SESSION_KEY.into(), Some(second.into()))])
            .is_err());
        assert_eq!(fs::read(path).unwrap(), before);
        assert_eq!(vault.author.as_ref().unwrap().login, "alice");
        assert_eq!(local_author::read(path).unwrap().login, "alice");
        drop(vault);
        fs::remove_dir(path.with_extension("author.pending")).unwrap();
        assert_eq!(fixture.open().unwrap().author.unwrap().login, "alice");
    }
    #[test]
    fn session_only_keeps_cached_author_until_sign_out_without_restoring_a_token() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        test_locked_session(
            path,
            &crate::broker_auth::BrokerSession {
                session_token: "synthetic-locked-token".into(),
                login: "alice".into(),
                name: None,
                avatar_url: None,
            },
        );
        let bytes = fs::read(path).unwrap();
        assert_eq!(read_local_author(path).unwrap().unwrap().login, "alice");
        assert_eq!(
            read(path, SESSION_KEY).unwrap_err(),
            "Storage locked for test"
        );
        test_select_session_only(path);
        assert_eq!(read_local_author(path).unwrap().unwrap().login, "alice");
        assert!(read(path, SESSION_KEY).unwrap().is_none());
        replace_session(path, None, true).unwrap();
        assert!(read_local_author(path).unwrap().is_none());
        assert_eq!(fs::read(path).unwrap(), bytes);
        // The explicit fallback still preserves the original persisted session.
        assert_eq!(local_author::read(path).unwrap().login, "alice");
    }
    #[test]
    fn another_process_or_vault_instance_cannot_overwrite_cached_records() {
        let fixture = Fixture::new();
        let _vault = fixture.open().unwrap();
        assert!(fixture
            .open()
            .err()
            .unwrap()
            .contains("another Gnosis TMS process"));
    }
    #[test]
    fn corrupt_new_vault_never_reimports_legacy_or_replaces_the_os_key() {
        let fixture = Fixture::new();
        drop(fixture.open().unwrap());
        fixture.legacy();
        let key = fixture.store.key.borrow().clone();
        fs::write(&fixture.paths.snapshot, b"corrupted-vault").unwrap();
        assert!(fixture.open().is_err());
        assert_eq!(
            fs::read(&fixture.paths.snapshot).unwrap(),
            b"corrupted-vault"
        );
        assert_eq!(*fixture.store.key.borrow(), key);
        assert!(fixture.paths.legacy.as_ref().unwrap().exists());
    }
    #[test]
    fn session_only_works_without_a_writable_storage_directory() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("not-a-directory"), b"file").unwrap();
        let paths = Paths {
            snapshot: fixture.root.join("not-a-directory/vault.hold"),
            legacy: None,
            session: None,
        };
        let mut vault = Vault::session_only(paths);
        vault
            .update(&[("key".into(), Some("synthetic".into()))])
            .unwrap();
        assert_eq!(vault.records[b"key".as_slice()].as_slice(), b"synthetic");
    }
    #[test]
    fn failed_unlock_is_cached_until_explicit_retry() {
        let fixture = Fixture::new();
        let path = &fixture.paths.snapshot;
        let mut manager = Vaults::default();
        manager.paths.insert(path.clone(), fixture.paths.clone());
        fixture.store.denied.set(true);
        assert!(manager.open(path, &fixture.store).is_err());
        assert!(manager.open(path, &fixture.store).is_err());
        assert_eq!(fixture.store.reads.get(), 1);
        fixture.store.denied.set(false);
        manager.failures.remove(path);
        assert!(manager.open(path, &fixture.store).is_ok());
        assert_eq!(fixture.store.reads.get(), 3);
    }
    #[test]
    #[ignore = "opt-in native OS credential-store smoke test; uses and removes a synthetic entry"]
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    fn native_os_store_persists_and_reopens_a_synthetic_vault() {
        let fixture = Fixture::new();
        let store = OsCredentialStore::new(&fixture.paths.snapshot);
        struct Cleanup(OsCredentialStore);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.delete_for_test();
            }
        }
        assert!(store.read().unwrap().is_none());
        let _cleanup = Cleanup(OsCredentialStore::new(&fixture.paths.snapshot));
        let mut vault = Vault::open(fixture.paths.clone(), &store).unwrap();
        vault
            .update(&[("test-key".into(), Some("synthetic-native-test".into()))])
            .unwrap();
        drop(vault);
        let restored = Vault::open(fixture.paths.clone(), &store).unwrap();
        assert_eq!(
            restored.records[b"test-key".as_slice()].as_slice(),
            b"synthetic-native-test"
        );
    }
    #[test]
    fn corrupt_pending_snapshot_is_preserved_for_recovery() {
        let fixture = Fixture::new();
        *fixture.store.key.borrow_mut() = Some(vec![7; 32]);
        let pending = fixture.paths.snapshot.with_extension("pending");
        fs::write(&pending, b"interrupted-or-corrupt").unwrap();
        assert!(fixture
            .open()
            .err()
            .unwrap()
            .contains("pending credential vault"));
        assert_eq!(fs::read(pending).unwrap(), b"interrupted-or-corrupt");
        assert!(!fixture.paths.snapshot.exists());
    }
    #[test]
    fn access_loss_clears_team_keys_and_keypair_but_preserves_other_namespaces() {
        let fixture = Fixture::new();
        test_path(&fixture.paths.snapshot);
        let path = &fixture.paths.snapshot;
        update(
            path,
            &[
                (
                    "team-ai/42/member-private-key-pem".into(),
                    Some("synthetic-private".into()),
                ),
                (
                    "team-ai/42/claude/api-key".into(),
                    Some("synthetic-key".into()),
                ),
                (
                    "team-ai/420/claude/api-key".into(),
                    Some("other-team".into()),
                ),
                ("ai-provider/claude/api-key".into(), Some("personal".into())),
            ],
        )
        .unwrap();
        clear_team(path, 42).unwrap();
        assert!(read(path, "team-ai/42/member-private-key-pem")
            .unwrap()
            .is_none());
        assert!(read(path, "team-ai/42/claude/api-key").unwrap().is_none());
        assert!(read(path, "team-ai/420/claude/api-key").unwrap().is_some());
        assert!(read(path, "ai-provider/claude/api-key").unwrap().is_some());
    }
}
