// QA term writes are synchronous and gated one-at-a-time by the editor modal, so a simple
// in-flight counter is sufficient. (Glossary uses the write-intent coordinator because its
// editor has background sync; QA's save path does not race a background sync — see
// plans/frontend-tier3-mirror-merge-plan.md.)
let activeQaListTermWriteCount = 0;

export function anyQaTermWriteIsActive() {
  return activeQaListTermWriteCount > 0;
}

export function beginQaTermWrite() {
  activeQaListTermWriteCount += 1;
}

export function endQaTermWrite() {
  activeQaListTermWriteCount = Math.max(0, activeQaListTermWriteCount - 1);
}

export function qaListTermWriteIsActive() {
  return anyQaTermWriteIsActive();
}

export function resetQaTermWriteCoordinator() {
  activeQaListTermWriteCount = 0;
}
