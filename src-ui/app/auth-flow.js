import { invoke, listen, openExternalUrl } from "./runtime.js";
import {
  loadStoredAuthSession,
  saveStoredAuthSession,
} from "./auth-storage.js";
import { state } from "./state.js";

export function setAuthState(nextAuth, render) {
  state.auth = {
    ...state.auth,
    ...nextAuth,
  };
  render();
}

export function applyGithubAuthResult(payload, render, loadUserTeams) {
  if (payload?.status === "success") {
    const session = payload.session ?? null;
    state.auth = {
      status: "success",
      message: payload.message ?? "Signed in with GitHub.",
      session,
    };
    saveStoredAuthSession(session);
    state.screen = "teams";
    void loadUserTeams(render);
    return;
  }

  setAuthState(
    {
      status: "error",
      message: payload?.message ?? "GitHub sign-in did not complete.",
      session: null,
    },
    render,
  );
}

export function restoreStoredGithubSession(render, loadUserTeams) {
  const session = loadStoredAuthSession();
  if (!session) {
    return;
  }

  state.auth = {
    status: "success",
    message: "Signed in with GitHub.",
    session,
  };
  state.screen = "teams";
  void loadUserTeams(render);
}

export async function registerGithubAuthListener(render, loadUserTeams) {
  if (!listen) {
    return;
  }

  await listen("github-oauth-callback", (event) => {
    applyGithubAuthResult(event.payload, render, loadUserTeams);
  });
}

export async function registerGithubAppInstallListener(render, setGithubAppInstallation) {
  if (!listen) {
    return;
  }

  await listen("github-app-install-callback", (event) => {
    setGithubAppInstallation(event.payload, render);
  });
}

export async function startGithubLogin(render) {
  if (!invoke) {
    setAuthState(
      {
        status: "error",
        message: "GitHub sign-in requires the desktop app runtime.",
      },
      render,
    );
    return;
  }

  setAuthState(
    {
      status: "launching",
      message: "Opening GitHub in your browser...",
      session: state.auth.session,
    },
    render,
  );

  try {
    const { authUrl } = await invoke("begin_github_oauth");
    openExternalUrl(authUrl);
    setAuthState(
      {
        status: "waiting",
        message:
          "Finish signing in with GitHub in your browser. We will bring you back here automatically.",
        session: state.auth.session,
      },
      render,
    );
  } catch (error) {
    const message = error?.message ?? String(error);
    setAuthState(
      {
        status: "error",
        message,
        session: null,
      },
      render,
    );
  }
}
