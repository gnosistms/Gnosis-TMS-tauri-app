import { invoke, listen, openExternalUrl } from "./runtime.js";
import {
  loadStoredAuthSession,
  saveStoredAuthSession,
} from "./auth-storage.js";
import {
  setActiveStorageLogin,
} from "./team-storage.js";
import {
  authSessionGeneration,
  hydrateStoredEditorPreferences,
  hydrateStoredTeamState,
  invalidateAuthSession,
  state,
} from "./state.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { classifySyncError } from "./sync-error.js";
import { showNoticeBadge } from "./status-feedback.js";

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
    throw new Error("AUTH_REQUIRED:Sign in with GitHub to connect to the broker first.");
  }

  return sessionToken;
}

export async function handleBrokerAuthExpired(render, error) {
  return handleSyncFailure(classifySyncError(error), { render });
}

export async function applyBrokerAuthResult(payload, render, loadUserTeams) {
  if (payload?.status === "success" && payload?.session?.sessionToken && payload.session.login) {
    const session = payload.session;
    invalidateAuthSession();
    const generation = authSessionGeneration;
    try {
      await saveStoredAuthSession(session);
    } catch {
      if (generation === authSessionGeneration) {
        setAuthState({
          status: "error",
          message: "Could not save your GitHub login on this computer. Please try signing in again.",
        }, render);
      }
      return;
    }
    if (generation !== authSessionGeneration) {
      return;
    }
    setActiveStorageLogin(session.login);
    hydrateStoredDataForActiveUser();
    state.auth = {
      status: "success",
      message: payload.message ?? `Signed in as @${session.login}.`,
      session,
      pendingAutoOpenSingleTeam: true,
    };
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
  const generation = authSessionGeneration;
  const session = await loadStoredAuthSession();
  if (!session || generation !== authSessionGeneration) {
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

function shouldPreserveCurrentScreen(options = {}) {
  return options.preserveCurrentScreen === true && state.screen !== "start";
}

function applyRestoredOnlineScreen(options = {}) {
  if (!shouldPreserveCurrentScreen(options)) {
    state.screen = "teams";
  }
}

export async function restoreStoredBrokerSession(
  render,
  loadUserTeams,
  storedSession = null,
  options = {},
) {
  const generation = authSessionGeneration;
  const session = storedSession ?? await loadStoredAuthSession();
  if (generation !== authSessionGeneration) {
    return;
  }
  if (!session) {
    state.auth = {
      ...state.auth,
      status: "idle",
      message: "",
      session: null,
      pendingAutoOpenSingleTeam: false,
    };
    state.screen = "start";
    render();
    return;
  }

  if (!invoke) {
    state.auth = {
      status: "success",
      message: `Signed in as @${session.login}.`,
      session,
      pendingAutoOpenSingleTeam: !shouldPreserveCurrentScreen(options),
    };
    applyRestoredOnlineScreen(options);
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
    if (generation !== authSessionGeneration || !state.auth.session) {
      return;
    }
    const verifiedSession = {
      // Inspection may have refreshed and persisted the token through invoke().
      sessionToken: state.auth.session.sessionToken,
      login: profile.login,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    };
    setActiveStorageLogin(verifiedSession.login);
    hydrateStoredDataForActiveUser({
      preserveResourceContext: shouldPreserveCurrentScreen(options),
    });
    state.auth = {
      status: "success",
      message: `Signed in as @${verifiedSession.login}.`,
      session: verifiedSession,
      pendingAutoOpenSingleTeam: !shouldPreserveCurrentScreen(options),
    };
    applyRestoredOnlineScreen(options);
    render();
    void loadUserTeams(render);
  } catch (error) {
    if (generation !== authSessionGeneration || !state.auth.session) {
      return;
    }
    const retainedSession = state.auth.session;
    setActiveStorageLogin(retainedSession.login);
    hydrateStoredDataForActiveUser({
      preserveResourceContext: shouldPreserveCurrentScreen(options),
    });
    state.auth = {
      status: "success",
      message: `Signed in as @${retainedSession.login}.`,
      session: retainedSession,
      pendingAutoOpenSingleTeam: !shouldPreserveCurrentScreen(options),
    };
    applyRestoredOnlineScreen(options);
    render();
    if (error?.code === "AUTH_STORAGE_FAILED") {
      showNoticeBadge(error.message, render, null);
    } else {
      void loadUserTeams(render);
    }
  }
}

function hydrateStoredDataForActiveUser(options = {}) {
  const preserveResourceContext = options.preserveResourceContext === true;
  if (!preserveResourceContext) {
    state.selectedTeamId = null;
    state.selectedProjectId = null;
    state.selectedGlossaryId = null;
    state.selectedChapterId = null;
    state.expandedProjects = new Set();
    state.expandedDeletedFiles = new Set();
  }
  hydrateStoredTeamState();
  hydrateStoredEditorPreferences();
  if (!preserveResourceContext) {
    state.projects = [];
    state.deletedProjects = [];
    state.users = [];
  }
}

export async function registerBrokerAuthListener(render, loadUserTeams) {
  if (!listen) {
    return;
  }

  await listen("broker-auth-callback", (event) => {
    void applyBrokerAuthResult(event.payload, render, loadUserTeams);
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
