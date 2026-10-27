# Export settings loaded notice

PR #384 follow-up. Show "Settings loaded" and the requested message only when
GitHub changes the effective export configuration for the selected language.

1. Compare reconciled portable layouts with effective paper-size defaults and
   normalized empty fields. Ignore derived/local fields, image machine paths and
   display-only image filenames; preserve meaningful text, assets, inclusion,
   numbering, contents options and item order differences.
2. Apply genuinely different settings before showing the past-tense notice. Ok
   dismisses the notice without reapplying a stale snapshot. Preserve existing
   account/session fences and newer local edits during older save completions.
3. Add comparison and browser regressions for equivalent settings, default-only
   differences, actual changes, and reopening after accepting. Run relevant
   tests, update PR #384, and copy only verified files into the running dev source.


The new browser regression reproduced a false positive: entry defaults were
captured before loading local disk settings, so an omitted remote paper size was
compared to the initial app default instead of the loaded local paper size.
Comparison now uses the current local layout/options as its effective fallback.

Complete. The new comparison and notice are integrated into the running dev
checkout, preserving unrelated work. Five focused settings/browser workflows
passed against the real port-1431 dev source after the stale-default fix,
including equivalent documents and reopening without repeated notices. The wider
export run passed the existing workflows and exposed the now-fixed default
regression. All 3,122 frontend unit/screen tests and 25 workflow tests passed on
the final source. Production build, changed-module ESLint and whitespace checks
passed; the unused-file audit retains the existing 41-file baseline. The notice
was visually inspected. No native changes or app restart were needed.
