use super::*;
use crate::{glossary_repo_sync::GlossaryDomain, qa_list_repo_sync::QaListDomain};

struct Fixture {
    root: PathBuf,
    local: PathBuf,
    other: PathBuf,
    remote: PathBuf,
}
impl Fixture {
    fn new(branch: &str, empty: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "gnosis-resource-sync-{}",
            crate::util::random_token(16)
        ));
        fs::create_dir_all(&root).unwrap();
        let remote = root.join("remote.git");
        let local = root.join("local");
        let other = root.join("other");
        git(
            &root,
            &[
                "init",
                "--bare",
                "--initial-branch",
                branch,
                remote.to_str().unwrap(),
            ],
        );
        git(
            &root,
            &["clone", remote.to_str().unwrap(), local.to_str().unwrap()],
        );
        identity(&local);
        if !empty {
            commit(&local, "base.txt", "base", "base");
            git(&local, &["push", "-u", "origin", branch]);
        }
        git(
            &root,
            &["clone", remote.to_str().unwrap(), other.to_str().unwrap()],
        );
        identity(&other);
        Self {
            root,
            local,
            other,
            remote,
        }
    }
    fn descriptor(&self, branch: &str) -> RepoResourceSyncDescriptor {
        RepoResourceSyncDescriptor {
            resource_id: Some("fixture".into()),
            repo_name: "fixture".into(),
            full_name: "fixture/repo".into(),
            repo_id: None,
            default_branch_name: Some(branch.into()),
            default_branch_head_oid: None,
            lifecycle_state: None,
            record_state: None,
            remote_state: None,
            status: None,
        }
    }
    fn sync(
        &self,
        domain: &dyn RepoResourceDomain,
        branch: &str,
        prepare: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<Option<String>, String> {
        let lock = repo_sync_lock(&self.local);
        let _guard = acquire_repo_sync_lock(&lock);
        sync_resource_checkout(
            domain,
            &self.descriptor(branch),
            &self.local,
            branch,
            &GitTransportAuth::from_token("fixture-token").unwrap(),
            prepare,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn git(path: &Path, args: &[&str]) -> String {
    git_output(path, args, None).unwrap()
}
fn identity(path: &Path) {
    git(path, &["config", "user.name", "Fixture"]);
    git(path, &["config", "user.email", "fixture@example.invalid"]);
}
fn commit(path: &Path, file: &str, text: &str, message: &str) {
    fs::write(path.join(file), text).unwrap();
    git(path, &["add", file]);
    git(path, &["commit", "-m", message]);
}
fn domains() -> [Box<dyn RepoResourceDomain>; 2] {
    [Box::new(GlossaryDomain), Box::new(QaListDomain)]
}

#[test]
fn stale_empty_descriptor_reconciles_both_resource_domains() {
    for domain in domains() {
        let fixture = Fixture::new("main", false);
        commit(&fixture.local, "local.txt", "local", "local");
        commit(&fixture.other, "remote.txt", "remote", "remote");
        git(&fixture.other, &["push", "origin", "main"]);
        fixture.sync(domain.as_ref(), "main", |_| Ok(())).unwrap();
        assert_eq!(
            fs::read_to_string(fixture.local.join("local.txt")).unwrap(),
            "local"
        );
        assert_eq!(
            fs::read_to_string(fixture.local.join("remote.txt")).unwrap(),
            "remote"
        );
        assert_eq!(
            git(&fixture.local, &["rev-parse", "HEAD"]),
            git(&fixture.remote, &["rev-parse", "refs/heads/main"])
        );
    }
}

#[test]
fn empty_remotes_publish_local_commits_on_named_branches() {
    for domain in domains() {
        let fixture = Fixture::new("translation", true);
        commit(&fixture.local, "local.txt", "local", "local");
        fixture
            .sync(domain.as_ref(), "translation", |head| {
                assert!(head.is_empty());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            git(&fixture.local, &["rev-parse", "HEAD"]),
            git(&fixture.remote, &["rev-parse", "refs/heads/translation"])
        );
    }
}

#[test]
fn remote_advancement_retries_once_and_preserves_both_sides() {
    for domain in domains() {
        let fixture = Fixture::new("main", false);
        commit(&fixture.local, "local.txt", "local", "local");
        let mut preparations = 0;
        fixture
            .sync(domain.as_ref(), "main", |_| {
                preparations += 1;
                if preparations == 1 {
                    commit(&fixture.other, "remote.txt", "remote", "remote");
                    git(&fixture.other, &["push", "origin", "main"]);
                }
                Ok(())
            })
            .unwrap();
        assert_eq!(preparations, 2);
        assert_eq!(
            fs::read_to_string(fixture.local.join("remote.txt")).unwrap(),
            "remote"
        );
        assert_eq!(
            fs::read_to_string(fixture.local.join("local.txt")).unwrap(),
            "local"
        );
    }
}

#[test]
fn repeated_advancement_stops_without_marking_the_repository_synced() {
    let fixture = Fixture::new("main", false);
    commit(&fixture.local, "local.txt", "local", "local");
    let mut preparations = 0;
    let error = fixture
        .sync(&GlossaryDomain, "main", |_| {
            preparations += 1;
            commit(
                &fixture.other,
                "remote.txt",
                &preparations.to_string(),
                "remote",
            );
            git(&fixture.other, &["push", "origin", "main"]);
            Ok(())
        })
        .unwrap_err();
    assert_eq!(preparations, 2);
    assert!(push_rejected_for_remote_advance(&error));
    assert!(read_local_repo_sync_state(&fixture.local)
        .unwrap()
        .is_none());
    assert_eq!(
        fs::read_to_string(fixture.local.join("local.txt")).unwrap(),
        "local"
    );
}

#[test]
fn branch_created_during_first_publication_is_reconciled() {
    let fixture = Fixture::new("main", true);
    commit(&fixture.local, "base.txt", "base", "base");
    // Another writer has our initial commit before the remote branch is published.
    git(
        &fixture.other,
        &["fetch", fixture.local.to_str().unwrap(), "main"],
    );
    git(&fixture.other, &["checkout", "-b", "main", "FETCH_HEAD"]);
    commit(&fixture.local, "local.txt", "local", "local");
    let mut preparations = 0;
    fixture
        .sync(&QaListDomain, "main", |head| {
            preparations += 1;
            if preparations == 1 {
                assert!(head.is_empty());
                commit(&fixture.other, "remote.txt", "remote", "remote");
                git(&fixture.other, &["push", "origin", "main"]);
            } else {
                assert!(!head.is_empty());
            }
            Ok(())
        })
        .unwrap();
    assert_eq!(preparations, 2);
    assert_eq!(
        fs::read_to_string(fixture.local.join("remote.txt")).unwrap(),
        "remote"
    );
    assert_eq!(
        fs::read_to_string(fixture.local.join("local.txt")).unwrap(),
        "local"
    );
}

#[test]
fn conflicting_changes_abort_rebase_without_losing_local_work() {
    for domain in domains() {
        let fixture = Fixture::new("main", false);
        commit(&fixture.local, "base.txt", "local change", "local");
        let local_head = git(&fixture.local, &["rev-parse", "HEAD"]);
        commit(&fixture.other, "base.txt", "remote change", "remote");
        git(&fixture.other, &["push", "origin", "main"]);
        assert!(fixture.sync(domain.as_ref(), "main", |_| Ok(())).is_err());
        assert_eq!(git(&fixture.local, &["rev-parse", "HEAD"]), local_head);
        assert_eq!(git(&fixture.local, &["status", "--porcelain"]), "");
        assert_eq!(
            fs::read_to_string(fixture.local.join("base.txt")).unwrap(),
            "local change"
        );
        assert!(read_local_repo_sync_state(&fixture.local)
            .unwrap()
            .is_none());
    }
}

#[test]
fn unrelated_histories_are_not_rebased_or_pushed() {
    let fixture = Fixture::new("main", true);
    commit(&fixture.local, "local.txt", "local", "local");
    commit(&fixture.other, "remote.txt", "remote", "remote");
    git(&fixture.other, &["push", "origin", "main"]);
    let local_head = git(&fixture.local, &["rev-parse", "HEAD"]);
    let remote_head = git(&fixture.remote, &["rev-parse", "refs/heads/main"]);
    assert!(fixture
        .sync(&GlossaryDomain, "main", |_| Ok(()))
        .unwrap_err()
        .contains("unrelated"));
    assert_eq!(git(&fixture.local, &["rev-parse", "HEAD"]), local_head);
    assert_eq!(
        git(&fixture.remote, &["rev-parse", "refs/heads/main"]),
        remote_head
    );
}

#[test]
fn failed_fetch_is_not_an_empty_remote_and_stale_tracking_refs_are_not_authoritative() {
    let fixture = Fixture::new("main", false);
    let auth = GitTransportAuth::from_token("fixture-token").unwrap();
    let resource = fixture.descriptor("main");
    assert!(
        enforce_remote_app_version(&GlossaryDomain, &fixture.local, &resource, "main", &auth)
            .unwrap()
            .is_some()
    );
    git(&fixture.remote, &["update-ref", "-d", "refs/heads/main"]);
    assert!(
        enforce_remote_app_version(&GlossaryDomain, &fixture.local, &resource, "main", &auth)
            .unwrap()
            .is_none()
    );
    // A stale local tracking ref remains but must not change the result.
    assert!(!git(&fixture.local, &["rev-parse", "refs/remotes/origin/main"]).is_empty());
    git(
        &fixture.local,
        &[
            "remote",
            "set-url",
            "origin",
            fixture.root.join("missing.git").to_str().unwrap(),
        ],
    );
    assert!(fixture
        .sync(&GlossaryDomain, "main", |_| panic!(
            "failed fetch must stop before migration/publication"
        ))
        .is_err());
    assert!(read_local_repo_sync_state(&fixture.local)
        .unwrap()
        .is_none());
}

#[test]
fn remote_version_is_checked_again_before_retrying_reconciliation() {
    for domain in domains() {
        let fixture = Fixture::new("main", false);
        commit(&fixture.local, "local.txt", "local", "local");
        let local_head = git(&fixture.local, &["rev-parse", "HEAD"]);
        let mut preparations = 0;
        let error = fixture
            .sync(domain.as_ref(), "main", |_| {
                preparations += 1;
                commit(
                    &fixture.other,
                    "future.txt",
                    "future",
                    "new format\n\nGTMS-App-Version: 999.0.0",
                );
                git(&fixture.other, &["push", "origin", "main"]);
                Ok(())
            })
            .unwrap_err();
        assert!(error.starts_with("APP_UPDATE_REQUIRED:"));
        assert_eq!(preparations, 1);
        assert_eq!(git(&fixture.local, &["rev-parse", "HEAD"]), local_head);
        assert!(!fixture.local.join("future.txt").exists());
    }
}

#[test]
fn migration_receives_the_verified_head_and_failure_prevents_publication() {
    let fixture = Fixture::new("main", false);
    commit(&fixture.local, "local.txt", "local", "local");
    let remote_head = git(&fixture.remote, &["rev-parse", "refs/heads/main"]);
    let error = fixture
        .sync(&GlossaryDomain, "main", |head| {
            assert_eq!(head, remote_head);
            Err("layout requires explicit conflict recovery".into())
        })
        .unwrap_err();
    assert_eq!(error, "layout requires explicit conflict recovery");
    assert_eq!(
        git(&fixture.remote, &["rev-parse", "refs/heads/main"]),
        remote_head
    );
    assert!(read_local_repo_sync_state(&fixture.local)
        .unwrap()
        .is_none());
}

#[test]
fn newly_cloned_repository_selects_requested_branch_without_resetting_default_history() {
    let fixture = Fixture::new("main", false);
    git(&fixture.other, &["checkout", "-b", "translation"]);
    commit(
        &fixture.other,
        "translation.txt",
        "translation",
        "translation",
    );
    git(&fixture.other, &["push", "origin", "translation"]);
    let resource = fixture.descriptor("translation");
    let auth = GitTransportAuth::from_token("fixture-token").unwrap();
    let head = enforce_remote_app_version(
        &GlossaryDomain,
        &fixture.local,
        &resource,
        "translation",
        &auth,
    )
    .unwrap();
    let main = git(&fixture.local, &["rev-parse", "refs/heads/main"]);
    select_cloned_resource_branch(&fixture.local, "translation", head.as_deref()).unwrap();
    assert_eq!(
        git(&fixture.local, &["symbolic-ref", "--short", "HEAD"]),
        "translation"
    );
    assert_eq!(git(&fixture.local, &["rev-parse", "refs/heads/main"]), main);
    fixture
        .sync(&GlossaryDomain, "translation", |_| Ok(()))
        .unwrap();
    assert!(select_cloned_resource_branch(&fixture.local, "missing", None).is_err());
}

#[test]
fn only_definite_remote_advancement_push_rejections_are_retryable() {
    for suffix in ["(non-fast-forward)", "(fetch first)"] {
        assert!(push_rejected_for_remote_advance(&format!(
            "git push failed: ! [rejected] main -> main {suffix}"
        )));
    }
    for message in [
        "error: failed to push some refs",
        "fatal: Authentication failed",
        "connection reset by peer",
        "! [remote rejected] main -> main (pre-receive hook declined)",
        "permission denied",
    ] {
        assert!(!push_rejected_for_remote_advance(message));
    }
}

#[test]
fn unborn_local_branch_adopts_a_remote_created_after_clone() {
    let fixture = Fixture::new("main", true);
    commit(&fixture.other, "remote.txt", "remote", "remote");
    git(&fixture.other, &["push", "origin", "main"]);
    fixture.sync(&GlossaryDomain, "main", |_| Ok(())).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.local.join("remote.txt")).unwrap(),
        "remote"
    );
    assert_eq!(
        git(&fixture.local, &["rev-parse", "HEAD"]),
        git(&fixture.remote, &["rev-parse", "refs/heads/main"])
    );
}

#[cfg(unix)]
#[test]
fn server_hook_rejection_does_not_retry_or_mark_synced() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new("main", false);
    commit(&fixture.local, "local.txt", "local", "local");
    let hook = fixture.remote.join("hooks/pre-receive");
    fs::write(&hook, "#!/bin/sh\necho 'permission denied' >&2\nexit 1\n").unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let mut preparations = 0;
    assert!(fixture
        .sync(&QaListDomain, "main", |_| {
            preparations += 1;
            Ok(())
        })
        .is_err());
    assert_eq!(preparations, 1);
    assert!(read_local_repo_sync_state(&fixture.local)
        .unwrap()
        .is_none());
    assert_eq!(
        fs::read_to_string(fixture.local.join("local.txt")).unwrap(),
        "local"
    );
}
