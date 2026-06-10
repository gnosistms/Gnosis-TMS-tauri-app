#[path = "github/app_auth.rs"]
mod app_auth;
#[path = "github/orgs.rs"]
mod orgs;
#[path = "github/repos.rs"]
mod repos;
#[path = "github/types.rs"]
pub(crate) mod types;

use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Emitter};

use crate::broker::broker_get_json_with_session;

const BACKEND_NONFATAL_TELEMETRY_EVENT: &str = "backend-nonfatal-telemetry";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendNonfatalTelemetryEvent {
    operation: &'static str,
    reason: &'static str,
}

fn encode_broker_path_segment(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

pub(crate) fn report_backend_nonfatal_error(
    app: &AppHandle,
    operation: &'static str,
    reason: &'static str,
) {
    let _ = app.emit(
        BACKEND_NONFATAL_TELEMETRY_EVENT,
        BackendNonfatalTelemetryEvent { operation, reason },
    );
}

fn broker_get_tolerant_json_list_with_session<T: DeserializeOwned>(
    app: &AppHandle,
    client: &Client,
    path: &str,
    session_token: &str,
    operation: &'static str,
    item_kind: &'static str,
) -> Result<Vec<T>, String> {
    let value: serde_json::Value = broker_get_json_with_session(client, path, session_token)?;
    let (items, skipped_count) = deserialize_tolerant_broker_list(value, item_kind)?;
    if skipped_count > 0 {
        report_backend_nonfatal_error(app, operation, "broker_list_item_deserialize_failed");
    }
    Ok(items)
}

fn deserialize_tolerant_broker_list<T: DeserializeOwned>(
    value: serde_json::Value,
    item_kind: &'static str,
) -> Result<(Vec<T>, usize), String> {
    let values = value
        .as_array()
        .ok_or_else(|| format!("GitHub App broker returned a malformed {item_kind} list."))?;
    let mut items = Vec::with_capacity(values.len());
    let mut skipped_count = 0;
    for item in values {
        match serde_json::from_value(item.clone()) {
            Ok(parsed) => items.push(parsed),
            Err(error) => {
                skipped_count += 1;
                eprintln!("Skipping malformed {item_kind} from GitHub App broker list: {error}");
            }
        }
    }
    Ok((items, skipped_count))
}

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::{deserialize_tolerant_broker_list, encode_broker_path_segment};

    #[derive(Debug, serde::Deserialize, PartialEq, Eq)]
    struct TestListItem {
        id: i64,
    }

    #[test]
    fn broker_path_segment_encoding_escapes_path_and_query_separators() {
        assert_eq!(
            encode_broker_path_segment("org/name?tab=members#owners"),
            "org%2Fname%3Ftab%3Dmembers%23owners"
        );
        assert_eq!(encode_broker_path_segment("github-login"), "github-login");
    }

    #[test]
    fn tolerant_broker_list_skips_malformed_items() {
        let value = serde_json::json!([
            { "id": 1 },
            { "missingId": true },
            { "id": 2 }
        ]);

        let (items, skipped_count) =
            deserialize_tolerant_broker_list::<TestListItem>(value, "test item").unwrap();

        assert_eq!(items, vec![TestListItem { id: 1 }, TestListItem { id: 2 }]);
        assert_eq!(skipped_count, 1);
    }

    #[test]
    fn tolerant_broker_list_rejects_non_arrays() {
        let error =
            deserialize_tolerant_broker_list::<TestListItem>(serde_json::json!({}), "test item")
                .unwrap_err();

        assert_eq!(
            error,
            "GitHub App broker returned a malformed test item list."
        );
    }
}

pub(crate) use app_auth::begin_github_app_install;
pub(crate) use orgs::{
    add_organization_admin_for_installation, delete_organization_for_installation,
    inspect_github_app_installation, inspect_team_metadata_repo_for_installation,
    invite_user_to_organization_for_installation, leave_organization_for_installation,
    list_accessible_github_app_installations, list_organization_members_for_installation,
    promote_organization_owner_for_installation, purge_local_installation_data,
    remove_organization_member_for_installation, revoke_organization_admin_for_installation,
    search_github_users_for_installation, set_organization_member_role_for_installation,
    setup_organization_for_installation, update_organization_description_for_installation,
    update_organization_name_for_installation,
};
pub(crate) use repos::{
    create_gnosis_glossary_repo, create_gnosis_project_repo, create_gnosis_qa_list_repo,
    ensure_gnosis_repo_properties_schema, list_gnosis_glossaries_for_installation,
    list_gnosis_projects_for_installation, list_gnosis_qa_lists_for_installation,
    list_gnosis_resources_for_installation, mark_gnosis_project_repo_deleted,
    rename_gnosis_project_repo, restore_gnosis_project_repo, rollback_created_gnosis_glossary_repo,
    rollback_created_gnosis_project_repo, rollback_created_gnosis_qa_list_repo,
};
