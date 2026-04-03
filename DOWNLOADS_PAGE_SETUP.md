# Downloads Page Setup

This repo now contains a static GitHub Pages downloads site in [`docs/`](/Users/hans/Desktop/GnosisTMS/docs).

## What It Does

- Serves a branded downloads page for `downloads.gnosis-tms.com`
- Fetches the latest release from the GitHub Releases API
- Recommends the right installer based on browser platform detection
- Still shows manual links for:
  - Mac Apple Silicon ZIP
  - Mac Intel ZIP
  - Windows MSI
  - Windows EXE setup

## Files

- [`docs/index.html`](/Users/hans/Desktop/GnosisTMS/docs/index.html)
- [`docs/styles.css`](/Users/hans/Desktop/GnosisTMS/docs/styles.css)
- [`docs/app.js`](/Users/hans/Desktop/GnosisTMS/docs/app.js)
- [`docs/CNAME`](/Users/hans/Desktop/GnosisTMS/docs/CNAME)

## Asset Logic

The page fetches:

- `https://api.github.com/repos/gnosistms/Gnosis-TMS-tauri-app/releases/latest`

Then it matches assets by filename:

- Mac Apple Silicon ZIP: `/_aarch64\.zip$/`
- Mac Intel ZIP: `/_x64\.zip$/`
- Windows MSI: `/_x64_en-US\.msi$/`
- Windows EXE setup: `/_x64-setup\.exe$/`

This avoids hard-coding a release version into the page.

## GitHub Pages Settings

In GitHub:

1. Open the repo: `gnosistms/Gnosis-TMS-tauri-app`
2. Go to `Settings`
3. Go to `Pages`
4. Set:
   - `Build and deployment` → `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/docs`
5. Save

If GitHub Pages is already configured, keep it on `main` + `/docs`.

## DNS

For `downloads.gnosis-tms.com`, add a DNS `CNAME` record pointing to:

- `gnosistms.github.io`

After DNS is live, GitHub Pages should pick up the custom domain from [`docs/CNAME`](/Users/hans/Desktop/GnosisTMS/docs/CNAME).

## Caveats

- Browser architecture detection is imperfect on some Mac browsers, especially Safari.
- When the browser cannot confidently tell Apple Silicon vs Intel, the page shows both Mac downloads and asks the user to choose.
- Mac downloads are ZIP files on purpose, because the ZIP preserves the custom DMG file icon better than a direct GitHub-downloaded DMG.
