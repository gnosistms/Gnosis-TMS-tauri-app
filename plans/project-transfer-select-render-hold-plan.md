# Project Transfer Select Render Hold Plan

## Problem

Background projects-page updates replace the open project-transfer modal. Restoring
focus after the render cannot preserve a native select popup, so the Team menu closes
while the user is choosing a destination.

## Plan

1. Extend the existing projects-page select render hold to the project-transfer Team
   and Glossary selects.
2. Flush held renders when a selection commits or the select loses focus, while
   avoiding the chapter-select safety timeout for modal selects.
3. Add unit coverage for modal-select deferral, commit handling, and timeout behavior.
4. Run the focused tests and the frontend unit suite.

