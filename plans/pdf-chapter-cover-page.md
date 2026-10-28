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

## Validation

- Rust unit tests for the rule; a Typst layout test that compiles quote and image
  openers and checks each one's page and that the text starts on page 2.
- Frontend unit tests for the preview split.
- Render sample PDFs and look at them.
