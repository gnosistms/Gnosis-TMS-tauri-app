import { requireBrokerSession } from "./auth-flow.js";
import { loadStoredMembersForTeam, saveStoredMembersForTeam } from "./member-cache.js";
import {
  applyMemberWriteIntentsToSnapshot,
  clearConfirmedMemberWriteIntents,
} from "./member-write-coordinator.js";
import { normalizeOrganizationMember } from "./member-shared.js";
import { memberKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

let activeMembersQuerySubscription = null;

export function resetMembersQueryObserver() {
  activeMembersQuerySubscription?.unsubscribe?.();
  activeMembersQuerySubscription = null;
}

function createUserDiscoverySnapshot(discovery = {}) {
  return {
    status:
      typeof discovery?.status === "string" && discovery.status.trim()
        ? discovery.status.trim()
        : "ready",
    error: typeof discovery?.error === "string" ? discovery.error : "",
  };
}

export function createMembersQuerySnapshot({
  members = [],
  discovery = {},
} = {}) {
  return {
    members: Array.isArray(members) ? members : [],
    discovery: createUserDiscoverySnapshot(discovery),
  };
}

export function applyMembersQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    clearConfirmedMemberWriteIntents(snapshot.members);
    const visibleSnapshot = applyMemberWriteIntentsToSnapshot(snapshot);
    state.users = Array.isArray(visibleSnapshot.members) ? visibleSnapshot.members : [];
    state.userDiscovery = createUserDiscoverySnapshot(snapshot.discovery);
  }

  state.membersPage.isRefreshing = isFetching === true;
  return true;
}

export function seedMembersQueryFromCache(team, {
  teamId = team?.id,
  render,
} = {}) {
  const cachedMembers = loadStoredMembersForTeam(team);
  if (!cachedMembers?.exists) {
    return null;
  }

  const snapshot = createMembersQuerySnapshot({
    members: cachedMembers.members,
    discovery: { status: "ready", error: "" },
  });
  queryClient.setQueryData(memberKeys.byTeam(teamId), snapshot);
  applyMembersQuerySnapshotToState(snapshot, { teamId, isFetching: true });
  render?.();
  return snapshot;
}

export function createMembersQueryOptions(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  return {
    queryKey: memberKeys.byTeam(teamId),
    queryFn: async () => {
      const users = await invoke("list_organization_members_for_installation", {
        installationId: team.installationId,
        orgLogin: team.githubOrg,
        sessionToken: requireBrokerSession(),
      });
      const members = (Array.isArray(users) ? users : [])
        .map((user) => normalizeOrganizationMember(user))
        .filter(Boolean);
      saveStoredMembersForTeam(team, members);
      const snapshot = createMembersQuerySnapshot({
        members,
        discovery: { status: "ready", error: "" },
      });
      clearConfirmedMemberWriteIntents(snapshot.members);
      return applyMemberWriteIntentsToSnapshot(snapshot);
    },
  };
}

export function ensureMembersQueryObserver(render, team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = memberKeys.byTeam(teamId);
  const currentKey = JSON.stringify(queryKey);
  if (activeMembersQuerySubscription?.key === currentKey) {
    activeMembersQuerySubscription.observer?.setOptions?.(
      createMembersQueryOptions(team, {
        ...options,
        teamId,
        render,
      }),
    );
    return activeMembersQuerySubscription;
  }

  activeMembersQuerySubscription?.unsubscribe?.();
  const subscription = subscribeQueryObserver(
    createMembersQueryOptions(team, {
      ...options,
      teamId,
      render,
    }),
    (result) => {
      if (result.data) {
        applyMembersQuerySnapshotToState(result.data, {
          teamId,
          isFetching: result.isFetching,
        });
      } else if (result.error && state.selectedTeamId === teamId) {
        state.userDiscovery = createUserDiscoverySnapshot({
          status: state.users.length > 0 ? "ready" : "error",
          error: state.users.length > 0 ? "" : result.error?.message ?? String(result.error),
        });
        state.membersPage.isRefreshing = result.isFetching;
      } else if (state.selectedTeamId === teamId) {
        state.membersPage.isRefreshing = result.isFetching;
      }
      render?.();
    },
  );

  activeMembersQuerySubscription = {
    ...subscription,
    key: currentKey,
    teamId,
  };
  return activeMembersQuerySubscription;
}

export async function invalidateMembersQueryAfterMutation(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = memberKeys.byTeam(teamId);
  const query = queryClient.getQueryCache().find({ queryKey });
  const hasActiveObserver = typeof query?.getObserversCount === "function"
    ? query.getObserversCount() > 0
    : false;

  await queryClient.invalidateQueries({
    queryKey,
    refetchType: hasActiveObserver ? "active" : "none",
  });

  if (!hasActiveObserver && options.refetchIfInactive !== false) {
    const snapshot = await queryClient.fetchQuery(createMembersQueryOptions(team, {
      ...options,
      teamId,
    }));
    applyMembersQuerySnapshotToState(snapshot, { teamId, isFetching: false });
    options.render?.();
  }
}

export function patchMemberQueryData(queryData, username, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const members = (Array.isArray(queryData.members) ? queryData.members : []).map((member) => {
    if (member?.username !== username) {
      return member;
    }
    changed = true;
    return {
      ...member,
      ...patch,
    };
  });

  return changed ? { ...queryData, members } : queryData;
}

export function removeMemberFromQueryData(queryData, username) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  return {
    ...queryData,
    members: (Array.isArray(queryData.members) ? queryData.members : [])
      .filter((member) => member?.username !== username),
  };
}
