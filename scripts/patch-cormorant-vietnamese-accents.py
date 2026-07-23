"""Make Cormorant Garamond's standalone Vietnamese accents match its stacked ones.

Usage:
    python3 scripts/patch-cormorant-vietnamese-accents.py \
        CormorantGaramond[wght].ttf out.ttf "Cormorant Garamond Gnosis"

Needs fonttools (pip install fonttools); it is not a dependency of the app itself.
Upstream file: google/fonts @ 3dd78844021e948ceb633d1dcee3f7885561b5d9,
ofl/cormorantgaramond/CormorantGaramond[wght].ttf


The font draws each accent twice: a compact version used when marks stack, and a
tall display version used when the accent stands alone. Vietnamese uses both forms
constantly, so the two collide inside a single line — `Tâm` renders with a tall
spike while `Tầm` renders flat, and `à` carries a grave 2.4x taller than the one in
`ầ`. This script replaces every tall standalone accent with the font's own compact
one.

  circumflex  â ậ ê ệ ô ộ        <- ầ ề ồ      (13 -> 13 points)
  grave       à è ì ò ù ỳ ờ ừ   <- ầ           (10 -> 15 points)
  acute       á é í ó ú ý ớ ứ   <- ấ           (10 -> 15 points)

The tilde is already identical in both forms. The hook differs between them but its
standalone form reads correctly as drawn, so it is left alone by choice. Uppercase
needs no change either: its circumflex already matches, and its grave and acute are
wider than the stacked pair but exactly the same height.

Each donor contour is translated so its horizontal centre and its lowest point land
where the replaced accent's did, which keeps the gap above the letter unchanged.
Where the point count shifts, the glyph's gvar deltas are rebuilt from the two
sources so the patch holds across the whole wght axis rather than one instance.
"""

import array
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

BASE_OF = {"a": "a", "e": "e", "o": "o"}

# (targets, donor, which accent of the donor)
JOBS = [
    ("â ậ", "ầ", "lower"),
    ("ê ệ", "ề", "lower"),
    ("ô ộ", "ồ", "lower"),
    ("à è ì ò ù ỳ ờ ừ", "ầ", "upper"),
    ("á é í ó ú ý ớ ứ", "ấ", "upper"),
]
DONOR_BASE = {"ầ": "a", "ấ": "a", "ề": "e", "ồ": "o"}


def contours(glyf, glyph):
    glyph.expand(glyf)
    out, start = [], 0
    for end in glyph.endPtsOfContours:
        xs = [glyph.coordinates[i][0] for i in range(start, end + 1)]
        ys = [glyph.coordinates[i][1] for i in range(start, end + 1)]
        out.append({"start": start, "end": end, "n": end - start + 1,
                    "xmin": min(xs), "xmax": max(xs), "ymin": min(ys), "ymax": max(ys)})
        start = end + 1
    return out


def patch(src, dst, family):
    # recalcTimestamp would stamp head.modified with the current time on save,
    # making the output differ on every run. The app pins this file's sha256.
    font = TTFont(src, recalcTimestamp=False)
    glyf, cmap, gvar = font["glyf"], font.getBestCmap(), font["gvar"]
    report = []

    # gvar decompiles lazily and reads point counts from glyf, so it has to be fully
    # materialised before any outline below changes length
    for name in list(gvar.variations.keys()):
        gvar.variations[name]

    for targets, donor_ch, which in JOBS:
        dname = cmap[ord(donor_ch)]
        dglyph = glyf[dname]
        base = glyf[cmap[ord(DONOR_BASE[donor_ch])]]
        base.expand(glyf)
        base_top = max(y for _, y in base.coordinates)
        accents = sorted((c for c in contours(glyf, dglyph) if c["ymin"] > base_top - 20),
                         key=lambda c: c["ymin"])
        donor = accents[0] if which == "lower" else accents[-1]
        dvars = gvar.variations.get(dname, [])

        for target_ch in targets.split():
            tname = cmap[ord(target_ch)]
            tglyph = glyf[tname]
            # the accent of a single-mark glyph is always its topmost contour
            mark = max(contours(glyf, tglyph), key=lambda c: c["ymin"])

            # integer shift, so the transplanted outline stays bit-identical to the donor
            dx = round((mark["xmin"] + mark["xmax"]) / 2 - (donor["xmin"] + donor["xmax"]) / 2)
            dy = round(mark["ymin"] - donor["ymin"])
            moved = [(dglyph.coordinates[i][0] + dx, dglyph.coordinates[i][1] + dy)
                     for i in range(donor["start"], donor["end"] + 1)]
            dflags = [dglyph.flags[i] for i in range(donor["start"], donor["end"] + 1)]

            head, tail = mark["start"], mark["end"] + 1
            n_points = len(tglyph.coordinates)
            coords = (list(tglyph.coordinates)[:head] + [(round(x), round(y)) for x, y in moved]
                      + list(tglyph.coordinates)[tail:])
            flags = list(tglyph.flags)[:head] + dflags + list(tglyph.flags)[tail:]

            tglyph.coordinates = GlyphCoordinates(coords)
            tglyph.flags = array.array("B", flags)
            # only the replaced contour changed length, so shift the ends after it
            new_ends, shift = [], donor["n"] - mark["n"]
            for end in tglyph.endPtsOfContours:
                new_ends.append(end + shift if end >= mark["end"] else end)
            tglyph.endPtsOfContours = new_ends
            tglyph.numberOfContours = len(new_ends)
            tglyph.recalcBounds(glyf)

            for tv in gvar.variations.get(tname, []):
                dv = next((d for d in dvars if d.axes == tv.axes), None)
                if dv is None:
                    sys.exit(f"no matching variation tuple for {target_ch}")
                donor_deltas = dv.coordinates[donor["start"]:donor["end"] + 1]
                tv.coordinates = (tv.coordinates[:head] + donor_deltas
                                  + tv.coordinates[tail:n_points]
                                  + tv.coordinates[n_points:n_points + 4])

            report.append(f"  {target_ch} <- {donor_ch}: {mark['n']}pt "
                          f"{mark['xmax']-mark['xmin']:.0f}x{mark['ymax']-mark['ymin']:.0f}"
                          f"  ->  {donor['n']}pt "
                          f"{donor['xmax']-donor['xmin']:.0f}x{donor['ymax']-donor['ymin']:.0f}")

    for rec in font["name"].names:
        if rec.nameID in (1, 3, 4, 6, 16):
            value = (str(rec).replace("Cormorant Garamond", family)
                     .replace("CormorantGaramond", family.replace(" ", "")))
            font["name"].setName(value, rec.nameID, rec.platformID, rec.platEncID, rec.langID)

    font.save(dst)
    return report


# ---------------------------------------------------------------------------
# Phase 2: uppercase stacked accents sit too close to the circumflex below them.
# Give the uppercase pair the same circumflex-to-tone offset the lowercase pair has.
# Both marks are drawn at identical sizes in the two cases, so only the offset moves.
# ---------------------------------------------------------------------------

STACKS = [("Ầ", "ầ", "A", "a"), ("Ấ", "ấ", "A", "a"),
          ("Ề", "ề", "E", "e"), ("Ế", "ế", "E", "e"),
          ("Ồ", "ồ", "O", "o"), ("Ố", "ố", "O", "o"),
          # Consistency audit finding H: the uppercase hook sat ~15u closer to the
          # circumflex than the lowercase one (ẩ/ể/ổ). Grave and acute already get
          # this treatment above; extend it to the hook for the same reason.
          ("Ẩ", "ẩ", "A", "a"), ("Ể", "ể", "E", "e"), ("Ổ", "ổ", "O", "o")]


def stack_offset(font, ch, base):
    """(dx, dy) from the circumflex's lower-left to the tone mark's lower-left."""
    glyf, cmap = font["glyf"], font.getBestCmap()
    bglyph = glyf[cmap[ord(base)]]
    bglyph.expand(glyf)
    base_top = max(y for _, y in bglyph.coordinates)
    accents = [c for c in contours(glyf, glyf[cmap[ord(ch)]]) if c["ymin"] > base_top - 20]
    accents.sort(key=lambda c: c["ymin"])
    circ, tone = accents[0], accents[-1]
    return tone["xmin"] - circ["xmin"], tone["ymin"] - circ["ymin"]


def align_uppercase_stacks(font, max_wght):
    from fontTools.varLib import instancer

    glyf, cmap, gvar = font["glyf"], font.getBestCmap(), font["gvar"]
    report = []

    # the same measurement at the axis maximum, so the correction can vary with weight
    peak = instancer.instantiateVariableFont(TTFont(SRC_PATH[0]), {"wght": max_wght})

    for up, low, ubase, lbase in STACKS:
        d_def = tuple(a - b for a, b in zip(stack_offset(font, low, lbase),
                                           stack_offset(font, up, ubase)))
        d_peak = tuple(a - b for a, b in zip(stack_offset(peak, low, lbase),
                                            stack_offset(peak, up, ubase)))

        gname = cmap[ord(up)]
        glyph = glyf[gname]
        bglyph = glyf[cmap[ord(ubase)]]
        bglyph.expand(glyf)
        base_top = max(y for _, y in bglyph.coordinates)
        accents = [c for c in contours(glyf, glyph) if c["ymin"] > base_top - 20]
        tone = max(accents, key=lambda c: c["ymin"])

        coords = list(glyph.coordinates)
        for i in range(tone["start"], tone["end"] + 1):
            coords[i] = (coords[i][0] + round(d_def[0]), coords[i][1] + round(d_def[1]))
        glyph.coordinates = GlyphCoordinates(coords)
        glyph.recalcBounds(glyf)

        # instance@peak = default + delta, so the delta absorbs the difference
        adj = (round(d_peak[0] - d_def[0]), round(d_peak[1] - d_def[1]))
        for tv in gvar.variations.get(gname, []):
            for i in range(tone["start"], tone["end"] + 1):
                dxy = tv.coordinates[i]
                if dxy is not None:
                    tv.coordinates[i] = (dxy[0] + adj[0], dxy[1] + adj[1])

        report.append(f"  {up}: tone mark moved ({round(d_def[0])}, {round(d_def[1])}) at the "
                      f"default master, {adj} more at weight {max_wght:.0f}")
    return report


SRC_PATH = []

if __name__ == "__main__":
    SRC_PATH.append(sys.argv[1])
    for line in patch(sys.argv[1], sys.argv[2], sys.argv[3]):
        print(line)

    font = TTFont(sys.argv[2], recalcTimestamp=False)
    for name in list(font["gvar"].variations.keys()):
        font["gvar"].variations[name]
    print()
    for line in align_uppercase_stacks(font, font["fvar"].axes[0].maxValue):
        print(line)
    font.save(sys.argv[2])
    print(f"\nsaved {sys.argv[2]}")
