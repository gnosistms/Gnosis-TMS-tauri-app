import { invoke, listen, openExternalUrl } from "./runtime.js";
import {
  clearStoredAuthSession,
  loadStoredAuthSession,
  saveStoredAuthSession,
} from "./auth-storage.js";
import {
  clearActiveStorageLogin,
  setActiveStorageLogin,
} from "./team-storage.js";
import { hydrateStoredEditorPreferences, hydrateStoredTeamState, state } from "./state.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { classifySyncError } from "./sync-error.js";

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

export async function handleBrokerAuthExpired(render, error) {
  return handleSyncFailure(classifySyncError(error), { render });
}

export function applyBrokerAuthResult(payload, render, loadUserTeams) {
  if (payload?.status === "success" && payload?.session?.sessionToken) {
    const session = payload.session;
    setActiveStorageLogin(session.login);
    hydrateStoredDataForActiveUser();
    state.auth = {
      status: "success",
      message: payload.message ?? `Signed in as @${session.login}.`,
      session,
      pendingAutoOpenSingleTeam: true,
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

export async function prepareStoredBrokerSessionRestore() {
  const session = await loadStoredAuthSession();
  if (!session) {
    return null;
  }

  state.auth = {
    ...state.auth,
    status: "restoring",
    message: "",
    session,
  };
  return session;
}

export async function restoreStoredBrokerSession(render, loadUserTeams, storedSession = null) {
  const session = storedSession ?? await loadStoredAuthSession();
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
      pendingAutoOpenSingleTeam: true,
    };
    state.screen = "teams";
    render();
    return;
  }

  try {
    if (
      state.auth.status !== "restoring"
      || state.auth.session?.sessionToken !== session.sessionToken
    ) {
      setAuthState(
        {
          status: "restoring",
          message: "",
          session,
        },
        render,
      );
    }
    const profile = await invoke("inspect_broker_auth_session", {
      sessionToken: session.sessionToken,
    });
    const verifiedSession = {
      sessionToken: session.sessionToken,
      login: profile.login,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    };
    setActiveStorageLogin(verifiedSession.login);
    hydrateStoredDataForActiveUser();
    state.auth = {
      status: "success",
      message: `Signed in as @${verifiedSession.login}.`,
      session: verifiedSession,
      pendingAutoOpenSingleTeam: true,
    };
    void saveStoredAuthSession(verifiedSession);
    state.screen = "teams";
    render();
    void loadUserTeams(render);
  } catch (error) {
    const classification = classifySyncError(error);
    if (classification.type === "auth_invalid") {
      await clearStoredAuthSession();
      clearActiveStorageLogin();
      state.auth = {
        status: "idle",
        message: "",
        session: null,
      };
      state.screen = "start";
      render();
      return;
    }

    setActiveStorageLogin(session.login);
    hydrateStoredDataForActiveUser();
    state.auth = {
      status: "success",
      message: `Signed in as @${session.login}.`,
      session,
      pendingAutoOpenSingleTeam: true,
    };
    state.screen = "teams";
    render();
    void loadUserTeams(render);
  }
}

function hydrateStoredDataForActiveUser() {
  state.selectedTeamId = null;
  state.selectedProjectId = null;
  state.selectedGlossaryId = null;
  state.selectedChapterId = null;
  state.expandedProjects = new Set();
  state.expandedDeletedFiles = new Set();
  hydrateStoredTeamState();
  hydrateStoredEditorPreferences();
  state.projects = [];
  state.deletedProjects = [];
  state.users = [];
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
