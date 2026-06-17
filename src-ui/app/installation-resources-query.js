import { requireBrokerSession } from "./auth-flow.js";
import { applyTeamAccessFromListing } from "./team-query.js";
import { installationResourceKeys, queryClient } from "./query-client.js";
import { invoke } from "./runtime.js";

// One broker round trip lists every gnosis resource type in the installation
// (projects + glossaries + QA lists). The repo set changes rarely, so within this
// window all readers — projects discovery, glossary discovery, QA discovery — share a
// single fetch instead of each paying their own ~6s listing call; concurrent readers
// dedupe onto one in-flight request. Manual refresh invalidates first, so explicit
// refreshes always hit the broker.
const INSTALLATION_RESOURCES_STALE_MS = 30_000;

async function fetchInstallationResources(installationId) {
  const resources = await queryClient.fetchQuery({
    queryKey: installationResourceKeys.byInstallation(installationId),
    queryFn: () =>
      invoke("list_gnosis_resources_for_installation", {
        installationId,
        sessionToken: requireBrokerSession(),
      }),
    staleTime: INSTALLATION_RESOURCES_STALE_MS,
  });
  // The listing carries the caller's access verdict (absent on older brokers) —
  // capabilities update with the data, replacing the blocking access check that used
  // to gate team entry.
  applyTeamAccessFromListing(installationId, resources?.access);
  return resources;
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

// Import verification re-lists remote repos immediately after creating one, so it must
// observe GitHub's newest listing rather than a request that started before the repo
// existed. Cancel any in-flight listing first so the refetch can't dedupe onto a stale
// promise, then mark the cache stale. Scoped to the import path on purpose — plain
// invalidation is enough for navigation and migration callers, which should not cancel
// a discovery fetch other screens may be awaiting.
export async function refreshInstallationResourcesForTeam(team) {
  if (!Number.isFinite(team?.installationId)) {
    return;
  }
  const queryKey = installationResourceKeys.byInstallation(team.installationId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
}
