# Optional chapter numbering

1. Audit generated chapter numbers in list/preview/contents, native PDF and Vellum
   clipboard metadata. Keep chapter numbering separate from page/footnote numbers
   and from the editable source chapter title.
2. Persist a per-chapter `numbered` preference (missing means true), derive a dense
   sequence from included numbered chapters in export order, and show a Numbered
   checkbox only in the selected chapter card. Patch controls/numbers in place so
   selection, title editing, checkbox focus and list scroll remain intact.
3. Carry the flag through export inputs. Omit chapter numbers from unnumbered
   PDF headings/contents and Vellum elements; preserve their contents entries,
   optional H1 subentries, page numbers, body treatment and export inclusion.
4. Test defaults, persistence, reorder/include/exclude/renumbering, UI focus and
   scroll, native PDF typesetting and Vellum metadata. Mirror into the running dev
   app, rebuild the native backend and update PR 384.

Completed:
- One derived number map drives read-only list prefixes, chapter previews and
  contents prefixes. Excluded/unavailable/unnumbered chapters consume no number;
  unnumbered chapters still appear in contents. Preferences persist by language,
  with older layouts and native clients defaulting to numbered.
- The selected card reveals its checkbox without changing card height. Checkbox
  and number updates patch the mounted DOM; title hit areas, caret, checkbox focus
  and scroll remain stable. The checkbox label does not trigger row selection.
- Native PDF rendering keeps optional chapter numbers separate from page numbers
  and book membership, so unnumbered chapters retain page folios and optional H1
  contents entries. Vellum's native `numbered` property follows the saved flag;
  formats without generated chapter numbers retain their existing behavior.
- 3,087 frontend tests, 25 workflow tests, 21 export browser workflows, 61 native
  PDF tests, strict all-target Clippy, formatting, JS lint, build and whitespace
  checks pass. Unused-code audit stays at 41 files/16 exports. The new workflow
  also passes against the running dev frontend.
- Actual A5 PDF compilation and metadata checks verify 1 / unnumbered interlude /
  2, plus the interlude's H1 entry and page numbering. PDF and UI proofs were
  visually checked. Sources are mirrored into dev; native app rebuilt/relaunched.
