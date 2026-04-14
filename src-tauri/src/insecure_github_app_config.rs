// Non-secret production defaults that can safely ship in the desktop app.
//
// Secret values must stay empty here and live only in the broker environment.
// The broker base URL is public information, so the release app can safely
// carry a production default while still allowing local env overrides for
// development or staging.

pub(crate) const INSECURE_GITHUB_APP_BROKER_BASE_URL: &str =
    "https://gnosis-github-app-broker-8bfus.ondigitalocean.app";
pub(crate) const INSECURE_GITHUB_APP_BROKER_TOKEN: &str = "";
