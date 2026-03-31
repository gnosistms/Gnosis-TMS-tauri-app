use tauri::window::Color;

pub(crate) const GITHUB_APP_CALLBACK_EVENT: &str = "github-app-install-callback";
pub(crate) const BROKER_AUTH_CALLBACK_EVENT: &str = "broker-auth-callback";
pub(crate) const GITHUB_CALLBACK_ADDRESS: &str = "127.0.0.1:45873";
pub(crate) const GITHUB_APP_SETUP_PATH: &str = "/github/app/setup";
pub(crate) const BROKER_AUTH_CALLBACK_PATH: &str = "/broker/auth/callback";
pub(crate) const MAIN_WINDOW_BACKGROUND: Color = Color(249, 240, 219, 255);
