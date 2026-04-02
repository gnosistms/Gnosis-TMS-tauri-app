export function formatErrorForDisplay(value) {
  const message = String(value ?? "").trim();
  if (!message) {
    return "";
  }

  const githubMatch = message.match(/^GitHub API\s+(\d+):\s*([\s\S]+)$/);
  if (!githubMatch) {
    return message;
  }

  const [, status, rawBody] = githubMatch;
  let displayMessage = rawBody.trim();

  try {
    const payload = JSON.parse(rawBody);
    const topLevelMessage =
      typeof payload?.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : "";
    const nestedMessages =
      Array.isArray(payload?.errors)
        ? payload.errors.find(
            (item) => typeof item?.message === "string" && item.message.trim(),
          )
        : null;

    const nestedMessageList = Array.isArray(payload?.errors)
      ? payload.errors
          .map((item) => (typeof item?.message === "string" ? item.message.trim() : ""))
          .filter(Boolean)
      : [];

    if (nestedMessageList.length > 0) {
      displayMessage = nestedMessageList.join(" ");
    } else if (topLevelMessage) {
      displayMessage = topLevelMessage;
    }
  } catch {
    displayMessage = rawBody.trim();
  }

  return `GitHub API ${displayMessage}. Status: ${status}`;
}
