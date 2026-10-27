import { invoke } from "./runtime.js";
import { authSessionGeneration, invalidateAuthSession } from "./state.js";

let pendingSessionWrite = Promise.resolve();

function queueSessionWrite(operation) {
  const result = pendingSessionWrite.then(operation);
  // Keep the queue usable after failure; the caller still receives the rejection.
  pendingSessionWrite = result.catch(() => {});
  return result;
}

export async function loadStoredAuthSession() {
  if (!invoke) {
    return null;
  }

  try {
    const session = await invoke("load_broker_auth_session");
    if (!session?.sessionToken || !session?.login) {
      return null;
    }

    return {
      sessionToken: session.sessionToken,
      login: session.login,
      name: session.name ?? null,
      avatarUrl: session.avatarUrl ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveStoredAuthSession(session) {
  if (!invoke) {
    return;
  }

  if (!session?.sessionToken || !session?.login) {
    await clearStoredAuthSession();
    return;
  }

  const generation = authSessionGeneration;
  await queueSessionWrite(() => {
    if (generation !== authSessionGeneration) {
      throw new Error("AUTH_SESSION_CHANGED:GitHub login changed before it could be saved.");
    }
    return invoke("save_broker_auth_session", { session });
  });
}

export async function clearStoredAuthSession() {
  invalidateAuthSession();
  if (!invoke) {
    return;
  }

  await queueSessionWrite(() => invoke("clear_broker_auth_session"));
}
