# Editor Media Leftover Gaps Plan

Three gaps left after the editor audio/video work
(`plans/editor-audio-video-media-plan.md`), found during the 2026-11-04 wording
audit.

## 1. Change view draws audio and video as a broken image

"Changed after my last edit" crosses out the previous value with an `<img>`,
so a previous YouTube/Vimeo link, audio link or uploaded MP3 is a broken image.

- `editor-media-tile.js`: split the tile's face (audio icon and file name, or
  the video poster) out of `renderEditorMediaTile`, with an option to leave out
  the play badge.
- `editor-change-view.js`: `previousImageView` carries the image and its
  derived media. A previous audio or video value renders as the media tile,
  crossed out, not clickable and without the play badge. An uploaded MP3 needs
  no address (the tile shows only its name), so it is still shown when the
  backend has no data URL for it. No Rust change.

## 2. The invalid-file modal names the real reason

`saveUploadedEditorImage` shows one message for every failure. Before the file
is read, its name, type and size decide whether it is refused outright:

| Reason | Example | What the modal says to do |
|---|---|---|
| `video` | .mp4, .mov, `video/*` | Put it online and insert it by URL |
| `unsupported-audio` | .ogg, .flac, .aac, `audio/*` | Convert to MP3, M4A or WAV |
| `too-large` | over 25 MB | Make it smaller, or put it on WordPress and insert it by URL |

- New `editor-upload-refusal.js` holds the classification.
- `state.js`: the modal state gains `reason` and `fileName`.
- `editor-image-flow.js`: refuse before reading, for picked and dropped files
  and for native dropped paths (before the backend reads the file, so a large
  video gets the video message, not the size one).
- `editor-image-invalid-file-modal.js`: a message per reason. A file that is
  read and fails the contents check keeps today's message.

## 3. Expected upload errors are not telemetry

`runtime.js` treats "not a valid supported image" as an expected user error.
Add the upload validator's audio and extension-mismatch messages from
`images.rs` to the same filter, without rewording any of them.

## Tests

- `editor-change-view.test.js`: previous video link, uploaded MP3 without a
  data URL, and audio link with caption render as crossed-out tiles.
- `editor-upload-refusal.test.js`, `editor-image-flow.test.js`,
  `editor-image-invalid-file-modal.test.js`: each reason, from picked file and
  dropped path to the message shown.
- `runtime.test.js`: each validator message is expected; other command
  failures are still reported.
