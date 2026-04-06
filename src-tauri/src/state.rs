use std::{
  collections::BTreeMap,
  sync::{Arc, Mutex},
};

use crate::project_repo_sync::ProjectRepoSyncSnapshot;

pub(crate) struct AuthState {
  pub(crate) pending_github_app_install: Mutex<Option<PendingGithubAppInstall>>,
  pub(crate) pending_broker_auth: Mutex<Option<PendingBrokerAuth>>,
}

pub(crate) struct ProjectRepoSyncStore {
  pub(crate) entries: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
}

pub(crate) struct PendingGithubAppInstall {
  pub(crate) csrf_state: String,
}

pub(crate) struct PendingBrokerAuth {
  pub(crate) csrf_state: String,
}

impl Default for ProjectRepoSyncStore {
  fn default() -> Self {
    Self {
      entries: Arc::new(Mutex::new(BTreeMap::new())),
    }
  }
}
