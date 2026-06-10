import test from "node:test";
import assert from "node:assert/strict";

import { renderMemberRemovalAccessNoticeModal } from "./member-removal-access-notice-modal.js";

test("member removal access notice renders nothing while closed", () => {
  assert.equal(
    renderMemberRemovalAccessNoticeModal({
      memberRemovalAccessNotice: { isOpen: false, username: "" },
    }),
    "",
  );
});

test("member removal access notice explains the revocation delay with one Ok button", () => {
  const html = renderMemberRemovalAccessNoticeModal({
    memberRemovalAccessNotice: { isOpen: true, username: "alice" },
  });

  assert.match(html, /@alice has been removed/);
  assert.match(html, /up\s+to 30 minutes/);
  assert.match(html, /data-action="dismiss-member-removal-access-notice"/);
  assert.equal((html.match(/data-action=/g) || []).length, 1, "exactly one action button");
});
