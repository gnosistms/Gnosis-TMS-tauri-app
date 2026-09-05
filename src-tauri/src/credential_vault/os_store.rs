//! Silent platform storage. No credential operation may display an OS prompt.
use super::CredentialStore;
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::Zeroizing;

const SERVICE: &str = "com.gnosis.tms.credentials";
const UNAVAILABLE: &str = "Saved credentials could not be accessed silently. Gnosis TMS will not ask for your computer password. Retry or use session-only storage.";

pub(super) struct OsCredentialStore {
    account: String,
}

impl OsCredentialStore {
    pub(super) fn new(path: &Path) -> Self {
        Self {
            account: format!(
                "vault-v3-{:x}",
                Sha256::digest(path.to_string_lossy().as_bytes())
            ),
        }
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn entry(&self) -> Result<keyring::Entry, String> {
        #[cfg(target_os = "macos")]
        disable_keychain_prompts()?;
        keyring::Entry::new(SERVICE, &self.account).map_err(|_| UNAVAILABLE.into())
    }

    #[cfg(all(
        test,
        any(target_os = "macos", target_os = "windows", target_os = "linux")
    ))]
    pub(super) fn delete_for_test(&self) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.entry()?
                .delete_credential()
                .map_err(|_| UNAVAILABLE.into())
        }
        #[cfg(target_os = "linux")]
        {
            let service = linux::connect()?;
            if let Some(item) = linux::find_item(&service, &self.account)? {
                item.delete().map_err(|_| UNAVAILABLE)?;
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn disable_keychain_prompts() -> Result<(), String> {
    use security_framework::os::macos::keychain::{KeychainUserInteractionLock, SecKeychain};
    use std::sync::OnceLock;

    // This is a process-wide Security.framework setting. A scoped guard would
    // re-enable dialogs on drop and race with another credential operation.
    // Static values are retained until process exit, including on error/retry.
    static NO_PROMPTS: OnceLock<Result<KeychainUserInteractionLock, String>> = OnceLock::new();
    NO_PROMPTS
        .get_or_init(|| SecKeychain::disable_user_interaction().map_err(|_| UNAVAILABLE.into()))
        .as_ref()
        .map(|_| ())
        .map_err(Clone::clone)
}

impl CredentialStore for OsCredentialStore {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            match self.entry()?.get_secret() {
                Ok(key) => Ok(Some(Zeroizing::new(key))),
                Err(keyring::Error::NoEntry) => Ok(None),
                // Never format platform errors: some variants carry secret bytes.
                Err(_) => Err(UNAVAILABLE.into()),
            }
        }
        #[cfg(target_os = "linux")]
        {
            let service = linux::connect()?;
            linux::find_item(&service, &self.account)?
                .map(|item| {
                    item.get_secret()
                        .map(Zeroizing::new)
                        .map_err(|_| UNAVAILABLE.into())
                })
                .transpose()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Err(UNAVAILABLE.into())
        }
    }

    fn write(&self, key: &[u8]) -> Result<(), String> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.entry()?
                .set_secret(key)
                .map_err(|_| UNAVAILABLE.into())
        }
        #[cfg(target_os = "linux")]
        {
            let service = linux::connect()?;
            if let Some(item) = linux::find_item(&service, &self.account)? {
                return item
                    .set_secret(key, "text/plain")
                    .map_err(|_| UNAVAILABLE.into());
            }
            let collection = service.get_default_collection().map_err(|_| UNAVAILABLE)?;
            if collection.is_locked().map_err(|_| UNAVAILABLE)? {
                return Err(UNAVAILABLE.into());
            }
            let mut attributes = linux::attributes(&self.account);
            attributes.insert("application", "rust-keyring");
            // The zero prompt timeout also handles a lock/permission change
            // after the check above: CreateItem cannot display a dialog.
            collection
                .create_item(
                    "Gnosis TMS credential vault",
                    attributes,
                    key,
                    true,
                    "text/plain",
                )
                .map_err(|_| UNAVAILABLE)?;
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = key;
            Err(UNAVAILABLE.into())
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{only_unlocked_match, SERVICE, UNAVAILABLE};
    use dbus_secret_service::{EncryptionType, Item, SecretService};
    use std::collections::HashMap;

    pub(super) fn connect() -> Result<SecretService, String> {
        // Zero means never call org.freedesktop.Secret.Prompt.Prompt, not show
        // a prompt and then dismiss it. This applies to every service operation.
        SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 0)
            .map_err(|_| UNAVAILABLE.into())
    }

    pub(super) fn attributes(account: &str) -> HashMap<&str, &str> {
        // Preserve the exact attributes used by keyring 3.x for existing keys.
        HashMap::from([
            ("service", SERVICE),
            ("username", account),
            ("target", "default"),
        ])
    }

    pub(super) fn find_item<'a>(
        service: &'a SecretService,
        account: &str,
    ) -> Result<Option<Item<'a>>, String> {
        let matches = service
            .search_items(attributes(account))
            .map_err(|_| UNAVAILABLE)?;
        only_unlocked_match(matches.unlocked, matches.locked.len())
    }
}

#[cfg(any(target_os = "linux", test))]
fn only_unlocked_match<T>(mut unlocked: Vec<T>, locked_count: usize) -> Result<Option<T>, String> {
    if locked_count != 0 || unlocked.len() > 1 {
        // Locked is not missing: never generate a replacement for that key.
        return Err(UNAVAILABLE.into());
    }
    Ok(unlocked.pop())
}

#[cfg(test)]
mod selection_tests {
    use super::*;

    #[test]
    fn locked_or_ambiguous_items_cannot_be_mistaken_for_a_missing_key() {
        assert_eq!(only_unlocked_match::<u8>(vec![], 0).unwrap(), None);
        assert_eq!(only_unlocked_match(vec![1], 0).unwrap(), Some(1));
        assert!(only_unlocked_match::<u8>(vec![], 1).is_err());
        assert!(only_unlocked_match(vec![1], 1).is_err());
        assert!(only_unlocked_match(vec![1, 2], 0).is_err());
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use security_framework::os::macos::keychain::SecKeychain;

    #[test]
    fn keychain_prompt_suppression_survives_parallel_entries_and_errors() {
        let workers = (0..8)
            .map(|_| {
                std::thread::spawn(|| {
                    let path = std::env::temp_dir()
                        .join(format!("gnosis-silent-{}", uuid::Uuid::now_v7()));
                    let store = OsCredentialStore::new(&path);
                    store.entry().unwrap();
                    assert!(!SecKeychain::user_interaction_allowed().unwrap());
                    // A nonexistent credential or denied read must leave UI disabled.
                    let _ = store.read();
                    assert!(!SecKeychain::user_interaction_allowed().unwrap());
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(!SecKeychain::user_interaction_allowed().unwrap());
    }
}
