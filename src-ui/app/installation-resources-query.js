import { requireBrokerSession } from "./auth-flow.js";
import { installationResourceKeys, queryClient } from "./query-client.js";
import { invoke } from "./runtime.js";

// One broker round trip lists every gnosis resource type in the installation
// (projects + glossaries + QA lists). The repo set changes rarely, so within this
// window all readers — projects discovery, glossary discovery, QA discovery — share a
// single fetch instead of each paying their own ~6s listing call; concurrent readers
// dedupe onto one in-flight request. Manual refresh invalidates first, so explicit
// refreshes always hit the broker.
const INSTALLATION_RESOURCES_STALE_MS = 30_000;

function fetchInstallationResources(installationId) {
  return queryClient.fetchQuery({
    queryKey: installationResourceKeys.byInstallation(installationId),
    queryFn: () =>
      invoke("list_gnosis_resources_for_installation", {
        installationId,
        sessionToken: requireBrokerSession(),
      }),
    staleTime: INSTALLATION_RESOURCES_STALE_MS,
  });
}

export async function listRemoteProjectsForInstallation(installationId) {
  const resources = await fetchInstallationResources(installationId);
  return Array.isArray(resources?.projects) ? resources.projects : [];
}

export async function listRemoteGlossariesForInstallation(installationId) {
  const resources = await fetchInstallationResources(installationId);
  return Array.isArray(resources?.glossaries) ? resources.glossaries : [];
}

export async function listRemoteQaListsForInstallation(installationId) {
  const resources = await fetchInstallationResources(installationId);
  return Array.isArray(resources?.qaLists) ? resources.qaLists : [];
}

export async function invalidateInstallationResourcesForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return;
  }
  await queryClient.invalidateQueries({
    queryKey: installationResourceKeys.byInstallation(team.installationId),
    refetchType: "none",
  });
}
