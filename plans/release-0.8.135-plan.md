# Release 0.8.135

User request: merge all open PRs for Gnosis TMS, then bump and release.

1. Inventory open PRs and their tested heads; merge #382, #383 and #384 after
   relevant checks pass. Resolve any integration issues without altering the
   user's dirty development checkout.
2. Prepare a clean release checkout from the merged main. Synchronize npm,
   lockfile, Tauri, Cargo and notice versions to 0.8.135; add release notes for
   the book-export/redundancy work and glossary-hover fixes.
3. Validate version agreement, locked Cargo metadata, version guard, workflow
   tests, frontend build, and the combined change's CI. Publish and merge a
   focused release PR, then tag its exact main merge commit as v0.8.135.
4. Monitor the existing signed release workflow for macOS Apple Silicon, macOS
   Intel and Windows. Verify stable release notes, installers, signatures and
   the version/platform entries in latest.json. Leave installation to the user.

The latest published stable release is v0.8.134. Local dev source and unrelated
uncommitted work are preserved; release builds run in GitHub Actions.

The user added a release hold while two existing chats finish their merges:
"Strip line breaks from PDF headers" and "Assess parallel image processing".
Do not submit the release PR, tag or publish until their changes are merged. Refresh/rebase this clean
release checkout onto the final main and rerun release validation, updating the
notes to include the running-header fix and the bounded image pipeline.

The user added two more incoming fixes from "Check for uncommitted changes":
keep own comments read across navigation/reloads (#387), and resolve overlapping
attribution prompts after switching windows (PR being prepared). Include both
after their checks pass and they merge, alongside the PDF image pipeline (#386).
