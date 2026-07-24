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
- [ ] #191 merged after its CI passes.
- [ ] Confirm main CI (Quality Check + Browser Tests) is green on the merge
      commit before tagging — watch each job, not just the run status.
- [x] Bump version to 0.8.72 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json) — staged in the working tree, uncommitted.
- [ ] Pre-tag verification: npm test, npm run audit:unused, cargo fmt check,
      npm run test:rust.
- [ ] Commit "Release 0.8.72", tag `v0.8.72`, push main + tag.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) — watch each job, not just the
      run status.
