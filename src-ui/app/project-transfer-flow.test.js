import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetProjectTransferJobsForTests,
  eligibleProjectTransferTargets,
  recoverPendingProjectTransfers,
  reconcileProjectTransferGlossaries,
  registerProjectTransferListeners,
  submitProjectTransfer,
} from "./project-transfer-flow.js";
import { createProjectTransferState, state } from "./state.js";

globalThis.window = {
  setTimeout,
  clearTimeout,
};

function team(id, installationId, membershipRole = "admin") {
  return {
    id,
    installationId,
    membershipRole,
    githubOrg: `org-${id}`,
    name: `Team ${id}`,
  };
}

function resetFixture() {
  __resetProjectTransferJobsForTests();
  state.teams = [team("source", 1), team("target", 2), team("viewer", 3, "viewer")];
  state.selectedTeamId = "source";
  state.projects = [{
    id: "source-project",
    name: "source-repo",
    title: "Source Project",
    chapters: [],
  }];
  state.deletedProjects = [];
  state.projectTransfer = {
    ...createProjectTransferState(),
    isOpen: true,
    projectId: "source-project",
    sourceTitle: "Source Project",
    targetTeamId: "target",
    projectName: "Copied Project",
    resourcesStatus: "done",
    targetProjects: [{ id: "other", name: "existing-repo", title: "Existing" }],
  };
}

function transferStatus(jobId, {
  status = "success",
  message = status === "success" ? "Transferred." : "Push failed.",
  copiedChapters = status === "success" ? 2 : 0,
} = {}) {
  return {
    jobId,
    status,
    message,
    copiedChapters,
    targetProjectTitle: "Copied Project",
    recovery: {
      targetInstallationId: 2,
      targetOrgLogin: "org-target",
      targetProjectId: "new-project",
      targetRepoName: "copied-project",
      metadataRepoName: "copied-project",
      previousRepoNames: [],
      targetFullName: "org-target/copied-project",
      targetRepoId: 22,
      targetNodeId: "node-22",
      targetDefaultBranch: "main",
      targetLifecycleState: "active",
      targetRecordState: "live",
      targetRemoteState: "linked",
      sourceProjectTitle: "Source Project",
    },
  };
}

function durableInvoke({
  terminal = {},
  onStart = () => {},
  onAcknowledge = () => {},
} = {}) {
  let jobId = "";
  return async (command, payload) => {
    if (command === "transfer_gtms_project_to_team") {
      jobId = payload.input.jobId;
      onStart(payload);
      return;
    }
    if (command === "get_gtms_project_transfer_status") {
      return transferStatus(payload.input.jobId || jobId, terminal);
    }
    if (command === "acknowledge_gtms_project_transfer_status") {
      onAcknowledge(payload.input.jobId);
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  };
}

test("eligible transfer targets require project-create capability and include the current team", () => {
  resetFixture();
  assert.deepEqual(
    eligibleProjectTransferTargets().map((entry) => entry.id),
    ["source", "target"],
  );
});

test("listener registration waits once before starting durable recovery", async () => {
  resetFixture();
  let releaseListener;
  let listenCalls = 0;
  let listCalls = 0;
  const listenerReady = new Promise((resolve) => {
    releaseListener = resolve;
  });
  const operations = {
    listen: async () => {
      listenCalls += 1;
      await listenerReady;
    },
    requireBrokerSession: () => "session",
    invoke: async (command) => {
      assert.equal(command, "list_gtms_project_transfer_statuses");
      listCalls += 1;
      return [];
    },
  };

  const first = registerProjectTransferListeners(() => {}, operations);
  const second = registerProjectTransferListeners(() => {}, operations);
  assert.equal(listenCalls, 1);
  assert.equal(listCalls, 0);

  releaseListener();
  await Promise.all([first, second]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(listenCalls, 1);
  assert.equal(listCalls, 1);
});

test("transfer glossary reconciliation uses metadata identity and cached term counts", () => {
  const result = reconcileProjectTransferGlossaries(
    [
      {
        id: "g-small",
        title: "Alpha",
        repoName: "alpha-repo",
        githubRepoId: 11,
        lifecycleState: "active",
        recordState: "live",
        remoteState: "linked",
      },
      {
        id: "g-large",
        title: "Zulu",
        repoName: "zulu-repo",
        githubRepoId: 12,
        lifecycleState: "active",
        recordState: "live",
        remoteState: "linked",
      },
      {
        id: "g-deleted",
        title: "Deleted",
        repoName: "deleted-repo",
        githubRepoId: 13,
        lifecycleState: "deleted",
        recordState: "live",
        remoteState: "linked",
      },
    ],
    [
      { repoId: 11, name: "alpha-repo", fullName: "org/alpha-repo" },
      { repoId: 12, name: "zulu-repo", fullName: "org/zulu-repo" },
      { repoId: 13, name: "deleted-repo", fullName: "org/deleted-repo" },
    ],
    [
      { id: "g-small", termCount: 2 },
      { id: "g-large", termCount: 9 },
    ],
  );
  assert.deepEqual(result.map((entry) => entry.id), ["g-large", "g-small"]);
  assert.equal(result[0].repoName, "zulu-repo");
});

test("submit serializes target creation and exact source reads, then publishes metadata", async () => {
  resetFixture();
  const order = [];
  const scopes = [];
  const metadata = [];

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ scope, kind, run }) => {
      scopes.push({ scope, kind });
      order.push(`${kind}:start`);
      const value = await run();
      order.push(`${kind}:end`);
      return value;
    },
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      title: "Copied Project",
      collisionResolved: false,
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
        defaultBranchName: "main",
      },
      metadataRecord: {
        projectId: "new-project",
        title: "Copied Project",
        repoName: "copied-project",
      },
    }),
    invoke: durableInvoke({
      terminal: { copiedChapters: 4 },
      onStart: (payload) => {
        assert.equal(payload.input.source.projectId, "source-project");
        assert.equal(payload.input.target.orgLogin, "org-target");
      },
      onAcknowledge: () => order.push("ack"),
    }),
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async (_target, record) => {
      order.push("metadata");
      metadata.push(record);
    },
    projectsPageOwnsTeam: () => false,
    rollbackCreatedProjectRepo: async () => {
      throw new Error("rollback should not run");
    },
  });

  assert.equal(result, true);
  assert.deepEqual(scopes, [
    { scope: "2:projects", kind: "projectTransfer" },
    { scope: "1:source-project:source-repo", kind: "projectTransferSourceRead" },
  ]);
  assert.deepEqual(order, [
    "projectTransfer:start",
    "projectTransferSourceRead:start",
    "projectTransferSourceRead:end",
    "metadata",
    "ack",
    "projectTransfer:end",
  ]);
  assert.equal(metadata[0].chapterCount, 4);
});

test("lost terminal events recover through durable status polling", async () => {
  resetFixture();
  let jobId = "";
  let reads = 0;
  let acknowledged = false;
  let metadataCount = null;

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
      },
      metadataRecord: { projectId: "new-project", title: "Copied Project" },
    }),
    invoke: async (command, payload) => {
      if (command === "transfer_gtms_project_to_team") {
        jobId = payload.input.jobId;
        return;
      }
      if (command === "get_gtms_project_transfer_status") {
        reads += 1;
        return reads === 1
          ? { ...transferStatus(jobId), status: "progress", message: "Copying..." }
          : transferStatus(jobId, { copiedChapters: 5 });
      }
      if (command === "acknowledge_gtms_project_transfer_status") {
        acknowledged = true;
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async (_team, record) => {
      metadataCount = record.chapterCount;
    },
    projectsPageOwnsTeam: () => false,
  });

  assert.equal(result, true);
  assert.equal(reads, 2);
  assert.equal(metadataCount, 5);
  assert.equal(acknowledged, true);
});

test("reload recovery publishes terminal success and acknowledges only afterward", async () => {
  resetFixture();
  state.projectTransfer = createProjectTransferState();
  const status = transferStatus("reloaded-job", { copiedChapters: 6 });
  const order = [];

  const recovered = await recoverPendingProjectTransfers(() => {}, {
    requireBrokerSession: () => "session",
    invoke: async (command, payload) => {
      if (command === "list_gtms_project_transfer_statuses") {
        return [status];
      }
      if (command === "acknowledge_gtms_project_transfer_status") {
        assert.equal(payload.input.jobId, "reloaded-job");
        order.push("ack");
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    upsertProjectMetadataRecord: async (_team, record) => {
      order.push(`metadata:${record.chapterCount}`);
    },
  });

  assert.equal(recovered, true);
  assert.deepEqual(order, ["metadata:6", "ack"]);
});

test("reload recovery rolls back a terminal push failure before acknowledging", async () => {
  resetFixture();
  const status = transferStatus("failed-job", {
    status: "error",
    message: "Content push failed.",
  });
  const order = [];

  await recoverPendingProjectTransfers(() => {}, {
    requireBrokerSession: () => "session",
    invoke: async (command) => {
      if (command === "list_gtms_project_transfer_statuses") {
        return [status];
      }
      if (command === "acknowledge_gtms_project_transfer_status") {
        order.push("ack");
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
    rollbackCreatedProjectRepo: async (_team, created, error, options) => {
      assert.equal(created.projectId, "new-project");
      assert.match(error.message, /Content push failed/);
      assert.equal(options.rethrowCause, false);
      order.push("rollback");
    },
  });

  assert.deepEqual(order, ["rollback", "ack"]);
});

test("terminal events still finish metadata publication after modal state resets", async () => {
  resetFixture();
  let metadataWritten = false;

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
        defaultBranchName: "main",
      },
      metadataRecord: {
        projectId: "new-project",
        title: "Copied Project",
        repoName: "copied-project",
      },
    }),
    invoke: durableInvoke({
      terminal: { copiedChapters: 2 },
      onStart: () => {
        state.projectTransfer = createProjectTransferState();
      },
    }),
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async () => {
      metadataWritten = true;
    },
    projectsPageOwnsTeam: () => false,
  });

  assert.equal(result, true);
  assert.equal(metadataWritten, true);
});

test("a transfer refreshes and selects the copy when the target projects page is visible", async () => {
  resetFixture();
  state.screen = "projects";
  let reloaded = false;

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
      },
      metadataRecord: { projectId: "new-project", title: "Copied Project" },
    }),
    invoke: durableInvoke({ terminal: { copiedChapters: 3 } }),
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async () => {},
    projectsPageOwnsTeam: () => true,
    reloadProjectsAfterWrite: async () => {
      reloaded = true;
    },
  });

  assert.equal(result, true);
  assert.equal(reloaded, true);
  assert.equal(state.selectedProjectId, "new-project");
});

test("terminal transfer errors roll back and never publish metadata", async () => {
  resetFixture();
  let rolledBack = false;
  let metadataWritten = false;

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
      },
      metadataRecord: { projectId: "new-project" },
    }),
    invoke: durableInvoke({ terminal: { status: "error", message: "Push failed." } }),
    pollDelayMs: 0,
    rollbackCreatedProjectRepo: async () => {
      rolledBack = true;
    },
    upsertProjectMetadataRecord: async () => {
      metadataWritten = true;
    },
    projectsPageOwnsTeam: () => false,
  });

  assert.equal(result, false);
  assert.equal(rolledBack, true);
  assert.equal(metadataWritten, false);
  assert.match(state.projectTransfer.error, /Push failed/);
});

test("metadata push failure deletes metadata before rolling back the created project", async () => {
  resetFixture();
  const order = [];

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
      },
      metadataRecord: { projectId: "new-project", title: "Copied Project" },
    }),
    invoke: durableInvoke({
      terminal: { copiedChapters: 2 },
      onAcknowledge: () => order.push("ack"),
    }),
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async () => {
      order.push("metadata-upsert");
      throw new Error("metadata push failed");
    },
    deleteProjectMetadataRecord: async (_team, projectId, options) => {
      assert.equal(projectId, "new-project");
      assert.equal(options.requirePushSuccess, true);
      order.push("metadata-delete");
    },
    rollbackCreatedProjectRepo: async () => {
      order.push("project-rollback");
    },
    projectsPageOwnsTeam: () => false,
  });

  assert.equal(result, false);
  assert.deepEqual(
    order,
    ["metadata-upsert", "metadata-delete", "project-rollback", "ack"],
  );
  assert.match(state.projectTransfer.error, /metadata push failed/);
});

test("ambiguous metadata cleanup preserves the created project", async () => {
  resetFixture();
  let projectRolledBack = false;

  const result = await submitProjectTransfer(() => {}, {
    requireBrokerSession: () => "session",
    enqueueRepoWrite: async ({ run }) => run(),
    createProjectRepoForTeam: async () => ({
      projectId: "new-project",
      repoName: "copied-project",
      localRepoInitialized: true,
      remoteProject: {
        name: "copied-project",
        fullName: "org-target/copied-project",
        repoId: 22,
      },
      metadataRecord: { projectId: "new-project", title: "Copied Project" },
    }),
    invoke: durableInvoke({ terminal: { copiedChapters: 2 } }),
    pollDelayMs: 0,
    upsertProjectMetadataRecord: async () => {
      throw new Error("metadata push outcome unknown");
    },
    deleteProjectMetadataRecord: async () => {
      throw new Error("metadata cleanup push outcome unknown");
    },
    rollbackCreatedProjectRepo: async () => {
      projectRolledBack = true;
    },
    projectsPageOwnsTeam: () => false,
  });

  assert.equal(result, false);
  assert.equal(projectRolledBack, false);
  assert.match(state.projectTransfer.error, /destination project was preserved/);
});
