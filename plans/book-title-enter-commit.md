# Finish chapter-title edits with Enter

Chapter titles already persist on input. Enter should finish editing by blurring
the field while retaining page 1, the saved title, and the list scroll position.

1. Add declarative Enter-to-blur behavior to the shared modal keyboard controller
   and opt chapter-title inputs into it. Keep IME composition and modified Enter
   behavior under the shared controller's existing guards.
2. Verify Enter blurs, preserves the edited title and scroll, does not advance or
   export, and survives closing/reopening the export modal.
3. Keep the running dev checkout and PR 384 synchronized.

Completed using the shared controller's `data-modal-enter-blur` opt-in. Chapter
titles retain their existing immediate persistence; Return ends editing without
activating Next or exporting. No separate document keyboard handler was added.

Validation: all 9 relevant browser checks passed (shared modal keyboard behavior,
long-list focus/scroll stability, and Enter persistence/blur including the IME
guard). All 6 focused rendering/focus-style unit tests passed, as did ESLint and
whitespace checks. The code is applied in the running dev checkout and PR branch.
