import {
  cloneWriteIntentValue,
  createWriteIntentCoordinator,
} from "./write-intent-coordinator.js";

const writeIntents = createWriteIntentCoordinator({
  defaultScope: "member-writes:default",
  label: "Member",
});

function normalizeMembersSnapshot(snapshot) {
  return Array.isArray(snapshot?.members)
    ? snapshot.members
    : Array.isArray(snapshot)
      ? snapshot
      : [];
}

export function memberRoleIntentKey(teamId, username) {
  return `member:role:${teamId ?? "unknown"}:${username ?? "unknown"}`;
}

export function memberRemovalIntentKey(teamId, username) {
  return `member:remove:${teamId ?? "unknown"}:${username ?? "unknown"}`;
}

export function memberOwnerPromotionIntentKey(teamId, username) {
  return `member:owner:${teamId ?? "unknown"}:${username ?? "unknown"}`;
}

export function memberUserWriteScope(team, username) {
  return `members:${team?.installationId ?? "unknown"}:${username ?? "unknown"}`;
}

export function requestMemberWriteIntent(intent, operations = {}) {
  if (intent?.type === "memberRemoval" || intent?.type === "memberOwnerPromotion") {
    const username = intent.username ?? intent.value?.username ?? "";
    writeIntents.clearIntentsWhere((currentIntent) =>
      currentIntent.teamId === intent.teamId
      && (currentIntent.username ?? currentIntent.value?.username) === username
      && currentIntent.type === "memberRole"
    );
  }
  return writeIntents.request(intent, operations);
}

export function anyMemberWriteIsActive() {
  return writeIntents.anyActive();
}

export function resetMemberWriteCoordinator() {
  writeIntents.reset();
}

export function getMemberWriteIntent(key) {
  return writeIntents.getIntent(key);
}

function patchMember(members, username, patch) {
  let changed = false;
  const nextMembers = members.map((member) => {
    if (member?.username !== username) {
      return member;
    }
    changed = true;
    return {
      ...member,
      ...cloneWriteIntentValue(patch),
    };
  });
  return changed ? nextMembers : members;
}

function removeMember(members, username) {
  return members.filter((member) => member?.username !== username);
}

export function applyMemberWriteIntentsToSnapshot(snapshot) {
  let nextMembers = normalizeMembersSnapshot(snapshot);

  for (const intent of writeIntents.getIntents()) {
    if (intent.status === "confirmed") {
      continue;
    }
    const username = intent.username ?? intent.value?.username ?? "";
    if (!username) {
      continue;
    }

    if (intent.type === "memberRole") {
      nextMembers = patchMember(nextMembers, username, {
        role: intent.value?.role,
        pendingMutation: intent.value?.role === "Admin" ? "makeAdmin" : "revokeAdmin",
        pendingError: "",
      });
      continue;
    }
    if (intent.type === "memberRemoval") {
      nextMembers = removeMember(nextMembers, username);
      continue;
    }
    if (intent.type === "memberOwnerPromotion") {
      nextMembers = patchMember(nextMembers, username, {
        role: "Owner",
        pendingMutation: "promoteOwner",
        pendingError: "",
      });
    }
  }

  return Array.isArray(snapshot?.members)
    ? {
        ...snapshot,
        members: nextMembers,
      }
    : nextMembers;
}

function intentMatchesSnapshot(intent, members) {
  const username = intent.username ?? intent.value?.username ?? "";
  if (!username) {
    return false;
  }

  const member = members.find((item) => item?.username === username);
  if (intent.type === "memberRemoval") {
    return !member;
  }
  if (!member) {
    return false;
  }
  if (intent.type === "memberRole") {
    return member.role === intent.value?.role;
  }
  if (intent.type === "memberOwnerPromotion") {
    return member.role === "Owner";
  }
  return false;
}

export function clearConfirmedMemberWriteIntents(snapshot) {
  const members = normalizeMembersSnapshot(snapshot);
  writeIntents.clearIntentsWhere((intent) =>
    intent.status === "pendingConfirmation" && intentMatchesSnapshot(intent, members)
  );
}
