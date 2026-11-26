# Weekly AI model notifications

1. Find the effective AI providers across teams owned by the signed-in user, including per-action selections. Run discovery and model listing in the background on a weekly cadence. Reuse the same model listings as AI Settings.
2. Keep each user's provider history and undelivered discoveries on this device. Seed each provider silently, compare model IDs, and deliver each discovery once across all owned teams. Merge models seen in the AI Settings model dropdown into the same history, including when a weekly lookup overlaps.
3. Show one provider at a time in an active Owner workspace. Support Ignore and the normal AI Settings navigation, and protect the active editor during background work.
4. Verify the weekly cadence, failure handling, cross-team deduplication, account and role changes, and both modal actions.

Notifications can appear in any team where the user is working as Owner. AI Settings opens for the active team. Page loads, background refreshes, and keyboard focus alone do not count as viewing a model list.
