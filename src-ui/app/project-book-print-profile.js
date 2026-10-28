export function bookPrintProfile(modal) {
  const code = String(modal.languageCode || "").toLowerCase().replaceAll("_", "-");
  const latin = !/^(ja|ko|zh|ar|fa)/.test(code);
  const family = code.startsWith("ja") ? "Shippori Mincho" : code.startsWith("ko") ? "Noto Serif KR"
    : /^(zh-hant|zh-tw|zh-hk)/.test(code) ? "Noto Serif TC" : code.startsWith("zh") ? "Noto Serif SC"
      : /^(ar|fa)/.test(code) ? "Noto Naskh Arabic" : "Crimson Pro";
  const saved = modal.book?.previewFonts?.profile;
  return {
    latin, direction: /^(ar|fa)/.test(code) ? "rtl" : "ltr", bodySizePt: latin ? 11.5 : 11,
    bodyFamilies: latin ? [family, "EB Garamond", "Cormorant Garamond Gnosis"] : [family, "EB Garamond"],
    headingFamilies: latin ? ["Alegreya", "EB Garamond", "Cormorant Garamond Gnosis"] : [family, "EB Garamond"],
    lineHeight: latin ? 1.3532421875 : 1.38, frontMatterLineHeight: latin ? 1.2532421875 : 1.41,
    headingLineHeight: latin ? 1.417 : 1.38, footnoteLineHeight: latin ? 1.0732421875 : 1.23, wordSpacingEm: latin ? .02 : 0,
    ...saved,
  };
}

export function bookPrintVariables(modal, kind) {
  const profile = bookPrintProfile(modal);
  const stack = (families) => [...new Set([...families, ...(profile.fallbackFamilies || [])])].map((family) => JSON.stringify(family)).join(",") + ",serif";
  return `--book-body-font:${stack(profile.bodyFamilies)};--book-heading-font:${stack(profile.headingFamilies)};--book-line-height:${profile.lineHeight};--book-front-line-height:${profile.frontMatterLineHeight};--book-footnote-line-height:${profile.footnoteLineHeight};--book-heading-line-height:${profile.headingLineHeight};--book-word-spacing:${profile.wordSpacingEm}em;--book-h1-size:${profile.latin ? 13 / profile.bodySizePt : 1.4}em;--book-h2-size:${profile.latin ? 12 / profile.bodySizePt : 1.2}em;--book-heading-weight:${profile.latin ? 400 : 700};--book-direction:${profile.direction};--book-first-indent:${profile.latin && kind === "chapter" ? "1.5em" : "0em"}`;
}
