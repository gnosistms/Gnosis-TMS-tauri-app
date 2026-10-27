# GPT-6 Astra model picker

Recognize `gpt-6-astra` when returned by OpenAI's models API, preserving the
existing two-version shortlist and saved model selections.

1. Add Astra to backend model family parsing and ordering.
2. Recognize Astra as a flagship in frontend model selection.
3. Verify shortlist inclusion, default selection, and saved-selection preservation
   with focused Rust and frontend regression tests.

API model ID verified against https://developers.openai.com/api/docs/models/gpt-6-astra.
No API credentials or live inference calls are needed for this picker change.

Status: complete. Backend filtering and frontend flagship selection recognize
Astra. Saved choices remain intact when the model list refreshes.

Validation: all 21 OpenAI provider Rust tests and 100 focused frontend tests
passed. Rust formatting and diff whitespace checks passed; targeted ESLint had
no errors (two existing unused-variable warnings). Live API access was not tested.
