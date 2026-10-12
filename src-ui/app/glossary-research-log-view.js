import { commonness } from "./glossary-research-frequency.js";
import { signedOnly } from "./glossary-research-original-word.js";

// Turns the stored research log (a flat list of events) into what the log
// shows: headings and findings as lines, and one item per AI request holding
// what was sent, the thinking, the answer, the cost and any problem. Requests
// that ran side by side in one batch are gathered under one progress line.

const STAGE_NAMES = {
  dictionary: "Dictionary",
  forms: "Word forms",
  discovery: "Discovery",
  proposal: "Proposal",
  counting: "Choosing a translation for each use",
  summary: "Summary",
  pivot: "Pivot",
};

export function stageName(stage) {
  return STAGE_NAMES[stage] ?? (stage ? stage[0].toUpperCase() + stage.slice(1) : "Request");
}

function newRequest(entry) {
  return {
    updatedAt: entry.at ?? 0,
    requestId: entry.requestId,
    stage: entry.stage ?? "",
    purpose: entry.purpose ?? "",
    batch: entry.batch ?? null,
    // When it was sent, and what its answer counts (for the live panel's progress).
    startedAt: entry.at ?? 0,
    progress: entry.progress ?? null,
    text: entry.text ?? "",
    instructions: entry.instructions ?? "",
    thinking: "",
    answer: "",
    usage: null,
    problem: "",
  };
}

/** "waiting" | "thinking" | "writing" | "done" | "failed" */
export function requestState(request) {
  if (request.problem) return "failed";
  if (request.usage) return request.usage.status === "ok" ? "done" : "failed";
  if (request.answer) return "writing";
  if (request.thinking) return "thinking";
  return "waiting";
}

export function isRequestRunning(request) {
  const current = requestState(request);
  return current === "waiting" || current === "thinking" || current === "writing";
}

/** Readable form of a finished JSON answer; the raw text otherwise. */
export function readableAnswer(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * [{kind: "line", entry} | {kind: "request", request} |
 *  {kind: "batch", stage, total, requests}]
 * Stream fragments are joined per request, so logs saved before streamed
 * text was kept whole read the same way.
 */
export function buildLogView(log) {
  const items = [];
  const requests = new Map();
  let openBatch = null;
  const requestFor = (entry) => {
    let request = requests.get(entry.requestId);
    if (!request) {
      // Stream text without its request event (trimmed or very old logs).
      request = newRequest({ requestId: entry.requestId });
      requests.set(entry.requestId, request);
      items.push({ kind: "request", request });
      openBatch = null;
    }
    return request;
  };
  for (const entry of log) {
    if (entry.requestId && requests.has(entry.requestId)) {
      const known = requests.get(entry.requestId);
      known.updatedAt = Math.max(known.updatedAt, entry.updatedAt ?? entry.at ?? 0);
    }
    switch (entry.type) {
      case "request": {
        const request = newRequest({ ...entry, text: stripRequestHeader(entry.text) });
        requests.set(entry.requestId, request);
        const batch = request.batch;
        if (batch && batch.total > 1) {
          const continues = openBatch && openBatch.stage === request.stage
            && openBatch.total === batch.total && openBatch.key === batch.key;
          if (!continues) {
            openBatch = { kind: "batch", stage: request.stage, total: batch.total, key: batch.key, requests: [] };
            items.push(openBatch);
          }
          openBatch.requests.push(request);
        } else {
          items.push({ kind: "request", request });
          openBatch = null;
        }
        break;
      }
      case "thinking":
        if (entry.requestId) requestFor(entry).thinking += entry.text;
        break;
      case "answer-delta":
        if (entry.requestId) requestFor(entry).answer += entry.text;
        break;
      case "answer":
        if (entry.requestId) {
          const request = requestFor(entry);
          if (!request.answer) request.answer = entry.text;
        }
        break;
      case "usage":
        if (entry.requestId && entry.record) {
          requestFor(entry).usage = entry.record;
        } else if (entry.requestId) {
          // Older logs kept only the formatted line.
          requestFor(entry).usage = { status: /^[\w-]+: (\w+),/.exec(entry.text)?.[1] ?? "ok", line: entry.text };
        } else {
          items.push({ kind: "line", entry });
        }
        break;
      case "problem":
        if (entry.requestId && requests.has(entry.requestId)) {
          requests.get(entry.requestId).problem = entry.text;
        } else {
          items.push({ kind: "line", entry });
          openBatch = null;
        }
        break;
      default:
        items.push({ kind: "line", entry });
        openBatch = null;
    }
  }
  return items;
}

/**
 * A heading and its lines that repeat the block just before them exactly
 * (e.g. "Review" written again each time an old run was reopened) are shown
 * once, with the heading marked "(×n)". Blocks with AI requests are kept.
 */
export function collapseRepeatedBlocks(items) {
  const blocks = [];
  for (const item of items) {
    const isHeading = item.kind === "line" && item.entry.type === "heading";
    if (isHeading || !blocks.length) blocks.push({ items: [], repeats: 1 });
    blocks.at(-1).items.push(item);
  }
  const key = (block) => block.items.every((item) => item.kind === "line")
    ? JSON.stringify(block.items.map((item) => [item.entry.type, item.entry.text]))
    : null;
  const kept = [];
  for (const block of blocks) {
    const previous = kept.at(-1);
    const blockKey = key(block);
    if (previous && blockKey !== null && blockKey === key(previous)) {
      previous.repeats += 1;
    } else {
      kept.push(block);
    }
  }
  return kept.flatMap((block) => block.items.map((item, index) => (
    index === 0 && block.repeats > 1 && item.kind === "line"
      ? { ...item, entry: { ...item.entry, text: `${item.entry.text} (×${block.repeats})` } }
      : item
  )));
}

// Request events used to carry "→ stage: purpose" as their first line.
function stripRequestHeader(text) {
  const value = String(text ?? "");
  return value.startsWith("→ ") ? value.slice(value.indexOf("\n") + 1) : value;
}

/** Requests in a batch sit under their stage's heading, so they skip its name. */
export function requestTitle(request) {
  const inBatch = request.batch && request.batch.total > 1;
  const parts = inBatch ? [`Batch ${request.batch.number} of ${request.batch.total}`] : [stageName(request.stage)];
  if (request.purpose) parts.push(request.purpose);
  return parts.join(" · ");
}

export function requestStatusText(request, formatUsd) {
  const current = requestState(request);
  if (current === "waiting") return "sent, waiting for the reply…";
  if (current === "thinking") return "thinking…";
  if (current === "writing") return `writing the answer… ${request.answer.length.toLocaleString("en-US")} characters`;
  const usage = request.usage;
  const cost = usage?.seconds != null ? ` · ${usage.seconds.toFixed(0)} s · ${formatUsd(usage.costUsd)}` : "";
  if (current === "failed") return `failed${request.problem ? `: ${request.problem}` : ""}${cost}`;
  return `done${cost}`;
}

export function batchProgressText(batch) {
  const done = batch.requests.filter((request) => !isRequestRunning(request)).length;
  const running = batch.requests.length - done;
  return `${done} of ${batch.total} done${running ? `, ${running} running` : ""}`;
}

// --- sections ----------------------------------------------------------------------

function requestSeconds(request) {
  return Number(request.usage?.seconds) || 0;
}

function requestCost(request) {
  return Number(request.usage?.costUsd) || 0;
}

/**
 * Consecutive findings of one kind in a section read as one block: their data
 * lists are joined. Each finding records how many requests came before it
 * (`at`), so the step shows findings and answers in the order they arrived. A finding without data (old logs, unknown kinds) keeps
 * its text, which the renderer shows as plain lines.
 */
function addLine(section, entry) {
  if (entry.type === "result") {
    const last = section.items.at(-1);
    const hasData = Array.isArray(entry.data) || (entry.data && typeof entry.data === "object");
    if (hasData && last?.kind === "result" && last.resultKind === entry.kind && Array.isArray(last.data) && Array.isArray(entry.data)) {
      last.data.push(...entry.data);
      last.texts.push(entry.text);
      return;
    }
    section.items.push({
      kind: "result", resultKind: entry.kind ?? "", at: section.requests.length,
      data: hasData ? (Array.isArray(entry.data) ? [...entry.data] : entry.data) : null,
      texts: [entry.text],
    });
    return;
  }
  section.items.push({ kind: "line", entry, at: section.requests.length });
}

/**
 * The log as sections, one per heading: its lines and findings, and the AI
 * requests made under it (shown in the live panel, not between the lines).
 * Lines before the first heading form a section without a title.
 */
export function buildLogSections(log) {
  const sections = [];
  const open = (heading) => {
    const section = { id: `s${sections.length + 1}`, heading, items: [], requests: [] };
    sections.push(section);
    return section;
  };
  let current = null;
  for (const item of collapseRepeatedBlocks(buildLogView(log))) {
    if (item.kind === "line" && item.entry.type === "heading") {
      current = open(item.entry.text);
      continue;
    }
    current ??= open(null);
    if (item.kind === "line") addLine(current, item.entry);
    else if (item.kind === "request") current.requests.push(item.request);
    else current.requests.push(...item.requests);
  }
  for (const section of sections) section.meta = sectionMeta(section);
  return sections;
}

/** Seconds, cost and state of a section's requests, for its header. */
export function sectionMeta(section) {
  const requests = section.requests;
  return {
    count: requests.length,
    seconds: requests.reduce((sum, request) => sum + requestSeconds(request), 0),
    costUsd: requests.reduce((sum, request) => sum + requestCost(request), 0),
    running: requests.filter(isRequestRunning).length,
    failed: requests.filter((request) => requestState(request) === "failed").length,
  };
}

export function allRequests(sections) {
  return sections.flatMap((section) => section.requests);
}

/**
 * The request the live panel shows: the batch member the person picked while
 * it runs, else the one it follows while that runs, else the running request
 * that changed last. Finished requests are read in their section instead.
 */
export function liveRequest(sections, choice = null, follow = null) {
  const requests = allRequests(sections);
  // A request picked in a batch is shown while it runs; a finished one never stays on screen.
  if (choice) {
    const picked = requests.find((request) => request.requestId === choice);
    if (picked && isRequestRunning(picked)) return picked;
  }
  // Stay on the request already shown while it runs, so a batch does not jump about.
  const followed = follow && requests.find((request) => request.requestId === follow);
  if (followed && isRequestRunning(followed)) return followed;
  const running = requests.filter(isRequestRunning);
  if (!running.length) return null;
  return running.reduce((best, request) => (request.updatedAt >= best.updatedAt ? request : best));
}

/** The batch a request belongs to, with its progress; null for a request on its own. */
export function requestBatch(sections, request) {
  if (!request?.batch || !(request.batch.total > 1)) return null;
  const members = allRequests(sections).filter((other) => other.batch?.key === request.batch.key && other.stage === request.stage);
  const done = members.filter((other) => !isRequestRunning(other)).length;
  return { total: request.batch.total, done, running: members.length - done, requests: members };
}

// --- one-line summaries of finished steps ------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const RESULT_SUMMARIES = {
  // The recommended rendering of each meaning, then how many options there are.
  candidates(data) {
    const groups = data.reduce((n, sense) => n + (sense.groups?.length ?? 0), 0);
    const recommended = [...new Set(data.map((sense) => (sense.groups ?? []).find((g) => g.recommended)?.members?.[0]).filter(Boolean))];
    return `${recommended.length ? `Recommended: ${recommended.join(", ")} · ` : ""}${plural(groups, "option")} for ${plural(data.length, "meaning")}`;
  },
  // Which candidates failed, by name; the passes only as a number.
  checks(data) {
    const why = (c) => (/never used|wrong meaning/i.test((c.reasons ?? []).join(" ")) ? "not used in that meaning" : /rarer|less familiar|less known|less used/i.test((c.reasons ?? []).join(" ")) ? "too rare" : "");
    const failed = [...new Map(data.filter((c) => c.verdict === "fail").map((c) => [c.target, why(c) ? `${c.target} (${why(c)})` : c.target])).values()];
    const unclear = [...new Set(data.filter((c) => c.verdict === "unclear").map((c) => c.target))];
    const passed = new Set(data.filter((c) => c.verdict === "pass").map((c) => c.target)).size;
    const all = new Set(data.map((c) => c.target)).size;
    return [
      `${passed} of ${all} pass`,
      failed.length ? `rejected: ${failed.join(", ")}` : "none rejected",
      unclear.length ? `unclear: ${unclear.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
  },
  frequency(data) {
    const term = data.find((item) => item.kind === "term");
    const parts = data.find((item) => item.kind === "parts");
    return [
      parts && parts.parts.length > 1 ? `built from ${parts.parts.map((p) => p.part).join(" + ")}` : "",
      term ? (term.invented ? `“${term.word}” is the author's own word: not in everyday ${term.language ?? ""}` : `“${term.word}” is ${commonness(term.zipf)} in everyday ${term.language ?? ""}`).replace(/ +/g, " ") : "",
    ].filter(Boolean).join(" · ");
  },
  sampling([item]) {
    return item.light ? `${plural(item.distinct, "passage")}, all read` : `${item.measuring} of ${item.distinct.toLocaleString("en-US")} paragraphs picked at random`;
  },
  // What a translator reached for, with how often.
  discovery([item]) {
    return `Written most: ${(item.top ?? []).slice(0, 4).map(([r, n]) => `${r} (${n})`).join(", ")} · ${item.read} uses of the word`;
  },
  proposal(data) {
    return `Proposed: ${data.map((entry) => `${(entry.sourceTerms ?? [])[0] ?? ""} → ${(entry.variants ?? []).join(", ")}`).join(" | ")}`;
  },
  agreement([item]) {
    return `The two AIs chose the same translation for ${item.agreed} of ${item.compared} uses`;
  },
  // Where the author took the term from leads; the ordinary meanings follow.
  senses(data) {
    const label = (sense) => sense.label || sense.sense;
    const pos = (sense) => sense.partOfSpeech || sense.wordClass || "";
    const borrowed = data.filter((sense) => sense.inDictionary === false || sense.sourceBook);
    const ordinary = data.filter((sense) => !borrowed.includes(sense));
    const parts = borrowed.map((sense) => {
      const article = /^[aeiou]/i.test(pos(sense)) ? "an" : "a";
      const head = pos(sense) ? `as ${article} ${pos(sense)} (${label(sense)})` : label(sense);
      const book = sense.originalTitle
        ? `from ${sense.originalTitle}${sense.originalAuthor ? (signedOnly(sense.originalAuthor) ? ` (signed only “${sense.originalAuthor.trim()}”)` : ` by ${sense.originalAuthor}`) : ""}${sense.translationTitle ? ` (in Spanish: ${sense.translationTitle})` : ""}`
        : sense.sourceBook ? `from ${sense.sourceBook}` : "the author's own";
      const origin = [
        book,
        sense.originalTerm ? `original ${sense.originalLanguage ?? ""} “${sense.originalTerm}”${sense.verified === false ? " (unverified)" : ""}` : "",
      ].filter(Boolean).join(", ");
      return `${head}: ${origin}`;
    });
    if (ordinary.length) {
      const byClass = new Map();
      for (const sense of ordinary) byClass.set(pos(sense), [...(byClass.get(pos(sense)) ?? []), label(sense)]);
      for (const [wordClass, labels] of byClass) {
        parts.push(`${wordClass ? `as an${/^[aeiou]/i.test(wordClass) ? "" : ""} ${wordClass}, ` : ""}ordinary ${ordinary[0].language ?? ""}: ${labels.join("; ")}`.replace(/ +/g, " ").replace(/^as an ([^aeiou])/i, "as a $1"));
      }
    }
    return parts.join(" · ");
  },
  shared(data) {
    const same = data.filter((pair) => pair.relation === "same").length;
    const different = data.filter((pair) => pair.relation === "different").length;
    return [same ? `${same} shared with the same meaning` : "", different ? `${different} with a different meaning, taken out` : ""].filter(Boolean).join("; ") || `${plural(data.length, "pair")} not judged`;
  },
};

/** Counting: the translations chosen most, by name, from the judges' answers. */
function countingSummary(section) {
  const counts = new Map();
  let judged = 0;
  for (const request of section.requests) {
    if (request.stage !== "counting" || !request.answer) continue;
    let value;
    try {
      value = JSON.parse(request.answer);
    } catch {
      continue;
    }
    const names = request.progress?.variants ?? {};
    for (const item of value?.items ?? []) {
      judged += 1;
      const name = item.status === "selected" ? names[item.variantId] ?? item.variantId : item.status === "other" ? "something else" : null;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if (!judged || !counts.size) return "";
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `Used most: ${top.map(([name, n]) => `${name} (${n})`).join(", ")} · ${judged} uses of the word`;
}

/** The summary step: the first sentence of the written summary. */
function writtenSummary(section) {
  for (const request of section.requests) {
    try {
      const text = String(JSON.parse(request.answer)?.summary ?? "");
      if (text) return text.split(/(?<=[.!?])\s/)[0];
    } catch {
      // not finished
    }
  }
  return "";
}

/** One line saying what a step found: its last finding, else its last line. */
export function sectionSummary(section) {
  if (section.heading === "Summary") {
    const written = writtenSummary(section);
    if (written) return written;
  }
  if (section.items.some((item) => item.kind === "line" && /^Cancelled\b/.test(item.entry.text ?? ""))) {
    return "You cancelled the research here; it went on below when you resumed it.";
  }
  if (/^Counting\b/.test(section.heading ?? "")) {
    const agreement = section.items.find((item) => item.kind === "result" && item.resultKind === "agreement");
    if (!agreement) {
      const counted = countingSummary(section);
      if (counted) return counted;
    }
  }
  for (let index = section.items.length - 1; index >= 0; index -= 1) {
    const item = section.items[index];
    // Findings that fill a display (the dictionary entry, each word's count) are not
    // what the step concluded; its last line sums it up.
    if (item.kind === "result" && ["dictionary", "formCount", "familyCount"].includes(item.resultKind)) continue;
    if (item.kind === "result") {
      const summarize = RESULT_SUMMARIES[item.resultKind];
      if (summarize && item.data) {
        try {
          // Steps that log one result per meaning or candidate are summed up together.
          const all = section.items
            .filter((other) => other.kind === "result" && other.resultKind === item.resultKind && Array.isArray(other.data))
            .flatMap((other) => other.data);
          return summarize(all.length ? all : item.data);
        } catch {
          // fall back to the logged text
        }
      }
      return item.texts.at(-1) ?? "";
    }
  }
  const facts = section.items.filter((item) => item.kind === "line" && item.entry.type === "fact");
  const last = facts.at(-1) ?? section.items.filter((item) => item.kind === "line").at(-1);
  return last?.entry.text ?? "";
}
