// Single source of truth for QA-list identity constants shared by the Tier 1 repo-resource
// adapters (export, editor-query, write-coordinator, old-layout-discard). Each adapter spreads
// this and adds its concern-specific config.
export const qaListResourceDescriptor = {
  collectionField: "qaLists",
  resourceIdField: "qaListId",
};
