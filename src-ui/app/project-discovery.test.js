import test from "node:test";
import assert from "node:assert/strict";

import { mergeMetadataDiscoveryProjects } from "./project-discovery.js";

test("metadata-backed project discovery ignores remote repos that have no metadata record", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        fullName: "team/project-1",
      },
      {
        id: "project-2",
        name: "project-2",
        title: "Project 2",
        fullName: "team/project-2",
      },
    ],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "project-1");
});

test("project discovery still falls back to remote repos when metadata could not be loaded", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [],
    remoteProjects: [
      {
        id: "project-2",
        name: "project-2",
        title: "Project 2",
        fullName: "team/project-2",
      },
    ],
    localProjects: [],
    metadataLoaded: false,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "project-2");
  assert.equal(merged[0].remoteState, "linked");
});

test("project discovery hides tombstoned metadata records", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [],
    localProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        fullName: "team/project-1",
        recordState: "tombstone",
      },
    ],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 0);
});
