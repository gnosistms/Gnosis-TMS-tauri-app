export const teams = [
  { id: "team-1", name: "dummy team" },
  { id: "team-2", name: "English Reference" },
];

export const projects = [
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

export const glossaries = [
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

export const glossaryTerms = [
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

export const translationRows = [
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
