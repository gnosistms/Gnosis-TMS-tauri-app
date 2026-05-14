# AI Secondary Row Text Plan

## Summary

- AI Translate and AI Review treat main text, footnotes, and image captions as separate row sections.
- Model output must be structured so secondary text never leaks into main text.
- The assistant Translate button auto-applies when the target main translation is empty.

## Key Changes

- Use structured output internally for editor AI Translate and AI Review responses. Do not accept a response where a footnote or image caption is appended to the main text.
- Translation response shape:
  - `translatedText`
  - `translatedFootnote`
  - `translatedImageCaption`
- Review response shape:
  - `suggestedText`
  - `suggestedFootnote`
  - `suggestedImageCaption`
  - `reviewed`
- Prompts request JSON with explicit section fields. Empty or unchanged sections are represented by empty strings, not omitted prose.
- Apply logic writes each section through existing content kinds:
  - main text: `"field"`
  - footnote: `"footnote"`
  - image caption: `"image-caption"`

## Backend Implementation

- Extend `src-tauri/src/ai/types.rs`:
  - `AiTranslationRequest` gains optional/defaulted `sourceFootnote`, `sourceImageCaption`, `targetFootnote`, and `targetImageCaption` strings.
  - `AiTranslationResponse` gains defaulted `translatedFootnote` and `translatedImageCaption` strings.
  - `AiReviewRequest` gains defaulted `footnote` and `imageCaption` strings for the language being reviewed, plus optional source-language `sourceFootnote` and `sourceImageCaption` for meaning review.
  - `AiReviewResponse` gains defaulted `suggestedFootnote` and `suggestedImageCaption` strings.
- Add a structured translation parser in `src-tauri/src/ai/mod.rs`, similar to the existing review parser:
  - Parse JSON with `translatedText`, `translatedFootnote`, and `translatedImageCaption`.
  - Reject malformed sectioned translation responses with a clear error instead of falling back to concatenated text.
  - Keep response fields as empty strings when the matching source section is absent or not requested.
- Add or reuse an AI output format for sectioned translation JSON:
  - Prefer a dedicated enum variant such as `TranslationSectionsJson`.
  - In `src-tauri/src/ai/providers/openai.rs`, map it to a strict schema with required string fields.
  - Non-OpenAI providers can receive the same prompt/JSON instruction path used by existing structured review modes.
- Update `build_translation_prompt`:
  - Include `<source_text>`, `<source_footnote>`, and `<source_image_caption>` sections only for sections that should be translated.
  - State that the model must return JSON only and must keep each translated section in its matching response field.
  - Include target secondary sections as context only when needed to explain why they should not be overwritten.
- Update `build_review_prompt`:
  - Grammar review reviews the target language's main text, footnote, and image caption without comparing accuracy against the source.
  - Meaning review compares all target sections against source main text, source footnote, source image caption, row context, glossary hints, and history.
  - Decision rule: `reviewed: true` only when every reviewed section is acceptable; otherwise return corrections only in the section fields that need changes.
- Extend `apply_gtms_editor_ai_review_result` in `src-tauri/src/project_import/chapter_editor`:
  - Input gains `suggestedFootnote` and `suggestedImageCaption`.
  - Persist main text, footnote, and image caption in one row-file commit.
  - Response returns updated `text`, `footnote`, and `imageCaption` so the UI can update all local row maps.

## Assistant Translate Behavior

- The assistant Translate button currently appears only when the target main text is empty; keep that rule.
- After the AI response returns, if the target main text is still empty and the request is still current, apply the draft immediately.
- Auto-apply writes main text and any eligible empty target footnote/image caption sections.
- If the target text changed while the AI request was running, do not auto-apply; keep the draft visible for manual review.
- Log the result in the assistant transcript as an applied translation, not as a pending draft.

## Frontend Implementation

- Update `src-ui/app/editor-ai-translate-flow.js`:
  - `buildEditorAiTranslateContext` reads source and target values from `fields`, `footnotes`, and `imageCaptions`.
  - Request payload includes secondary source sections only when the source section is non-empty and the target section is empty.
  - Source-current checks compare all requested source sections, not only main text.
  - Apply mode writes returned section values through `updateEditorRowFieldValue(rowId, targetLanguageCode, value, contentKind)`.
  - Draft mode stores sectioned draft fields and either auto-applies them or leaves them visible depending on the target-current check.
- Update assistant draft state/rendering:
  - Extend draft items with `draftTranslationFootnote` and `draftTranslationImageCaption`.
  - Normalize persisted assistant items so old drafts without those fields still load.
  - Render sectioned draft blocks in `src-ui/screens/translate-sidebar.js`, with labels for footnote and image caption only when present.
  - `applyEditorAssistantDraft` applies all sectioned draft fields, preserving existing non-empty target secondary sections.
- Update `src-ui/app/editor-ai-review-request.js`:
  - Add helpers to read `row.footnotes[languageCode]` and `row.imageCaptions[languageCode]`.
  - Include reviewed-language secondary sections for both grammar and meaning review.
  - Include source-language secondary sections for meaning review.
  - Build row-window context with secondary sections when useful, while keeping prompts compact.
- Update `src-ui/app/editor-ai-review-state.js`:
  - Track source snapshots for main text, footnote, and image caption.
  - Track `suggestedFootnote` and `suggestedImageCaption`.
  - Stale detection should invalidate a review result if any reviewed section changed after the request.
  - `showSuggestion` should become true when any suggested section differs from the current matching section.
- Update `src-ui/app/editor-ai-review-flow.js`:
  - Treat a row as reviewable if any reviewed section has text.
  - Apply sectioned suggestions through content kinds and persist the row once.
  - Keep the "looks good" state only when the structured response says all sections are reviewed.
- Update `src-ui/screens/translate-sidebar.js`:
  - Show AI Review suggestions by section.
  - Diff each suggested section against its matching current section.
  - The Apply button applies all visible section corrections together.

## Batch Behavior

- AI Translate All includes rows where source main text, source footnote, or source image caption needs translation into an empty target section.
- AI Review All includes rows where the reviewed language has any non-empty section: main text, footnote, or image caption.
- Review markers remain per language, not per section.

## Batch Implementation

- Update `src-ui/app/editor-ai-translate-all-flow.js`:
  - Work items should be created when at least one target section is empty and its matching source section is non-empty.
  - A row with existing target main text can still be included for footnote-only or caption-only translation.
  - Progress counts should still count one row/language work item, not one count per section.
- Update `src-ui/app/editor-ai-review-all-flow.js`:
  - `reviewableTranslationRows` should include rows with non-empty main text, footnote, or image caption.
  - `applyReviewResultToRow` should update `fields`, `footnotes`, and `imageCaptions`, plus the persisted maps returned by the backend.
  - Review All should send sectioned request payloads and save sectioned results through the extended backend command.
- Preserve the existing preflight behavior for already-reviewed rows. A reviewed marker still means the language cell is reviewed as a whole.

## Compatibility and Migration

- All new request/response fields are defaulted strings so existing stored assistant data and older call sites do not break.
- Old assistant draft items without sectioned draft fields should normalize to empty strings.
- Existing row persistence already has `footnotes` and `imageCaptions` maps, so no data migration is needed.
- Existing target secondary text is not overwritten by AI Translate. AI Review can replace secondary text only when applying a review suggestion.

## Test Plan

- Rust tests:
  - Translation prompt includes source footnote/image caption sections and demands JSON fields.
  - Translation parser accepts valid sectioned JSON and rejects malformed/non-JSON sectioned output.
  - Review prompt includes reviewed-language footnote/image caption sections for grammar review.
  - Meaning review prompt includes source and target secondary sections.
  - `apply_gtms_editor_ai_review_result` persists suggested main text, footnote, and image caption in one commit.
- JS tests:
  - AI Translate request payloads include only eligible secondary source sections.
  - AI Translate apply writes returned sections with correct content kinds.
  - Assistant Translate auto-applies when the target main text is still empty.
  - Assistant Translate leaves a manual draft when target text changes in flight.
  - AI Review request builder includes main text, footnote, and image caption.
  - AI Review state marks suggestions stale when any reviewed section changes.
  - AI Review rendering and Apply handle sectioned suggestions.
  - AI Translate All includes footnote-only and caption-only work.
  - AI Review All includes footnote-only and caption-only rows.
- Run focused node tests, focused Rust tests, and `npm run build`.

## Implementation Order

1. Add backend structured request/response fields and parsers.
2. Update frontend request builders and state models to carry sectioned data.
3. Update single-row translate/review apply paths.
4. Update assistant transcript rendering and auto-apply behavior.
5. Update Translate All and Review All batch flows.
6. Add focused tests as each layer is changed, then run the full build.

## Working File Process

- Treat this file as the source of truth for this planning thread.
- Future planning changes should update this file first, then summarize the change in chat.
