import test from "node:test";
import assert from "node:assert/strict";

import { mergeMetadataBackedGlossarySummaries } from "./glossary-discovery.js";

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
