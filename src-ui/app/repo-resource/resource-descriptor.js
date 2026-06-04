import { state } from "../state.js";

// Shared helpers for the repo-resource framework. A "descriptor" is the per-domain config
// object (see glossary-resource-descriptor.js / qa-list-resource-descriptor.js) that the
// Tier 1 factories consume; these helpers read its identity fields so each factory does not
// re-implement them.

/**
 * Resolve a resource's id. Uses `descriptor.resourceId(resource)` if provided, otherwise the
 * first present field in `descriptor.resourceIdFields` (default `["id"]`).
 */
export function resourceId(resource, descriptor = {}) {
  if (typeof descriptor.resourceId === "function") {
    return descriptor.resourceId(resource);
  }
  for (const field of descriptor.resourceIdFields ?? ["id"]) {
    if (resource?.[field] != null) {
      return resource[field];
    }
  }
  return null;
}

/**
 * The currently selected team. With `fallbackToFirst`, falls back to the first team when none
 * is selected (used by flows that can run before a team is explicitly chosen).
 */
export function selectedTeam({ fallbackToFirst = false } = {}) {
  const found = state.teams.find((team) => team.id === state.selectedTeamId);
  if (found) {
    return found;
  }
  return fallbackToFirst ? state.teams[0] ?? null : null;
}
