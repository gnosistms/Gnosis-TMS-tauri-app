// Turns the stored research log (a flat list of events) into what the log
// shows: headings and findings as lines, and one item per AI request holding
// what was sent, the thinking, the answer, the cost and any problem. Requests
// that ran side by side in one batch are gathered under one progress line.

const STAGE_NAMES = {
  dictionary: "Dictionary",
  forms: "Word forms",
  discovery: "Discovery",
  proposal: "Proposal",
  counting: "Counting",
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
 * lists are joined. A finding without data (old logs, unknown kinds) keeps
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
      kind: "result", resultKind: entry.kind ?? "",
      data: hasData ? (Array.isArray(entry.data) ? [...entry.data] : entry.data) : null,
      texts: [entry.text],
    });
    return;
  }
  section.items.push({ kind: "line", entry });
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
  candidates(data) {
    const groups = data.reduce((n, sense) => n + (sense.groups?.length ?? 0), 0);
    const renderings = data.reduce((n, sense) => n + (sense.groups ?? []).reduce((m, g) => m + (g.members?.length ?? 0), 0), 0);
    return `${plural(renderings, "rendering")} in ${plural(groups, "group")} for ${plural(data.length, "sense")}`;
  },
  checks(data) {
    const count = (verdict) => data.filter((c) => c.verdict === verdict).length;
    return [`${count("pass")} pass`, count("unclear") ? `${count("unclear")} unclear` : "", count("fail") ? `${count("fail")} fail` : ""].filter(Boolean).join(", ")
      + ` (${plural(data.length, "candidate")} checked)`;
  },
  frequency(data) {
    const term = data.find((item) => item.kind === "term");
    const parts = data.find((item) => item.kind === "parts");
    return [
      parts ? parts.parts.map((p) => p.part).join(" + ") : "",
      term ? `“${term.word}” Zipf ${term.zipf == null ? "—" : Number(term.zipf).toFixed(2)}${term.invented ? ", the author's own word" : ""}` : "",
    ].filter(Boolean).join(" · ");
  },
  sampling([item]) {
    return item.light ? `${plural(item.distinct, "passage")}, light study` : `${plural(item.distinct, "distinct passage")}, ${item.measuring} measured`;
  },
  discovery([item]) {
    return `${item.read} of ${item.total} read; most common: ${(item.top ?? []).slice(0, 3).map(([r]) => r).join(", ")}`;
  },
  proposal(data) {
    return data.map((entry) => `${(entry.sourceTerms ?? [])[0] ?? ""} → ${(entry.variants ?? []).join(", ")}`).join(" | ");
  },
  agreement([item]) {
    return `the judges agreed on ${item.agreed} of ${item.compared}`;
  },
  senses(data) {
    return data.map((sense) => sense.sense).join("; ");
  },
  shared(data) {
    const same = data.filter((pair) => pair.relation === "same").length;
    const different = data.filter((pair) => pair.relation === "different").length;
    return [same ? `${same} shared with the same meaning` : "", different ? `${different} with a different meaning, taken out` : ""].filter(Boolean).join("; ") || `${plural(data.length, "pair")} not judged`;
  },
};

/** One line saying what a step found: its last finding, else its last line. */
export function sectionSummary(section) {
  for (let index = section.items.length - 1; index >= 0; index -= 1) {
    const item = section.items[index];
    if (item.kind === "result") {
      const summarize = RESULT_SUMMARIES[item.resultKind];
      if (summarize && item.data) {
        try {
          return summarize(item.data);
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
