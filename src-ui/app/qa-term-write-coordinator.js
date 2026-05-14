let activeQaListTermWriteCount = 0;

export function beginQaTermWrite() {
  activeQaListTermWriteCount += 1;
}

export function endQaTermWrite() {
  activeQaListTermWriteCount = Math.max(0, activeQaListTermWriteCount - 1);
}

export function qaListTermWriteIsActive() {
  return activeQaListTermWriteCount > 0;
}

export function resetQaTermWriteCoordinator() {
  activeQaListTermWriteCount = 0;
}
