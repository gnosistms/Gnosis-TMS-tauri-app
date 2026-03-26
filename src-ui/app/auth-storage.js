import { invoke } from "./runtime.js";

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

  try {
    if (!session?.sessionToken || !session?.login) {
      await clearStoredAuthSession();
      return;
    }

    await invoke("save_broker_auth_session", { session });
  } catch {
    // Ignore native storage failures and continue in memory.
  }
}

export async function clearStoredAuthSession() {
  if (!invoke) {
    return;
  }

  try {
    await invoke("clear_broker_auth_session");
  } catch {
    // Ignore native storage failures and continue in memory.
  }
}
