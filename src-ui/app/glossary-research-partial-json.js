// Read an AI answer that is still streaming in as data: the JSON received so
// far, cut back to the last point where every value is complete, with the
// open arrays and objects closed. A string value that is still being written
// is kept, so text grows in place. A key without its value, a half-written
// number or `true`, and a half-written key are left out until they are whole.

/**
 * The value of a (possibly unfinished) JSON text, or null when nothing can be
 * read yet. Never throws.
 */
export function parsePartialJson(text) {
  const source = String(text ?? "");
  const start = source.search(/[[{]/);
  if (start < 0) return null;
  const stack = []; // "{" or "["
  let inString = false;
  let escaped = false;
  let stringIsKey = false;
  let expectKey = false; // inside an object, the next string is a key
  let afterColon = false; // inside an object, a value is being written
  let lastSafe = null; // { end, closers } after which the text reads as complete
  let stringStart = -1;

  const closers = () => stack.slice().reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  const markSafe = (end) => {
    lastSafe = { end, closers: closers() };
  };

  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        if (stringIsKey) {
          expectKey = false;
        } else {
          afterColon = false;
          markSafe(i + 1);
        }
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      stringIsKey = stack.at(-1) === "{" && expectKey;
      continue;
    }
    if (c === "{" || c === "[") {
      stack.push(c);
      expectKey = c === "{";
      afterColon = false;
      markSafe(i + 1);
      continue;
    }
    if (c === "}" || c === "]") {
      stack.pop();
      expectKey = false;
      afterColon = false;
      markSafe(i + 1);
      if (!stack.length) break;
      continue;
    }
    if (c === ":") {
      afterColon = true;
      continue;
    }
    if (c === ",") {
      expectKey = stack.at(-1) === "{";
      afterColon = false;
      continue;
    }
    if (/\s/.test(c)) continue;
    // A number or literal: complete when the next character ends it.
    const match = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(source.slice(i));
    if (!match) continue;
    const end = i + match[0].length;
    if (end < source.length && /[\s,\]}]/.test(source[end])) {
      afterColon = false;
      markSafe(end);
    }
    i = end - 1;
  }

  let repaired = null;
  if (inString && !stringIsKey && (stack.at(-1) === "[" || afterColon)) {
    // A string value still being written: keep what has arrived.
    let body = source.slice(stringStart, source.length);
    if (escaped) body = body.slice(0, -1);
    body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    repaired = `${source.slice(start, stringStart)}${body}"${closers()}`;
  } else if (lastSafe) {
    repaired = `${source.slice(start, lastSafe.end)}${lastSafe.closers}`;
  }
  if (!repaired) return null;
  try {
    return JSON.parse(repaired);
  } catch {
    // A trailing comma before the closers (`{"a":1,}`) is the only expected leftover.
    try {
      return JSON.parse(repaired.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}
