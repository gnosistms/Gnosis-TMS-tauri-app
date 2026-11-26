# Local PDF shortlink cache

1. Store verified shortlinks in one app-local cache keyed by exact original URL, including its section anchor. Share entries across chapter and book exports and keep them across restarts and file or project deletion.
2. Merge the previous per-file caches on first use. Remove imported copies only after the shared cache is saved. Keep failed lookups eligible for retry.
3. Verify reuse across exports, migration, section isolation, and writes from overlapping exports.

## Verification

The reported screenshot decoded to the full article URL. The active development build included the lookup, but the prior export did not record which network step failed. Redirect verification now stops at the article URL already fetched. The live lookup for the same article returned the WordPress shortlinks, and the rendered footnote used a 21 × 21 QR.
