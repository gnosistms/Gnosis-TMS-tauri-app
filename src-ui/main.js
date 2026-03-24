const app = document.querySelector("#app");

const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: "team-1",
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
};

const teams = [
  { id: "team-1", name: "dummy team" },
  { id: "team-2", name: "English Reference" },
];

const projects = [
  {
    id: "p1",
    name: "goo",
    chapters: [
      { id: "c1", name: "goo chapter 00", glossary: "Gnosis4.tmx" },
      { id: "c1b", name: "goo chapter 01", glossary: "Brasington EN-VI.tmx" },
    ],
  },
  {
    id: "p2",
    name: "HNHH",
    chapters: [
      { id: "c2", name: "HNHH chapter 00 (p2)", glossary: "Gnosis4.tmx" },
      { id: "c3", name: "HNHH chapter 01", glossary: "Gnosis4.tmx" },
      { id: "c4", name: "HNHH chapter 02", glossary: "no glossary" },
      { id: "c5", name: "HNHH chapter 03", glossary: "Gnosis4.tmx" },
      { id: "c6", name: "HNHH chapter 04", glossary: "Brasington EN-VI-1773328943535.tmx" },
      { id: "c7", name: "HNHH chapter 05", glossary: "no glossary" },
      { id: "c8", name: "HNHH chapter 06", glossary: "Gnosis4.tmx" },
      { id: "c9", name: "HNHH chapter 07 (p2)", glossary: "65583f3acd4b07e378e8f603" },
    ],
  },
  {
    id: "p3",
    name: "Project 1",
    chapters: [
      { id: "c10", name: "Project 1 chapter 01", glossary: "Gnosis4.tmx" },
    ],
  },
];

const glossaries = [
  {
    id: "g1",
    name: "Brasington EN-VI-1773328943535.tmx",
    sourceLanguage: "English",
    targetLanguage: "Vietnamese",
  },
  {
    id: "g2",
    name: "Gnosis4.tmx",
    sourceLanguage: "Spanish",
    targetLanguage: "Vietnamese",
  },
];

const glossaryTerms = [
  ["a voluntad", "chu dong, theo y muon"],
  ["Abismo", "vuc tham, dia nguc"],
  ["abominable, abominables", "dang kinh, ghe gom, gom ghiec, ghe tom"],
  ["ABSOLUTO INMANIFESTADO", "coi tuyet doi chua bieu hien"],
  ["acto sexual", "quan he tinh duc, giao hop, tinh duc"],
  ["adepto, adeptos", "dao su, dao si"],
  ["Adonai, Adonai", "A-do-nai"],
  ["adviene", "giang sinh, dan sinh, den"],
  ["agregados", "cau truc tam ly, cau truc, hanh"],
  ["Agregados Psiquicos", "cau truc tam ly, cac cai toi, hanh"],
];

const translationRows = [
  {
    id: "t1",
    sourceTitle: "Chapter 1: el AMOR",
    targetTitle: "Chuong 1: TINH YEU",
    sourceBody:
      "Krishna, an incarnation of Christ, with his wife Radha",
    targetBody:
      "Krishna, mot hien than cua Chua Kito, cung vo la Radha",
    targetEditable: true,
    notes:
      "Chua Giesu voi Maria Magdalena - Tranh kinh cua Stephen Adam trong nha tho Kilmore, Scotland, 1906.",
    status: "Reviewed",
  },
  {
    id: "t2",
    sourceTitle: "Dios, como PADRE, es SABIDURIA.",
    targetTitle: "Thien Chua, la CHA, la SU KHON NGOAN.",
    sourceBody:
      "God as Father is wisdom. God as Mother is love. God as Father resides within the eye of wisdom.",
    targetBody:
      "Thien Chua, la CHA, la SU KHON NGOAN. Thien Chua, voi tu cach la ME, la TINH YEU.",
    targetEditable: false,
    notes:
      "Secondary row placeholder to establish the vertical rhythm of the mock translate page.",
    status: "Please Check",
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function navButton(label, target, isGhost = false) {
  return `<button class="header-nav__button${
    isGhost ? " header-nav__button--ghost" : ""
  }" data-nav-target="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
}

function primaryButton(label, action) {
  return `<button class="button button--primary" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
}

function textAction(label, action) {
  return `<button class="text-action" data-action="${escapeHtml(
    action,
  )}">${escapeHtml(label)}</button>`;
}

function pageShell({ title, navButtons = [], tools = "", body = "" }) {
  return `
    <div class="screen screen--page">
      <header class="page-header">
        <div class="page-header__nav">${navButtons.join("")}</div>
        <div class="page-header__title-wrap">
          <h1 class="page-header__title">${escapeHtml(title)}</h1>
        </div>
        <div class="page-header__tools">${tools}</div>
      </header>
      <main class="page-body">${body}</main>
    </div>
  `;
}

function createSearchField(placeholder = "Search") {
  return `
    <label class="search-field">
      <span class="search-field__icon">⌕</span>
      <input type="text" placeholder="${escapeHtml(placeholder)}" />
    </label>
  `;
}

function renderStartScreen() {
  return `
    <main class="screen screen--start">
      <article class="card card--hero">
        <div class="card__body">
          <p class="card__eyebrow">INVERENCIAL PEACE!</p>
          <h1 class="card__title">Gnosis TMS</h1>
          <p class="card__subtitle">
            Sign in with your GitHub account to access your teams, shared projects,
            and glossary workflows.
          </p>
          <p class="card__supporting">
            Creating a GitHub account is free. We use GitHub to manage storage for
            shared files and collaboration history.
          </p>
          <div class="hero-actions">
            ${primaryButton("Log in with GitHub", "login-with-github")}
            <a
              class="hero-link"
              href="https://github.com/signup"
              target="_blank"
              rel="noreferrer"
            >
              Create a free GitHub account
            </a>
          </div>
        </div>
      </article>
    </main>
  `;
}

function renderTeamsScreen() {
  const cards = teams
    .map(
      (team) => `
        <article class="card card--list-row">
          <div class="card__body list-row">
            <div class="list-row__content">
              <h2 class="list-row__title">${escapeHtml(team.name)}</h2>
            </div>
            <div class="list-row__actions">
              ${textAction("Open", `open-team:${team.id}`)}
              ${textAction("Rename", "noop")}
              ${textAction("Delete", "noop")}
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  return pageShell({
    title: "Translation Teams",
    navButtons: [navButton("Logout", "start")],
    tools: primaryButton("+ New Team", "noop"),
    body: `<section class="stack">${cards}</section>`,
  });
}

function renderProjectCard(project) {
  const expanded = state.expandedProjects.has(project.id);
  const chapterCount = `${project.chapters.length} chapter${
    project.chapters.length === 1 ? "" : "s"
  }`;

  const chapterRows = expanded
    ? `
      <div class="expandable-card__body">
        <div class="chapter-table">
          ${project.chapters
            .map(
              (chapter) => `
                <div class="chapter-table__row">
                  <div class="chapter-table__name">${escapeHtml(chapter.name)}</div>
                  <div class="chapter-table__glossary">
                    <button class="glossary-pill" data-action="open-glossaries">${escapeHtml(
                      chapter.glossary,
                    )} <span>⌄</span></button>
                  </div>
                  <div class="chapter-table__actions">
                    ${textAction("Open", `open-translate:${chapter.id}`)}
                    ${textAction("Download", "noop")}
                    ${textAction("Rename", "noop")}
                    ${textAction("Delete", "noop")}
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  return `
    <article class="card card--expandable ${expanded ? "is-expanded" : ""}">
      <div class="expandable-card__header">
        <button class="chevron-button" data-action="toggle-project:${project.id}">
          <span class="chevron ${expanded ? "is-open" : ""}"></span>
        </button>
        <div class="expandable-card__title-wrap">
          <h2 class="expandable-card__title">${escapeHtml(project.name)}</h2>
          <span class="expandable-card__meta">${escapeHtml(chapterCount)}</span>
        </div>
        <div class="expandable-card__actions">
          ${textAction("Rename", "noop")}
          ${textAction("Import", "noop")}
          ${textAction("Delete", "noop")}
        </div>
      </div>
      ${chapterRows}
    </article>
  `;
}

function renderProjectsScreen() {
  const selectedTeam = teams.find((team) => team.id === state.selectedTeamId) ?? teams[0];

  return pageShell({
    title: "Projects",
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Project", "noop")}`,
    body: `<section class="stack">${projects.map(renderProjectCard).join("")}</section>`,
  }).replace("<h1 class=\"page-header__title\">Projects</h1>", `<h1 class="page-header__title">${escapeHtml(selectedTeam.name)} - Projects</h1>`);
}

function renderGlossariesScreen() {
  return pageShell({
    title: "Glossaries",
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Projects", "projects"),
    ],
    tools: `${textAction("Upload", "noop")} ${primaryButton("+ New Glossary", "noop")}`,
    body: `
      <section class="table-card">
        <div class="table-card__header glossary-list glossary-list--head">
          <div>Name</div>
          <div>Source Language</div>
          <div>Target Language</div>
          <div></div>
        </div>
        ${glossaries
          .map(
            (glossary) => `
              <div class="glossary-list glossary-list--row">
                <div class="glossary-list__name">
                  <button class="text-link" data-action="open-glossary:${glossary.id}">${escapeHtml(
                    glossary.name,
                  )}</button>
                </div>
                <div>${escapeHtml(glossary.sourceLanguage)}</div>
                <div>${escapeHtml(glossary.targetLanguage)}</div>
                <div class="glossary-list__actions">
                  ${textAction("Rename", "noop")}
                  ${textAction("Open", `open-glossary:${glossary.id}`)}
                  ${textAction("Download", "noop")}
                  ${textAction("Delete", "noop")}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
    `,
  });
}

function renderGlossaryEditorScreen() {
  const glossary = glossaries.find((item) => item.id === state.selectedGlossaryId) ?? glossaries[0];

  return pageShell({
    title: glossary.name,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Glossaries", "glossaries"),
    ],
    tools: `${createSearchField("Search")} ${primaryButton("+ New Term", "noop")}`,
    body: `
      <section class="table-card">
        <div class="term-grid term-grid--head">
          <div>Spanish</div>
          <div>Vietnamese</div>
          <div></div>
        </div>
        ${glossaryTerms
          .map(
            ([source, target]) => `
              <div class="term-grid term-grid--row">
                <div>${escapeHtml(source)}</div>
                <div>${escapeHtml(target)}</div>
                <div class="term-grid__actions">
                  ${textAction("Edit", "noop")}
                  ${textAction("Delete", "noop")}
                </div>
              </div>
            `,
          )
          .join("")}
      </section>
    `,
  });
}

function renderTranslateScreen() {
  const chapter =
    projects.flatMap((project) => project.chapters).find((item) => item.id === state.selectedChapterId) ??
    projects[1].chapters[0];

  return pageShell({
    title: chapter.name,
    navButtons: [
      navButton("Logout", "start"),
      navButton("Teams", "teams"),
      navButton("Projects", "projects"),
      navButton("Glossaries", "glossaries"),
    ],
    body: `
      <section class="translate-toolbar card">
        <div class="card__body translate-toolbar__body">
          <div class="toolbar-row">
            <button class="pill pill--active">Translate</button>
            <button class="pill">Preview</button>
            <button class="select-pill">Source: Spanish <span>⌄</span></button>
            <button class="select-pill">Target: Vietnamese <span>⌄</span></button>
            <button class="select-pill">Font Size: 14 <span>⌄</span></button>
            <button class="select-pill">Visible languages: 3 <span>⌄</span></button>
            <button class="select-pill">Filter: Show all <span>⌄</span></button>
          </div>
          <div class="toolbar-row toolbar-row--between">
            <div class="toolbar-search">
              ${createSearchField("Search")}
              <label class="replace-toggle"><input type="checkbox" /> Replace</label>
            </div>
            <div class="toolbar-meta">
              <span>936 source words</span>
              ${textAction("Unreview All", "noop")}
              ${textAction("Download", "noop")}
            </div>
          </div>
        </div>
      </section>
      <section class="translate-layout">
        <div class="translate-main">
          ${translationRows
            .map(
              (row) => `
                <article class="card card--translation">
                  <div class="card__body">
                    <div class="translation-row__meta">
                      ${textAction("Insert", "noop")}
                      ${textAction("Delete", "noop")}
                    </div>
                    <div class="translation-row__grid">
                      <div class="translation-cell">
                        <div class="translation-cell__title">${escapeHtml(row.sourceTitle)}</div>
                        <p>${escapeHtml(row.sourceBody)}</p>
                        <textarea>${
                          row.targetEditable ? escapeHtml(row.notes) : ""
                        }</textarea>
                        <div class="translation-cell__actions">
                          <button class="button button--secondary">Cancel</button>
                          <button class="button button--primary">Save</button>
                          <button class="button button--primary">Save & Review</button>
                        </div>
                      </div>
                      <div class="translation-cell">
                        <div class="translation-cell__title">${escapeHtml(row.targetTitle)}</div>
                        <p>${escapeHtml(row.targetBody)}</p>
                        <div class="translation-cell__note">${escapeHtml(row.notes)}</div>
                      </div>
                    </div>
                    <div class="translation-row__footer">
                      <span class="status-badge status-badge--${
                        row.status === "Reviewed" ? "good" : "warning"
                      }">${escapeHtml(row.status)}</span>
                      <button class="button button--secondary">Comments</button>
                    </div>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
        <aside class="card card--history">
          <div class="card__body">
            <div class="history-tabs">
              <button class="history-tabs__item history-tabs__item--active">History</button>
              <button class="history-tabs__item">Comments</button>
              <button class="history-tabs__item">Duplicates</button>
            </div>
            <div class="history-stack">
              ${[1, 2, 3]
                .map(
                  (index) => `
                    <article class="history-item">
                      <h3>Chuong 1 - Tinh yeu</h3>
                      <p>Uploaded 27/01/2026</p>
                      <button class="button button--secondary">Restore</button>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </div>
        </aside>
      </section>
    `,
  });
}

function render() {
  const screenMarkup = {
    start: renderStartScreen(),
    teams: renderTeamsScreen(),
    projects: renderProjectsScreen(),
    glossaries: renderGlossariesScreen(),
    glossaryEditor: renderGlossaryEditorScreen(),
    translate: renderTranslateScreen(),
  }[state.screen];

  app.innerHTML = screenMarkup;

  const titles = {
    start: "Gnosis TMS",
    teams: "Translation Teams - Gnosis TMS",
    projects: "Projects - Gnosis TMS",
    glossaries: "Glossaries - Gnosis TMS",
    glossaryEditor: "Glossary Editor - Gnosis TMS",
    translate: "Translate - Gnosis TMS",
  };

  document.title = titles[state.screen] ?? "Gnosis TMS";
}

document.addEventListener("click", (event) => {
  const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
  if (navTarget) {
    state.screen = navTarget;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) {
    return;
  }

  if (action === "login-with-github") {
    state.screen = "teams";
    render();
    return;
  }

  if (action.startsWith("open-team:")) {
    state.selectedTeamId = action.split(":")[1];
    state.screen = "projects";
    render();
    return;
  }

  if (action.startsWith("toggle-project:")) {
    const projectId = action.split(":")[1];
    if (state.expandedProjects.has(projectId)) {
      state.expandedProjects.delete(projectId);
    } else {
      state.expandedProjects.add(projectId);
    }
    render();
    return;
  }

  if (action.startsWith("open-glossary:")) {
    state.selectedGlossaryId = action.split(":")[1];
    state.screen = "glossaryEditor";
    render();
    return;
  }

  if (action === "open-glossaries") {
    state.screen = "glossaries";
    render();
    return;
  }

  if (action.startsWith("open-translate:")) {
    state.selectedChapterId = action.split(":")[1];
    state.screen = "translate";
    render();
  }
});

render();
