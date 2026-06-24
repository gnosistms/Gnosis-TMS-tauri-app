import {
  parseInlineMarkup,
  splitRubyNodeChildren,
} from "./editor-inline-markup/parser.js";
import {
  normalizeEditorFootnotes,
  parseUnescapedFootnoteMarkers,
  unescapeLiteralFootnoteMarkers,
} from "./editor-footnotes.js";
import {
  EDITOR_ROW_TEXT_STYLE_CENTERED,
  EDITOR_ROW_TEXT_STYLE_HEADING1,
  EDITOR_ROW_TEXT_STYLE_HEADING2,
  EDITOR_ROW_TEXT_STYLE_INDENTED,
  EDITOR_ROW_TEXT_STYLE_QUOTE,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

const TEXT_ENCODER = new TextEncoder();
const FONT_SIZE = 20;
const VELLUM_ATTACHMENT_CHARACTER = "\uFFFC";
const VELLUM_PARAGRAPH_SEPARATOR = "\u2029";
// Within a single row, a user-entered newline is a soft line break, not a new
// paragraph. Apple's text system treats U+000A/U+2029 as paragraph separators
// (which carry NSParagraphSpacing) but U+2028 as a line break inside the same
// paragraph (no paragraph spacing). Mapping body newlines to U+2028 keeps Vellum
// consistent with the editor, preview, HTML, WordPress, and Markdown, which all
// render a within-row newline as a tight line break. Row/paragraph boundaries
// are emitted separately as U+000A and stay paragraph separators.
const VELLUM_LINE_SEPARATOR = "\u2028";

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return "";
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  if (typeof btoa !== "function") {
    throw new Error("Base64 encoding is not available.");
  }

  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function stringDataXml(value) {
  return `<data>${bytesToBase64(TEXT_ENCODER.encode(String(value ?? "")))}</data>`;
}

function bytesDataXml(bytes) {
  return `<data>${bytesToBase64(bytes)}</data>`;
}

function uidXml(index) {
  return `<dict><key>CF$UID</key><integer>${index}</integer></dict>`;
}

function arrayXml(items) {
  return `<array>${items.join("")}</array>`;
}

function dictXml(entries) {
  return `<dict>${entries.map(([key, value]) => `<key>${escapeXml(key)}</key>${value}`).join("")}</dict>`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function softenBodyLineBreaks(value) {
  return String(value ?? "").replaceAll("\n", VELLUM_LINE_SEPARATOR);
}

function encodeVarUint(value) {
  const bytes = [];
  let next = Math.max(0, Number(value) || 0);
  do {
    let byte = next & 0x7f;
    next = Math.floor(next / 128);
    if (next > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (next > 0);
  return bytes;
}

function encodeAttributeRuns(runs) {
  const bytes = [];
  for (const run of runs) {
    if (!run || run.length <= 0) {
      continue;
    }
    bytes.push(...encodeVarUint(run.length), run.attributeIndex);
  }
  return new Uint8Array(bytes);
}

function mergeAdjacentRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if (!run || run.length <= 0) {
      continue;
    }
    const previous = merged[merged.length - 1];
    if (previous && previous.attributeKey === run.attributeKey) {
      previous.length += run.length;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

function createArchiveBuilder() {
  const objects = ["<string>$null</string>", ""];
  const stringIds = new Map();
  const classIds = new Map();
  const boolIds = new Map();
  const integerIds = new Map();
  const realIds = new Map();

  function addRaw(xml) {
    objects.push(xml);
    return objects.length - 1;
  }

  function addString(value) {
    const text = String(value ?? "");
    if (stringIds.has(text)) {
      return stringIds.get(text);
    }
    const id = addRaw(`<string>${escapeXml(text)}</string>`);
    stringIds.set(text, id);
    return id;
  }

  function addBoolean(value) {
    const key = value === true ? "true" : "false";
    if (boolIds.has(key)) {
      return boolIds.get(key);
    }
    const id = addRaw(value === true ? "<true/>" : "<false/>");
    boolIds.set(key, id);
    return id;
  }

  function addInteger(value) {
    const normalized = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
    const key = String(normalized);
    if (integerIds.has(key)) {
      return integerIds.get(key);
    }
    const id = addRaw(`<integer>${normalized}</integer>`);
    integerIds.set(key, id);
    return id;
  }

  function addReal(value) {
    const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
    const key = String(normalized);
    if (realIds.has(key)) {
      return realIds.get(key);
    }
    const id = addRaw(`<real>${escapeXml(key)}</real>`);
    realIds.set(key, id);
    return id;
  }

  function addDate(value = Date.now()) {
    const seconds = value instanceof Date
      ? value.getTime() / 1000
      : Number(value);
    const appleReferenceSeconds = Number.isFinite(seconds)
      ? seconds - 978307200
      : Date.now() / 1000 - 978307200;
    const classId = addClass(["NSDate", "NSObject"]);
    return addKeyedObject(classId, [
      ["NS.time", `<real>${escapeXml(String(appleReferenceSeconds))}</real>`],
    ]);
  }

  function addClass(classes, className = classes[0]) {
    const key = `${className}:${classes.join("|")}`;
    if (classIds.has(key)) {
      return classIds.get(key);
    }
    const id = addRaw(dictXml([
      ["$classes", arrayXml(classes.map((entry) => `<string>${escapeXml(entry)}</string>`))],
      ["$classname", `<string>${escapeXml(className)}</string>`],
    ]));
    classIds.set(key, id);
    return id;
  }

  function addKeyedObject(classId, entries) {
    return addRaw(dictXml([
      ["$class", uidXml(classId)],
      ...entries,
    ]));
  }

  function addNsDictionary(entries, classId = null) {
    const resolvedClassId = classId ?? addClass(["NSDictionary", "NSObject"]);
    return addKeyedObject(resolvedClassId, [
      ["NS.keys", arrayXml(entries.map(([key]) => uidXml(addString(key))))],
      ["NS.objects", arrayXml(entries.map(([, objectId]) => uidXml(objectId)))],
    ]);
  }

  function addAttributedString(text) {
    const classId = addClass(["NSAttributedString", "NSObject"]);
    return addKeyedObject(classId, [
      ["NSString", uidXml(addString(text))],
      ["NSAttributes", uidXml(addNsDictionary([]))],
    ]);
  }

  function addFont(name, flags = 16) {
    const classId = addClass(["NSFont", "NSObject"]);
    return addKeyedObject(classId, [
      ["NSName", uidXml(addString(name))],
      ["NSSize", `<real>${FONT_SIZE}</real>`],
      ["NSfFlags", `<integer>${flags}</integer>`],
    ]);
  }

  function addParagraphStyle(options = {}) {
    const classId = addClass(["NSParagraphStyle", "NSObject"]);
    const entries = [
      ["NSAllowsTighteningForTruncation", "<integer>1</integer>"],
      ["NSLineSpacing", "<real>5</real>"],
      ["NSParagraphSpacing", `<real>${options.paragraphSpacing ?? 10}</real>`],
      ["NSTabStops", uidXml(0)],
    ];
    if (Number.isFinite(options.alignment)) {
      entries.unshift(["NSAlignment", `<integer>${options.alignment}</integer>`]);
    }
    if (Number.isFinite(options.paragraphSpacingBefore)) {
      entries.push(["NSParagraphSpacingBefore", `<real>${options.paragraphSpacingBefore}</real>`]);
    }
    if (Number.isFinite(options.firstLineHeadIndent)) {
      entries.push(["NSFirstLineHeadIndent", `<real>${options.firstLineHeadIndent}</real>`]);
    }
    if (Number.isFinite(options.headIndent)) {
      entries.push(["NSHeadIndent", `<real>${options.headIndent}</real>`]);
    }
    if (Number.isFinite(options.tailIndent)) {
      entries.push(["NSTailIndent", `<real>${options.tailIndent}</real>`]);
    }
    return addKeyedObject(classId, entries);
  }

  function addUrl(href) {
    const classId = addClass(["NSURL", "NSObject"]);
    return addKeyedObject(classId, [
      ["NS.base", uidXml(0)],
      ["NS.relative", uidXml(addString(href))],
    ]);
  }

  function addOgParagraphFormat(kind, stateEntries, mutable = false) {
    const classId = mutable
      ? addClass(["OGMutableParagraphFormat", "OGParagraphFormat", "NSObject"])
      : addClass(["OGParagraphFormat", "NSObject"]);
    const stateClassId = mutable
      ? addClass(["NSMutableDictionary", "NSDictionary", "NSObject"])
      : null;
    return addKeyedObject(classId, [
      ["kind", uidXml(addString(kind))],
      ["state", uidXml(addNsDictionary(stateEntries, stateClassId))],
    ]);
  }

  function setRoot(xml) {
    objects[1] = xml;
  }

  function objectXml(id) {
    return objects[id] ?? "";
  }

  function toXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${dictXml([
  ["$archiver", "<string>OGImagePreservingArchiver</string>"],
  ["$objects", arrayXml(objects)],
  ["$top", dictXml([["$0", uidXml(1)]])],
  ["$version", "<integer>100000</integer>"],
])}
</plist>`;
  }

  return {
    addAttributedString,
    addBoolean,
    addClass,
    addDate,
    addFont,
    addInteger,
    addKeyedObject,
    addNsDictionary,
    addOgParagraphFormat,
    addParagraphStyle,
    addRaw,
    addReal,
    addString,
    addUrl,
    objectXml,
    setRoot,
    toXml,
  };
}

function addAttributeObjects(builder, attachmentAttributes = {}) {
  const footnoteAttributes = attachmentAttributes.footnoteAttributes ?? new Map();
  const imageAttributes = attachmentAttributes.imageAttributes ?? new Map();
  const subheadAttributes = attachmentAttributes.subheadAttributes ?? new Map();
  const trueId = builder.addBoolean(true);
  const underlineId = builder.addInteger(1);
  const regularFontId = builder.addFont("Georgia", 16);
  const boldFontId = builder.addFont("Georgia-Bold", 16);
  const italicFontId = builder.addFont("Georgia-Italic", 80);
  const defaultParagraphId = builder.addParagraphStyle({ alignment: 4, paragraphSpacing: 10 });
  const quoteParagraphId = builder.addParagraphStyle({
    alignment: 4,
    firstLineHeadIndent: 24,
    headIndent: 24,
    paragraphSpacing: 20,
    paragraphSpacingBefore: 10,
    tailIndent: -24,
  });
  const centeredParagraphId = builder.addParagraphStyle({
    alignment: 2,
    firstLineHeadIndent: 20,
    headIndent: 20,
    paragraphSpacing: 15,
    paragraphSpacingBefore: 5,
    tailIndent: -40,
  });
  const imageParagraphId = builder.addParagraphStyle({
    alignment: 2,
    paragraphSpacing: 10,
  });
  const indentedParagraphId = builder.addParagraphStyle({
    firstLineHeadIndent: 24,
    headIndent: 24,
    paragraphSpacing: 15,
    paragraphSpacingBefore: 5,
    tailIndent: -59,
  });
  const quoteFormatId = builder.addOgParagraphFormat("blockquote", [
    ["includeInPrint", trueId],
    ["blockquoteType", builder.addString("prose")],
    ["includeInEbook", trueId],
  ]);
  const centeredFormatId = builder.addOgParagraphFormat("alignment", [
    ["includeInPrint", trueId],
    ["alignment", builder.addString("center")],
    ["includeInEbook", trueId],
  ]);
  const indentedFormatId = builder.addOgParagraphFormat("alignment", [
    ["alignment", builder.addString("left")],
    ["includeInPrint", trueId],
    ["includeInEbook", trueId],
    ["inset", trueId],
  ], true);

  const staticAttributeEntries = new Map([
    ["default", [
      ["NSParagraphStyle", defaultParagraphId],
      ["NSFont", regularFontId],
    ]],
    ["bold", [
      ["NSFont", boldFontId],
      ["NSParagraphStyle", defaultParagraphId],
      ["OGBoldText", trueId],
    ]],
    ["italic", [
      ["NSParagraphStyle", defaultParagraphId],
      ["OGItalicText", trueId],
      ["NSFont", italicFontId],
    ]],
    ["underline", [
      ["NSFont", regularFontId],
      ["OGUnderlineText", trueId],
      ["NSParagraphStyle", defaultParagraphId],
      ["NSUnderline", underlineId],
    ]],
    ["quote", [
      ["NSParagraphStyle", quoteParagraphId],
      ["OGParagraphFormat", quoteFormatId],
      ["NSFont", regularFontId],
    ]],
    ["centered", [
      ["NSParagraphStyle", centeredParagraphId],
      ["OGParagraphFormat", centeredFormatId],
      ["NSFont", regularFontId],
    ]],
    ["indented", [
      ["NSParagraphStyle", indentedParagraphId],
      ["OGParagraphFormat", indentedFormatId],
      ["NSFont", regularFontId],
    ]],
  ]);

  const baseAttributes = new Map([...staticAttributeEntries.entries()].map(
    ([key, entries]) => [key, builder.addNsDictionary(entries)],
  ));

  function linkAttributeEntries(href) {
    const normalizedHref = String(href ?? "").trim();
    const urlId = builder.addUrl(normalizedHref);
    const linkStateId = builder.addNsDictionary([
      ["webLinkURL", urlId],
      ["type", builder.addString("web")],
    ]);
    return [
      ["NSLink", urlId],
      ["OGLink", linkStateId],
      ["NSFont", regularFontId],
      ["NSParagraphStyle", defaultParagraphId],
    ];
  }

  function linkAttributeId(href) {
    const normalizedHref = String(href ?? "").trim();
    const key = `link:${normalizedHref}`;
    if (baseAttributes.has(key)) {
      return baseAttributes.get(key);
    }
    const attributeId = builder.addNsDictionary(linkAttributeEntries(normalizedHref));
    baseAttributes.set(key, attributeId);
    return attributeId;
  }

  function footnoteAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const footnote = footnoteAttributes.get(attributeKey);
    if (!footnote) {
      return baseAttributes.get("default");
    }

    const cellClassId = builder.addClass([
      "OGFootnoteAttachmentCell",
      "OGRefnoteAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const stateId = builder.addNsDictionary([
      ["text", builder.addAttributedString(footnote.text)],
    ]);
    const formatClassId = builder.addClass([
      "OGMutableAttachmentFormat",
      "OGAttachmentFormat",
      "NSObject",
    ]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("footnote"))],
      ["state", uidXml(stateId)],
      ["uniqueID", uidXml(builder.addString(footnote.uniqueId))],
    ]);
    const attributeId = builder.addNsDictionary([
      ["NSFont", regularFontId],
      ["NSAttachment", attachmentId],
      ["OGAttachmentFormat", formatId],
      ["NSParagraphStyle", defaultParagraphId],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  function subheadAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const subhead = subheadAttributes.get(attributeKey);
    if (!subhead) {
      return baseAttributes.get("default");
    }

    const cellClassId = builder.addClass([
      "OGSubheadAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const stateId = builder.addNsDictionary([
      ["level", builder.addInteger(subhead.level)],
      ["keepWithNext", trueId],
      ["text", builder.addAttributedString(subhead.text)],
    ]);
    const formatClassId = builder.addClass([
      "OGMutableAttachmentFormat",
      "OGAttachmentFormat",
      "NSObject",
    ]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("subhead"))],
      ["state", uidXml(stateId)],
      ["uniqueID", uidXml(builder.addString(subhead.uniqueId))],
    ]);
    const attributeId = builder.addNsDictionary([
      ["NSFont", regularFontId],
      ["NSAttachment", attachmentId],
      ["OGAttachmentFormat", formatId],
      ["NSParagraphStyle", defaultParagraphId],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  function imageAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const image = imageAttributes.get(attributeKey);
    if (!image) {
      return baseAttributes.get("default");
    }

    const metadataEntries = imageMetadataEntries(builder, image);
    const metadataClassId = builder.addClass(["NSMutableDictionary", "NSDictionary", "NSObject"]);
    const metadataId = builder.addNsDictionary(metadataEntries, metadataClassId);
    const handleClassId = builder.addClass(["OGImageHandle", "OGImageToken", "NSObject"]);
    const sourceUrlId = builder.addUrl(image.preservedUrl || image.source);
    const handleId = builder.addKeyedObject(handleClassId, [
      ["imageKey", uidXml(builder.addString(image.imageKey))],
      // Vellum's archived field names are inverted: preservedMetadata is the NSURL,
      // and preservedURL is the metadata dictionary.
      ["preservedMetadata", uidXml(sourceUrlId)],
      ["preservedURL", uidXml(metadataId)],
    ]);
    const stateId = builder.addNsDictionary([
      ["imageHasCaption", builder.addBoolean(Boolean(image.caption))],
      ["imageHandle", handleId],
      ["imageSize", builder.addString("full")],
      ["text", builder.addAttributedString(image.caption)],
    ]);
    const formatClassId = builder.addClass([
      "OGMutableAttachmentFormat",
      "OGAttachmentFormat",
      "NSObject",
    ]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("image"))],
      ["state", uidXml(stateId)],
    ]);
    const cellClassId = builder.addClass([
      "OGImageAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const attributeId = builder.addNsDictionary([
      ["NSFont", regularFontId],
      ["OGAttachmentFormat", formatId],
      ["NSAttachment", attachmentId],
      ["NSParagraphStyle", imageParagraphId],
      ["NSToolTip", builder.addString(image.tooltip)],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  return {
    attributeIdForKey(attributeKey) {
      if (String(attributeKey ?? "").startsWith("link:")) {
        return linkAttributeId(attributeKey.slice("link:".length));
      }
      if (String(attributeKey ?? "").startsWith("footnote:")) {
        return footnoteAttributeId(attributeKey);
      }
      if (String(attributeKey ?? "").startsWith("image:")) {
        return imageAttributeId(attributeKey);
      }
      if (String(attributeKey ?? "").startsWith("subhead:")) {
        return subheadAttributeId(attributeKey);
      }
      return baseAttributes.get(attributeKey) ?? baseAttributes.get("default");
    },
  };
}

function addWholeChapterAttributeObjects(builder, attachmentAttributes = {}) {
  const footnoteAttributes = attachmentAttributes.footnoteAttributes ?? new Map();
  const imageAttributes = attachmentAttributes.imageAttributes ?? new Map();
  const subheadAttributes = attachmentAttributes.subheadAttributes ?? new Map();
  const trueId = builder.addBoolean(true);
  const quoteFormatId = builder.addOgParagraphFormat("blockquote", [
    ["includeInPrint", trueId],
    ["blockquoteType", builder.addString("prose")],
    ["includeInEbook", trueId],
  ]);
  const centeredFormatId = builder.addOgParagraphFormat("alignment", [
    ["includeInPrint", trueId],
    ["alignment", builder.addString("center")],
    ["includeInEbook", trueId],
  ]);
  const indentedFormatId = builder.addOgParagraphFormat("alignment", [
    ["alignment", builder.addString("left")],
    ["includeInPrint", trueId],
    ["includeInEbook", trueId],
    ["inset", trueId],
  ], true);

  const baseAttributes = new Map([
    ["default", builder.addNsDictionary([])],
    ["bold", builder.addNsDictionary([["OGBoldText", trueId]])],
    ["italic", builder.addNsDictionary([["OGItalicText", trueId]])],
    ["underline", builder.addNsDictionary([["OGUnderlineText", trueId]])],
    ["quote", builder.addNsDictionary([["OGParagraphFormat", quoteFormatId]])],
    ["centered", builder.addNsDictionary([["OGParagraphFormat", centeredFormatId]])],
    ["indented", builder.addNsDictionary([["OGParagraphFormat", indentedFormatId]])],
  ]);

  function linkAttributeId(href) {
    const normalizedHref = String(href ?? "").trim();
    const key = `link:${normalizedHref}`;
    if (baseAttributes.has(key)) {
      return baseAttributes.get(key);
    }
    const urlId = builder.addUrl(normalizedHref);
    const linkStateId = builder.addNsDictionary([
      ["webLinkURL", urlId],
      ["type", builder.addString("web")],
    ]);
    const attributeId = builder.addNsDictionary([
      ["OGLink", linkStateId],
    ]);
    baseAttributes.set(key, attributeId);
    return attributeId;
  }

  function footnoteAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const footnote = footnoteAttributes.get(attributeKey);
    if (!footnote) {
      return baseAttributes.get("default");
    }

    const cellClassId = builder.addClass([
      "OGFootnoteAttachmentCell",
      "OGRefnoteAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const stateId = builder.addNsDictionary([
      ["text", builder.addAttributedString(footnote.text)],
    ]);
    const formatClassId = builder.addClass(["OGAttachmentFormat", "NSObject"]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("footnote"))],
      ["state", uidXml(stateId)],
      ["uniqueID", uidXml(builder.addString(footnote.uniqueId))],
    ]);
    const attributeId = builder.addNsDictionary([
      ["OGAttachmentFormat", formatId],
      ["NSAttachment", attachmentId],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  function subheadAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const subhead = subheadAttributes.get(attributeKey);
    if (!subhead) {
      return baseAttributes.get("default");
    }

    const cellClassId = builder.addClass([
      "OGSubheadAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const stateId = builder.addNsDictionary([
      ["level", builder.addInteger(subhead.level)],
      ["keepWithNext", trueId],
      ["text", builder.addAttributedString(subhead.text)],
    ]);
    const formatClassId = builder.addClass(["OGAttachmentFormat", "NSObject"]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("subhead"))],
      ["state", uidXml(stateId)],
      ["uniqueID", uidXml(builder.addString(subhead.uniqueId))],
    ]);
    const attributeId = builder.addNsDictionary([
      ["OGAttachmentFormat", formatId],
      ["NSAttachment", attachmentId],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  function imageAttributeId(attributeKey) {
    if (baseAttributes.has(attributeKey)) {
      return baseAttributes.get(attributeKey);
    }

    const image = imageAttributes.get(attributeKey);
    if (!image) {
      return baseAttributes.get("default");
    }

    const metadataEntries = imageMetadataEntries(builder, image);
    const metadataClassId = builder.addClass(["NSMutableDictionary", "NSDictionary", "NSObject"]);
    const metadataId = builder.addNsDictionary(metadataEntries, metadataClassId);
    const handleClassId = builder.addClass(["OGImageHandle", "OGImageToken", "NSObject"]);
    const sourceUrlId = builder.addUrl(image.preservedUrl || image.source);
    const handleId = builder.addKeyedObject(handleClassId, [
      ["imageKey", uidXml(builder.addString(image.imageKey))],
      ["preservedMetadata", uidXml(sourceUrlId)],
      ["preservedURL", uidXml(metadataId)],
    ]);
    const stateId = builder.addNsDictionary([
      ["imageHasCaption", builder.addBoolean(Boolean(image.caption))],
      ["imageHandle", handleId],
      ["imageSize", builder.addString("full")],
      ["text", builder.addAttributedString(image.caption)],
    ]);
    const formatClassId = builder.addClass([
      "OGMutableAttachmentFormat",
      "OGAttachmentFormat",
      "NSObject",
    ]);
    const formatId = builder.addKeyedObject(formatClassId, [
      ["kind", uidXml(builder.addString("image"))],
      ["state", uidXml(stateId)],
    ]);
    const cellClassId = builder.addClass([
      "OGImageAttachmentCell",
      "OGTextAttachmentCell",
      "OGAttachmentCell",
      "NSTextAttachmentCell",
      "NSCell",
      "NSObject",
    ]);
    const cellId = builder.addKeyedObject(cellClassId, [
      ["NSCellFlags", "<integer>0</integer>"],
      ["NSCellFlags2", "<integer>0</integer>"],
    ]);
    const attachmentClassId = builder.addClass(["NSTextAttachment", "NSObject"]);
    const attachmentId = builder.addKeyedObject(attachmentClassId, [
      ["NSCell", uidXml(cellId)],
      ["NSFileWrapper", uidXml(0)],
    ]);
    const attributeId = builder.addNsDictionary([
      ["NSAttachment", attachmentId],
      ["OGAttachmentFormat", formatId],
      ["NSToolTip", builder.addString(image.tooltip)],
    ]);
    baseAttributes.set(attributeKey, attributeId);
    return attributeId;
  }

  return {
    attributeIdForKey(attributeKey) {
      if (String(attributeKey ?? "").startsWith("link:")) {
        return linkAttributeId(attributeKey.slice("link:".length));
      }
      if (String(attributeKey ?? "").startsWith("footnote:")) {
        return footnoteAttributeId(attributeKey);
      }
      if (String(attributeKey ?? "").startsWith("image:")) {
        return imageAttributeId(attributeKey);
      }
      if (String(attributeKey ?? "").startsWith("subhead:")) {
        return subheadAttributeId(attributeKey);
      }
      return baseAttributes.get(attributeKey) ?? baseAttributes.get("default");
    },
  };
}

function imageMetadataEntries(builder, image) {
  const entries = [];
  const addStringEntry = (key, value) => {
    const text = normalizeText(value);
    if (text) {
      entries.push([key, builder.addString(text)]);
    }
  };
  const addBooleanEntry = (key, value) => {
    if (typeof value === "boolean") {
      entries.push([key, builder.addBoolean(value)]);
    }
  };
  const addNumberEntry = (key, value) => {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      entries.push([key, builder.addReal(number)]);
    }
  };

  addStringEntry("colorSpace", image.colorSpace);
  addBooleanEntry("hasAlpha", image.hasAlpha);
  addBooleanEntry("canUpsize", image.canUpsize);
  addNumberEntry("pixelHeight", image.pixelHeight);
  addStringEntry("filename", image.fileName);
  addNumberEntry("pixelWidth", image.pixelWidth);
  addStringEntry("lastAbsolutePath", image.lastAbsolutePath || image.source);
  addStringEntry("uti", image.uti);
  addStringEntry("colorSpaceModel", image.colorSpaceModel);

  return entries;
}

function blockAttributeKey(block) {
  switch (normalizeEditorRowTextStyle(block?.textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return "bold";
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return "quote";
    case EDITOR_ROW_TEXT_STYLE_CENTERED:
      return "centered";
    case EDITOR_ROW_TEXT_STYLE_INDENTED:
      return "indented";
    default:
      return "default";
  }
}

function activeAttributeKey(active, fallbackKey) {
  if (active.linkHref) {
    return `link:${active.linkHref}`;
  }
  if (active.underline) {
    return "underline";
  }
  if (active.italic) {
    return "italic";
  }
  if (active.bold) {
    return "bold";
  }
  return fallbackKey || "default";
}

function appendTextRun(target, text, attributeKey) {
  const value = String(text ?? "");
  if (!value) {
    return;
  }
  target.text += value;
  target.runs.push({
    length: value.length,
    attributeKey,
  });
}

function trimTrailingHorizontalSpace(target) {
  if (!target?.text) {
    return;
  }

  let trimCount = 0;
  while (target.text.endsWith(" ") || target.text.endsWith("\t")) {
    target.text = target.text.slice(0, -1);
    trimCount += 1;
  }
  while (trimCount > 0 && target.runs.length > 0) {
    const lastRun = target.runs[target.runs.length - 1];
    const removed = Math.min(trimCount, lastRun.length);
    lastRun.length -= removed;
    trimCount -= removed;
    if (lastRun.length <= 0) {
      target.runs.pop();
    }
  }
}

function footnoteBodyText(text) {
  return parseInlineMarkup(unescapeLiteralFootnoteMarkers(text)).visibleText.trim();
}

function visibleInlineText(text) {
  return parseInlineMarkup(unescapeLiteralFootnoteMarkers(text)).visibleText.trim();
}

function inlineNodesText(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }
      if (node.type === "text") {
        return node.text;
      }
      return inlineNodesText(node.children);
    })
    .join("");
}

function fallbackVellumAttachmentUniqueId(block, kind, discriminator, index) {
  const source = `${String(block?.rowId ?? "row")}:${String(block?.languageCode ?? "")}:${kind}:${discriminator}:${index}`;
  let hash = 0x811c9dc5;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    hash ^= source.charCodeAt(cursor);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  return `id${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${String(index).padStart(4, "0")}`;
}

function createVellumAttachmentUniqueId(block, kind, discriminator, index) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `id${crypto.randomUUID().toUpperCase()}`;
  }
  return fallbackVellumAttachmentUniqueId(block, kind, discriminator, index);
}

function fallbackVellumElementUniqueId(title) {
  const source = `chapter:${normalizeText(title)}`;
  let hash = 0x811c9dc5;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    hash ^= source.charCodeAt(cursor);
    hash = Math.imul(hash, 0x01000193);
  }
  const first = (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  const second = first.split("").reverse().join("");
  return `id${first}-${second.slice(0, 4)}-4${second.slice(1, 4)}-8${second.slice(4, 7)}-${first}${second}`;
}

function createVellumElementUniqueId(title) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `id${crypto.randomUUID().toUpperCase()}`;
  }
  return fallbackVellumElementUniqueId(title);
}

function createFootnoteContext(block, target) {
  const footnotes = normalizeEditorFootnotes(block?.footnotes);
  if (footnotes.length === 0) {
    return null;
  }

  return {
    footnotes,
    footnoteByMarker: new Map(footnotes.map((entry) => [entry.marker, entry])),
    usedMarkers: new Set(),
    attributeKeyForEntry(entry) {
      const index = target.footnoteAttributes.size + 1;
      const attributeKey = `footnote:${index}`;
      target.footnoteAttributes.set(attributeKey, {
        marker: entry.marker,
        text: footnoteBodyText(entry.text),
        uniqueId: createVellumAttachmentUniqueId(block, "footnote", entry.marker, index),
      });
      return attributeKey;
    },
  };
}

function headingLevel(block) {
  switch (normalizeEditorRowTextStyle(block?.textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return 1;
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return 2;
    default:
      return 0;
  }
}

function leadingChapterTitleBlock(blocks) {
  const first = (Array.isArray(blocks) ? blocks : [])[0];
  if (headingLevel(first) !== 1 || normalizeEditorFootnotes(first?.footnotes).length > 0) {
    return null;
  }

  const title = visibleInlineText(first?.text ?? "");
  return title ? { block: first, title } : null;
}

export function extractVellumLeadingHeadingTitle(blocks) {
  return leadingChapterTitleBlock(blocks)?.title ?? null;
}

function appendSubheadRuns(block, target, level) {
  const text = visibleInlineText(block?.text ?? "");
  if (!text) {
    return;
  }

  const index = target.subheadAttributes.size + 1;
  const attributeKey = `subhead:${index}`;
  target.subheadAttributes.set(attributeKey, {
    level,
    text,
    uniqueId: createVellumAttachmentUniqueId(block, "subhead", level, index),
  });
  appendTextRun(target, VELLUM_ATTACHMENT_CHARACTER, attributeKey);
  appendTextRun(target, VELLUM_PARAGRAPH_SEPARATOR, "default");
}

function fileNameFromPath(path) {
  const source = normalizeText(path);
  if (!source) {
    return "";
  }
  const parts = source.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function imageFileName(image) {
  return normalizeText(image?.fileName)
    || fileNameFromPath(image?.filePath)
    || fileNameFromPath(image?.path)
    || fileNameFromPath(image?.url)
    || "image";
}

function imageUti(fileName) {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "public.jpeg";
    case "png":
      return "public.png";
    case "gif":
      return "com.compuserve.gif";
    case "webp":
      return "org.webmproject.webp";
    default:
      return "";
  }
}

function filePathToFileUrl(path) {
  const source = normalizeText(path);
  if (!source || /^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return source;
  }
  if (!source.startsWith("/")) {
    return source;
  }
  return `file://${source.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function fileUrlToPath(url) {
  const source = normalizeText(url);
  if (!source.toLowerCase().startsWith("file://")) {
    return "";
  }
  try {
    const parsed = new URL(source);
    return decodeURIComponent(parsed.pathname);
  } catch {
    return "";
  }
}

function imageSource(image) {
  if (normalizeText(image?.kind) === "url") {
    return normalizeText(image?.url);
  }
  return filePathToFileUrl(image?.filePath) || normalizeText(image?.path);
}

function imageKey(fileName, source, index) {
  const name = normalizeText(fileNameFromPath(fileName)) || normalizeText(fileNameFromPath(source)) || `image-${index}`;
  const stem = name.replace(/\.[^.]*$/, "");
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || `image_${index}`;
}

function preparedVellumImage(image) {
  return image && typeof image.vellumPrepared === "object"
    ? image.vellumPrepared
    : null;
}

function imageTooltip(fileName, prepared) {
  const width = Number(prepared?.pixelWidth);
  const height = Number(prepared?.pixelHeight);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `${fileName}\n${Math.trunc(width)} × ${Math.trunc(height)} px`;
  }
  return fileName;
}

function appendImageRuns(block, target) {
  const image = block?.image;
  if (!image) {
    return;
  }

  const index = target.imageAttributes.size + 1;
  const prepared = preparedVellumImage(image);
  const fallbackFileName = imageFileName(image);
  const fallbackSource = imageSource(image);
  const fileName = normalizeText(prepared?.fileName) || fallbackFileName;
  const preservedUrl = normalizeText(prepared?.preservedUrl);
  const source = preservedUrl || fallbackSource;
  const lastAbsolutePath = normalizeText(prepared?.lastAbsolutePath)
    || fileUrlToPath(source)
    || source;
  const caption = visibleInlineText(block?.caption ?? "");
  const attributeKey = `image:${index}`;
  target.imageAttributes.set(attributeKey, {
    canUpsize: typeof prepared?.canUpsize === "boolean" ? prepared.canUpsize : undefined,
    caption,
    colorSpace: prepared?.colorSpace,
    colorSpaceModel: prepared?.colorSpaceModel,
    fileName,
    hasAlpha: typeof prepared?.hasAlpha === "boolean" ? prepared.hasAlpha : undefined,
    imageKey: normalizeText(prepared?.imageKey) || imageKey(fileName, source, index),
    lastAbsolutePath,
    pixelHeight: prepared?.pixelHeight,
    pixelWidth: prepared?.pixelWidth,
    preservedUrl,
    source,
    tooltip: normalizeText(prepared?.tooltip) || imageTooltip(fileName, prepared),
    uti: normalizeText(prepared?.uti) || imageUti(fileName),
  });
  appendTextRun(target, VELLUM_ATTACHMENT_CHARACTER, attributeKey);
}

export function buildVellumImageResourceRequests(blocks) {
  const requests = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || block.kind !== "image" || !block.image) {
      continue;
    }

    const index = requests.length + 1;
    const fileName = imageFileName(block.image);
    const source = imageSource(block.image);
    if (!source) {
      continue;
    }

    requests.push({
      index,
      source,
      fileName,
      uti: imageUti(fileName),
    });
  }
  return requests;
}

export function applyPreparedVellumImageResources(blocks, preparedResources) {
  const resourcesByIndex = new Map(
    (Array.isArray(preparedResources) ? preparedResources : [])
      .map((resource) => [Number(resource?.index), resource])
      .filter(([index, resource]) => Number.isInteger(index) && index > 0 && resource),
  );
  let imageIndex = 0;

  return (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (!block || block.kind !== "image" || !block.image) {
      return block;
    }

    imageIndex += 1;
    const prepared = resourcesByIndex.get(imageIndex);
    if (!prepared) {
      return block;
    }

    return {
      ...block,
      image: {
        ...block.image,
        vellumPrepared: prepared,
      },
    };
  });
}

function appendFootnoteAttachmentRun(target, entry, footnoteContext) {
  footnoteContext.usedMarkers.add(entry.marker);
  appendTextRun(target, VELLUM_ATTACHMENT_CHARACTER, footnoteContext.attributeKeyForEntry(entry));
}

function bodyTextRun(text) {
  return softenBodyLineBreaks(unescapeLiteralFootnoteMarkers(text));
}

function appendTextWithFootnotes(target, text, attributeKey, footnoteContext) {
  const source = String(text ?? "");
  if (!source) {
    return;
  }

  const markers = footnoteContext ? parseUnescapedFootnoteMarkers(source) : [];
  if (markers.length === 0) {
    appendTextRun(target, bodyTextRun(source), attributeKey);
    return;
  }

  let cursor = 0;
  for (const marker of markers) {
    appendTextRun(target, bodyTextRun(source.slice(cursor, marker.index)), attributeKey);
    const entry = footnoteContext.footnoteByMarker.get(marker.marker);
    if (entry && !footnoteContext.usedMarkers.has(entry.marker)) {
      trimTrailingHorizontalSpace(target);
      appendFootnoteAttachmentRun(target, entry, footnoteContext);
    } else {
      appendTextRun(target, marker.raw, attributeKey);
    }
    cursor = marker.endIndex;
  }
  appendTextRun(target, bodyTextRun(source.slice(cursor)), attributeKey);
}

function appendRemainingFootnoteRuns(target, footnoteContext) {
  if (!footnoteContext) {
    return;
  }

  const remaining = [...footnoteContext.footnotes]
    .sort((left, right) => left.marker - right.marker)
    .filter((entry) => !footnoteContext.usedMarkers.has(entry.marker));
  if (remaining.length === 0) {
    return;
  }

  trimTrailingHorizontalSpace(target);
  remaining.forEach((entry) => {
    appendFootnoteAttachmentRun(target, entry, footnoteContext);
  });
}

function appendInlineNodeRuns(nodes, target, fallbackKey, active = {}, footnoteContext = null) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      appendTextWithFootnotes(target, node.text, activeAttributeKey(active, fallbackKey), footnoteContext);
      continue;
    }

    if (node.tag === "ruby") {
      const { baseChildren, annotationChildren } = splitRubyNodeChildren(node.children);
      const rubyText = inlineNodesText(annotationChildren).trim();
      appendInlineNodeRuns(
        baseChildren,
        target,
        fallbackKey,
        active,
        footnoteContext,
      );
      if (rubyText) {
        appendTextWithFootnotes(
          target,
          `（${rubyText}）`,
          activeAttributeKey(active, fallbackKey),
          footnoteContext,
        );
      }
      continue;
    }

    if (node.tag === "rt") {
      continue;
    }

    if (node.tag === "hr") {
      appendTextRun(target, "\n", fallbackKey);
      continue;
    }

    const nextActive = {
      ...active,
      bold: active.bold || node.tag === "strong",
      italic: active.italic || node.tag === "em",
      underline: active.underline || node.tag === "u",
      linkHref: node.tag === "a" && node.attributes?.href
        ? node.attributes.href
        : active.linkHref,
    };
    appendInlineNodeRuns(node.children, target, fallbackKey, nextActive, footnoteContext);
  }
}

function appendBlockRuns(block, target) {
  const fallbackKey = blockAttributeKey(block);
  const level = headingLevel(block);
  if (level > 0) {
    appendSubheadRuns(block, target, level);
    return;
  }

  if (block?.kind === "image") {
    appendImageRuns(block, target);
    return;
  }

  const parsed = parseInlineMarkup(block?.text ?? "");
  const footnoteContext = createFootnoteContext(block, target);
  appendInlineNodeRuns(parsed.nodes, target, fallbackKey, {}, footnoteContext);
  appendRemainingFootnoteRuns(target, footnoteContext);
}

function buildVellumTextRuns(blocks) {
  const target = {
    text: "",
    runs: [],
    footnoteAttributes: new Map(),
    imageAttributes: new Map(),
    subheadAttributes: new Map(),
  };
  const visibleBlocks = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && (block.kind !== "image" || block.image));

  visibleBlocks.forEach((block, index) => {
    if (index > 0 && !target.text.endsWith("\n") && !target.text.endsWith(VELLUM_PARAGRAPH_SEPARATOR)) {
      appendTextRun(target, "\n", blockAttributeKey(block));
    }
    appendBlockRuns(block, target);
  });

  target.runs = mergeAdjacentRuns(target.runs);
  return target;
}

function appendTrailingPlainTextSection(target) {
  appendTextRun(target, "\n", "default");
  target.runs = mergeAdjacentRuns(target.runs);
}

function buildResolvedAttributeArchive(builder, runs, attributes) {
  const attributeIds = [];
  const attributeIndexes = new Map();
  const resolvedRuns = runs.map((run) => {
    const attributeId = attributes.attributeIdForKey(run.attributeKey);
    if (!attributeIndexes.has(attributeId)) {
      attributeIndexes.set(attributeId, attributeIds.length);
      attributeIds.push(attributeId);
    }
    return {
      length: run.length,
      attributeIndex: attributeIndexes.get(attributeId),
    };
  });
  return { attributeIds, resolvedRuns };
}

function addAttributedStringArchiveObject(builder, text, attributeIds, resolvedRuns, options = {}) {
  const arrayClassId = builder.addClass(options.mutableArray
    ? ["NSMutableArray", "NSArray", "NSObject"]
    : ["NSArray", "NSObject"]);
  const dataClassId = builder.addClass(options.mutableData
    ? ["NSMutableData", "NSData", "NSObject"]
    : ["NSData", "NSObject"]);
  const attributedStringClassId = builder.addClass(options.mutableString
    ? ["NSMutableAttributedString", "NSAttributedString", "NSObject"]
    : ["NSAttributedString", "NSObject"]);
  const stringObjectId = options.stringAsData
    ? builder.addKeyedObject(builder.addClass(["NSMutableString", "NSString", "NSObject"]), [
      ["NS.bytes", stringDataXml(text)],
    ])
    : builder.addString(text);
  const attributesObjectId = builder.addKeyedObject(arrayClassId, [
    ["NS.objects", arrayXml(attributeIds.map(uidXml))],
  ]);
  const attributeInfoObjectId = builder.addKeyedObject(dataClassId, [
    ["NS.bytes", bytesDataXml(encodeAttributeRuns(resolvedRuns))],
  ]);

  return builder.addKeyedObject(attributedStringClassId, [
    ["NSAttributeInfo", uidXml(attributeInfoObjectId)],
    ["NSAttributes", uidXml(attributesObjectId)],
    ["NSString", uidXml(stringObjectId)],
  ]);
}

export function buildVellumTextEditorContentDecodedXml(blocks) {
  const {
    text,
    runs,
    footnoteAttributes,
    imageAttributes,
    subheadAttributes,
  } = buildVellumTextRuns(blocks);
  if (!text) {
    return "";
  }

  const builder = createArchiveBuilder();
  const attributes = addAttributeObjects(builder, {
    footnoteAttributes,
    imageAttributes,
    subheadAttributes,
  });
  const { attributeIds, resolvedRuns } = buildResolvedAttributeArchive(builder, runs, attributes);
  const rootObjectId = addAttributedStringArchiveObject(builder, text, attributeIds, resolvedRuns, {
    mutableArray: true,
    mutableData: true,
    mutableString: true,
    stringAsData: true,
  });

  builder.setRoot(builder.objectXml(rootObjectId));

  return builder.toXml();
}

export function buildVellumOgElementPrivateDecodedXml(blocks, options = {}) {
  const allBlocks = Array.isArray(blocks) ? blocks : [];
  const titleEntry = leadingChapterTitleBlock(allBlocks);
  const bodyBlocks = titleEntry ? allBlocks.slice(1) : allBlocks;
  const title = titleEntry?.title || normalizeText(options.title) || "Untitled Chapter";
  const body = buildVellumTextRuns(bodyBlocks);
  appendTrailingPlainTextSection(body);
  const {
    text,
    runs,
    footnoteAttributes,
    imageAttributes,
    subheadAttributes,
  } = body;

  const builder = createArchiveBuilder();
  const attributes = addWholeChapterAttributeObjects(builder, {
    footnoteAttributes,
    imageAttributes,
    subheadAttributes,
  });
  const { attributeIds, resolvedRuns } = buildResolvedAttributeArchive(builder, runs, attributes);
  const textObjectId = addAttributedStringArchiveObject(builder, text, attributeIds, resolvedRuns, {
    mutableArray: false,
    mutableData: true,
    mutableString: false,
    stringAsData: false,
  });
  const elementClassId = builder.addClass([
    "OGTypedTextElement",
    "OGTextElementBase",
    "OGElement",
    "OGElementContainer",
    "NSObject",
  ]);
  const elementId = builder.addKeyedObject(elementClassId, [
    ["children", uidXml(0)],
    ["displayTitleInHeading", "<true/>"],
    ["explicitOwningBook", uidXml(0)],
    ["includeInEBook", "<true/>"],
    ["includeInPrint", "<true/>"],
    ["isExpanded", "<true/>"],
    ["mtime", uidXml(builder.addDate(options.now))],
    ["numbered", "<true/>"],
    ["parent", uidXml(builder.addString("$null"))],
    ["text", uidXml(textObjectId)],
    ["title", uidXml(builder.addString(title))],
    ["typeName", uidXml(builder.addString("chapter"))],
    ["uniqueID", uidXml(builder.addString(createVellumElementUniqueId(title)))],
    ["wasCreatedByImport", "<false/>"],
  ]);
  const arrayClassId = builder.addClass(["NSArray", "NSObject"]);
  const elementsArrayId = builder.addKeyedObject(arrayClassId, [
    ["NS.objects", arrayXml([uidXml(elementId)])],
  ]);
  const dictionaryClassId = builder.addClass(["NSDictionary", "NSObject"]);
  const keysObjectId = builder.addString("elements");

  builder.setRoot(dictXml([
    ["$class", uidXml(dictionaryClassId)],
    ["NS.keys", arrayXml([uidXml(keysObjectId)])],
    ["NS.objects", arrayXml([uidXml(elementsArrayId)])],
  ]));

  return builder.toXml();
}
