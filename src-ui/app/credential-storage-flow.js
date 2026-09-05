import { invoke } from "./runtime.js";
import { state } from "./state.js";

export async function refreshCredentialStorage(render, { retry = false } = {}) {
  if (!invoke) return;
  try {
    state.credentialStorage = await invoke("load_credential_storage_status", { retry });
  } catch (error) {
    state.credentialStorage = { mode: "locked", message: error?.message ?? String(error) };
  }
  render?.();
}

export async function useSessionOnlyCredentialStorage(render) {
  try {
    state.credentialStorage = await invoke("use_session_only_credential_storage");
  } catch (error) {
    state.credentialStorage = { mode: "locked", message: error?.message ?? String(error) };
  }
  render?.();
}
