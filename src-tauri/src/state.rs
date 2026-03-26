use std::sync::Mutex;

pub(crate) struct AuthState {
  pub(crate) pending_github_app_install: Mutex<Option<PendingGithubAppInstall>>,
  pub(crate) pending_broker_auth: Mutex<Option<PendingBrokerAuth>>,
}

pub(crate) struct PendingGithubAppInstall {
  pub(crate) csrf_state: String,
}

pub(crate) struct PendingBrokerAuth {
  pub(crate) csrf_state: String,
}
