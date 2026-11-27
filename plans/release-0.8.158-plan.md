# Gnosis TMS 0.8.158

1. Cover large jumps back to previously viewed rows with browser regressions for the chapter editor and Projects list. Verify the saved row and its viewport offset after leaving and returning.
2. When the destination row has yet to render, retry recording the scroll position once the virtual list has drawn its rows. Run the scroll regressions, frontend checks and release metadata checks.
3. Publish the patch through a release pull request and tag the merge on main. Verify the GitHub release notes, installers and signed updater entries for Windows, Apple Silicon and Intel Macs.
