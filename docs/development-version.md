# Development app versions

The Applications launcher and `npm run tauri:dev` run the same release preflight.
At each start it fetches main and release tags from origin, compares the checkout
with the newest stable release on main, and updates all six version metadata files
when it can verify that the released source and configuration are already present.
Tauri then rebuilds the native executable with that version.

If release code is missing or overlaps local edits that the verifier cannot prove,
startup stops with an integration message. Integrate the release changes while
preserving local work, then restart. Startup does not merge or replace source files.
A version bump alone cannot make older code compatible with newer repository data.

If origin is unavailable, startup warns and checks cached release refs. Repository
sync still rejects data written by a newer version. Restart development sessions
after new releases; an already running executable cannot update its compiled version
just by refreshing the UI.

For deliberate old-version testing, set `GNOSIS_ALLOW_STALE_DEV_VERSION=1` for that
invocation. It retains the real old version and repository sync protection. To skip
the network check, set `GNOSIS_FETCH_DEV_RELEASES=0`. To require manual version
metadata updates, set `GNOSIS_SYNC_DEV_VERSION=0`. These are explicit overrides;
the everyday launcher does not set them.
