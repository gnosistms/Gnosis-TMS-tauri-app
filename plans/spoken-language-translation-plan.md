# Natural translation of spoken language (and subtitle rows)

## Problem

AI Translate renders spoken-language words literally. In the Gnosis VN
Subtitles chapter "A Nurse's Near-Death Experience" (982 SRT rows), the
speaker's agreement-seeking "right?" became "đúng không?" / "phải không?" /
"bạn hiểu không?" 43 times, "you know" became "bạn biết đấy" 22 times, and
"um" became "Ừm" 33 times — the speaker sounds as if she were quizzing the
audience. Two causes:

1. The translate prompts say only "Translate … from X to Y". With no
   permission to do otherwise, the model accounts for every source word
   (e.g. "we just got off work, right?" → "vừa tan ca mà, đúng không?": it
   found the natural particle "mà" and still added the literal tag).
2. SRT imports make one row per caption line, so phrases are cut across rows
   ("…moments where, you" / "know, I did something great"), and each row has
   to carry its own half of the phrase.

A translation brief per file was considered and rejected: files mix registers
(a literary book quoting a conversation), and the model can recognize spoken
language by itself once allowed to translate it as a translator would.

## Experiment (gpt-6.1-sol, the Gnosis VN translate model, 2026-10-06)

The app's exact batch prompt (Responses API, strict batch schema, default
reasoning effort), two runs per version, 150 rows per source:

| Source → target | Literal carry-overs | A: current prompt | B: may reflow across rows | C: reflow + register rule |
|---|---|---|---|---|
| EN → VI (nurse) | tags + "bạn biết đấy" + "Ừm" | 28 / 28 | 13 / 20 | 0 / 0 |
| FR → VI (interview) | "euh" → "Ờ" | 31 / 31 | — | 2 / 2 |
| ES → VI (interview) | hesitations / repeated words / tags | 25 / 16 / 6–8 | — | 10–12 / 3–4 / 2 |
| ZH → VI (conversation) | hesitations | 5 | — | 3–4 |

Reflow alone fixed only the phrases split across rows; agreement tags inside
one row and every hesitation survived. The register rule removed them. A rule
that names English examples ("right?", "you know", …) and one that only
describes what such words do performed the same on English, so the
language-neutral wording is used. Residual hits were checked by hand and are
correct (real questions that got an answer, one-word listener backchannels,
natural English "right?" in VI → EN). On Spanish book passages (Q&A,
lectures, *Las Tres Montañas*), students' real questions survived and
literary prose stayed literary.

## Design

### Register rule — every translate prompt (Rust, `src-tauri/src/ai/mod.rs`)

`translation_register_rule()` is pushed after the output rule in both
`build_translation_prompt` (single row) and `build_translation_batch_prompt`
(Translate All, derived-glossary pivot batches):

> Translate as a skilled human translator would: into natural target-language
> text, in the register of each passage of the source. A literary passage
> stays literary; quoted or spontaneous speech stays speech.
>
> Spontaneous speech contains words that manage the conversation rather than
> add content: tags that invite the listener's agreement, fillers that hold
> the speaker's turn or soften a statement, hesitation sounds, and words
> repeated in false starts. Every language has its own, and they rarely match
> word for word. Render what each one does the way a native speaker of the
> target language would, or leave it out. Never turn one into a literal
> question or statement the speaker did not mean.

Review prompts are unchanged.

### Subtitle rule — batch prompt, subtitle chapters only

`AiTranslationBatchRequest` gains `subtitle_cues: bool` (`#[serde(default)]`,
camelCase `subtitleCues`). When true, `subtitle_cue_rule()` is pushed before
the register rule:

> These rows are consecutive subtitle cues from one video. A sentence often
> begins in one row and continues in the next, so translate the passage as one
> continuous text, then divide your translation across the same rows. Keep each
> row roughly aligned with the part of the source it covers, but you may move
> words between neighbouring rows in <rows_to_translate> so that each sentence
> reads naturally in the target language; a row's translation does not have to
> contain every word of that row's source. Every row still gets its own
> non-empty translation, and no row's translation moves into another row's
> entry. The rows in <context_before> and <context_after> are translated
> separately: do not move words into or out of them, and translate everything
> said in <rows_to_translate> within those rows.

> Caption markup stays in its own row: a speaker-change marker such as ">>"
> stays at the start of its row, and sound tags such as [music] stay in their
> row.

The last three sentences were added after code review (blank cues, row shifts,
and words lost or doubled at batch edges). Re-run on gpt-6.1-sol with the same
150-row passages, two runs each: no blank or shifted rows; no phrase lost or
doubled at the 12 internal batch edges checked; filler counts unchanged within
run-to-run noise (EN 0 tags; FR "euh" 2–3; one ZH "你知道吗" rendered
literally in one of two runs). Without the markup sentence the model dropped
">>" speaker markers (kept 35 and 24 of 44); with it, 44 of 44 in both runs.

The single-row prompt never gets it (one row has no neighbours to reflow into).

### Review counterpart

`AiReviewBatchRequest` gains the same `subtitle_cues` flag. Meaning-mode batch
review of adjacent cues gets `subtitle_cue_review_rule()`, which tells the
reviewer to read each row with its neighbours and not to report moved words as
omissions or additions or move them back. Review All chunks subtitle chapters
into stretches of adjacent cues (default 15 rows) so neighbours are in view.
Single-row review is unchanged: it has no neighbouring rows to read.

### Frontend (`editor-ai-batch-request.js`, `editor-ai-translate-all-flow.js`)

- A chapter is a subtitle chapter when `chapterHasSrtSourceFormat(sourceFormats)`
  (the same test that shows the timing column).
- Subtitle chapters chunk with `SUBTITLE_AI_BATCH_MAX_ROWS = 30` (the size
  tested) and a new chunker option `continuesBatch(previousItem, item)` that
  splits a batch wherever the rows are not adjacent in the chapter. Translate
  All skips rows that already have a translation, so without this a batch
  could join cues from both sides of a gap and the model would move words
  across it.
- `buildTranslateBatchRequest` sets `subtitleCues: true` only when the
  request's rows are adjacent cues (`rowIdsAreAdjacentCues`).
- A row is a cue when it has SRT base timing (`rowIsSubtitleCue`), so in a
  chapter mixing an SRT with another source file, the other file's rows
  separate the cues around them. Adjacency is position among non-deleted rows,
  so a deleted cue between two rows does not break a batch. The helpers live in
  `editor-ai-batch-request.js`, shared with Review All.
- A subtitle-cue response is applied whole or not at all. If any row is
  missing, or comes back blank while its source has text, nothing is applied
  and the whole stretch is retried once on the batch path; a failed call gets
  the same retry; only then does the stretch fall to single rows. Applying the
  rest and retrying one row would translate words the model moved into its
  neighbours twice.
- When a cue changes mid-flight (source edited, target filled), its
  neighbours in the response are not applied either and stay for the next
  run, since their translations may carry words moved from it.

## Tests

- Rust: single and batch prompts contain the register rule; the batch prompt
  contains the subtitle rule only when `subtitle_cues` is set; requests
  without the field deserialize with it false.
- Rust: the review batch prompt carries the review rule only in meaning mode
  with `subtitle_cues`.
- JS: chunker splits on `continuesBatch`; Translate All on an SRT chapter
  sends `subtitleCues: true`, batches up to 30 rows, splits at an
  already-translated row and at a row without timing, applies none of an
  incomplete or blank response and retries the stretch, retries a failed call
  on the batch path, and leaves the neighbours of a mid-flight edit alone; a
  non-SRT chapter sends no flag and keeps 15-row batches. The review request
  is flagged only for adjacent cues in meaning mode.

## Out of scope

- A per-file read-ahead pass for speaker relationships (Vietnamese pronouns).
  gpt-6.1-sol already chose "con" for a mother speaking to her child, so it is
  not needed for this fix.
- Team conventions the prompt cannot know (e.g. Gnosis VN refers to Samael
  Aun Weor as "thầy"; the test translations used "tôi").
