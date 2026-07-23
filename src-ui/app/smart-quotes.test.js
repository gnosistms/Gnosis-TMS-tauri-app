import test from "node:test";
import assert from "node:assert/strict";

import { smartenInlineMarkupQuotes } from "./editor-inline-markup/smart-quotes.js";

test("double quotes open at the start and after whitespace, close otherwise", () => {
  assert.equal(
    smartenInlineMarkupQuotes('He said "hello" to me.'),
    "He said “hello” to me.",
  );
  assert.equal(smartenInlineMarkupQuotes('"Start"'), "“Start”");
});

test("double quotes open after opening delimiters and dashes", () => {
  assert.equal(smartenInlineMarkupQuotes('("quoted")'), "(“quoted”)");
  assert.equal(smartenInlineMarkupQuotes('—"quoted"'), "—“quoted”");
});

test("apostrophes in contractions and possessives become right single quotes", () => {
  assert.equal(smartenInlineMarkupQuotes("it's John's dogs'"), "it’s John’s dogs’");
  assert.equal(smartenInlineMarkupQuotes("d'accord l'homme"), "d’accord l’homme");
});

test("single quotes open a quotation at the start or after whitespace", () => {
  assert.equal(smartenInlineMarkupQuotes("say 'hi' now"), "say ‘hi’ now");
  assert.equal(smartenInlineMarkupQuotes("'quote'"), "‘quote’");
});

test("nested double-then-single quotes open and close correctly", () => {
  assert.equal(
    smartenInlineMarkupQuotes(`She said "he said 'no' loudly"`),
    "She said “he said ‘no’ loudly”",
  );
});

test("quote context carries across markup tags", () => {
  // The apostrophe after the bold run follows the visible "e", so it is a right
  // single quote. (Tag aliases canonicalize on round-trip: <b> -> <strong>.)
  assert.equal(
    smartenInlineMarkupQuotes("<strong>He</strong>'s here"),
    "<strong>He</strong>’s here",
  );
  // The closing double quote after the bold run follows visible "i", so it closes.
  assert.equal(smartenInlineMarkupQuotes("<strong>\"hi\"</strong>"), "<strong>“hi”</strong>");
  // A quote opening before a link and closing after it.
  assert.equal(
    smartenInlineMarkupQuotes('see "<a href="https://example.com">the page</a>"'),
    "see “<a href=\"https://example.com\">the page</a>”",
  );
});

test("straight quotes inside an href attribute are never converted", () => {
  const input = '<a href="https://example.com/?q=a">link</a>';
  assert.equal(smartenInlineMarkupQuotes(input), input);
});

test("a quote after a separator opens", () => {
  assert.equal(smartenInlineMarkupQuotes('a<hr>"b"'), "a<hr>“b”");
});

test("already-curly quotes are left unchanged (idempotent)", () => {
  const once = smartenInlineMarkupQuotes('He said "hi" and it\'s fine.');
  assert.equal(smartenInlineMarkupQuotes(once), once);
});

test("text without straight quotes is returned unchanged", () => {
  assert.equal(smartenInlineMarkupQuotes("no quotes here [1]"), "no quotes here [1]");
  assert.equal(smartenInlineMarkupQuotes(""), "");
});

test("footnote markers and escaped markers are untouched", () => {
  assert.equal(
    smartenInlineMarkupQuotes('The end.[1] "next"'),
    "The end.[1] “next”",
  );
  assert.equal(smartenInlineMarkupQuotes(String.raw`\[1] "x"`), String.raw`\[1] “x”`);
});

test("Vietnamese and Spanish text convert with the same positional rules", () => {
  assert.equal(
    smartenInlineMarkupQuotes('là Tarot của những người "Bohemia".'),
    "là Tarot của những người “Bohemia”.",
  );
  // Spanish inverted marks count as opening context.
  assert.equal(smartenInlineMarkupQuotes('¿"qué"?'), "¿“qué”?");
});

test("a double quote followed by whitespace or end closes even after a boundary", () => {
  // Ambiguous isolated quote: the next-character tiebreaker closes it.
  assert.equal(smartenInlineMarkupQuotes("He said \" then left"), "He said ” then left");
  assert.equal(smartenInlineMarkupQuotes("trailing \""), "trailing ”");
});

test("English decade abbreviations use an apostrophe", () => {
  assert.equal(
    smartenInlineMarkupQuotes("back in the '80s", { language: "en" }),
    "back in the ’80s",
  );
  assert.equal(
    smartenInlineMarkupQuotes("the '90s music", { language: "en-US" }),
    "the ’90s music",
  );
});

test("English leading-apostrophe elisions use an apostrophe", () => {
  assert.equal(
    smartenInlineMarkupQuotes("'Twas the night, 'tis so, rock 'n' roll", { language: "en" }),
    "’Twas the night, ’tis so, rock ’n’ roll",
  );
  assert.equal(
    smartenInlineMarkupQuotes("get 'em all", { language: "en" }),
    "get ’em all",
  );
});

test("elision and decade rules are English-only and never touch other languages", () => {
  // Without English, a leading apostrophe before "em" opens a quotation — critical for
  // Vietnamese, where "em" is a common word.
  assert.equal(smartenInlineMarkupQuotes("'em bé'", { language: "vi" }), "‘em bé’");
  assert.equal(smartenInlineMarkupQuotes("'Twas", { language: "vi" }), "‘Twas");
  // A quoted two-digit number is not treated as a decade outside English.
  assert.equal(smartenInlineMarkupQuotes("'80s", { language: "vi" }), "‘80s");
  // No language given defaults to the safe, non-English rules.
  assert.equal(smartenInlineMarkupQuotes("'tis"), "‘tis");
});

test("English elisions do not fire on longer words that merely start the same", () => {
  assert.equal(smartenInlineMarkupQuotes("say 'timeless' things", { language: "en" }), "say ‘timeless’ things");
  assert.equal(smartenInlineMarkupQuotes("an 'employee'", { language: "en" }), "an ‘employee’");
});
