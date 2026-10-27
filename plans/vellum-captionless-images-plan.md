# Vellum images from WordPress URLs

## Status

Implemented fixes for two image metadata defects found using the reported chapter. Automated checks pass. Live comparison verified in Vellum 4.1.4: the original affected-chapter export omitted the images; the corrected export displays both images with their captions removed. The confirmed defects concern URL filenames and downloaded image types; Media Library captions are not required for the corrected export.

## Affected content

- Book: Tâm Lý Học Cho Sự Thay Đổi Triệt Để; chapter text begins “CHIẾC THANG KỲ DIỆU”.
- Repository: Gnosis-VN/revolutionary-psychology.
- Chapter ID: `019edb6e-b077-7e70-bf2e-1066ad5227ba`; folder: `tam-ly-hoc-cach-mang-0-2`.
- Examined chapter tree: `e10aa002d3f6f0de89c62dd8c6ca574c7acfb025`. The local August 24 copy had no images. Read changed JSON blobs from GitHub into a temporary directory; did not modify live TMS data.
- The current Vietnamese chapter has two WordPress CDN images, both with TMS captions: Jacob's ladder and the time/spiritual-level diagram.

## Reproduced defects and changes

1. `fileNameFromPath` treated a URL's query parameters as part of its filename. The chapter's `?w=1538&ssl=1` and `?resize=1536%2C1131&ssl=1` suffixes prevented extension-based type detection; native preparation returned an empty UTI for each image. The JS builder now derives filenames from URL pathnames, decodes escaped names, and preserves the full source URL for downloads. Filesystem paths retain their existing handling.
2. The ladder URL ends in `.webp`, but its response contains JPEG bytes. Native preparation now derives PNG/JPEG/GIF/WebP file types and extensions from the downloaded bytes, overriding stale filename/type hints. Matching extensions (including `.jpeg`) remain unchanged, and unrecognized formats retain existing fallback behavior.

The corrected native preparation produces `…Hoet.jpg` / `public.jpeg` and `…tam-linh.png` / `public.png`. SHA-256 checks confirm both image files contain the exact same bytes as the original downloads; no conversion or quality loss is introduced.

## Verification

- New URL-filename regression failed before the JS fix and passes afterward. Cases cover WordPress query parameters, fragment identifiers, encoded filenames, and captions present/empty.
- 2,021 app tests pass, including export flow, preview, and Vellum archives.
- All 17 workflow checks pass outside the sandbox. The first sandboxed attempt could not start the launcher tests' child server (four failures).
- Native Vellum suite: 7 passed, 1 ignored global clipboard smoke test. Tests used an isolated temporary directory so they did not clear the pending live sample's images.
- HTML import suite: 13 passed, including five captionless WordPress layouts.
- Targeted JS lint and diff whitespace checks pass.
- Unused-code audit remains nonzero for files/imports/exports outside these changes: existing bench/launcher scripts, update-browser-test imports, and `ensureEditorFootnoteEntry`.

## Live Vellum tests

- Vellum 4.1.4 is installed. macOS denies System Events UI automation (-1743), so the user performs Paste and supplies screenshots.
- Initial controlled fixture: three copies of a 640 × 420 PNG with caption present, empty, and absent. All three appear in Vellum. Follow-up screenshot confirms warnings concern insufficient resolution and missing accessibility descriptions, not missing images.
- Actual chapter baseline: built from the current remote Vietnamese rows using the original production code and placed on the clipboard. The user confirms that the images do not appear, reproducing the reported failure.
- Corrected exports are ready, including a version with captions removed only in the test payload. The corrected captionless version was placed on the clipboard and pasted by the user, who confirmed: “I see the images now.” Both actual chapter images therefore load without captions.

Probe artifacts:
- Initial fixture: `/private/tmp/gnosis-vellum-caption-probe/`.
- Actual chapter: `/private/tmp/gnosis-vellum-chapter-probe/`.
- Original archive: `clipboard-before.json`; fixed archive: `clipboard-fixed.json`; fixed captionless archive: `clipboard-fixed-captionless.json`.
- Updated temporary native probe executable: `vellum_caption_probe_fixed`. It calls the production resource-preparation and clipboard-writing functions directly. The temporary source example was removed from the repository.
- Fixed resources use an isolated `fixed-temp` directory. Do not run default native resource preparation until the baseline paste is completed: it clears the baseline's Vellum temporary files.

Verification complete. Changes remain in the working tree; no commit, packaged build, or release was made as part of this investigation.

## Review follow-up: filename collisions

Review reproduced an image overwrite after URL filename decoding: `figure.png`, `figure.png`, and `figure%202.png` produce two outputs named `figure 2.png`. The allocator counted requested names but did not reserve generated names.

1. Extend the existing native resource-preparation test with distinct image bytes, duplicate names, existing numeric suffixes, case variants, and a filename that collides after format correction. Reuse the existing test to avoid parallel tests clearing the same temporary directory.
2. Reserve every allocated filename and retry occupied suffixes, retaining per-name counters so repeated allocations do not rescan every earlier suffix.
3. Run the regression before/after, then the native Vellum suite in an isolated temporary directory, and check the scoped diff.

Follow-up completed: the allocator now reserves both original and generated names, checks every candidate for collisions, and resumes from the previous suffix count. The extended seven-image preparation regression failed before the change because image 2's bytes were overwritten; it now verifies distinct filenames and exact bytes in both preserved and process files. Coverage includes duplicate names, numeric suffixes occupied before and after generation, ASCII case variants, and collisions introduced by format correction. Final native Vellum suite: 7 passed, 1 intentional clipboard smoke skip. Rust formatting and diff whitespace checks pass. Live clipboard contents and existing paste resources were left untouched by using an isolated test temporary directory.
