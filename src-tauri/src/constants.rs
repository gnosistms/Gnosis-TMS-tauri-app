use tauri::window::Color;

pub(crate) const GITHUB_CALLBACK_EVENT: &str = "github-oauth-callback";
pub(crate) const GITHUB_APP_CALLBACK_EVENT: &str = "github-app-install-callback";
pub(crate) const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
pub(crate) const GITHUB_CALLBACK_PATH: &str = "/github/callback";
pub(crate) const GITHUB_APP_SETUP_PATH: &str = "/github/app/setup";
pub(crate) const GNOSIS_TMS_ORG_DESCRIPTION: &str = "[Gnosis TMS Translation Team]";
pub(crate) const MAIN_WINDOW_BACKGROUND: Color = Color(247, 236, 213, 255);
