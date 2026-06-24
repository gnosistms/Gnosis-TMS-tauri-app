import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPreparedVellumImageResources,
  buildVellumImageResourceRequests,
  buildVellumOgElementPrivateDecodedXml,
  buildVellumTextEditorContentDecodedXml,
  extractVellumLeadingHeadingTitle,
} from "./vellum-text-editor-content.js";

const VELLUM_ATTACHMENT_CHARACTER = "\uFFFC";
const VELLUM_PARAGRAPH_SEPARATOR = "\u2029";
const VELLUM_LINE_SEPARATOR = "\u2028";

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

function uidsForArrayKey(objectXml, key) {
  const pattern = new RegExp(`<key>${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</key><array>([\\s\\S]*?)</array>`);
  const match = objectXml.match(pattern);
  assert.ok(match, `missing UID array for ${key}`);
  return [...match[1].matchAll(/<key>CF\$UID<\/key><integer>(\d+)<\/integer>/g)]
    .map((entry) => Number(entry[1]));
}

function classNameForArchiveObject(xml, objectXml) {
  const classObject = archiveObjectAtUid(xml, uidForKey(objectXml, "$class"));
  const match = classObject.match(/<key>\$classname<\/key><string>([^<]+)<\/string>/);
  assert.ok(match, "class object is missing $classname");
  return match[1];
}

test("buildVellumOgElementPrivateDecodedXml writes a chapter element and promotes a leading H1", () => {
  const xml = buildVellumOgElementPrivateDecodedXml([
    {
      kind: "text",
      rowId: "row-title",
      languageCode: "en",
      textStyle: "heading1",
      text: "WordPress <strong>Style</strong> Sample",
      footnotes: [],
    },
    {
      kind: "text",
      rowId: "row-body",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Body <em>text</em>",
      footnotes: [],
    },
  ], { title: "Fallback title", now: new Date("2026-06-23T00:00:00Z") });

  const root = archiveObjectAtUid(xml, 1);
  assert.equal(classNameForArchiveObject(xml, root), "NSDictionary");
  assert.match(archiveObjectAtUid(xml, uidsForArrayKey(root, "NS.keys")[0]), /<string>elements<\/string>/);
  const elementsArray = archiveObjectAtUid(xml, uidsForArrayKey(root, "NS.objects")[0]);
  const element = archiveObjectAtUid(xml, uidsForArrayKey(elementsArray, "NS.objects")[0]);
  assert.equal(classNameForArchiveObject(xml, element), "OGTypedTextElement");
  assert.match(archiveObjectAtUid(xml, uidForKey(element, "title")), /<string>WordPress Style Sample<\/string>/);
  assert.match(archiveObjectAtUid(xml, uidForKey(element, "typeName")), /<string>chapter<\/string>/);
  assert.match(xml, /<string>OGTypedTextElement<\/string>/);
  assert.match(xml, /<string>NSDate<\/string>/);
  assert.equal(extractVellumLeadingHeadingTitle([
    {
      kind: "text",
      textStyle: "heading1",
      text: "WordPress <strong>Style</strong> Sample",
      footnotes: [],
    },
  ]), "WordPress Style Sample");

  assert.match(xml, /<string>Body text\n<\/string>/);
  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([5, 0, 4, 1, 1, 0]))));
  assert.doesNotMatch(xml, /<string>Fallback title<\/string>/);
});

test("buildVellumOgElementPrivateDecodedXml writes a within-row newline as a soft line break", () => {
  const xml = buildVellumOgElementPrivateDecodedXml([
    {
      kind: "text",
      rowId: "row-a",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Line one\nLine two",
      footnotes: [],
    },
    {
      kind: "text",
      rowId: "row-b",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Next paragraph",
      footnotes: [],
    },
  ], { title: "Soft break chapter" });

  // The within-row newline becomes a U+2028 line separator (no paragraph
  // spacing); the boundary between rows stays a U+000A paragraph separator.
  assert.match(
    xml,
    new RegExp(`<string>Line one${VELLUM_LINE_SEPARATOR}Line two\nNext paragraph\n</string>`),
  );
  assert.doesNotMatch(xml, /Line one\nLine two/);
});

test("buildVellumOgElementPrivateDecodedXml appends an editable plain text section after a final image", () => {
  const xml = buildVellumOgElementPrivateDecodedXml([
    {
      kind: "image",
      rowId: "row-image",
      languageCode: "en",
      image: {
        kind: "upload",
        filePath: "/tmp/Diogenes.webp",
        fileName: "Diogenes.webp",
      },
      caption: "A caption",
    },
  ], { title: "Image chapter" });

  assert.match(xml, /OGImageAttachmentCell/);
  assert.ok(xml.includes(`<string>${VELLUM_ATTACHMENT_CHARACTER}\n</string>`));
  const byteValues = decodedNsByteValues(xml);
  assert.ok(byteValues.some((value) => value.equals(Buffer.from([1, 0, 1, 1]))));
});

test("buildVellumOgElementPrivateDecodedXml keeps non-leading headings as subheads", () => {
  const xml = buildVellumOgElementPrivateDecodedXml([
    {
      kind: "text",
      rowId: "row-body",
      languageCode: "en",
      textStyle: "paragraph",
      text: "Intro",
      footnotes: [],
    },
    {
      kind: "text",
      rowId: "row-h2",
      languageCode: "en",
      textStyle: "heading2",
      text: "Internal H2",
      footnotes: [],
    },
  ], { title: "Chapter fallback" });

  assert.match(xml, /<string>Chapter fallback<\/string>/);
  assert.match(xml, /OGSubheadAttachmentCell/);
  assert.match(xml, /<string>Internal H2<\/string>/);
  assert.match(xml, /<string>level<\/string>/);
  assert.match(xml, /<integer>2<\/integer>/);
});

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

test("buildVellumTextEditorContentDecodedXml uses prepared local Vellum image resources", () => {
  const blocks = [
    {
      kind: "image",
      rowId: "row-image",
      languageCode: "en",
      image: {
        kind: "url",
        url: "https://example.com/images/Diogenes.webp",
      },
      caption: "Prepared caption",
    },
  ];
  const requests = buildVellumImageResourceRequests(blocks);
  assert.deepEqual(requests, [{
    index: 1,
    source: "https://example.com/images/Diogenes.webp",
    fileName: "Diogenes.webp",
    uti: "org.webmproject.webp",
  }]);

  const preparedBlocks = applyPreparedVellumImageResources(blocks, [{
    index: 1,
    fileName: "Diogenes.webp",
    imageKey: "diogenes",
    preservedUrl: "file:///var/folders/test/co.180g.Vellum/preserved-images.abc123/Diogenes.webp",
    lastAbsolutePath: "/var/folders/test/co.180g.Vellum/vellum-process-attachment.def456/Diogenes.webp",
    uti: "org.webmproject.webp",
    tooltip: "Diogenes.webp\n3840 × 2920 px",
    pixelWidth: 3840,
    pixelHeight: 2920,
    colorSpace: "sRGB",
    colorSpaceModel: "RGB",
    hasAlpha: false,
    canUpsize: false,
  }]);
  const xml = buildVellumTextEditorContentDecodedXml(preparedBlocks);

  assert.match(xml, /<string>file:\/\/\/var\/folders\/test\/co\.180g\.Vellum\/preserved-images\.abc123\/Diogenes\.webp<\/string>/);
  assert.doesNotMatch(xml, /https:\/\/example\.com\/images\/Diogenes\.webp/);
  assert.match(xml, /<string>lastAbsolutePath<\/string>/);
  assert.match(xml, /<string>\/var\/folders\/test\/co\.180g\.Vellum\/vellum-process-attachment\.def456\/Diogenes\.webp<\/string>/);
  assert.match(xml, /<string>pixelWidth<\/string>/);
  assert.match(xml, /<real>3840<\/real>/);
  assert.match(xml, /<string>pixelHeight<\/string>/);
  assert.match(xml, /<real>2920<\/real>/);
  assert.match(xml, /<string>colorSpace<\/string>/);
  assert.match(xml, /<string>sRGB<\/string>/);
  assert.match(xml, /<string>colorSpaceModel<\/string>/);
  assert.match(xml, /<string>RGB<\/string>/);
  assert.match(xml, /<string>hasAlpha<\/string>/);
  assert.match(xml, /<false\/>/);
  assert.match(xml, /<string>canUpsize<\/string>/);
  assert.match(xml, /<string>Diogenes\.webp\n3840 × 2920 px<\/string>/);
});
