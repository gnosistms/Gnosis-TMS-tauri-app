import { invoke, listen, openExternalUrl } from "./runtime.js";
import {
  clearStoredAuthSession,
  loadStoredAuthSession,
  saveStoredAuthSession,
} from "./auth-storage.js";
import { resetSessionState, state } from "./state.js";

const AUTH_REQUIRED_PREFIX = "AUTH_REQUIRED:";

function setAuthState(nextAuth, render) {
  state.auth = {
    ...state.auth,
    ...nextAuth,
  };
  render();
}

export function requireBrokerSession() {
  const sessionToken = state.auth.session?.sessionToken;
  if (!sessionToken) {
    throw new Error("Sign in with GitHub to connect to the broker first.");
  }

  return sessionToken;
}

export function isBrokerAuthExpiredError(error) {
  const message = error?.message ?? String(error ?? "");
  return (
    message.startsWith(AUTH_REQUIRED_PREFIX) ||
    message === "Unauthorized" ||
    message.includes("Your GitHub session expired")
  );
}

export async function handleBrokerAuthExpired(render, error) {
  if (!isBrokerAuthExpiredError(error)) {
    return false;
  }

  await clearStoredAuthSession();
  resetSessionState();
  state.auth = {
    status: "expired",
    message:
      "Your GitHub session expired. Please log in with GitHub again to continue.",
    session: null,
  };
  state.screen = "start";
  render();
  return true;
}

export function applyBrokerAuthResult(payload, render, loadUserTeams) {
  if (payload?.status === "success" && payload?.session?.sessionToken) {
    const session = payload.session;
    state.auth = {
      status: "success",
      message: payload.message ?? `Signed in as @${session.login}.`,
      session,
    };
    void saveStoredAuthSession(session);
    state.screen = "teams";
    render();
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

export async function restoreStoredBrokerSession(render, loadUserTeams) {
  const session = await loadStoredAuthSession();
  if (!session) {
    state.screen = "start";
    render();
    return;
  }

  if (!invoke) {
    state.auth = {
      status: "success",
      message: `Signed in as @${session.login}.`,
      session,
    };
    state.screen = "teams";
    render();
    return;
  }

  try {
    const profile = await invoke("inspect_broker_auth_session", {
      sessionToken: session.sessionToken,
    });
    const verifiedSession = {
      sessionToken: session.sessionToken,
      login: profile.login,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    };
    state.auth = {
      status: "success",
      message: `Signed in as @${verifiedSession.login}.`,
      session: verifiedSession,
    };
    void saveStoredAuthSession(verifiedSession);
    state.screen = "teams";
    render();
    void loadUserTeams(render);
  } catch {
    await clearStoredAuthSession();
    state.auth = {
      status: "idle",
      message: "",
      session: null,
    };
    state.screen = "start";
    render();
  }
}

export async function registerBrokerAuthListener(render, loadUserTeams) {
  if (!listen) {
    return;
  }

  await listen("broker-auth-callback", (event) => {
    applyBrokerAuthResult(event.payload, render, loadUserTeams);
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
      message: "Opening GitHub sign-in in your browser...",
      session: state.auth.session,
    },
    render,
  );

  try {
    const { authUrl } = await invoke("begin_broker_auth");
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
    setAuthState(
      {
        status: "error",
        message: error?.message ?? String(error),
        session: null,
      },
      render,
    );
  }
}
