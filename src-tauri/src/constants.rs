#[cfg(target_os = "macos")]
use tauri::window::Color;

pub(crate) const GITHUB_APP_CALLBACK_EVENT: &str = "github-app-install-callback";
pub(crate) const BROKER_AUTH_CALLBACK_EVENT: &str = "broker-auth-callback";
pub(crate) const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
pub(crate) const GITHUB_APP_SETUP_PATH: &str = "/github/app/setup";
pub(crate) const BROKER_AUTH_CALLBACK_PATH: &str = "/broker/auth/callback";
pub(crate) const WORDPRESS_AUTH_CALLBACK_EVENT: &str = "wordpress-auth-callback";
pub(crate) const WORDPRESS_AUTH_CALLBACK_PATH: &str = "/wordpress/auth/callback";
pub(crate) const WORDPRESS_EXPORT_PROGRESS_EVENT: &str = "wordpress-export-progress";
// Keep this value and label in sync with src-ui/app/import-file-limit.js.
// Rust is authoritative; JS mirrors this only to reject oversized picker files before reading them.
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

pub(crate) fn decoded_base64_len(value: &str) -> usize {
    let normalized_len = value.split_whitespace().map(str::len).sum::<usize>();
    let padding = value
        .trim_end()
        .chars()
        .rev()
        .take_while(|character| *character == '=')
        .count()
        .min(2);
    normalized_len
        .saturating_mul(3)
        .checked_div(4)
        .unwrap_or(0)
        .saturating_sub(padding)
}

#[cfg(test)]
mod tests {
    use super::{
        decoded_base64_len, ensure_within_import_size_limit, import_file_size_limit_error,
        MAX_IMPORT_FILE_BYTES,
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

    #[test]
    fn decoded_base64_len_handles_padding_and_whitespace() {
        assert_eq!(decoded_base64_len("YQ=="), 1);
        assert_eq!(decoded_base64_len("YWI="), 2);
        assert_eq!(decoded_base64_len("YWJj"), 3);
        assert_eq!(decoded_base64_len("YW Jj\nZA=="), 4);
    }
}
