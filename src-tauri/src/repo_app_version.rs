use std::{cmp::Ordering, path::Path};

use serde::{Deserialize, Serialize};

use crate::repo_sync_shared::git_output;

const APP_UPDATE_REQUIRED_PREFIX: &str = "APP_UPDATE_REQUIRED:";
const GTMS_APP_VERSION_TRAILER: &str = "GTMS-App-Version:";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoAppUpdateRequirement {
    pub(crate) required_version: String,
    pub(crate) current_version: String,
    pub(crate) resource_kind: String,
    pub(crate) resource_name: String,
    pub(crate) message: String,
}

pub(crate) fn current_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub(crate) fn git_commit_app_version_trailer() -> String {
    format!("{GTMS_APP_VERSION_TRAILER} {}", current_app_version())
}

pub(crate) fn encode_repo_app_update_requirement(requirement: &RepoAppUpdateRequirement) -> String {
    match serde_json::to_string(requirement) {
        Ok(payload) => format!("{APP_UPDATE_REQUIRED_PREFIX}{payload}"),
        Err(_) => requirement.message.clone(),
    }
}

pub(crate) fn parse_repo_app_update_requirement_error(
    error_message: &str,
) -> Option<RepoAppUpdateRequirement> {
    let payload = error_message.strip_prefix(APP_UPDATE_REQUIRED_PREFIX)?;
    serde_json::from_str(payload).ok()
}

pub(crate) fn remote_ref_requires_newer_app(
    repo_path: &Path,
    remote_ref: &str,
    resource_kind: &str,
    resource_name: &str,
) -> Result<Option<RepoAppUpdateRequirement>, String> {
    let remote_commit_message =
        git_output(repo_path, &["log", "-1", "--format=%B", remote_ref], None)?;
    let Some(remote_app_version) = extract_commit_app_version(&remote_commit_message) else {
        return Ok(None);
    };

    let current_version = current_app_version();
    if compare_app_versions(&remote_app_version, &current_version) != Ordering::Greater {
        return Ok(None);
    }

    let normalized_resource_kind = resource_kind.trim();
    let normalized_resource_name = resource_name.trim();
    let label = if normalized_resource_name.is_empty() {
        format!("{normalized_resource_kind} repo")
    } else {
        format!("{normalized_resource_kind} repo '{normalized_resource_name}'")
    };

    Ok(Some(RepoAppUpdateRequirement {
        required_version: remote_app_version.clone(),
        current_version: current_version.clone(),
        resource_kind: normalized_resource_kind.to_string(),
        resource_name: normalized_resource_name.to_string(),
        message: format!(
            "This {label} was last saved by Gnosis TMS {remote_app_version}. You are running {current_version}. Update Gnosis TMS before syncing so an older app version does not overwrite newer-format data."
        ),
    }))
}

fn extract_commit_app_version(commit_message: &str) -> Option<String> {
    commit_message.lines().rev().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix(GTMS_APP_VERSION_TRAILER)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn compare_app_versions(left: &str, right: &str) -> Ordering {
    let left_parts = parse_version_parts(left);
    let right_parts = parse_version_parts(right);
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_part = left_parts.get(index).copied().unwrap_or(0);
        let right_part = right_parts.get(index).copied().unwrap_or(0);
        match left_part.cmp(&right_part) {
            Ordering::Equal => continue,
            other => return other,
        }
    }

    Ordering::Equal
}

fn parse_version_parts(value: &str) -> Vec<u64> {
    value
        .trim()
        .split('.')
        .map(|segment| {
            segment
                .split_once('-')
                .map(|(prefix, _)| prefix)
                .unwrap_or(segment)
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::{
        compare_app_versions, encode_repo_app_update_requirement, extract_commit_app_version,
        git_commit_app_version_trailer, parse_repo_app_update_requirement_error,
        RepoAppUpdateRequirement,
    };

    #[test]
    fn extract_commit_app_version_reads_trailer_from_commit_body() {
        let message = "Update glossary term 123\n\nGTMS-Operation: glossary.term.upsert\nGTMS-App-Version: 0.1.35";
        assert_eq!(
            extract_commit_app_version(message).as_deref(),
            Some("0.1.35")
        );
    }

    #[test]
    fn compare_app_versions_orders_dotted_numeric_versions() {
        assert_eq!(compare_app_versions("0.1.36", "0.1.35"), Ordering::Greater);
        assert_eq!(compare_app_versions("0.2.0", "0.10.0"), Ordering::Less);
        assert_eq!(compare_app_versions("0.1.35", "0.1.35"), Ordering::Equal);
        assert_eq!(
            compare_app_versions("0.1.35-beta.1", "0.1.35"),
            Ordering::Equal
        );
    }

    #[test]
    fn repo_app_update_requirement_round_trips_through_error_prefix() {
        let requirement = RepoAppUpdateRequirement {
            required_version: "0.1.36".to_string(),
            current_version: "0.1.35".to_string(),
            resource_kind: "project".to_string(),
            resource_name: "repo-one".to_string(),
            message: "Update required.".to_string(),
        };
        let encoded = encode_repo_app_update_requirement(&requirement);
        assert_eq!(
            parse_repo_app_update_requirement_error(&encoded),
            Some(requirement)
        );
    }

    #[test]
    fn git_commit_app_version_trailer_uses_expected_prefix() {
        assert!(git_commit_app_version_trailer().starts_with("GTMS-App-Version: "));
    }
}
