## Icon Workflow

`iconComposer.icon` is the source-of-truth design file created in Apple Icon Composer.

Tauri does not consume Icon Composer `.icon` bundles directly for desktop packaging. Its macOS bundle expects `icon.icns`, and the Tauri icon generator accepts a square PNG or SVG source.

Correct workflow for this repo:

1. Update `iconComposer.icon` in Icon Composer.
2. Export a flattened `1024x1024` PNG from Icon Composer to `iconComposerExports/iconComposer-iOS-Default-1024x1024@1x.png`.
3. Run `npm run icons:sync`.

The sync script regenerates `icon.icns`, `icon.ico`, and the desktop PNGs from the flattened export. It also refuses to run if the Icon Composer bundle is newer than the exported PNG, so the generated Tauri assets cannot silently drift behind the real design source.
