#[cfg(target_os = "macos")]
use tauri::window::Color;

pub(crate) const GITHUB_APP_CALLBACK_EVENT: &str = "github-app-install-callback";
pub(crate) const BROKER_AUTH_CALLBACK_EVENT: &str = "broker-auth-callback";
pub(crate) const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
pub(crate) const GITHUB_APP_SETUP_PATH: &str = "/github/app/setup";
pub(crate) const BROKER_AUTH_CALLBACK_PATH: &str = "/broker/auth/callback";
pub(crate) const MAX_IMPORT_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub(crate) const IMPORT_FILE_SIZE_LIMIT_LABEL: &str = "25 MB";
#[cfg(target_os = "macos")]
pub(crate) const MAIN_WINDOW_BACKGROUND: Color = Color(251, 242, 226, 255);

pub(crate) fn import_file_size_limit_error(file_label: &str) -> String {
    format!("'{file_label}' is too large to import. The maximum file size is {IMPORT_FILE_SIZE_LIMIT_LABEL}.")
}

pub(crate) fn ensure_within_import_size_limit(
    byte_len: u64,
    file_label: &str,
) -> Result<(), String> {
    if byte_len > MAX_IMPORT_FILE_BYTES {
        return Err(import_file_size_limit_error(file_label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_within_import_size_limit, import_file_size_limit_error, MAX_IMPORT_FILE_BYTES,
    };

    #[test]
    fn import_size_limit_allows_files_at_the_limit() {
        assert_eq!(
            ensure_within_import_size_limit(MAX_IMPORT_FILE_BYTES, "chapter.docx"),
            Ok(())
        );
    }

    #[test]
    fn import_size_limit_rejects_files_above_the_limit() {
        assert_eq!(
            ensure_within_import_size_limit(MAX_IMPORT_FILE_BYTES + 1, "chapter.docx"),
            Err(import_file_size_limit_error("chapter.docx"))
        );
    }
}
