mod event;
mod queue;
#[cfg(feature = "windows-crash-smoke")]
#[path = "../../../.github/tests/windows-crash-probe.rs"]
mod smoke;

use libloading::os::windows::Library;
use serde::Deserialize;
use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const DSN: &str = match option_env!("VITE_SENTRY_DSN") {
    Some(value) => value,
    None => include_str!("../../sentry-dsn.txt"),
};

#[derive(Clone)]
struct Paths {
    database: PathBuf,
    settings: PathBuf,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Settings {
    #[serde(rename = "telemetry-disclosure-shown")]
    disclosed: bool,
    #[serde(rename = "telemetry-enabled")]
    enabled: Option<bool>,
    #[serde(rename = "telemetry-install-id")]
    install_id: Option<String>,
}

impl Paths {
    fn settings(&self) -> Settings {
        fs::read(&self.settings)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn stopped(&self) -> bool {
        self.settings().enabled == Some(false)
    }
}

struct Capture {
    _library: Library,
    stop: unsafe extern "C" fn(),
}

impl Capture {
    fn start(paths: &Paths) -> Option<Self> {
        let app = std::env::current_exe().ok()?;
        let resources = app.parent()?.join("crash-reporter");
        let wide = |p: &Path| p.as_os_str().encode_wide().chain([0]).collect::<Vec<_>>();
        let database = wide(&paths.database);
        let daemon = wide(&resources.join("sentry-crash.exe"));
        let reporter = wide(&app);
        // Only load the installed library and system dependencies. Keeping the handle
        // alive until after sentry_close also covers the SDK's Win32 exception filter.
        unsafe {
            const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x800;
            let library = Library::load_with_flags(
                resources.join("gnosis-crash-capture.dll"),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
            .ok()?;
            type Start = unsafe extern "C" fn(*const u16, *const u16, *const u16, *const i8) -> i32;
            let start = library.get::<Start>(b"gnosis_capture_start\0").ok()?;
            let stop = *library
                .get::<unsafe extern "C" fn()>(b"gnosis_capture_stop\0")
                .ok()?;
            let release = concat!("gnosis-tms@", env!("CARGO_PKG_VERSION"), "\0");
            if start(
                database.as_ptr(),
                daemon.as_ptr(),
                reporter.as_ptr(),
                release.as_ptr().cast(),
            ) != 0
            {
                return None;
            }
            Some(Self {
                _library: library,
                stop,
            })
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe { (self.stop)() }
    }
}

pub(crate) struct Reporter {
    paths: Option<Paths>,
    capture: Mutex<Option<Capture>>,
}

impl Reporter {
    pub(crate) fn start(identifier: &str) -> Option<Self> {
        let paths = dirs::data_dir()
            .zip(dirs::data_local_dir())
            .map(|(data, local)| Paths {
                settings: data.join(identifier).join("app-state.json"),
                database: local.join(identifier).join("native-crashes"),
            });
        // The SDK passes one envelope path to its external reporter. Only ever process
        // files from our own database, even when this executable is launched by hand.
        if std::env::args_os()
            .nth(1)
            .as_deref()
            .map(Path::new)
            .is_some_and(|p| p.extension() == Some(OsStr::new("envelope")))
        {
            if let Some(p) = &paths {
                queue::process(p);
            }
            return None;
        }
        let reporter = Self {
            paths,
            capture: Mutex::default(),
        };
        if let Some(p) = &reporter.paths {
            if p.stopped() {
                let paths = p.clone();
                std::thread::spawn(move || queue::process(&paths));
            } else {
                reporter.apply_choice(true);
            }
        }
        #[cfg(feature = "windows-crash-smoke")]
        smoke::when_requested();
        Some(reporter)
    }

    pub(crate) fn apply_choice(&self, enabled: bool) {
        let Some(paths) = self.paths.as_ref().filter(|_| !DSN.trim().is_empty()) else {
            return;
        };
        {
            let mut capture = self.capture.lock().unwrap_or_else(|e| e.into_inner());
            if enabled && capture.is_none() {
                *capture = Capture::start(paths);
            } else if !enabled {
                capture.take();
            }
        }
        if enabled {
            let paths = paths.clone();
            std::thread::spawn(move || queue::process(&paths));
        } else {
            queue::discard(paths);
        }
    }
}
