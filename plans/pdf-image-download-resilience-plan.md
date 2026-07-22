# PDF Image Download Resilience

Date: 2026-07-21

## Problem

A transient remote-image failure currently aborts the entire PDF export with a
generic safety message. The message does not identify the image or distinguish
an unsafe URL from DNS, timeout, HTTP, size, or response-body failures.

The affected Gnosis VN chapter also exposed a deterministic case: Wikimedia
returns HTTP 403 to reqwest's default request because it lacks a descriptive
application `User-Agent`.

## Plan

- [x] Preserve the existing public-host validation, DNS pinning, redirect
      refusal, eight-second timeout, and 25 MB response cap.
- [x] Send an application-identifying `User-Agent` so Wikimedia and similar
      hosts accept legitimate export image requests.
- [x] Return structured remote-image download failures with safe, actionable
      user-facing reasons.
- [x] Retry once when a failure is plausibly transient (connection/timeout,
      response read, HTTP 408/429, or HTTP 5xx).
- [x] Carry the image caption and hostname into PDF preparation diagnostics.
- [x] Continue PDF generation with a visible placeholder when a remote image
      remains unavailable; local uploaded-image failures remain hard errors.
- [x] Add focused Rust tests for failure classification, retry decisions,
      image identification, and Typst placeholder rendering.
- [x] Run formatting, strict Clippy, Rust tests, and the frontend test suite.
