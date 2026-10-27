# Vietnamese drop-cap metrics and clearance

## Goal

Keep Great Vibes drop caps collision-free and typographically stable in Typst PDF
exports. Vietnamese tone marks must not shrink or lower the underlying capital,
and horizontal spacing must match the bare capital as though its diacritics were
added only after the letter was placed.

## Implementation

1. Extend the vendored `droplet` helper with optional callbacks for:
   - a separate glyph used only to calculate drop-cap scale;
   - a glyph-specific gutter applied to the complete rectangular drop-cap region.
   Existing callers retain the current behavior when these callbacks are absent.
2. Generate Typst helpers for Latin exports that:
   - map Vietnamese accented capitals to their bare sizing base;
   - preserve the original accented glyph for rendering;
   - use stable font-metric vertical edges so marks extend above or below a fixed
     base-letter position;
   - select an all-line gutter from the bare capital's measured Great Vibes
     right-side overhang, without letting high diacritics enlarge that gutter;
   - give the horned `Ơ` and `Ư` families separate horizontal metrics because
     their right-side marks occupy the same vertical band as body text;
   - separate collision clearance from optical spacing, giving `Ư` a narrower
     final gap after its horn than the unhorned `U` receives after its ink;
   - normalize exported inline text to NFC and pass only the core capital
     grapheme—not surrounding opening punctuation—to metric callbacks.
3. Update source-generation tests and add focused assertions for Vietnamese base
   mapping, base-derived clearance, and unchanged non-Latin behavior.
4. Compile and inspect A–Z and Vietnamese comparison specimens, then run focused
   Rust tests and the configured Typst smoke test when its runtime variables are
   available.

## Verification

- `I`, `Ì`, `Í`, `Ĩ`, `Ỉ`, and `Ị` render with the same base size and placement.
- `U/Ư` and their Vietnamese tone variants remain aligned within their base family.
- Accents remain attached above or below the base rather than entering its height
  calculation.
- Each accented family has the same letter-to-body spacing as its bare capital
  across lines 1–3, except `Ơ` and `Ư`, whose whole horned families use their own
  clearance. High marks may overhang into the clear space above those lines.
- `Ư` and its tone variants clear the horn without making the main `U` shape look
  detached from the body text; their post-ink optical gap is narrower than `U`'s.
- Quoted and canonically decomposed Vietnamese openings select the same metrics as
  their unquoted, precomposed equivalents.
- Existing Latin drop-cap selection and all non-Latin PDF behavior remain intact.
