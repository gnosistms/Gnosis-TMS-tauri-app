# Repo Resource Hard-Delete Action Policy Fix

## Problem

Glossary and QA-list permanent-delete confirmation actions are routed through the
ordinary shared-write policy. Because permanent deletion only applies after a resource
is soft-deleted, that policy rejects the confirmation as a write to a read-only item.

## Plan

1. Classify both the open and confirm phases of glossary permanent deletion as local
   hard-delete actions, resolving the confirmation target from modal state.
2. Apply the same policy classification to QA lists for resource-model parity.
3. Add dispatcher-level regressions proving confirmation reaches modal validation
   instead of the deleted-resource read-only guard, then run focused and full frontend
   unit tests.
