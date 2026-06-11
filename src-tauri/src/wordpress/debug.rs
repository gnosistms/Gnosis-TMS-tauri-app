use std::io::Write;

/// Appends a timestamped line to the file named by the
/// `GNOSIS_WORDPRESS_DEBUG_LOG` env var. Inert when the variable is unset, so
/// it is safe to leave the call sites in release builds. Never log tokens or
/// auth headers through this.
pub(crate) fn wordpress_debug_log(message: &str) {
    let Ok(path) = std::env::var("GNOSIS_WORDPRESS_DEBUG_LOG") else {
        return;
    };
    if path.trim().is_empty() {
        return;
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.trim())
    {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}
