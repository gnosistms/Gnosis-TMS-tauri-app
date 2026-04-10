import test from "node:test";
import assert from "node:assert/strict";

import {
  beginEntityModalSubmit,
  cancelEntityModal,
  entityConfirmationMatches,
  openEntityFormModal,
  openEntityConfirmationModal,
  openEntityRenameModal,
  reopenEntityConfirmationModalWithError,
  updateEntityFormField,
  updateEntityModalConfirmation,
  updateEntityModalName,
} from "./resource-entity-modal.js";

test("shared entity rename modal helper opens modal state with the requested id and name", () => {
  let modalState = null;

  const opened = openEntityRenameModal({
    setState: (nextState) => {
      modalState = nextState;
    },
    entityId: "project-1",
    idField: "projectId",
    nameField: "projectName",
    currentName: "Project One",
  });

  assert.equal(opened, true);
  assert.deepEqual(modalState, {
    isOpen: true,
    status: "idle",
    error: "",
    projectId: "project-1",
    projectName: "Project One",
  });
});

test("shared entity form modal helper opens modal state with arbitrary fields", () => {
  let modalState = null;

  const opened = openEntityFormModal({
    setState: (nextState) => {
      modalState = nextState;
    },
    fields: {
      title: "Glossary One",
      sourceLanguageCode: "en",
    },
  });

  assert.equal(opened, true);
  assert.deepEqual(modalState, {
    isOpen: true,
    status: "idle",
    error: "",
    title: "Glossary One",
    sourceLanguageCode: "en",
  });
});

test("shared entity rename modal helper clears modal errors when the name changes", () => {
  const modalState = {
    isOpen: true,
    status: "idle",
    error: "Existing error",
    glossaryId: "glossary-1",
    glossaryName: "Old",
  };

  updateEntityModalName(modalState, "glossaryName", "New");

  assert.equal(modalState.glossaryName, "New");
  assert.equal(modalState.error, "");
});

test("shared entity form helper clears modal errors when a field changes", () => {
  const modalState = {
    isOpen: true,
    status: "idle",
    error: "Existing error",
    projectName: "Old",
  };

  updateEntityFormField(modalState, "projectName", "New");

  assert.equal(modalState.projectName, "New");
  assert.equal(modalState.error, "");
});

test("shared entity confirmation modal helper opens modal state with blank confirmation text", () => {
  let modalState = null;

  const opened = openEntityConfirmationModal({
    setState: (nextState) => {
      modalState = nextState;
    },
    entityId: "glossary-1",
    idField: "glossaryId",
    nameField: "glossaryName",
    confirmationField: "confirmationText",
    currentName: "Glossary One",
  });

  assert.equal(opened, true);
  assert.deepEqual(modalState, {
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId: "glossary-1",
    glossaryName: "Glossary One",
    confirmationText: "",
  });
});

test("shared entity confirmation helper clears modal errors when confirmation text changes", () => {
  const modalState = {
    isOpen: true,
    status: "idle",
    error: "Existing error",
    projectId: "project-1",
    projectName: "Project One",
    confirmationText: "",
  };

  updateEntityModalConfirmation(modalState, "confirmationText", "Project One");

  assert.equal(modalState.confirmationText, "Project One");
  assert.equal(modalState.error, "");
});

test("shared entity confirmation helper can reopen a modal with the prior confirmation text and error", () => {
  let modalState = null;

  const reopened = reopenEntityConfirmationModalWithError({
    setState: (nextState) => {
      modalState = nextState;
    },
    entityId: "project-1",
    idField: "projectId",
    nameField: "projectName",
    confirmationField: "confirmationText",
    currentName: "Project One",
    confirmationText: "Project One",
    error: "Delete failed",
  });

  assert.equal(reopened, true);
  assert.deepEqual(modalState, {
    isOpen: true,
    status: "idle",
    error: "Delete failed",
    projectId: "project-1",
    projectName: "Project One",
    confirmationText: "Project One",
  });
});

test("shared entity confirmation helper compares confirmation text against the entity name", () => {
  assert.equal(entityConfirmationMatches({
    projectName: "Project One",
    confirmationText: "Project One",
  }, {
    nameField: "projectName",
    confirmationField: "confirmationText",
  }), true);

  assert.equal(entityConfirmationMatches({
    projectName: "Project One",
    confirmationText: "Wrong",
  }, {
    nameField: "projectName",
    confirmationField: "confirmationText",
  }), false);
});

test("shared entity modal submit helper sets loading state and clears errors", () => {
  const modalState = {
    isOpen: true,
    status: "idle",
    error: "Existing error",
  };
  const calls = [];

  beginEntityModalSubmit(modalState, () => {
    calls.push("render");
  });

  assert.equal(modalState.status, "loading");
  assert.equal(modalState.error, "");
  assert.deepEqual(calls, ["render"]);
});

test("shared entity modal cancel helper resets state and re-renders", () => {
  const calls = [];

  cancelEntityModal(
    () => {
      calls.push("reset");
    },
    () => {
      calls.push("render");
    },
  );

  assert.deepEqual(calls, ["reset", "render"]);
});
