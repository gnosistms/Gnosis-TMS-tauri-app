import test from "node:test";
import assert from "node:assert/strict";

import { pickerSelectedCode, renderLanguagePickerModal } from "./language-picker-modal.js";

test("the shared picker lists both Chinese scripts with the alphabet-slider list class", () => {
  const html = renderLanguagePickerModal({
    dialogName: "demo", titleId: "demo-title", eyebrow: "DEMO", title: "Pick", listLabel: "Languages",
    selectedCode: "zh-hant", selectAction: "pick-language", nested: true, actionsHtml: "",
  });
  assert.match(html, /class="language-picker-modal__list"/);
  assert.match(html, /modal-backdrop--nested-picker/);
  assert.match(html, /data-action="pick-language:zh-Hans"/);
  assert.match(html, /data-action="pick-language:zh-Hant"[\s\S]*?aria-selected="true"/);
  assert.doesNotMatch(html, /data-action="pick-language:zh"/);
  assert.ok(html.indexOf("Chinese (Simplified)") < html.indexOf("Chinese (Traditional)"));
});

test("selected codes are normalised and unknown codes select nothing", () => {
  assert.equal(pickerSelectedCode("zh_hans"), "zh-Hans");
  assert.equal(pickerSelectedCode("zh"), "");
});
