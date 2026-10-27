# Move the book composer's Cancel action to the header

Place Cancel beside Next on page 1 and remove the bottom footer. Give its former
height to the chapter list and preview. Keep the shared modal cancel/default
behavior and allow the header actions to wrap on narrow windows.

Update the running dev checkout and PR 384, then verify the header button
positions, footer removal, and existing export/title-editing workflows.

Completed: Cancel is immediately left of Next in the header; the footer is
removed and its height is available to the chapter list and preview. Narrow
headers can wrap their actions. The dev app is updated.

All 11 export browser workflows and 4 composer unit tests pass. Browser geometry
checks confirm the header buttons are side by side and no footer remains; the
updated screenshot was visually reviewed. ESLint and whitespace checks pass.
