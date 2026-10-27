import { readFile } from "node:fs/promises";
import { expect, test } from "./test.js";

const rust = await readFile(new URL("../../src-tauri/src/glossary_research_studio/dle.rs", import.meta.url), "utf8");
const script = rust.match(/const EXTRACT_SCRIPT: &str = r#"([\s\S]*?)"#;/)[1]
  .replaceAll("RESULT_HOST", "gnosis-research.invalid");

async function readEntry(page, html) {
  const result = new Promise((resolve) => {
    page.route("https://gnosis-research.invalid/**", async (route) => {
      resolve(JSON.parse(new URL(route.request().url()).searchParams.get("data")));
      await route.abort();
    });
  });
  await page.setContent(html);
  await page.addScriptTag({ content: script });
  return result;
}

test("DLE suggestions on a missing-entry page are not dictionary evidence", async ({ page }) => {
  const result = await readEntry(page, `<article>
    <p>La palabra van- no está registrada en el Diccionario.</p>
    <h3><a href="/vano">vano</a></h3>
    <h3><a href="/vanidad">vanidad</a></h3>
  </article>`);
  expect(result.status).toBe("not_found");
  expect(result.entry).toBeUndefined();
  expect(result.message).toContain("no está registrada");
});

test("DLE reader preserves a real entry's senses and complex forms", async ({ page }) => {
  const result = await readEntry(page, `<article><h1>vanidad</h1><section class="c-section">
    <p class="c-text-intro">Del lat. vanĭtas.</p>
    <ol class="c-definitions"><li><div class="c-definitions__item"><div>
      <span class="n_acep">1.</span><abbr title="nombre femenino">f.</abbr> Arrogancia, presunción.
    </div></div></li></ol>
    <h3 id="locucion"><a href="/vanidad#locucion">ajar la vanidad</a></h3>
  </section></article>`);
  expect(result.status).toBe("found");
  expect(result.entry.articles[0]).toMatchObject({
    headword: "vanidad", etymology: "Del lat. vanĭtas.",
    senses: [{ number: "1", definition: "Arrogancia, presunción." }],
    complexForms: [{ form: "ajar la vanidad", id: "locucion" }],
  });
});

test("DLE reader reports a browser challenge without inventing a negative entry", async ({ page }) => {
  const result = await readEntry(page, '<title>Just a moment</title><p>Verify you are human</p>');
  expect(result.status).toBe("needs_person");
  expect(result.entry).toBeUndefined();
});
