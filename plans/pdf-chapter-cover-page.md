# Chapter cover pages in PDF exports

When the first thing in a chapter after its title (and chapter number) is a quote
or an image, that quote or image stands alone on the chapter's first page beneath
the title, and the chapter text starts on the next page. Title plus epigraph, or
title plus image, then reads as a cover page for the chapter.

## Rule

- Look past what puts nothing on the page: a leading H1 promoted to the title,
  blank rows, and footnote blocks.
- A quote opener is the run of consecutive quote blocks with their citations, so a
  multi-paragraph epigraph, or two epigraphs, stay together. Blank rows between
  quotes do not end the run; anything else visible does.
- An image opener is that one image. An image that follows it starts the next
  page, like the text.
- The rule applies only when something visible follows the opener. A chapter that
  is only a quote or only an image already has the page to itself.

## PDF (`pdf_export.rs`)

1. `chapter_cover_end` returns the last block of the cover.
2. `render_typst_chapter` emits `#pagebreak(weak: true)` before the first block
   after the cover. The check runs at the top of the loop, so citations that were
   already set inside their quote and skipped with `continue` cannot miss it.
3. A cover image is not floated. It is set in `#block(width: 100%, height: 1fr)`:
   the block gets the space left under the title float, so `gnosis-image` measures
   that space instead of the whole page and shrinks the image to fit under the
   title. (Checked with Typst 0.15.1: plain `layout` reports the full page height
   under a top float, a `1fr` block only what remains. Without the explicit width
   the block shrinks to its content and the image is no longer centred.)
4. `typst_block_emission_order` takes the cover end, so a cover image followed only
   by images keeps its place instead of joining the sorted trailing run.
5. The text after a cover opens a page of its own, so its first paragraph takes the
   drop cap, after a quote cover as after an image cover.
6. A cover quote that fits on one line is centred (`gnosis-quote(cover: true)`):
   the quote shrinks to its text in a centred box with its citation stacked under
   it, flush with the quote's right edge as on a full-width quote. Longer cover
   quotes keep the full measure.

## Book preview

`renderBookChapterPages` returns one page, or a cover page and a text page. The
composer draws each as its own sheet. Footnotes stay numbered across both and are
listed on the text page, as the single-page preview already lists all of them at
the end. A cover image shrinks to the space left under the header, as in the PDF.
Each cover quote sits in a `width: fit-content` wrapper, which centres a one-line
quote and keeps its citation at the quote's right edge without measuring lines.

## Image-cover title spacing

The title's 5.5em above and 6em below squeezed a tall cover image. Chosen: over
every image cover the title takes 2em above and 2.5em below
(`gnosis-title(tight: true)`, and the matching header rule in the preview). An
adaptive version, tightening only for tall images, was compared and not chosen.

## Drop caps sized to the paragraph

A general fix, not specific to covers. A first paragraph shorter than the
three-line cap ended beside it and left a gap above the next paragraph. Now the
cap drops as many lines as the paragraph has: three for three or more lines, two
for two, none for one. `gnosis-dropcap-lines` counts lines at the full text
width, as `gnosis-quote` measures quotes: beside the cap the lines are narrower,
so the text can only run on below the cap, never stop short of it. A two-line cap
scales its per-letter gap with the smaller letter, since the gaps were tuned for
three lines.

The book preview follows. Its HTML always carries the three-line cap, and
`project-book-dropcap.js` counts the lines on the mounted page, after both full
and scoped renders. It sets the cap inline, then compares the paragraph's height
with one- and two-line probes, as the PDF does. `data-book-dropcap-lines` then
sizes the cap: none for one line, 2.29em for two (3.9em × .587, the PDF's scale),
3.9em for three. The scoped render leaves that attribute out when it compares
the mounted page with fresh HTML, so a measured page is not rebuilt.

Measured with Great Vibes in Chromium, the preview cap sat about half a line
above the first line's cap height, where the PDF sets it flush. Its size was
right: 3.9em spans the common capitals (A, O, T) over three lines. The top margin
now lowers the ink onto the cap height (median error 0.00em with text-box trim,
−0.02em without). The bottom margin ends the float midway through the range that
sets exactly the cap's lines beside it. It is measured per layout, because trim
moves the lines up against the float. Every letter A–Y wraps two or three lines
as intended, with and without trim.

Not matched yet: the PDF gives each letter its own gap for its swash
(`gnosis-dropcap-gap`, 1.74em for T). The preview has one gap, so the T's
crossbar runs into the text beside it, as it did before.

## Citations end with the quote text

A general fix, most visible on covers. A quote is inset 1em on both sides, but its
citation was pushed back out to the column's right margin (`outdent: 1em`), where a
separate citation block used to sit. On a body page the surrounding paragraphs show
that margin, but on a cover the quote is the only text, so the citation seemed to
hang 1em past it. The centred one-line cover quote did the same: its citation ended
at the quote's padded edge, not its text.

Now every quote's citation ends where the quote text does. `gnosis-citation` drops
`outdent`, so inside a quote it stays within the quote's padding, and the centred
cover branch pads its stacked citation by the same 1em. The preview gives a
citation that follows a quote the quote's `padding-inline`. Citations of
paragraphs, and standalone citation blocks, keep the column margin, which is where
that text ends.

## Validation

- Rust unit tests for the rule; a Typst layout test that compiles quote and image
  openers and checks each one's page and that the text starts on page 2.
- Frontend unit tests for the preview split.
- Render sample PDFs and look at them.
