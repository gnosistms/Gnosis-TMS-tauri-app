# Release 0.8.146

1. Cut `claude/release-0.8.146` from `dev` at `d72fe1f7`, which already
   contains `origin/main` at the 0.8.145 release merge (`0c193497`). It adds
   the ten commits made on `dev` on 2026-11-04 after 0.8.145: audio as a
   footnote in exports that cannot play it (`02fafc66`), refusing audio on a
   row without text (`8aaa6134`), naming audio and video instead of image in
   the UI (`dffa392c`), copying a source term's only translation with
   Cmd/Ctrl+C (`e42ed3d0`), the leftover editor media gaps from PR #423
   (`081b57db`, `df99d213`, `7f5200ca`, `0cfac412`, `cb44a7f5`), and link URLs
   in image captions for print exports (`d72fe1f7`). Hans asked for this
   release on 2026-11-04. Later the same day, Full review accepting
   explanatory translations (`66ba105d` on `dev`) was cherry-picked onto the
   release branch at Hans's request.
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.146. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.146` and merge after its
   quality/browser CI passes.
4. Push an annotated v0.8.146 tag at the release merge commit to trigger signed
   builds.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
6. Merge `main` back into `dev`, bringing over the version numbers, notes and
   this plan.
