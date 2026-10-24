# Conflict resolution image payload fix

A normalized URL image carries `path: null`. Passing it directly as a conflict
resolution `baseImages` value makes the Rust command reject the save before the
handler runs: `invalid type: null, expected a string`.

1. Review serialization, image removal, concurrent image changes, and URL/upload
   boundaries against the native command contract.
2. Serialize image bases with string-only kind/url/path properties, retaining null
   for missing images. Add frontend and native command-input regression coverage.
3. Verify the isolated branch against main, open a focused PR, and merge after CI
   succeeds on its reviewed head.

The working copy contains other unreleased features; extract only this fix and
its tests into the PR.

Review: no blocking findings. Only the conflict image baseline is serialized;
chosen image values, missing-image nulls, permission checks, and native three-way
merge behavior are unchanged. Frontend regression fixtures use normalized UI
images, reproducing the null-valued property that the old fixtures missed.

Local validation on the isolated branch: all 2,993 frontend and 25 workflow
tests pass; the production build, JavaScript lint (existing warnings), and Rust
formatting check pass. The unused-code audit reports existing files/exports; this
change adds no exports or runtime modules. The native input test and CI validate
the same string-only payload contract.
