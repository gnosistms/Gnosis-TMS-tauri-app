# Research glossary terms from every editor language

1. Show the existing research button on every language panel, retaining the
   existing glossary-management permission check.
2. Pass the clicked panel's language into research preparation and select it
   initially. Retain the existing glossary-source checks and term-identification
   flow for researching a translated term.
3. Verify editor rendering and source/target entry points without live AI calls.

Status: complete. The existing button is shown for every editor language with
the same permission check. The clicked language is preselected in preparation.
All 41 affected editor model/render tests pass. Mocked browser checks verified
buttons for Spanish, Vietnamese, and French and correct initial selection from
each button, without live AI calls. Scoped ESLint and whitespace checks pass.
