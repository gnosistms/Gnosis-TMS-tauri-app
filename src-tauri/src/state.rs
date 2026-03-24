use std::sync::Mutex;

pub(crate) struct AuthState {
  pub(crate) pending_oauth: Mutex<Option<PendingOauth>>,
  pub(crate) pending_github_app_install: Mutex<Option<PendingGithubAppInstall>>,
}

pub(crate) struct PendingOauth {
  pub(crate) csrf_state: String,
  pub(crate) pkce_verifier: String,
}

pub(crate) struct PendingGithubAppInstall {
  pub(crate) csrf_state: String,
}
