// Subtitle timing model for SRT-sourced chapters: parse/format editor input,
// per-language effective timing (override ?? row base timing), and the derived
// timing-error computation shared by the row renderer and the row filter.

export const MIN_TIMING_DURATION_MS = 250;

export function chapterHasSrtSourceFormat(sourceFormats) {
  return Array.isArray(sourceFormats) && sourceFormats.includes("srt");
}

function normalizeTimingValue(timing) {
  const startMs = Number(timing?.startMs);
  const endMs = Number(timing?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < 0) {
    return null;
  }
  return { startMs: Math.floor(startMs), endMs: Math.floor(endMs) };
}

export function cloneRowTimings(timings) {
  const entries = Object.entries(timings && typeof timings === "object" ? timings : {});
  const cloned = {};
  for (const [code, timing] of entries) {
    const normalized = normalizeTimingValue(timing);
    if (normalized) {
      cloned[code] = normalized;
    }
  }
  return cloned;
}

export function timingValuesEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  return Boolean(left) && Boolean(right)
    && left.startMs === right.startMs
    && left.endMs === right.endMs;
}

export function rowTimingsEqual(left, right) {
  const leftEntries = Object.entries(left && typeof left === "object" ? left : {});
  const rightEntries = Object.entries(right && typeof right === "object" ? right : {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([code, value]) => timingValuesEqual(value, right?.[code]));
}

// The language's stored override wins; otherwise the row inherits its imported
// (or insert-time) base timing. Null when the row has no timing at all.
export function effectiveRowTiming(row, languageCode) {
  return (
    normalizeTimingValue(row?.timings?.[languageCode])
    ?? normalizeTimingValue(row?.srtTiming)
  );
}

// Format milliseconds as canonical SRT display text (HH:MM:SS,mmm).
export function formatTimingMs(totalMs) {
  const normalized = Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs) : 0;
  const millis = normalized % 1000;
  const totalSeconds = Math.floor(normalized / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value, width) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

// Parse editor input into milliseconds. Accepts H:MM:SS or MM:SS, an optional
// "," or "." fraction of 1-3 digits (",5" is 500 ms), and surrounding
// whitespace. Returns null when the text is not a valid timestamp.
export function parseTimingInput(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return null;
  }
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(normalized);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) {
    return null;
  }
  const millis = match[4] ? Number(match[4].padEnd(3, "0")) : 0;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

// Timing errors over one language's ordered sequence of effective timings
// (null entries are rows with no timing; they neither error nor participate in
// adjacency). Returns one { startError, endError } per input entry:
// - too short (end - start < 250 ms, including end < start): both inputs error.
//   Entries flagged `emptyText: true` are exempt — an empty cue is deliberate
//   spacing, so a sub-minimum duration is not actionable.
// - overlap with the previous timed row: this row's start AND the previous
//   timed row's end error, so both rows of the pair are marked
// Adjacency (start == previous end) is not an error; only strict overlap is.
export function computeTimingErrors(sequence) {
  const entries = Array.isArray(sequence) ? sequence : [];
  const timings = entries.map(normalizeTimingValue);
  const errors = timings.map(() => ({ startError: false, endError: false }));
  let previousIndex = -1;

  timings.forEach((timing, index) => {
    if (!timing) {
      return;
    }
    if (
      timing.endMs - timing.startMs < MIN_TIMING_DURATION_MS
      && entries[index]?.emptyText !== true
    ) {
      errors[index].startError = true;
      errors[index].endError = true;
    }
    if (previousIndex >= 0 && timing.startMs < timings[previousIndex].endMs) {
      errors[index].startError = true;
      errors[previousIndex].endError = true;
    }
    previousIndex = index;
  });

  return errors;
}

// Per-row, per-language error map for a chapter's active rows. Returns
// Map<rowId, { [languageCode]: { startError, endError } }> containing only
// rows that have at least one error.
export function computeChapterTimingErrors(rows, languageCodes) {
  const activeRows = (Array.isArray(rows) ? rows : []).filter(
    (row) => row?.lifecycleState !== "deleted" && row?.rowId,
  );
  const errorsByRowId = new Map();

  for (const code of Array.isArray(languageCodes) ? languageCodes : []) {
    const sequence = activeRows.map((row) => {
      const timing = effectiveRowTiming(row, code);
      return timing
        ? { ...timing, emptyText: !String(row?.fields?.[code] ?? "").trim() }
        : null;
    });
    const errors = computeTimingErrors(sequence);
    errors.forEach((error, index) => {
      if (!error.startError && !error.endError) {
        return;
      }
      const rowId = activeRows[index].rowId;
      const rowErrors = errorsByRowId.get(rowId) ?? {};
      rowErrors[code] = error;
      errorsByRowId.set(rowId, rowErrors);
    });
  }

  return errorsByRowId;
}
