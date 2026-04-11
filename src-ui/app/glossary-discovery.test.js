import test from "node:test";
import assert from "node:assert/strict";

import {
  findConfirmedMissingGlossaryRecords,
  mergeMetadataBackedGlossarySummaries,
} from "./glossary-discovery.js";

test("glossary discovery hides tombstoned metadata records", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [
      {
        id: "glossary-1",
        repoName: "glossary-1",
        title: "Glossary 1",
        recordState: "tombstone",
      },
    ],
    [
      {
        id: "glossary-1",
        title: "Glossary 1",
        repoName: "glossary-1",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        fullName: "team/glossary-1",
      },
    ],
    [],
    { metadataLoaded: true, remoteLoaded: true },
  );

  assert.equal(merged.length, 0);
});

test("glossary discovery surfaces unregisteredLocal when metadata is missing", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [
      {
        id: "glossary-1",
        repoName: "glossary-1",
        title: "Glossary 1",
        remoteState: "linked",
        resolutionState: "",
      },
    ],
    [],
    [],
    {
      metadataLoaded: true,
      remoteLoaded: true,
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].resolutionState, "unregisteredLocal");
});

test("glossary discovery surfaces repair issues from local repo scans", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [],
    [
      {
        id: "glossary-1",
        title: "Glossary 1",
        repoName: "glossary-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/glossary-1",
      },
    ],
    [],
    {
      metadataLoaded: true,
      remoteLoaded: true,
      repairIssues: [
        {
          kind: "glossary",
          issueType: "missingLocalRepo",
          resourceId: "glossary-1",
          expectedRepoName: "glossary-1",
          message: "Team metadata references this glossary, but its local repo is missing.",
        },
      ],
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].resolutionState, "repair");
  assert.match(merged[0].repairIssueMessage, /local repo is missing/i);
});

test("glossary discovery matches renamed remote repos by stable github repo identity", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [],
    [
      {
        id: "glossary-1",
        title: "Glossary 1",
        repoName: "old-glossary-name",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/old-glossary-name",
        githubRepoId: 84,
      },
    ],
    [
      {
        repoId: 84,
        name: "new-glossary-name",
        fullName: "team/new-glossary-name",
      },
    ],
    {
      metadataLoaded: true,
      remoteLoaded: true,
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].remoteState, "linked");
  assert.equal(merged[0].resolutionState, "");
  assert.equal(merged[0].repoId, 84);
  assert.equal(merged[0].fullName, "team/new-glossary-name");
});

test("glossary discovery keeps a live glossary when old tombstones reuse the same repo name", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [
      {
        id: "live-glossary",
        repoName: "shared-name",
        title: "Live Glossary",
        lifecycleState: "active",
        recordState: "live",
        remoteState: "linked",
        fullName: "team/shared-name",
      },
    ],
    [
      {
        id: "old-glossary-1",
        title: "Old Glossary 1",
        repoName: "shared-name",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        fullName: "team/shared-name",
      },
      {
        id: "old-glossary-2",
        title: "Old Glossary 2",
        repoName: "shared-name",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        fullName: "team/shared-name",
      },
      {
        id: "live-glossary",
        title: "Live Glossary",
        repoName: "shared-name",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/shared-name",
        githubRepoId: 101,
      },
    ],
    [
      {
        repoId: 101,
        name: "shared-name",
        fullName: "team/shared-name",
      },
    ],
    {
      metadataLoaded: true,
      remoteLoaded: true,
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "live-glossary");
  assert.equal(merged[0].recordState, "live");
  assert.equal(merged[0].resolutionState, "");
});

test("glossary discovery identifies live linked metadata records whose remote repo is gone", () => {
  const missing = findConfirmedMissingGlossaryRecords(
    [
      {
        id: "glossary-1",
        title: "Glossary 1",
        repoName: "glossary-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/glossary-1",
      },
      {
        id: "glossary-2",
        title: "Glossary 2",
        repoName: "old-glossary-2",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/old-glossary-2",
        githubRepoId: 84,
      },
    ],
    [
      {
        repoId: 84,
        name: "new-glossary-2",
        fullName: "team/new-glossary-2",
      },
    ],
  );

  assert.deepEqual(missing.map((record) => record.id), ["glossary-1"]);
});

test("glossary discovery drops stale unmatched local glossaries once metadata and repo scan are authoritative", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [
      {
        id: "glossary-1",
        repoName: "glossary-1",
        title: "Glossary 1",
        remoteState: "missing",
        recordState: "live",
      },
    ],
    [],
    [],
    {
      metadataLoaded: true,
      remoteLoaded: true,
      repairLoaded: true,
      repairIssues: [],
    },
  );

  assert.equal(merged.length, 0);
});

test("glossary discovery keeps real stray local glossaries after the repo scan", () => {
  const merged = mergeMetadataBackedGlossarySummaries(
    [
      {
        id: "glossary-1",
        repoName: "glossary-1",
        title: "Glossary 1",
        recordState: "live",
      },
    ],
    [],
    [],
    {
      metadataLoaded: true,
      remoteLoaded: true,
      repairLoaded: true,
      repairIssues: [
        {
          kind: "glossary",
          issueType: "strayLocalRepo",
          repoName: "glossary-1",
          message: "This local glossary repo has no matching team-metadata record and was left as a repair candidate.",
        },
      ],
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "glossary-1");
  assert.equal(merged[0].resolutionState, "repair");
  assert.equal(merged[0].repairIssueType, "strayLocalRepo");
});
