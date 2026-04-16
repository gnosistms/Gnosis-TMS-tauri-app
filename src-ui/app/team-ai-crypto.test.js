import test from "node:test";
import assert from "node:assert/strict";

import {
  decryptTeamAiWrappedKey,
  encryptTeamAiPlaintext,
  generateTeamAiMemberKeypair,
} from "./team-ai-crypto.js";

test("team AI wrap decrypt re-wrap round trip preserves the provider key", async () => {
  const brokerKeypair = await generateTeamAiMemberKeypair();
  const memberKeypair = await generateTeamAiMemberKeypair();

  const brokerWrappedKey = await encryptTeamAiPlaintext(
    "sk-team-shared-roundtrip",
    brokerKeypair.publicKeyPem,
  );
  const brokerPlaintext = await decryptTeamAiWrappedKey(
    brokerWrappedKey,
    brokerKeypair.privateKeyPem,
  );

  assert.equal(brokerPlaintext, "sk-team-shared-roundtrip");

  const memberWrappedKey = await encryptTeamAiPlaintext(
    brokerPlaintext,
    memberKeypair.publicKeyPem,
  );
  const memberPlaintext = await decryptTeamAiWrappedKey(
    memberWrappedKey,
    memberKeypair.privateKeyPem,
  );

  assert.equal(memberPlaintext, "sk-team-shared-roundtrip");
});
