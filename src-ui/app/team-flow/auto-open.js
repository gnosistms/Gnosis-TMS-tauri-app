export function consumePendingSingleTeamAutoOpen(authState, currentScreen) {
  const shouldAutoOpen =
    authState?.pendingAutoOpenSingleTeam === true
    && currentScreen === "teams";

  if (authState && typeof authState === "object") {
    authState.pendingAutoOpenSingleTeam = false;
  }

  return shouldAutoOpen;
}
