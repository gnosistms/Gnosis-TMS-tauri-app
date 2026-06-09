# Top-Level State Collapse Plan

## Goal

Collapse the mirrored glossary and QA list top-level state modules into one generic
`repo-resource/top-level-state.js` factory while preserving the existing public
exports and signatures.

## Steps

1. Extract the shared top-level state engine with descriptor hooks for state fields,
   query keys, normalization/sorting, query snapshot creation, persistence,
   reconciliation, query application, and repo sync support.
2. Convert glossary and QA list top-level modules to thin adapters, keeping QA-only
   rollback/resource-id helpers outside the generic engine.
3. Apply the normalize-first preserve-create de-drift for both domains and run the
   focused resource tests plus the full frontend test suite.
