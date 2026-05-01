import { requireBrokerSession } from "./auth-flow.js";
import {
  loadStoredTeamPendingMutations,
  replaceStoredTeamRecords,
  saveStoredTeamRecords,
  splitStoredTeamRecords,
} from "./team-storage.js";
import {
  applyTeamPendingMutation,
  applyTeamSnapshotToState,
  buildTeamRecordFromInstallation,
  reconcileStoredTeam,
  resolveNextSelectedTeamId,
} from "./team-flow/shared.js";
import { applyPendingMutations } from "./optimistic-collection.js";
import {
  applyTeamWriteIntentsToSnapshot,
  clearConfirmedTeamWriteIntents,
} from "./team-write-coordinator.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { queryClient, subscribeQueryObserver, teamKeys } from "./query-client.js";

let activeTeamsQuerySubscription = null;

export function resetTeamsQueryObserver() {
  activeTeamsQuerySubscription?.unsubscribe?.();
  activeTeamsQuerySubscription = null;
}

function createOrgDiscoverySnapshot(discovery = {}) {
  return {
    status:
      typeof discovery?.status === "string" && discovery.status.trim()
        ? discovery.status.trim()
        : "ready",
    error: typeof discovery?.error === "string" ? discovery.error : "",
  };
}

function currentAuthLogin() {
  const login = state.auth.session?.login;
  return typeof login === "string" && login.trim() ? login.trim().toLowerCase() : null;
}

function isOrganizationInstallation(installation) {
  return String(installation?.accountType ?? "").toLowerCase() === "organization";
}

function applyLegacyPendingTeamMutations(snapshot) {
  const legacyPendingMutations = loadStoredTeamPendingMutations();
  state.pendingTeamMutations = legacyPendingMutations;
  return applyPendingMutations(snapshot, legacyPendingMutations, applyTeamPendingMutation);
}

export function createTeamsQuerySnapshot({
  items = [],
  deletedItems = [],
  discovery = {},
  authLogin = currentAuthLogin(),
} = {}) {
  return {
    items: Array.isArray(items) ? items : [],
    deletedItems: Array.isArray(deletedItems) ? deletedItems : [],
    discovery: createOrgDiscoverySnapshot(discovery),
    authLogin,
  };
}

export function applyTeamsQuerySnapshotToState(snapshot, {
  authLogin = snapshot?.authLogin ?? currentAuthLogin(),
  isFetching = false,
} = {}) {
  if (authLogin !== currentAuthLogin()) {
    return false;
  }

  if (snapshot) {
    clearConfirmedTeamWriteIntents(snapshot);
    const visibleSnapshot = applyTeamWriteIntentsToSnapshot(snapshot);
    applyTeamSnapshotToState({
      items: Array.isArray(visibleSnapshot.items) ? visibleSnapshot.items : [],
      deletedItems: Array.isArray(visibleSnapshot.deletedItems) ? visibleSnapshot.deletedItems : [],
    });
    state.selectedTeamId = resolveNextSelectedTeamId(state.selectedTeamId, state.teams);
    state.orgDiscovery = createOrgDiscoverySnapshot(snapshot.discovery);
  }

  state.teamsPage.isRefreshing = isFetching === true;
  return true;
}

export function seedTeamsQueryFromCache({
  authLogin = currentAuthLogin(),
  render,
  includeLegacyPendingMutations = true,
} = {}) {
  const storedTeamRecords = splitStoredTeamRecords();
  const storedSnapshot = {
    items: storedTeamRecords.activeTeams,
    deletedItems: storedTeamRecords.deletedTeams,
  };
  const snapshotSource = includeLegacyPendingMutations
    ? applyLegacyPendingTeamMutations(storedSnapshot)
    : storedSnapshot;
  const snapshot = createTeamsQuerySnapshot({
    ...snapshotSource,
    discovery: { status: "ready", error: "" },
    authLogin,
  });
  queryClient.setQueryData(teamKeys.currentUser(authLogin), snapshot);
  applyTeamsQuerySnapshotToState(snapshot, { authLogin, isFetching: true });
  render?.();
  return snapshot;
}

export function createTeamsQueryOptions(options = {}) {
  const authLogin = options.authLogin ?? currentAuthLogin();
  return {
    queryKey: teamKeys.currentUser(authLogin),
    queryFn: async () => {
      const existingTeamRecords = [
        ...splitStoredTeamRecords().activeTeams,
        ...splitStoredTeamRecords().deletedTeams,
      ];
      const installations = await invoke("list_accessible_github_app_installations", {
        sessionToken: requireBrokerSession(),
      });
      const installationList = (Array.isArray(installations) ? installations : [])
        .filter(isOrganizationInstallation);
      const storedTeamsByInstallationId = new Map(
        existingTeamRecords
          .filter((team) => Number.isFinite(team.installationId))
          .map((team) => [team.installationId, team]),
      );
      const reconciledTeams = installationList
        .map((installation) => {
          const storedTeam = storedTeamsByInstallationId.get(installation.installationId);
          return storedTeam
            ? reconcileStoredTeam(storedTeam, installation)
            : buildTeamRecordFromInstallation(installation);
        })
        .filter(Boolean);
      const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams);
      const nextStoredSnapshot = splitStoredTeamRecords(nextStoredTeams);
      const snapshot = createTeamsQuerySnapshot({
        items: nextStoredSnapshot.activeTeams,
        deletedItems: nextStoredSnapshot.deletedTeams,
        discovery: { status: "ready", error: "" },
        authLogin,
      });
      clearConfirmedTeamWriteIntents(snapshot);
      return applyTeamWriteIntentsToSnapshot(snapshot);
    },
  };
}

export function ensureTeamsQueryObserver(render, options = {}) {
  const authLogin = options.authLogin ?? currentAuthLogin();
  const queryKey = teamKeys.currentUser(authLogin);
  const currentKey = JSON.stringify(queryKey);
  if (activeTeamsQuerySubscription?.key === currentKey) {
    activeTeamsQuerySubscription.observer?.setOptions?.(createTeamsQueryOptions({ authLogin }));
    return activeTeamsQuerySubscription;
  }

  activeTeamsQuerySubscription?.unsubscribe?.();
  const subscription = subscribeQueryObserver(
    createTeamsQueryOptions({ authLogin }),
    (result) => {
      if (result.data) {
        applyTeamsQuerySnapshotToState(result.data, {
          authLogin,
          isFetching: result.isFetching,
        });
      } else if (result.error && currentAuthLogin() === authLogin) {
        state.orgDiscovery = {
          status: state.teams.length > 0 || state.deletedTeams.length > 0 ? "ready" : "error",
          error: state.teams.length > 0 || state.deletedTeams.length > 0
            ? ""
            : result.error?.message ?? String(result.error),
        };
        state.teamsPage.isRefreshing = result.isFetching;
      } else if (currentAuthLogin() === authLogin) {
        state.teamsPage.isRefreshing = result.isFetching;
      }
      render?.();
    },
  );

  activeTeamsQuerySubscription = {
    ...subscription,
    key: currentKey,
    authLogin,
  };
  return activeTeamsQuerySubscription;
}

export async function invalidateTeamsQueryAfterMutation(options = {}) {
  const authLogin = options.authLogin ?? currentAuthLogin();
  const queryKey = teamKeys.currentUser(authLogin);
  const query = queryClient.getQueryCache().find({ queryKey });
  const hasActiveObserver = typeof query?.getObserversCount === "function"
    ? query.getObserversCount() > 0
    : false;

  await queryClient.invalidateQueries({
    queryKey,
    refetchType: hasActiveObserver ? "active" : "none",
  });

  if (!hasActiveObserver && options.refetchIfInactive !== false) {
    const snapshot = await queryClient.fetchQuery(createTeamsQueryOptions({ authLogin }));
    applyTeamsQuerySnapshotToState(snapshot, { authLogin, isFetching: false });
    options.render?.();
  }
}

export function patchTeamQueryData(queryData, teamId, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }
  let changed = false;
  const patchOne = (team) => {
    if (team?.id !== teamId) {
      return team;
    }
    changed = true;
    return { ...team, ...patch };
  };
  const nextData = {
    ...queryData,
    items: (Array.isArray(queryData.items) ? queryData.items : []).map(patchOne),
    deletedItems: (Array.isArray(queryData.deletedItems) ? queryData.deletedItems : []).map(patchOne),
  };
  return changed ? nextData : queryData;
}

export function moveTeamQueryData(queryData, teamId, targetCollection, patch = {}) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }
  const items = Array.isArray(queryData.items) ? queryData.items : [];
  const deletedItems = Array.isArray(queryData.deletedItems) ? queryData.deletedItems : [];
  const team = items.find((item) => item?.id === teamId)
    ?? deletedItems.find((item) => item?.id === teamId);
  if (!team) {
    return queryData;
  }
  const nextTeam = { ...team, ...patch };
  const nextItems = items.filter((item) => item?.id !== teamId);
  const nextDeletedItems = deletedItems.filter((item) => item?.id !== teamId);
  if (targetCollection === "deleted") {
    nextDeletedItems.unshift(nextTeam);
  } else {
    nextItems.unshift(nextTeam);
  }
  return {
    ...queryData,
    items: nextItems,
    deletedItems: nextDeletedItems,
  };
}
