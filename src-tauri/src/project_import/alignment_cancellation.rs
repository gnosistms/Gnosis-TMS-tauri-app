//! Cooperative cancellation for one frontend alignment/apply attempt.
//! Blocking HTTP can finish, but canceled responses cannot start more work or apply.
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

const CANCELED: &str = "ALIGNMENT_CANCELED: Alignment canceled.";
type Token = Arc<AtomicU8>; // 0 = working, 1 = canceled, 2 = applying (cannot cancel).
struct Entry {
    token: Token,
    running: bool,
    created: Instant,
}
static REQUESTS: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
thread_local! { static CURRENT: RefCell<Option<Token>> = const { RefCell::new(None) }; }

fn valid_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("The alignment request ID is invalid.".into());
    }
    Ok(id)
}

fn prune(entries: &mut HashMap<String, Entry>) {
    entries.retain(|_, entry| entry.running || entry.created.elapsed() < Duration::from_secs(300));
}

pub(super) struct Registration {
    id: Option<String>,
    token: Token,
}
impl Registration {
    pub(super) fn new(id: Option<String>) -> Result<Self, String> {
        let token = Arc::new(AtomicU8::new(0));
        let Some(id) = id.filter(|id| !id.is_empty()) else {
            return Ok(Self { id: None, token });
        };
        valid_id(&id)?;
        let mut entries = REQUESTS
            .lock()
            .map_err(|_| "Could not register alignment cancellation.")?;
        prune(&mut entries);
        if let Some(entry) = entries.get_mut(&id) {
            if entry.running {
                return Err("The alignment request is already running.".into());
            }
            entry.running = true;
            return Ok(Self {
                id: Some(id),
                token: entry.token.clone(),
            });
        }
        entries.insert(
            id.clone(),
            Entry {
                token: token.clone(),
                running: true,
                created: Instant::now(),
            },
        );
        Ok(Self {
            id: Some(id),
            token,
        })
    }

    pub(super) fn run<T>(self, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        with_token(Some(self.token.clone()), || {
            check()?;
            let result = work();
            check()?;
            result
        })
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            if let Ok(mut entries) = REQUESTS.lock() {
                entries.remove(id);
            }
        }
    }
}

pub(super) fn cancel(id: &str) -> Result<bool, String> {
    let id = valid_id(id)?;
    let mut entries = REQUESTS.lock().map_err(|_| "Could not cancel alignment.")?;
    prune(&mut entries);
    if let Some(entry) = entries.get(id) {
        return Ok(entry
            .token
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
            || entry.token.load(Ordering::SeqCst) == 1);
    }
    // Cancellation can beat IPC registration. Keep a short-lived tombstone.
    if entries.values().filter(|entry| !entry.running).count() >= 128 {
        return Err("Too many pending alignment cancellations. Try again shortly.".into());
    }
    entries.insert(
        id.into(),
        Entry {
            token: Arc::new(AtomicU8::new(1)),
            running: false,
            created: Instant::now(),
        },
    );
    Ok(true)
}

pub(super) fn current() -> Option<Token> {
    CURRENT.with(|current| current.borrow().clone())
}
pub(super) fn current_id() -> Option<String> {
    let token = current()?;
    REQUESTS
        .lock()
        .ok()?
        .iter()
        .find_map(|(id, entry)| Arc::ptr_eq(&entry.token, &token).then(|| id.clone()))
}
pub(super) fn with_token<T>(token: Option<Token>, work: impl FnOnce() -> T) -> T {
    struct Restore(Option<Token>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CURRENT.with(|current| *current.borrow_mut() = self.0.take());
        }
    }
    let previous = CURRENT.with(|current| current.replace(token));
    let _restore = Restore(previous);
    work()
}
pub(super) fn check() -> Result<(), String> {
    if current().is_some_and(|token| token.load(Ordering::SeqCst) == 1) {
        return Err(CANCELED.into());
    }
    Ok(())
}
pub(super) fn begin_apply() -> Result<(), String> {
    if let Some(token) = current() {
        token
            .compare_exchange(0, 2, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| CANCELED.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request_id() -> String {
        uuid::Uuid::now_v7().to_string()
    }
    #[test]
    fn cancel_before_registration_prevents_work() {
        let id = request_id();
        assert!(cancel(&id).unwrap());
        let result = Registration::new(Some(id))
            .unwrap()
            .run(|| panic!("must not start"));
        assert!(matches!(result, Err::<(), _>(error) if error == CANCELED));
    }
    #[test]
    fn cancellation_of_in_flight_work_rejects_its_late_result() {
        let id = request_id();
        let request = Registration::new(Some(id.clone())).unwrap();
        let result = request.run(|| {
            assert!(cancel(&id).unwrap());
            Ok(42)
        });
        assert_eq!(result.unwrap_err(), CANCELED);
    }
    #[test]
    fn applying_and_canceling_are_mutually_exclusive() {
        let id = request_id();
        let request = Registration::new(Some(id.clone())).unwrap();
        request
            .run(|| {
                begin_apply()?;
                assert!(!cancel(&id)?);
                Ok(())
            })
            .unwrap();
        let id = request_id();
        let request = Registration::new(Some(id.clone())).unwrap();
        request
            .run(|| {
                cancel(&id)?;
                assert!(begin_apply().is_err());
                Ok(())
            })
            .unwrap_err();
    }
    #[test]
    fn sibling_worker_inherits_token_and_does_not_affect_other_jobs() {
        let a = request_id();
        let b = request_id();
        let first = Registration::new(Some(a.clone())).unwrap();
        let second = Registration::new(Some(b)).unwrap();
        first
            .run(|| {
                let token = current();
                cancel(&a)?;
                std::thread::scope(|s| s.spawn(|| with_token(token, check)).join().unwrap())
                    .unwrap_err();
                Ok(())
            })
            .unwrap_err();
        second.run(check).unwrap();
        check().unwrap();
    }
    #[test]
    fn completed_requests_release_registry_entries_and_duplicate_ids_are_rejected() {
        let id = request_id();
        let request = Registration::new(Some(id.clone())).unwrap();
        assert!(Registration::new(Some(id.clone())).is_err());
        request.run(|| Ok(())).unwrap();
        assert!(!REQUESTS.lock().unwrap().contains_key(&id));
    }
}
