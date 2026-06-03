use std::fs;
use std::io;
use std::path::Path;

use rand::distributions::Alphanumeric;
use rand::Rng;

/// Generate a cryptographically random alphanumeric token of the given length.
pub(crate) fn random_token(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

/// Atomically replace the file at `dest` with the file at `tmp_path`.
///
/// On Unix, `fs::rename` atomically replaces the destination in a single syscall, so a
/// concurrent reader always observes either the complete old file or the complete new
/// file — never a partial or missing one. The destination is left untouched if the
/// rename fails.
///
/// On Windows, `fs::rename` can fail when the destination already exists (for example
/// when another handle holds the file open or its attributes differ). Only in that
/// case do we fall back to removing the destination and retrying. This fallback opens
/// a brief window where the destination is absent, which Windows offers no portable
/// way to avoid here; the new contents remain recoverable in `tmp_path` if the retry
/// also fails.
pub(crate) fn atomic_replace(tmp_path: &Path, dest: &Path) -> io::Result<()> {
    match fs::rename(tmp_path, dest) {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(_) => {
            let _ = fs::remove_file(dest); // best-effort; ENOENT is fine on first write
            fs::rename(tmp_path, dest)
        }
        #[cfg(not(windows))]
        Err(error) => Err(error),
    }
}
