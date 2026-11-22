use super::{event, Paths, DSN};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

const MAX_EVENT: u64 = 1024 * 1024;
const MAX_PENDING: usize = 5;
const MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

fn events(dir: &Path, extension: &str) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|e| e.to_str()) == Some(extension)
                && p.file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| Uuid::parse_str(s).is_ok())
        })
        .collect()
}

fn read(path: &Path) -> Option<Vec<u8>> {
    let mut data = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_EVENT + 1)
        .read_to_end(&mut data)
        .ok()?;
    (data.len() as u64 <= MAX_EVENT).then_some(data)
}

fn send(event: &Value) -> bool {
    let Ok(mut endpoint) = url::Url::parse(DSN.trim()) else {
        return false;
    };
    let Some((prefix, project)) = endpoint.path().rsplit_once('/') else {
        return false;
    };
    let path = format!("{prefix}/api/{project}/envelope/");
    endpoint.set_path(&path);
    let _ = endpoint.set_username("");
    let _ = endpoint.set_password(None);
    let header = json!({"dsn": DSN.trim(), "event_id": event["event_id"]});
    let body = format!("{header}\n{{\"type\":\"event\"}}\n{event}\n");
    let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return false;
    };
    client
        .post(endpoint)
        .header("Content-Type", "application/x-sentry-envelope")
        .body(body)
        .send()
        .is_ok_and(|res| res.status().is_success())
}

// Called in the external reporter after a crash and off the UI thread on startup/save.
// The app and helper can race on relaunch. Lock across claim/send so they share one
// queue. A retry after an interrupted HTTP response preserves Sentry's event ID.
fn delivery_lock(paths: &Paths) -> Option<fs::File> {
    let lock = fs::File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .read(true)
        .open(paths.database.join("delivery.lock"))
        .ok()?;
    lock.lock().ok()?;
    Some(lock)
}

fn remove_pending(external: &Path, pending: &Path) {
    for path in events(external, "envelope")
        .into_iter()
        .chain(events(pending, "json"))
    {
        let _ = fs::remove_file(path);
    }
    let _ = fs::remove_file(pending.join("incoming.tmp"));
}

pub(super) fn discard(paths: &Paths) {
    if let Some(_lock) = delivery_lock(paths) {
        remove_pending(
            &paths.database.join("external"),
            &paths.database.join("pending"),
        );
    }
}

pub(super) fn process(paths: &Paths) {
    let Some(_lock) = delivery_lock(paths) else {
        return;
    };
    let external = paths.database.join("external");
    let pending = paths.database.join("pending");
    if paths.stopped() {
        remove_pending(&external, &pending);
        return;
    }
    if fs::create_dir_all(&pending).is_err() {
        return;
    }
    for file in events(&external, "envelope") {
        // A relaunch can overlap the daemon writing this file. Leave incomplete
        // envelopes for the external reporter, which starts after the write finishes.
        if let Some(event) = read(&file).and_then(|b| event::read_sdk_envelope(&b)) {
            let dest = pending.join(format!(
                "{}.json",
                event["event_id"].as_str().unwrap_or_default()
            ));
            let temp = pending.join("incoming.tmp");
            if fs::write(&temp, event.to_string())
                .and_then(|()| fs::rename(&temp, dest))
                .is_err()
            {
                continue;
            }
            let _ = fs::remove_file(file);
        }
    }
    let mut files = events(&pending, "json");
    let modified = |p: &Path| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    };
    files.sort_by_cached_key(|p| std::cmp::Reverse(modified(p)));
    for (index, file) in files.into_iter().enumerate() {
        let settings = paths.settings(); // Recheck immediately before every send.
        if index >= MAX_PENDING
            || modified(&file).elapsed().is_ok_and(|age| age > MAX_AGE)
            || settings.enabled == Some(false)
        {
            let _ = fs::remove_file(file);
            continue;
        }
        if !settings.disclosed {
            continue;
        }
        let Some(mut event) = read(&file)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .and_then(|v| event::scrub(&v))
        else {
            let _ = fs::remove_file(file);
            continue;
        };
        if let Some(id) = settings.install_id.and_then(|id| Uuid::parse_str(&id).ok()) {
            event["tags"] = json!({"install_id":id});
        }
        if send(&event) {
            let _ = fs::remove_file(file);
        }
    }
}
