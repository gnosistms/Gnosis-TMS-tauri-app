import test from "node:test";
import assert from "node:assert/strict";

import { classifySyncError } from "./sync-error.js";

test("classifySyncError treats broker transport failures as broker connection failures", () => {
  const classified = classifySyncError(new Error(
    "Could not reach the GitHub App broker: error sending request for url (https://gnosis-github-app-broker-8bfus.ondigitalocean.app/api/github-app/installations/125730441/gnosis-glossaries)",
  ));

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "broker");
});

test("classifySyncError treats GitHub DNS failures as GitHub connection failures", () => {
  const classified = classifySyncError(new Error(
    "git fetch failed: fatal: unable to access 'https://github.com/example/repo.git/': Could not resolve host: github.com",
  ));

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "github");
});

test("classifySyncError treats GitHub connect failures as GitHub connection failures", () => {
  const classified = classifySyncError(new Error(
    "git push failed: fatal: unable to access 'https://github.com/example/repo.git/': Failed to connect to github.com port 443 after 75003 ms",
  ));

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "github");
});

test("classifySyncError treats generic network unreachable errors as internet failures", () => {
  const classified = classifySyncError(new Error("Network is unreachable"));

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "internet");
});

test("classifySyncError treats broker 503 responses as connection failures", () => {
  const classified = classifySyncError(
    new Error("GitHub App broker request failed with status 503: Service Unavailable"),
    { status: 503 },
  );

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "broker");
  assert.equal(classified.status, 503);
});

test("classifySyncError treats generic 503 responses as connection failures", () => {
  const classified = classifySyncError(new Error("Service Unavailable"), { status: 503 });

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "unknown");
});

test("classifySyncError keeps generic 500 responses as server temporary", () => {
  const classified = classifySyncError(new Error("Internal Server Error"), { status: 500 });

  assert.equal(classified.type, "server_temporary");
  assert.equal(classified.status, 500);
});

test("classifySyncError treats broker 500 responses as connection failures", () => {
  const classified = classifySyncError(
    new Error("GitHub App broker request failed with status 500: upstream unavailable"),
    { status: 500 },
  );

  assert.equal(classified.type, "connection_unavailable");
  assert.equal(classified.source, "broker");
});

test("classifySyncError keeps auth failures out of connection handling", () => {
  const classified = classifySyncError(new Error("AUTH_REQUIRED:Your GitHub session expired."));

  assert.equal(classified.type, "auth_invalid");
});

test("classifySyncError keeps access loss out of connection handling", () => {
  const classified = classifySyncError(
    new Error("You no longer have access to this team."),
    { status: 403 },
  );

  assert.equal(classified.type, "resource_access_lost");
});
