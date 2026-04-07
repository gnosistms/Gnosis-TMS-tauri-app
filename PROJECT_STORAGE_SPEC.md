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
5. Rich text must preserve editable structure, not just flattened markup.
6. Binary assets should be stored separately from row JSON when possible.
7. Git commit history is the source of truth for file creation/modification history and authorship.
8. The core row schema must stay format-agnostic, with sparse `format_metadata` for format-specific data.
9. File-level and package-level metadata must be preserved separately from unit-level metadata.
10. The canonical schema must support non-string pass-through values when a source format mixes text and non-text resources.

## Repository Layout

One project equals one Git repository.

Recommended layout:

```text
project-repo/
  project.json
  chapters/
    01-introduction/
      chapter.json
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
  "slug": "01-introduction",
  "lifecycle": {
    "state": "active"
  }
}
```

Rules:

1. The app should rely on `chapter_id`, not folder name, for identity.
2. The folder name may be changed by the app if the chapter title changes.
3. Renaming a chapter folder should be treated as a normal metadata update, not as a new chapter.
4. Project-level file membership should not be stored in `project.json`; it should be derived by scanning `chapters/*/chapter.json`.

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
3. Row order is stored on each row file in `structure.order_key`.
4. Insert/delete/reorder operations must not rename unaffected row files.

## Project-Level File

### `project.json`

`project.json` stores metadata for the whole project repository.

Example:

```json
{
  "project_id": "ce916278-7ec8-4758-a2aa-061d5f4958a5",
  "title": "Sample Project",
  "lifecycle": {
    "state": "active"
  },
  "settings": {
    "default_export_format": "docx"
  }
}
```

Required fields:

- `project_id`
- `title`
- `lifecycle`

Optional fields:

- `settings`

Rules:

1. `project.json` must not contain chapter content.
2. `project.json` must not duplicate row-level data.
3. `lifecycle.state` should be one of:
   - `active`
   - `deleted`
4. `project.json` must contain only project-level metadata.
5. `project.json` must not store file/chapter membership, deleted-file lists, or file-level lifecycle state.
6. The app should derive the project’s file list by scanning `chapters/*/chapter.json`.
7. Renaming, deleting, or restoring one file must not require rewriting `project.json`.

## Chapter-Level Files

## File/Chapter Mapping

In the current GTMS model, one imported file normally maps to one chapter.

That means:

- a user-visible "file" row in the app is backed by one chapter folder in the canonical storage format
- file soft-delete is implemented as chapter soft-delete
- file restore is implemented as chapter restore
- file permanent delete is implemented as physical chapter deletion

This mapping is intentionally simple for v1 so spreadsheet-style imports and future file-based imports can share one lifecycle model.

The file list for a project should be derived by scanning the chapter folders in `chapters/`.
File active/deleted state should be derived from each chapter’s own `chapter.json.lifecycle.state`.

If a future source format needs one uploaded file to map to multiple chapters, that should introduce a higher-level document object rather than changing the meaning of chapter ids retroactively.

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
  "lifecycle": {
    "state": "active"
  },
  "source_files": [
    {
      "file_id": "source-001",
      "format": "xlsx",
      "path_hint": "Chapter01.xlsx",
      "filename_template": "Chapter01.%LANG_ISO%.xlsx",
      "file_metadata": {
        "source_locale": "es",
        "target_locales": [
          "en",
          "vi"
        ],
        "header_blob": null,
        "root_language": null,
        "wrapper_name": null,
        "serialization_hints": {}
      }
    }
  ],
  "package_assets": [],
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
- `lifecycle`
- `languages`

Optional fields:

- `source_files`
- `package_assets`
- `settings`

Field notes:

- `format` must be `"gtms"`
- `format_version` starts at `1`
- `appVersion` is the Gnosis TMS version that last wrote the file
- `lifecycle.state` should be one of:
  - `active`
  - `deleted`
  - reserved for future states such as `archived`

Rules:

1. `chapter.json` must be enough to understand the chapter without reading row files first.
2. `chapter.json` must not contain row content.
3. `chapter.json` should change only when chapter metadata changes.
4. Reordering rows must not rewrite `chapter.json`.
5. Editing row text must not rewrite `chapter.json`.
6. `source_files[]` should preserve file-level metadata needed for faithful export.
7. `package_assets[]` should preserve bundle/package context for formats such as XCLOC, DOCX, PPTX, and IDML.
8. `lifecycle.state` is the source of truth for whether a file/chapter is active or deleted.
9. Soft-delete and restore operations must not rewrite row files.

### Row Ordering

Display order is derived by scanning `rows/*.json`, reading `structure.order_key` from each row file, and sorting rows in memory by:

1. `structure.order_key`
2. `row_id` as a deterministic tie-breaker

Rules:

1. There must be no committed chapter-wide row order file in v1.
2. `structure.order_key` is a per-row lexicographic rank key, not a contiguous integer index.
3. New imported rows should receive sparse keys with large gaps so later inserts can usually be done by rewriting only the new row.
4. If two rows end up with the same `order_key` after merge, the app should still sort deterministically using `row_id`.
5. If a local area runs out of key space between neighbors, the app may rebalance a bounded contiguous set of nearby row files.

## Row Files

Each row lives in its own JSON file under `rows/`.

Although the repository layout calls these `rows`, each file actually stores one generic translation unit.
That unit may come from a spreadsheet row, a subtitle cue, a software localization key, or a rich-text document fragment.

The filename is the row UUIDv7:

```text
rows/<row_id>.json
```

Example:

```json
{
  "row_id": "1b2f4f8a-7c4d-4b64-a6a0-5d51c470d0b1",
  "unit_type": "string",
  "external_id": "welcome_message",
  "guidance": {
    "description": "Shown on the home screen welcome banner.",
    "context": "HomeScreen",
    "comments": [
      {
        "kind": "developer",
        "text": "Keep this short."
      }
    ],
    "source_references": []
  },
  "status": {
    "review_state": "unreviewed",
    "reviewed_at": null,
    "reviewed_by": null,
    "flags": []
  },
  "structure": {
    "source_file": "Chapter01.%LANG_ISO%.xlsx",
    "container_path": {
      "sheet": "Sheet1",
      "row": 12,
      "column_group": "main"
    },
    "order_key": "00000000000000010000000000000000",
    "group_context": null
  },
  "origin": {
    "source_format": "xlsx",
    "source_sheet": "Sheet1",
    "source_row_number": 12
  },
  "format_state": {
    "translatable": true,
    "character_limit": null,
    "tags": [],
    "source_state": null,
    "custom_attributes": {}
  },
  "placeholders": [],
  "variants": [],
  "fields": {
    "es": {
      "value_kind": "text",
      "plain_text": "Texto de ejemplo.",
      "rich_text": {
        "blocks": [
          {
            "type": "paragraph",
            "runs": [
              {
                "text": "Texto de ejemplo.",
                "marks": []
              }
            ]
          }
        ]
      },
      "html_preview": "<p>Texto de ejemplo.</p>",
      "notes_html": "",
      "attachments": [],
      "passthrough_value": null
    },
    "en": {
      "value_kind": "text",
      "plain_text": "Example text.",
      "rich_text": {
        "blocks": [
          {
            "type": "paragraph",
            "runs": [
              {
                "text": "Example text.",
                "marks": []
              }
            ]
          }
        ]
      },
      "html_preview": "<p>Example text.</p>",
      "notes_html": "",
      "attachments": [],
      "passthrough_value": null
    },
    "vi": {
      "value_kind": "text",
      "plain_text": "Van ban vi du.",
      "rich_text": {
        "blocks": [
          {
            "type": "paragraph",
            "runs": [
              {
                "text": "Van ban vi du.",
                "marks": []
              }
            ]
          }
        ]
      },
      "html_preview": "<p>Van ban vi du.</p>",
      "notes_html": "",
      "attachments": [],
      "passthrough_value": null
    }
  },
  "format_metadata": {
    "xlsx": {
      "source_sheet": "Sheet1",
      "source_row_number": 12
    }
  }
}
```

Required fields:

- `row_id`
- `unit_type`
- `status`
- `structure`
- `fields`

Optional fields:

- `external_id`
- `guidance`
- `origin`
- `format_state`
- `timing`
- `placeholders`
- `variants`
- `format_metadata`

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

### `guidance`

Optional first-class translator guidance and source commentary.

Example:

```json
{
  "description": "Shown on the home screen welcome banner.",
  "context": "HomeScreen",
  "comments": [
    {
      "kind": "developer",
      "text": "Keep this short."
    }
  ],
  "source_references": [
    "src/home.tsx:48"
  ]
}
```

Use this instead of hiding important cross-format guidance inside `format_metadata`.

It must be able to represent:

- descriptions
- semantic context
- translator/developer comments
- note threads or note-like entries
- source references such as Gettext `#:`

### `unit_type`

Required value describing the logical kind of translation unit.

Suggested values:

- `string`
- `plural`
- `array_item`
- `subtitle_cue`
- `document_block`
- `table_cell`
- `rich_text_fragment`

### `structure`

Required object describing where the unit belongs in the source material.

Example:

```json
{
  "source_file": "main.%LANG_ISO%.json",
  "container_path": {
    "json_path": [
      "home",
      "welcome"
    ]
  },
  "order_key": "00000000000000010000000000000000",
  "group_context": "HomeScreen"
}
```

This is the core location metadata used to reconstruct source files.

It must be flexible enough to represent:

- filename binding
- nested key path
- worksheet / row / column
- slide / shape / paragraph / run path
- subtitle cue order
- XLIFF / Qt / Gettext context groupings
- package-relative asset paths

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

### `format_state`

Optional normalized workflow/status metadata imported from source formats.

Example:

```json
{
  "translatable": true,
  "character_limit": 42,
  "tags": [
    "ios",
    "onboarding"
  ],
  "source_state": "translated",
  "custom_attributes": {
    "datatype": "html"
  }
}
```

Use this for cross-format flags such as:

- XLIFF target state
- Gettext fuzzy / reviewed state
- XCStrings extraction or review state
- Android `formatted="false"`
- arbitrary exporter/importer attributes that should round-trip

### `timing`

Optional object for time-based media alignment metadata.

Recommended shape:

```json
{
  "cue_index": 18,
  "start_ms": 72500,
  "end_ms": 75200,
  "position": {
    "x1": null,
    "x2": null,
    "y1": null,
    "y2": null
  }
}
```

### `placeholders`

Optional ordered list describing placeholders embedded in the text.

Example:

```json
[
  {
    "name": "username",
    "syntax": "%s",
    "kind": "printf",
    "ordinal": 0,
    "example": "Alice",
    "description": null
  }
]
```

This must support:

- printf-style placeholders
- ICU/select placeholders
- ARB placeholder metadata
- raw/literal placeholders for software strings

### `variants`

Optional list of variant branches for pluralization and other dimension-based variants.

Example:

```json
[
  {
    "dimensions": {
      "plural": "one",
      "device": null,
      "platform": null,
      "gender": null,
      "width": null
    },
    "field_overrides": {
      "en": {
        "value_kind": "text",
        "plain_text": "1 file",
        "rich_text": null,
        "html_preview": null,
        "notes_html": "",
        "attachments": [],
        "passthrough_value": null
      }
    }
  }
]
```

This must support:

- plural forms
- device variants
- platform variants
- gender / select branches
- width or presentation variants

### `fields`

Required object keyed by language code.

Each key should match a language defined in `chapter.json.languages`.

Each language field object should support:

- `value_kind`
- `plain_text`
- `rich_text`
- `html_preview`
- `notes_html`
- `attachments`
- `passthrough_value`

Recommended v1 simplification:

- each row contains an entry for every language in the chapter
- `value_kind` always exists and defaults to `text`
- `plain_text` always exists, even if empty
- `rich_text` may be null for formats that are truly plain text
- `html_preview` is optional derived data, not the sole canonical representation
- `notes_html` always exists, even if empty
- `attachments` always exists, even if empty
- `passthrough_value` exists for non-text or mixed-type source formats

### `format_metadata`

Optional sparse object keyed by source format family.

Example:

```json
{
  "xliff": {
    "notes": [
      {
        "value": "User welcome",
        "from": "description",
        "priority": "1"
      }
    ],
    "context_groups": [
      {
        "purpose": "location",
        "contexts": [
          {
            "context_type": "sourcefile",
            "value": "app/app.component.ts"
          }
        ]
      }
    ]
  }
}
```

This is where source-format-specific metadata belongs when it does not justify a first-class core field.

`format_metadata` should be sparse and format-keyed.
Do not use it as a dumping ground for metadata that is common across many formats.

## Rich Text Model

Rich text must be stored as editable structured content, not only as flattened HTML.

Recommended model:

- `rich_text.blocks[]`
- each block has a `type`
- each block contains `runs[]`
- each run contains `text` plus `marks[]`

Suggested block types:

- `paragraph`
- `heading`
- `blockquote`
- `list_item`
- `table_cell`

Suggested run marks:

- `strong`
- `em`
- `underline`
- `link`
- `code`
- `highlight`
- `line_break`

`html_preview` may be stored as a convenience for preview/export, but it should be derived from `rich_text` where possible.

This design is required so formats such as DOCX, HTML, IDML, PPTX, and subtitle markup can preserve translator-visible formatting boundaries.

## Attachment Model

Binary or media-related material should not be embedded directly inside text strings.

Instead, store attachments structurally in the field.

Example:

```json
[
  {
    "type": "image",
    "storage": "remote",
    "url": "https://example.com/image.jpg",
    "caption_rich_text": {
      "blocks": [
        {
          "type": "paragraph",
          "runs": [
            {
              "text": "Example caption.",
              "marks": []
            }
          ]
        }
      ]
    }
  }
]
```

## File-Level And Package-Level Metadata

Some formats need metadata that belongs to a source file or package, not to a single unit.

Examples:

- Gettext header blobs
- XLIFF source/target locale and original-resource metadata
- XCStrings file version and source language
- YAML root language
- JavaScript/PHP wrapper variable names
- XCLOC bundle manifests and contextual assets

Therefore `chapter.json.source_files[]` should support:

- `file_id`
- `format`
- `path_hint`
- `filename_template`
- `file_metadata`

And `chapter.json.package_assets[]` should support:

- `asset_id`
- `type`
- `path`
- `scope`
- `metadata`

## Non-String Pass-Through Values

Some supported formats can carry values that are not simple strings.

Examples:

- `.plist`
- `.resx`
- package manifests

The canonical model should therefore support:

- `value_kind`
  Suggested values:
  `text | number | boolean | date | binary | object | array | null`
- `passthrough_value`

If a value is not translatable text, the importer may preserve it as pass-through data rather than forcing it into `plain_text`.

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
- reordering one row should normally rewrite only the moved row file
- changing chapter metadata should only rewrite `chapter.json`

## Insert/Delete/Reorder Semantics

### Insert Row

Insert means:

1. create a new row UUIDv7
2. create a new `rows/<row_id>.json`
3. assign a `structure.order_key` that sorts between the previous and next row

### Delete Row

Delete means:

1. delete the row file

### Reorder Row

Reorder means:

1. rewrite the moved row's `structure.order_key`
2. if there is no available space between adjacent keys, rebalance a bounded nearby run of row files
3. do not rename row files
4. do not change row ids

## Chapter/File Lifecycle Semantics

In the current storage model, one imported file normally maps to one chapter.
Therefore soft-delete for an uploaded file is modeled as soft-delete for the corresponding chapter.

Soft-delete must preserve the chapter folder and its row files.
It is a reversible lifecycle change, not physical deletion.

### Soft-Delete Chapter/File

Soft-delete means:

1. keep the chapter folder in `chapters/`
2. keep `chapter.json` and all row files unchanged except for lifecycle metadata
3. set `chapter.json.lifecycle.state` to `deleted`
4. do not rewrite `project.json`
5. exclude the deleted chapter from normal active views and default exports

Soft-delete must not:

- rename the chapter folder
- move the chapter to a trash folder
- rewrite unaffected row files
- add tombstone flags to every row

### Restore Chapter/File

Restore means:

1. keep the chapter folder in place
2. set `chapter.json.lifecycle.state` back to `active`
3. do not rewrite `project.json`

Restore must not rewrite row files.

## Team-Scoped Permission Note

Permissions are managed at the team level, not per project and not per file.

That means:

- if a user can perform an action on files, that ability comes from their role in the parent team
- every project in a team inherits the same file-action permissions
- every file/chapter in every project in that team inherits the same file-action permissions

For the current file/chapter lifecycle rules, the intended UI behavior is:

- all team members can import files
- all team members can rename files
- all team members can soft-delete files
- all team members can restore soft-deleted files
- only team owners can permanently delete files

These permission rules are application behavior and should not be encoded inside `project.json`, `chapter.json`, or row files.

## Import Rules

### Any Supported Format -> GTMS

When importing any supported source format:

1. assign each imported unit a new stable UUIDv7
2. preserve the native identifier in `external_id` when one exists
3. preserve location data in `structure`
4. preserve workflow/status/flags in `format_state`
5. preserve placeholders, variants, comments, and context
6. preserve source-format-only data in `format_metadata`
7. store text as `plain_text` plus `rich_text` when formatting exists
8. preserve file-level metadata in `source_files[]`
9. preserve package/bundle assets in `package_assets[]` when relevant
10. save imported content into the canonical folder structure

### XLSX -> GTMS

When importing `.xlsx`:

1. detect languages from the header row
2. create one row object per worksheet row
3. store original sheet/row metadata in `origin` and `structure`
4. preserve description/comment columns as `guidance`

### DOCX / HTML / IDML / PPTX -> GTMS

When importing rich-text document formats:

1. preserve paragraph/block order in `structure.order_key`
2. preserve formatting as `rich_text`
3. derive `plain_text` for search and fallback export
4. preserve style/layout anchors in `structure` and `format_metadata`
5. preserve package/media references at file or chapter level when needed

### SRT -> GTMS

When importing subtitle formats:

1. create one row per subtitle cue
2. preserve cue order in `timing.cue_index`
3. preserve start/end times in `timing`
4. preserve cue positioning in `timing.position` when present

### Software Localization Formats -> GTMS

When importing software strings:

1. preserve key names in `external_id`
2. preserve file binding in `structure.source_file`
3. preserve nested path or context in `structure`
4. preserve placeholders and variants
5. preserve comments, tags, state, and custom attributes
6. preserve file-level wrapper/header metadata in `source_files[]`

## Export Rules

Exports are derived outputs, not the canonical save path.

### GTMS -> XLSX

- flatten fields into worksheet columns
- use current language ordering
- convert notes and attachments into the chosen Excel-compatible representation

### GTMS -> DOCX

- map `rich_text` blocks/runs into Word paragraph/run formatting
- render attachments and captions where supported

### GTMS -> TXT

- strip or simplify formatting
- decide whether each language exports as its own section, columns, or per-row blocks

### GTMS -> Software Localization Formats

- reconstruct key identity from `external_id`
- reconstruct file placement from `structure`
- reconstruct plurals and variants from `variants`
- reconstruct placeholders and source-format attributes from `placeholders`, `format_state`, and `format_metadata`
- reconstruct comments/context from `guidance`
- reconstruct file/package metadata from `source_files[]` and `package_assets[]`

## Save vs Export Terminology

- `Save` means save to the canonical folder structure
- `Export` means write `.xlsx`, `.docx`, `.txt`, or other interchange formats

## Glossary Repository Format

Glossaries should use the same Git-first philosophy as projects:

- one glossary equals one Git repository
- one term equals one JSON file
- there is no committed term index file
- the app loads the whole glossary into memory in order to build search and matcher structures

Recommended layout:

```text
glossary-repo/
  glossary.json
  terms/
    <term_id>.json
  .gitattributes
```

Why this layout is recommended:

- adding one term creates one file
- editing one term rewrites one file
- deleting one term rewrites or removes one file
- no shared term list needs to be merged
- Git conflicts stay localized to individual terms whenever possible

### `glossary.json`

`glossary.json` stores only glossary-level metadata.

Example:

```json
{
  "glossary_id": "2ec8d9e8-52e2-4c84-bb56-a7765e0cb5de",
  "title": "Gnosis ES-EN",
  "lifecycle": {
    "state": "active"
  },
  "languages": {
    "source": {
      "code": "es",
      "name": "Spanish"
    },
    "target": {
      "code": "en",
      "name": "English"
    }
  }
}
```

Required fields:

- `glossary_id`
- `title`
- `lifecycle`
- `languages.source`
- `languages.target`

Rules:

1. `glossary.json` must not contain term content.
2. `glossary.json` must not store a committed list of term ids.
3. The app should derive glossary membership by scanning `terms/*.json`.
4. Renaming a glossary must rewrite only `glossary.json`.
5. Adding, editing, deleting, or restoring one term must not require rewriting `glossary.json`.

### Term Files

Each term lives in its own JSON file under `terms/`.

Recommended pattern:

```text
terms/<term_id>.json
```

Example:

```json
{
  "term_id": "cfdfd77b-cf1a-4fe7-81d7-f8c7612e33b7",
  "source_terms": [
    "Akasha"
  ],
  "target_terms": [
    "Akasha"
  ],
  "notes_to_translators": "",
  "footnote": "",
  "untranslated": true,
  "lifecycle": {
    "state": "active"
  }
}
```

Required fields:

- `term_id`
- `source_terms`
- `target_terms`
- `notes_to_translators`
- `footnote`
- `untranslated`
- `lifecycle`

Rules:

1. `term_id` should be a UUIDv7.
2. `source_terms[]` stores one or more accepted source-language spellings.
3. `target_terms[]` stores one or more accepted target-language spellings.
4. `notes_to_translators` is internal guidance for translators and editors.
5. `footnote` stores explanatory text that may later be inserted into a published book as a footnote.
6. `untranslated = true` means the term should remain untranslated in the target language.
7. If `untranslated = true`, the app may fall back to `source_terms[]` when building in-memory matchers, but `target_terms[]` should still be preserved when available.
8. Term add/edit/delete operations should touch only the relevant term file.
9. There must be no committed glossary-wide term index in v1.

### Glossary Sync Rules

1. Creating a new glossary should create a new repo in the org.
2. Importing a glossary from file should also create a new repo in the org.
3. The app should clone the glossary repo locally before editing it.
4. Local glossary edits should:
   - save the changed file to disk
   - create a local Git commit
   - pull and push asynchronously afterward
5. The app should load glossary terms from disk and build search/matcher structures in memory instead of relying on a committed index.

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
- display order: per-row `structure.order_key`
- rich text: structured blocks/runs with optional derived `html_preview`
- attachments: structured field metadata
- first-class translator guidance: `guidance`
- row review state: built in
- file-level metadata: preserved from day 1
- package/bundle assets: supported in chapter metadata from day 1
- pass-through non-text values: supported from day 1
- placeholders / variants / context / state: supported in the row schema from day 1
- `format_metadata`: sparse format-specific bag from day 1
- import from `.xlsx`
- export later to `.xlsx`, `.docx`, `.txt`, subtitle, and software localization formats
- glossary repos should use one-file-per-term with no committed index
