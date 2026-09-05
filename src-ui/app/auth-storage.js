import { state } from "./state.js";
import { invoke } from "./runtime.js";

export async function loadStoredAuthSession() {
  if (!invoke || state.credentialStorage?.mode === "locked") {
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
  } catch (error) {
    state.credentialStorage = { mode: "locked", message: error?.message ?? String(error) };
    return null;
  }
}

export async function saveStoredAuthSession(session, expectedSessionToken = null) {
  if (!invoke) {
    return;
  }

  try {
    if (!session?.sessionToken || !session?.login) {
      await clearStoredAuthSession();
      return;
    }

    await invoke("save_broker_auth_session", { session, expectedSessionToken });
  } catch (error) {
    state.credentialStorage = { mode: "locked", message: error?.message ?? String(error) };
    throw error;
  }
}

export async function clearStoredAuthSession() {
  if (!invoke) {
    return;
  }

  try {
    await invoke("clear_broker_auth_session");
  } catch (error) {
    state.credentialStorage = { mode: "locked", message: error?.message ?? String(error) };
    throw error;
  }
}
