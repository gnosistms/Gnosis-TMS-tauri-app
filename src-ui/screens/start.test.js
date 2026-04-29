import test from "node:test";
import assert from "node:assert/strict";

import { renderStartScreen } from "./start.js";

function startState(overrides = {}) {
  return {
    auth: {
      status: "idle",
      message: "",
      session: null,
      pendingAutoOpenSingleTeam: false,
    },
    offline: {
      checked: true,
      hasConnection: true,
      hasLocalData: false,
    },
    ...overrides,
  };
}

test("start screen renders the hero logo in idle, restoring, and offline states", () => {
  assert.match(
    renderStartScreen(startState()),
    /class="start-hero__logo"/,
  );
  assert.match(
    renderStartScreen(startState({ auth: { status: "restoring", message: "" } })),
    /class="start-hero__logo"/,
  );
  assert.match(
    renderStartScreen(startState({
      offline: {
        checked: true,
        hasConnection: false,
        hasLocalData: true,
      },
    })),
    /class="start-hero__logo"/,
  );
});
