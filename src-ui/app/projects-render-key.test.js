import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectsRenderKey } from "./projects-render-key.js";

const statusSurface = '<div class="team-ui-debug">Syncing 3 repos...</div>';

function page({ spinDelay = "", status = statusSurface, body = "<p>Project A</p>" } = {}) {
  const spinStyle = spinDelay ? ` style="--title-icon-spin-delay: -${spinDelay}ms;"` : "";
  return `<div class="screen"><span class="title-icon-button__icon is-spinning"${spinStyle}></span><main>${body}</main>${status}</div>`;
}

test("the spinner's elapsed-time offset does not change the key", () => {
  assert.equal(
    buildProjectsRenderKey({ screenHtml: page({ spinDelay: "120" }), statusSurfaceHtml: statusSurface }),
    buildProjectsRenderKey({ screenHtml: page({ spinDelay: "4310" }), statusSurfaceHtml: statusSurface }),
  );
});

test("the status surface does not change the key", () => {
  const otherSurface = '<div class="team-ui-debug">Syncing 2 repos...</div>';
  assert.equal(
    buildProjectsRenderKey({ screenHtml: page(), statusSurfaceHtml: statusSurface }),
    buildProjectsRenderKey({ screenHtml: page({ status: otherSurface }), statusSurfaceHtml: otherSurface }),
  );
});

test("a change in the page body changes the key", () => {
  assert.notEqual(
    buildProjectsRenderKey({ screenHtml: page(), statusSurfaceHtml: statusSurface }),
    buildProjectsRenderKey({
      screenHtml: page({ body: "<p>Project A</p><p>Project B</p>" }),
      statusSurfaceHtml: statusSurface,
    }),
  );
});

test("starting or stopping the spinner changes the key", () => {
  assert.notEqual(
    buildProjectsRenderKey({ screenHtml: page(), statusSurfaceHtml: statusSurface }),
    buildProjectsRenderKey({
      screenHtml: page().replace(" is-spinning", ""),
      statusSurfaceHtml: statusSurface,
    }),
  );
});

test("extra parts such as app-level modals are part of the key", () => {
  const base = { screenHtml: page(), statusSurfaceHtml: statusSurface };
  assert.notEqual(
    buildProjectsRenderKey({ ...base, extraParts: ["", "idle"] }),
    buildProjectsRenderKey({ ...base, extraParts: ["<div class=\"modal\"></div>", "idle"] }),
  );
  assert.notEqual(
    buildProjectsRenderKey({ ...base, extraParts: ["", "idle"] }),
    buildProjectsRenderKey({ ...base, extraParts: ["", "preparing"] }),
  );
});
