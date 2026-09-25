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
    requestId: entry.requestId,
    stage: entry.stage ?? "",
    purpose: entry.purpose ?? "",
    batch: entry.batch ?? null,
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

/**
 * Open unless the person chose otherwise: a request that runs on its own is
 * open while it runs, so its thinking and answer can be read as they arrive.
 */
export function isRequestOpen(request, openChoices) {
  const choice = openChoices?.[request.requestId];
  if (choice !== undefined) return choice;
  return !(request.batch && request.batch.total > 1) && isRequestRunning(request);
}
