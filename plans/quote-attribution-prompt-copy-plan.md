# Shorten the empty attribution prompt

1. Change the visible empty Quote attribution prompt to “Enter attribution”,
   without a final period. Retain the smaller italic typography and the existing
   editing placeholder and focus behavior.
2. Update the existing renderer/browser expectations and the check that prompt
   text is never saved as attribution content.
3. Run the focused renderer and attribution browser checks. Keep the change local
   for the next combined release; do not publish or bump the version.
