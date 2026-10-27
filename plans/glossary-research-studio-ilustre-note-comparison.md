# Ilustre usage-note comparison

Compare the current saved ilustre entry with the previously proposed compact entry using the existing subscription-only Codex lab transport. Do not change the live study, glossary, app, or existing lab procedure.

1. Freeze the current saved entry, all 57 paragraphs and their source neighbors, four original 15/15/15/12 batches, production translation instructions, model, and code hashes. Compact notes: 16 words for distinguished and 16 for enlighten, with the redundant shared note removed. Candidate text/order and source evidence stay identical. Keep the current surface-form repetition in both conditions.
2. Reuse lab.mjs's actual checkpointed call implementation: ChatGPT login required, credential environment variables removed, ephemeral sessions, tools disabled, usage receipts retained. Run two independent repetitions of each condition, sequentially, alternating/reversing order across batches to reduce order effects. Low reasoning, gpt-6.1-sol. Record actual input, cached input, output tokens and wall time separately from judging.
3. Blind paired source-based quality review of all 114 paragraph pairs, including both verb cases, descendant versus noble birth, moral neutrality, honorifics and metonymic bones. Calibrate the reviewer with known semantic faults and acceptable alternatives. Independently confirm claimed material differences; inspect those and difficult cases manually. Do not grade compliance with the long notes as accuracy.
4. Report note-size and whole-request savings separately, paired timing variability, actual accuracy consequences and uncertainty. Codex subscription execution timing is not native app API timing. Preserve complete requests, outputs, usage, blind mappings and report in an ignored dedicated run directory, with reproducible launch scripts alongside the lab.

The comparison changes both candidate notes and removes the shared note; results concern that combined shortening, not an isolated distinguished-note edit. This is a small, word-specific experiment and cannot establish universal safe note lengths.

## Follow-up: prompt-only token measurement

Use the four saved native Gnosis final-validation promptText values, rather than Codex usage totals or the lab's prompt projection. Verify their notes and source rows against the frozen comparison. Replace only the glossary_info block for the compact version, retaining all other bytes. Count both with a tokenizer empirically validated against saved native usage (the gpt-6.1-sol alias is not mapped by tiktoken 0.14.0), excluding CLI instructions and provider framing. Record prompt, glossary and notes-only counts separately; compare against saved native usage as a check. No new AI calls or live data changes. Save the reproducible counter and an addendum to the experiment report.

Completed: 22,171 → 20,515 native prompt-body tokens, 1,656 saved (7.47%) over four batches/57 paragraphs. Every paired batch saves 414 tokens. o200k_base explains all four old native receipts with exactly 73 fixed framing tokens each. No model calls or live data changes.
