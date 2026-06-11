use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

use crate::project_repo_sync::ProjectRepoSyncSnapshot;

pub(crate) struct AuthState {
    pub(crate) pending_github_app_install: Mutex<Option<PendingGithubAppInstall>>,
    pub(crate) pending_broker_auth: Mutex<Option<PendingBrokerAuth>>,
    pub(crate) pending_wordpress_auth: Mutex<Option<PendingWordPressAuth>>,
}

pub(crate) struct ProjectRepoSyncStore {
    pub(crate) entries: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
}

pub(crate) struct ProjectImportBatchCancelStore {
    pub(crate) canceled_batch_ids: Arc<Mutex<BTreeSet<String>>>,
}

pub(crate) struct PendingGithubAppInstall {
    pub(crate) csrf_state: String,
}

pub(crate) struct PendingBrokerAuth {
    pub(crate) csrf_state: String,
}

pub(crate) struct PendingWordPressAuth {
    pub(crate) csrf_state: String,
}

impl Default for ProjectRepoSyncStore {
    fn default() -> Self {
        Self {
            entries: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }
}

impl Default for ProjectImportBatchCancelStore {
    fn default() -> Self {
        Self {
            canceled_batch_ids: Arc::new(Mutex::new(BTreeSet::new())),
        }
    }
}
