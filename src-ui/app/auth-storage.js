const GITHUB_AUTH_STORAGE_KEY = "gnosisTms.githubAuthSession";

export function loadStoredAuthSession() {
  try {
    const storedValue = window.localStorage?.getItem(GITHUB_AUTH_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue);
    if (!parsed?.accessToken || !parsed?.login) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      login: parsed.login,
      name: parsed.name ?? null,
      avatarUrl: parsed.avatarUrl ?? null,
    };
  } catch {
    return null;
  }
}

export function saveStoredAuthSession(session) {
  try {
    if (!session?.accessToken || !session?.login) {
      clearStoredAuthSession();
      return;
    }

    window.localStorage?.setItem(GITHUB_AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore local storage failures and continue in memory.
  }
}

export function clearStoredAuthSession() {
  try {
    window.localStorage?.removeItem(GITHUB_AUTH_STORAGE_KEY);
  } catch {
    // Ignore local storage failures and continue in memory.
  }
}
