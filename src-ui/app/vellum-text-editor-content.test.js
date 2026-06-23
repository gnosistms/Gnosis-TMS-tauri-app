import test from "node:test";
import assert from "node:assert/strict";

import { buildVellumTextEditorContentDecodedXml } from "./vellum-text-editor-content.js";

const VELLUM_ATTACHMENT_CHARACTER = "\uFFFC";
const VELLUM_PARAGRAPH_SEPARATOR = "\u2029";

function decodedNsByteValues(xml) {
  const values = [];
  const pattern = /<key>NS\.bytes<\/key><data>([^<]+)<\/data>/g;
  let match = pattern.exec(xml);
  while (match) {
    values.push(Buffer.from(match[1].replace(/\s+/g, ""), "base64"));
    match = pattern.exec(xml);
  }
  return values;
}

function archiveObjectAtUid(xml, uid) {
  const objectsStartTag = "<key>$objects</key><array>";
  let cursor = xml.indexOf(objectsStartTag);
  assert.notEqual(cursor, -1, "archive object table missing");
  cursor += objectsStartTag.length;

  for (let objectIndex = 0; objectIndex <= uid; objectIndex += 1) {
    while (/\s/.test(xml[cursor] ?? "")) {
      cursor += 1;
    }

    let end = cursor;
    const scalarMatch = xml.slice(cursor).match(/^<(string|integer|real|data)>[\s\S]*?<\/\1>|^<(true|false)\/>/);
    if (scalarMatch) {
      end = cursor + scalarMatch[0].length;
    } else {
      const containerMatch = xml.slice(cursor).match(/^<(dict|array)>/);
      assert.ok(containerMatch, `archive object ${objectIndex} has an unsupported XML shape`);
      const rootTag = containerMatch[1];
      const pattern = new RegExp(`</?${rootTag}>`, "g");
      pattern.lastIndex = cursor;
      let depth = 0;
      let match = pattern.exec(xml);
      while (match) {
        depth += match[0][1] === "/" ? -1 : 1;
        if (depth === 0) {
          end = pattern.lastIndex;
          break;
        }
        match = pattern.exec(xml);
      }
      assert.ok(end > cursor, `archive object ${objectIndex} is unterminated`);
    }

    if (objectIndex === uid) {
      return xml.slice(cursor, end);
    }
    cursor = end;
  }

  throw new Error(`archive object ${uid} not found`);
}

function uidForKey(objectXml, key) {
  const pattern = new RegExp(`<key>${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</key><dict><key>CF\\$UID</key><integer>(\\d+)</integer></dict>`);
  const match = objectXml.match(pattern);
  assert.ok(match, `missing UID for ${key}`);
  return Number(match[1]);
}

function classNameForArchiveObject(xml, objectXml) {
  const classObject = archiveObjectAtUid(xml, uidForKey(objectXml, "$class"));
  const match = classObject.match(/<key>\$classname<\/key><string>([^<]+)<\/string>/);
  assert.ok(match, "class object is missing $classname");
  return match[1];
}

test("buildVellumTextEditorContentDecodedXml writes footnote markers as Vellum attachments", () => {
  const xml = buildVellumTextEditorContentDecodedXml([{
    kind: "text",
    rowId: "row-1",
    languageCode: "en",
    textStyle: "paragraph",
    text: "footnote test [1]",
    footnotes: [{ marker: 1, text: "footnote 1" }],
  }]);

  assert.match(xml, /OGFootnoteAttachmentCell/);
  assert.match(xml, /OGMutableAttachmentFormat/);
  assert.match(xml, /<string>NSAttachment<\/string>/);
  assert.match(xml, /<string>OGAttachmentFormat<\/string>/);
  assert.match(xml, /<string>footnote<\/string>/);
  assert.match(xml, /<string>footnote 1<\/string>/);

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === `footnote test${VELLUM_ATTACHMENT_CHARACTER}`));
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([13, 0, 1, 1]))));
});

test("buildVellumTextEditorContentDecodedXml keeps escaped footnote markers literal", () => {
  const xml = buildVellumTextEditorContentDecodedXml([{
    kind: "text",
    rowId: "row-1",
    languageCode: "en",
    textStyle: "paragraph",
    text: String.raw`literal \[1\] real [1]`,
    footnotes: [{ marker: 1, text: "footnote 1" }],
  }]);

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === `literal [1] real${VELLUM_ATTACHMENT_CHARACTER}`));
});

test("buildVellumTextEditorContentDecodedXml writes ruby as parenthetical fallback text", () => {
  const xml = buildVellumTextEditorContentDecodedXml([{
    kind: "text",
    rowId: "row-ruby",
    languageCode: "ja",
    textStyle: "paragraph",
    text: "Ruby <ruby>漢字<rt>かんじ</rt></ruby> test",
    footnotes: [],
  }]);

  assert.doesNotMatch(xml, /<string>CTRubyAnnotation<\/string>/);
  assert.doesNotMatch(xml, /<string>NSCTRubyAnnotation<\/string>/);
  assert.doesNotMatch(xml, /<string>NSRubyAnnotation<\/string>/);
  assert.doesNotMatch(xml, /<key>TextBefore<\/key>/);

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === "Ruby 漢字（かんじ） test"));
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([17, 0]))));
});

test("buildVellumTextEditorContentDecodedXml writes heading1 as a Vellum subhead attachment", () => {
  const xml = buildVellumTextEditorContentDecodedXml([{
    kind: "text",
    rowId: "row-h1",
    languageCode: "en",
    textStyle: "heading1",
    text: "H1 test",
    footnotes: [],
  }]);

  assert.match(xml, /OGSubheadAttachmentCell/);
  assert.match(xml, /OGMutableAttachmentFormat/);
  assert.match(xml, /<string>subhead<\/string>/);
  assert.match(xml, /<string>level<\/string>/);
  assert.match(xml, /<string>keepWithNext<\/string>/);
  assert.match(xml, /<string>H1 test<\/string>/);

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === `${VELLUM_ATTACHMENT_CHARACTER}${VELLUM_PARAGRAPH_SEPARATOR}`));
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([1, 0, 1, 1]))));
});

test("buildVellumTextEditorContentDecodedXml writes heading2 as a level-2 subhead attachment", () => {
  const xml = buildVellumTextEditorContentDecodedXml([{
    kind: "text",
    rowId: "row-h2",
    languageCode: "en",
    textStyle: "heading2",
    text: "H2 test",
    footnotes: [],
  }]);

  assert.match(xml, /OGSubheadAttachmentCell/);
  assert.match(xml, /<string>subhead<\/string>/);
  assert.match(xml, /<string>H2 test<\/string>/);
  assert.ok(xml.includes([
    "<integer>2</integer>",
    "<dict><key>$classes</key><array><string>NSAttributedString</string><string>NSObject</string></array>",
    "<key>$classname</key><string>NSAttributedString</string></dict>",
    "<string>H2 test</string>",
  ].join("")));

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === `${VELLUM_ATTACHMENT_CHARACTER}${VELLUM_PARAGRAPH_SEPARATOR}`));
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([1, 0, 1, 1]))));
});

test("buildVellumTextEditorContentDecodedXml writes images as Vellum image attachments", () => {
  const xml = buildVellumTextEditorContentDecodedXml([
    {
      kind: "text",
      rowId: "row-1",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Text test p1",
      footnotes: [],
    },
    {
      kind: "image",
      rowId: "row-image",
      languageCode: "en",
      image: {
        kind: "upload",
        path: "chapters/chapter-1/images/row-image/Diogenes.webp",
        filePath: "/tmp/Diogenes.webp",
        fileName: "Diogenes.webp",
      },
      caption: "A <em>caption</em>",
    },
    {
      kind: "text",
      rowId: "row-2",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Text test p2",
      footnotes: [],
    },
  ]);

  assert.match(xml, /OGImageAttachmentCell/);
  assert.match(xml, /OGImageHandle/);
  assert.match(xml, /<string>image<\/string>/);
  assert.match(xml, /<string>imageHasCaption<\/string>/);
  assert.match(xml, /<string>imageHandle<\/string>/);
  assert.match(xml, /<string>imageSize<\/string>/);
  assert.match(xml, /<string>full<\/string>/);
  assert.match(xml, /<string>A caption<\/string>/);
  assert.match(xml, /<string>Diogenes\.webp<\/string>/);
  assert.match(xml, /<string>file:\/\/\/tmp\/Diogenes\.webp<\/string>/);
  assert.doesNotMatch(xml, /Text test p1\\nA caption\\nText test p2/);

  const handleMatch = xml.match(/<key>imageKey<\/key>[\s\S]*?<key>preservedMetadata<\/key><dict><key>CF\$UID<\/key><integer>(\d+)<\/integer><\/dict><key>preservedURL<\/key><dict><key>CF\$UID<\/key><integer>(\d+)<\/integer><\/dict>/);
  assert.ok(handleMatch, "image handle fields missing");
  const preservedMetadataObject = archiveObjectAtUid(xml, Number(handleMatch[1]));
  const preservedUrlObject = archiveObjectAtUid(xml, Number(handleMatch[2]));
  assert.equal(classNameForArchiveObject(xml, preservedMetadataObject), "NSURL");
  assert.equal(classNameForArchiveObject(xml, preservedUrlObject), "NSMutableDictionary");

  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.toString("utf8") === `Text test p1\n${VELLUM_ATTACHMENT_CHARACTER}\nText test p2`));
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([13, 0, 1, 1, 13, 0]))));
});
