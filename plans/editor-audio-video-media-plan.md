# Editor Audio and Video Media Plan

## Goal

Let translators put audio and video into a row through the existing image
buttons, so media from a WordPress media library (and YouTube, Vimeo or
VideoPress) can sit in a Gnosis TMS document with a caption, just like an image.

## Decisions (from Hans, 2026-11-03)

- Reuse the two image buttons. Tooltips become **"Insert image, audio, or video
  by URL"** and **"Upload image or audio"**.
- Upload accepts audio as **.mp3, .m4a, .wav**. Video cannot be uploaded.
- The upload cap stays **25 MB** for audio too. Longer recordings go to
  WordPress first and get inserted by URL.
- "WordPress video" means **both** video files in the media library (.mp4,
  .m4v, .mov, .webm) **and** VideoPress links.
- Video in the row is a **thumbnail with a play badge**. Clicking it opens a
  larger player overlay, the same way clicking an image opens the big view.
- Audio in the row is an **audio-file icon** (open-source SVG icon library),
  not an image. Clicking it opens an audio player overlay.
- Audio and video keep the **caption** field. A WordPress media-library file
  fills its caption automatically when the library has one, as images do now.
- Exports: **embed** where the format can embed, **link** where it can only
  link, and **plain-text URL** where it can do neither.

## Defaults I am taking (say if you want otherwise)

- The toolbar button labels stay `img url` and `img ↑`; only tooltips change.
- A URL counts as audio when it ends in .mp3, .m4a or .wav, the same three
  formats as upload.
- A video file URL counts as video from any site, not only WordPress sites.
  This covers the media library without needing to prove a site is WordPress.
- YouTube and Vimeo captions do not fill in automatically. (A later step could
  offer the video title from oEmbed.)
- Icons come from **Lucide** (ISC license), inlined as SVG like the toolbar's
  existing icons: `file-audio` for audio, `play` for the video badge.
- The audio player has play/pause, a seek bar with elapsed and total time,
  10-second back/forward and a speed choice (1×, 1.25×, 1.5×, 2×), with the
  caption under it. Closing the overlay stops playback.

## Data model: derive the media kind, store nothing new

The stored row value stays `{ kind: "url", url }` or `{ kind: "upload", path }`.
Whether it is an image, audio or video is derived from the URL or the uploaded
file's extension:

| Media | Recognized by |
|---|---|
| Audio | `.mp3`, `.m4a`, `.wav` URL or uploaded path |
| YouTube | `youtube.com/watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `youtube-nocookie.com` |
| Vimeo | `vimeo.com/<id>`, `player.vimeo.com/video/<id>` |
| VideoPress | `videopress.com/v/<guid>`, `video.wordpress.com/v/<guid>` or `/embed/<guid>` |
| Video file | `.mp4`, `.m4v`, `.mov`, `.webm` URL |
| Image | everything else (today's behavior) |

Why derive instead of adding a `mediaType` field: older app versions
deserialize `StoredFieldImage` without that field and would drop it the next
time they save the row. Deriving keeps every row readable and preserved by
older versions. Those versions will show audio and video as a broken image
until the teammate updates, which is acceptable.

The detection lives in one JS module (`editor-media-kind.js`) and one Rust
module (`chapter_editor/media_kind.rs`). Both test against one shared fixture,
`tests/fixtures/editor-media-kind/cases.json`, so they cannot drift.

## Steps (one commit each)

1. **Media kind + CSP.** Add the two detection modules and the shared fixture.
   Add `media-src 'self' blob: asset: http://asset.localhost https: http:` and
   a `frame-src` for `youtube-nocookie.com`, `youtube.com`, `player.vimeo.com`,
   `video.wordpress.com` and `videopress.com` to both `csp` and `devCsp` in
   `tauri.conf.json`.
2. **Export safety guard.** Before any UI ships, make every export path skip
   audio and video wherever it would download or decode an image (PDF image
   cache, EPUB, DOCX, Markdown bundling, WordPress image upload, chapter-cover
   detection). Today a `.mp3` URL would fail as "could not include image".
3. **URL insert + row preview.** Tooltips and the URL field placeholder and
   errors. URL validation by kind: images still load-test; audio checks
   metadata through an `<audio>` element; YouTube/Vimeo/VideoPress need a
   parseable id. Row tiles in `editor-row-render.js`:
   - audio: the Lucide icon plus the file name, as a button;
   - video: the thumbnail with a play badge. YouTube uses
     `i.ytimg.com/vi/<id>/hqdefault.jpg`. Vimeo and VideoPress use the
     `thumbnail_url` from their oEmbed endpoints, fetched by a small Rust
     command and cached for the session. Video files show their first frame
     from `<video preload="metadata">`, or a film icon if that fails.
   Context-menu wording follows the kind ("Remove audio", "Copy video URL").
   Duplicate-to-language and the reuse warning work as they do for images.
4. **Player overlays.** Extend the image preview overlay state with the media
   kind. The audio overlay is the player described above. The video overlay is
   a 16:9 frame: `<iframe>` for YouTube (`youtube-nocookie.com/embed`), Vimeo
   and VideoPress, `<video controls>` for files, plus an "Open in browser"
   link. Both follow `events/modal-dialog.js` rules (Escape, backdrop, focus).
5. **Audio upload.** Add `.mp3,.m4a,.wav` and their MIME types to the picker's
   accept list and to drag-and-drop. In Rust, add magic-byte detection: MP3
   (`ID3` or an MPEG frame sync), M4A (`ftyp` with an `M4A `/`mp42`/`isom`
   brand, checked so it can never be mistaken for AVIF) and WAV
   (`RIFF....WAVE`). The extension must match the contents, as it must for
   images. The 25 MB limit is unchanged.
6. **WordPress captions.** `wordpress_media_lookup` sends
   `media_type=audio` or `media_type=video` for those kinds and skips the
   image-only resize and `-scaled` suffix handling. VideoPress, YouTube and
   Vimeo links skip the lookup. The spinner text names the kind.
7. **Exports.**

   | Format | Audio | YouTube / Vimeo / VideoPress | Video file |
   |---|---|---|---|
   | WordPress | `wp:audio` block; uploaded audio goes to the media library first, like uploaded images | `wp:embed` block | `wp:video` block |
   | HTML | `<audio controls>`; uploaded audio as a data URL, like uploaded images | `<iframe>` player | `<video controls>` |
   | EPUB | uploaded audio bundled with `<audio controls>`; remote audio linked | linked | linked |
   | PDF book | icon + caption + clickable URL | same | same |
   | DOCX, RTF, Vellum | hyperlink paragraph with the caption | same | same |
   | Markdown | link; uploaded audio bundled beside the file, like book images | link | link |
   | TXT, XLSX | caption and the URL as plain text | same | same |

   Uploaded audio has no public address, so the link-only formats show its
   caption and file name as text. The in-app book preview and editor preview
   show the same icon or thumbnail tile as the row. Media never becomes a
   chapter's opening cover image.
8. **Tests.** The shared media-kind fixture in `npm test` and `cargo test`;
   Rust tests for the new magic bytes, WordPress lookup parameters and each
   export format; row-render and overlay unit tests; one Playwright test that
   inserts an audio URL, opens the player and closes it.

## Risk to check first

YouTube now refuses embeds from pages that send no http(s) `Referer`
("Error 153"). The packaged macOS app runs at `tauri://localhost`, which sends
none, while `npm run tauri:dev` runs at `http://localhost:1431`, which does.
A YouTube embed can therefore work in dev and fail in the release build.
Step 4 must be checked in a packaged build. If YouTube refuses there, the
video overlay shows the thumbnail and an "Open on YouTube" button that opens
the system browser, and the HTML and WordPress exports are unaffected.

## Working copy

`pdf_export.rs` and `project-book-chapter-preview.js` have uncommitted edits
from other work in the main checkout. Build this in its own worktree so those
edits are neither picked up nor overwritten.
