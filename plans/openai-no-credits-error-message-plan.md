# OpenAI No-Credits Error Message Plan

## Goal

Show a clear, actionable message when OpenAI reports that an API account has no
credits remaining, without describing the failure as a temporary rate limit or a
broken model.

## Implementation

1. Normalize OpenAI 429 responses so explicit no-credit language and quota error
   codes produce one stable, user-facing billing message; retain detailed transient
   request/token limit messages and the safe fallback for malformed responses.
2. Classify explicit no-credit failures in AI Settings before generic quota/model
   handling. Give the modal a billing-specific title and supporting text that tells
   the user to add API credits and does not recommend changing models.
3. Apply the same display normalization to AI Assistant errors in the editor so an
   older/raw provider message and the normalized backend message produce identical,
   actionable copy.
4. Add backend and frontend regression coverage for the settings modal, assistant
   transcript, and retry-signaling behavior; run focused Rust and JavaScript tests.

