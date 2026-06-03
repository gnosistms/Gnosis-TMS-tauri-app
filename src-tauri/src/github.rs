#[path = "github/app_auth.rs"]
mod app_auth;
#[path = "github/orgs.rs"]
mod orgs;
#[path = "github/repos.rs"]
mod repos;
#[path = "github/types.rs"]
pub(crate) mod types;

fn encode_broker_path_segment(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::encode_broker_path_segment;

    #[test]
    fn broker_path_segment_encoding_escapes_path_and_query_separators() {
        assert_eq!(
            encode_broker_path_segment("org/name?tab=members#owners"),
            "org%2Fname%3Ftab%3Dmembers%23owners"
        );
        assert_eq!(encode_broker_path_segment("github-login"), "github-login");
    }
}

pub(crate) use app_auth::{begin_github_app_install, github_client};
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
    mark_gnosis_project_repo_deleted, rename_gnosis_project_repo, restore_gnosis_project_repo,
    rollback_created_gnosis_glossary_repo, rollback_created_gnosis_project_repo,
    rollback_created_gnosis_qa_list_repo,
};
