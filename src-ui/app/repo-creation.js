import { appendRepoNameSuffix } from "./repo-names.js";

const REPO_NAME_CONFLICT_MESSAGE_FRAGMENT = "name already exists on this account";
const DEFAULT_MAX_REPO_NAME_ATTEMPTS = 100;

export function isRepoNameConflictError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return message.includes(REPO_NAME_CONFLICT_MESSAGE_FRAGMENT);
}

export async function createUniqueRepoWithNumericSuffix(
  baseRepoName,
  createRepo,
  options = {},
) {
  const normalizedBase = String(baseRepoName ?? "").trim();
  if (!normalizedBase) {
    throw new Error("Could not determine the repo name.");
  }

  if (typeof createRepo !== "function") {
    throw new Error("Could not create the repo because the creation callback was missing.");
  }

  const conflictTest =
    typeof options.conflictTest === "function"
      ? options.conflictTest
      : isRepoNameConflictError;
  const maxAttempts =
    Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
      ? options.maxAttempts
      : DEFAULT_MAX_REPO_NAME_ATTEMPTS;

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidateRepoName = appendRepoNameSuffix(normalizedBase, attempt);
    try {
      const result = await createRepo(candidateRepoName, attempt);
      return {
        result,
        attemptedRepoName: candidateRepoName,
        collisionResolved: attempt > 1,
      };
    } catch (error) {
      if (!conflictTest(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error("Could not determine an available repo name.");
}
