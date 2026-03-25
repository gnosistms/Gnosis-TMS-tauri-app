# Gnosis TMS Project Storage Spec

## Purpose

The canonical working format for a Gnosis TMS project is a folder-based Git-friendly project structure.

Other formats such as `.xlsx`, `.docx`, and `.txt` are import/export formats.
They are not the primary editing format.

The goals of the working format are:

- support multilingual row-based translation work
- support row metadata such as review status
- support rich text formatting
- work well with Git for collaboration and history
- avoid fragile row identity based on physical line number
- make merge conflicts land on row boundaries whenever possible

## Design Principles

1. One row is one atomic unit.
2. Row identity is stable and never depends on display order.
3. The format should be easy to diff in Git.
4. The format should be easy to validate and migrate.
5. Rich text is stored as sanitized HTML fragments.
6. Binary assets should be stored separately from row JSON when possible.
7. Git commit history is the source of truth for file creation/modification history and authorship.

## Repository Layout

One project equals one Git repository.

Recommended layout:

```text
project-repo/
  project.json
  chapters/
    01-introduction/
      chapter.json
      rowOrder.json
      rows/
        <row_id>.json
      assets/
  .gitattributes
```

Why this layout is recommended:

- Git history stays project-specific
- chapter files stay reasonably small
- merge conflicts tend to stay localized
- reordering rows affects only chapter-local metadata

## Identity and Naming Rules

The system must distinguish between stable identity and human-readable naming.

Identity must not depend on:

- display order
- folder listing order
- chapter title
- row position

### Stable IDs

Use UUIDv7 for the following:

- `project_id`
- `chapter_id`
- `row_id`

Rules:

1. IDs are created once and never reused.
2. IDs do not change when the user renames a project or chapter.
3. IDs do not change when rows are inserted, deleted, or reordered.
4. IDs are the primary keys used by the app internally.

### Human-Readable Names

These are allowed to change:

- project title
- chapter title
- optional folder slug used in directory names

These are labels, not identities.

### Chapter Folder Naming

Chapter folders should use a readable slug for convenience, but the slug is not the true identity.

Recommended pattern:

```text
chapters/
  01-introduction/
  02-chapter-title/
```

Recommended chapter metadata:

```json
{
  "chapter_id": "4c77fbcb-e381-434c-b69f-8f7a26365cd0",
  "title": "Introduction",
  "slug": "01-introduction"
}
```

Rules:

1. The app should rely on `chapter_id`, not folder name, for identity.
2. The folder name may be changed by the app if the chapter title changes.
3. Renaming a chapter folder should be treated as a normal metadata update, not as a new chapter.
4. `project.json.chapter_order` should store chapter ids, not slugs.

### Row File Naming

Row filenames are identity-bearing and should not be decorative.

Recommended pattern:

```text
rows/
  <row_id>.json
```

Rules:

1. Row filenames are derived directly from `row_id`.
2. Row filenames never change unless the row is deleted.
3. Row order is stored only in `rowOrder.json`.
4. Insert/delete/reorder operations must not rename unaffected row files.

## Project-Level File

### `project.json`

`project.json` stores metadata for the whole project repository.

Example:

```json
{
  "project_id": "ce916278-7ec8-4758-a2aa-061d5f4958a5",
  "title": "Sample Project",
  "chapter_order": [
    "4c77fbcb-e381-434c-b69f-8f7a26365cd0",
    "b59e8f6d-8940-4425-b976-2ef3d66df457"
  ],
  "settings": {
    "default_export_format": "docx"
  }
}
```

Required fields:

- `project_id`
- `title`
- `chapter_order`

Optional fields:

- `settings`

Rules:

1. `project.json` must not contain chapter content.
2. `project.json` must not duplicate row-level data.
3. `chapter_order` must contain chapter ids only.
4. Every chapter id in `chapter_order` must correspond to one chapter folder in `chapters/`.
5. Renaming a chapter title or slug must not require changing the chapter id in `chapter_order`.

## Chapter-Level Files

### `chapter.json`

Contains all chapter-level metadata, including format/version information and chapter-specific settings.

Example:

```json
{
  "format": "gtms",
  "format_version": 1,
  "appVersion": "0.1.0",
  "chapter_id": "4c77fbcb-e381-434c-b69f-8f7a26365cd0",
  "title": "Introduction",
  "slug": "01-introduction",
  "source_import": {
    "format": "xlsx",
    "path_hint": "Chapter01.xlsx"
  },
  "languages": [
    {
      "code": "es",
      "name": "Spanish",
      "role": "source"
    },
    {
      "code": "en",
      "name": "English",
      "role": "reference"
    },
    {
      "code": "vi",
      "name": "Vietnamese",
      "role": "target"
    }
  ],
  "settings": {
    "default_preview_language": "vi"
  }
}
```

Required fields:

- `format`
- `format_version`
- `appVersion`
- `chapter_id`
- `title`
- `slug`
- `languages`

Optional fields:

- `source_import`
- `settings`

Field notes:

- `format` must be `"gtms"`
- `format_version` starts at `1`
- `appVersion` is the Gnosis TMS version that last wrote the file

Rules:

1. `chapter.json` must be enough to understand the chapter without reading row files first.
2. `chapter.json` must not contain row content.
3. `chapter.json` should change only when chapter metadata changes.
4. Reordering rows must not rewrite `chapter.json`.
5. Editing row text must not rewrite `chapter.json`.

### `rowOrder.json`

Contains display order for rows.

This file exists so row identity can remain stable even when rows are inserted, deleted, or reordered.

Example:

```json
[
  "1b2f4f8a-7c4d-4b64-a6a0-5d51c470d0b1",
  "7e3df8d4-5775-4a9b-82d5-36cf53d41d10"
]
```

Rules:

1. Every id in `rowOrder.json` must correspond to an existing file in `rows/`.
2. Every row file in `rows/` must appear exactly once in `rowOrder.json`.
3. The file must contain row ids only, with no wrapper object in v1.
4. Reordering rows means rewriting only this file.
5. Editing row text must not rewrite this file.

## Row Files

Each row lives in its own JSON file under `rows/`.

The filename is the row UUIDv7:

```text
rows/<row_id>.json
```

Example:

```json
{
  "row_id": "1b2f4f8a-7c4d-4b64-a6a0-5d51c470d0b1",
  "status": {
    "review_state": "unreviewed",
    "reviewed_at": null,
    "reviewed_by": null,
    "flags": []
  },
  "origin": {
    "source_format": "xlsx",
    "source_sheet": "Sheet1",
    "source_row_number": 12
  },
  "fields": {
    "es": {
      "html": "<p>Texto de ejemplo.</p>",
      "notes_html": "",
      "image": null,
      "imagecaption_html": ""
    },
    "en": {
      "html": "<p>Example text.</p>",
      "notes_html": "",
      "image": null,
      "imagecaption_html": ""
    },
    "vi": {
      "html": "<p>Van ban vi du.</p>",
      "notes_html": "",
      "image": null,
      "imagecaption_html": ""
    }
  }
}
```

Required fields:

- `row_id`
- `status`
- `fields`

Optional fields:

- `origin`
- `timing`

### `status`

Recommended v1 shape:

```json
{
  "review_state": "unreviewed",
  "reviewed_at": null,
  "reviewed_by": null,
  "flags": []
}
```

Suggested `review_state` values:

- `unreviewed`
- `in_review`
- `reviewed`
- `approved`
- `rejected`

Suggested `flags` values:

- `glossary_checked`
- `format_checked`
- `needs_attention`
- `has_question`

### `origin`

Optional object describing where the row came from originally.

Example:

```json
{
  "source_format": "xlsx",
  "source_sheet": "Sheet1",
  "source_row_number": 12
}
```

This is import traceability metadata, not row identity.

### `timing`

Optional object for time-based media alignment metadata.

Recommended shape:

```json
{
  "start_ms": 72500,
  "end_ms": 75200
}
```

### `fields`

Required object keyed by language code.

Each key should match a language defined in `chapter.json.languages`.

Each language field object should support:

- `html`
- `notes_html`
- `image`
- `imagecaption_html`

Recommended v1 simplification:

- each row contains an entry for every language in the chapter
- `notes_html` always exists, even if empty
- `image` always exists, even if null
- `imagecaption_html` always exists, even if empty

## Rich Text Model

Each language field stores rich text in `html`.

Allowed HTML should be a controlled subset only.

Recommended allowed tags:

- `p`
- `h1`
- `h2`
- `h3`
- `strong`
- `em`
- `mark`
- `blockquote`
- `ul`
- `ol`
- `li`
- `a`
- `br`

Allowed attributes:

- for `a`: `href`

Disallowed:

- arbitrary inline styles
- scripts
- event handlers
- embedded iframes

## Image Model

Images should not be embedded directly inside the HTML fragment.

Instead, store them structurally in the field.

Example:

```json
{
  "image": {
    "type": "remote",
    "url": "https://example.com/image.jpg"
  },
  "imagecaption_html": "<p>Example caption.</p>"
}
```

## Change History Strategy

Primary history mechanism: Git.

Git is the source of truth for:

- when a file first appeared
- when a file last changed
- the recorded author/committer history of file changes

Therefore the canonical file format does not store:

- `project.json.created_at`
- `project.json.updated_at`
- `chapter.json.created_at`
- `chapter.json.updated_at`
- `row.created_at`
- `row.updated_at`
- `row.created_by`
- `row.updated_by`

## Git Workflow Compatibility

Recommended `.gitattributes`:

```text
*.json text eol=lf
assets/** binary
```

Important practice:

- keep row JSON pretty-printed and stable
- sort object keys consistently
- avoid rewriting unrelated files on save

That means:

- editing one row should only rewrite that row file
- reordering rows should only rewrite `rowOrder.json`
- changing chapter metadata should only rewrite `chapter.json`

## Insert/Delete/Reorder Semantics

### Insert Row

Insert means:

1. create a new row UUIDv7
2. create a new `rows/<row_id>.json`
3. insert the row id into `rowOrder.json`

### Delete Row

Delete means:

1. remove the row id from `rowOrder.json`
2. delete the row file

### Reorder Row

Reorder means:

1. rewrite `rowOrder.json`
2. do not rename row files
3. do not change row ids

## Import Rules

### XLSX -> GTMS

When importing `.xlsx`:

1. detect languages from the header row
2. create one row object per worksheet row
3. assign each imported row a new stable UUIDv7
4. store original sheet/row metadata in `origin`
5. save imported document into the canonical folder structure

## Export Rules

Exports are derived outputs, not the canonical save path.

### GTMS -> XLSX

- flatten fields into worksheet columns
- use current language ordering
- convert notes/image/image caption into the chosen Excel-compatible representation

### GTMS -> DOCX

- map supported HTML subset into Word paragraph/run formatting
- render the field image and image caption

### GTMS -> TXT

- strip or simplify formatting
- decide whether each language exports as its own section, columns, or per-row blocks

## Save vs Export Terminology

- `Save` means save to the canonical folder structure
- `Export` means write `.xlsx`, `.docx`, `.txt`, or other interchange formats

## Versioning and Migrations

The format must be versioned from the beginning.

Use:

- `chapter.format`
- `chapter.format_version`

Migration rule:

- readers may upgrade old versions forward
- writers should emit only the current version

## Recommended JSON Writing Rules

To stay Git-friendly:

1. Use UTF-8.
2. Use LF newlines.
3. Pretty-print with stable indentation.
4. Keep key order deterministic.
5. Do not rewrite the whole project on every save.

## Recommended V1 Decision

For the first real implementation:

- canonical working format: folder-based project structure
- history/collaboration: Git
- row identity: UUIDv7
- one row per file
- display order: `rowOrder.json`
- rich text: sanitized HTML subset
- image: structured field metadata
- row review state: built in
- import from `.xlsx`
- export later to `.xlsx`, `.docx`, `.txt`
