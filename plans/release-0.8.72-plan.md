# Release 0.8.72

Date: 2026-07-24

## Contents

- PDF export image layout (#187): images become Typst floats so partially-empty
  pages fill with text; the chapter title is emitted as the first top float so
  an early image can never be hoisted above it; the fixed 82% image height cap
  is replaced by measuring the caption and sizing the image to the space it
  leaves.
- Double-click an editor glossary underline to edit the term (#185).
- Add GPT-5.6 Sol/Terra/Luna to the OpenAI model picker (#186).
- Update the footnote-marker browser regression test for the no-space marker
  behavior (#189): #183 removed the separator space before auto-generated
  footnote markers but missed this test, so Browser Tests failed on main and
  every PR from #183 until #189 landed. (#188 was a duplicate of the same fix,
  closed unmerged.)
- Keep trailing chapter images in flow, shortest first (#190): fixes the
  end-of-chapter layout where a float ran ahead of the final sentence and the
  text finished nearly alone on a page; trailing images are now non-floating,
  sorted shortest-first by header-parsed aspect ratio.
- Preserve the focused textarea's native undo stack across row patches (#191):
  a row patch used replaceWith, which wiped the browser's native undo stack, so
  Cmd+X then Cmd+Z intermittently failed in the editor; the focused row is now
  morphed in place. Adds a browser regression test. Merged into this release
  after the plan above was first drafted.

## Steps

- [x] Content PRs #185, #186, #187, #189, #190 merged (main at 082e6fe1).
- [x] #191 merged after its CI passes (main at 03a1ee42). The initial Ubuntu
      browser-test failure did not reproduce locally (5/5 passes on the merged
      tree) and cleared on the fresh run after main was merged into the branch.
- [x] Confirm main CI (Quality Check + Browser Tests) green on the merge commit
      before tagging.
- [x] Bump version to 0.8.72 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test (1719 pass), npm run audit:unused (clean),
      cargo fmt check (clean), npm run test:rust (439 pass).
- [x] Commit "Release 0.8.72", tag `v0.8.72`, push main + tag. The release
      commit was first cut on 082e6fe1 (before #191); rebased onto origin/main
      so 0.8.72 includes #191. Final commit 6b69a65d, tag v0.8.72.
- [x] Confirm the release build and updater artifacts publish successfully on
      every platform. Release run 30066794135 succeeded for macOS x86_64, macOS
      aarch64, and Windows x86_64. GitHub Release "Gnosis TMS v0.8.72" published
      (not draft) with all installers, updater bundles + signatures, and
      latest.json referencing version 0.8.72 across all platforms.
