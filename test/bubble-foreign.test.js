import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf, openings } from "./openings.js";

/**
 * A word the page's dictionary knew, with the engine on (D193).
 *
 * The engine translates from the pair's language or not at all, and a page
 * in the reader's own language fed it Polish (Michał's screenshot,
 * 2026-09-11): "książkach" glossed "księgowa", the sentence around it word
 * salad - and the guess kept itself in the vocabulary (D22). The rule is
 * `answeredElsewhere` (gloss.test.js); what this reads is the call sites,
 * like `bubble-hint` does, because the regressions would be call sites
 * saying nothing: a request that stops carrying the page's language, a
 * landing that shows the guess anyway or keeps it, a voice that ignores the
 * book that knew the word.
 */

const ROOT = new URL("../src/content/", import.meta.url);

/** @returns {Promise<string>} */
async function reading() {
  return readFile(new URL("reading.js", ROOT), "utf8");
}

/**
 * The landing of the translating fresh selection: from its opening to the
 * decision about keeping.
 *
 * @param {string} source
 */
function freshLanding(source) {
  const fresh = openings(source).filter((call) => call.includes('variant: "save"'));
  assert.equal(fresh.length, 1, "the translating fresh selection opens somewhere new");
  const after = source.slice(source.indexOf(fresh[0] ?? "") + (fresh[0] ?? "").length);
  return after.slice(0, after.indexOf("const decision = keeping("));
}

describe("a word the page's dictionary knew, with the engine on", () => {
  it("asks the dictionaries in the page's language too, from both translating bubbles", async () => {
    const source = await reading();
    const request = bodyOf(source, "translateRequest");
    assert.match(request, /request\.lang = lang/, "the request stopped carrying the page's language");
    assert.match(freshLanding(source), /translateRequest\(text, selection\.context, selection\.lang\)/, "the fresh selection asks without the page's language");
    assert.match(
      bodyOf(source, "fillSecondLayer"),
      /translateRequest\(phrase\.text, wanted\.context, phrase\.lang\)/,
      "the recall bubble's layer asks without the page's language",
    );
  });

  it("shows the phrase's own language's answer when the background named one, and keeps nothing", async () => {
    const landing = freshLanding(await reading());
    const at = landing.indexOf("if (language !== undefined) {");
    assert.ok(at !== -1, "the landing stopped asking whether the phrase is in another language");
    const branch = landing.slice(at, landing.indexOf("return;", at));
    assert.match(branch, /tooltip\.setBody\("", "normal"\)/, "a gloss stands over the foreign word");
    assert.doesNotMatch(branch, /setContext\(sentence\)/, "the engine's sentence stands over the foreign word");
    assert.doesNotMatch(branch, /keep\(\[/, "a guess keeps itself in the vocabulary");
    assert.match(branch, /current\.answered = language/, "the voice does not follow the phrase's language");
    assert.match(branch, /bubble_saves_under/, "Save files under the pair without saying so (D167)");
    // With no entry to show, the dictionaries' verdict about that language
    // stands in the hint line - no dictionary for it yet, or none that knew
    // the word - never the engine's-answer hint, which is about a guess
    // that was not made.
    assert.match(branch, /quietNote\(\{ entries: 0, dictionaries, findable: selection\.findable \}\)/, "the verdict is not asked about the phrase's language");
    assert.match(branch, /dictionaryVerdict\(verdict, language, words\)/, "the verdict is not said in the hint line");
    assert.doesNotMatch(branch, /dictionaryHint\(/, "the engine's-answer hint is said over an answer the engine did not give");
    assert.match(branch, /tooltip\.expand\(\)/, "the answer can hide behind More, leaving a bubble of nothing but its row");
    assert.match(branch, /tooltip\.reveal\(\)/, "Save can hide behind the fold (D131)");
  });

  it("is decided in the background before the engine is asked, and the engine is not asked for it", async () => {
    const source = await readFile(new URL("../src/background/index.js", import.meta.url), "utf8");
    const from = source.indexOf("case Message.TRANSLATE:");
    const handler = source.slice(from, source.indexOf("case Message.LOOK_UP:", from));
    const detected = handler.indexOf("detectLanguage(");
    const looked = handler.indexOf("lookUpAnswer(");
    const decided = handler.indexOf("if (language.length > 0) {");
    const engine = handler.indexOf("await translate({");
    assert.ok(detected !== -1 && looked !== -1 && decided !== -1 && engine !== -1, "the translate handler lost a step");
    assert.ok(detected < looked && looked < decided && decided < engine, "the engine is asked before the phrase's language is known");
    // The detector reads the sentence around the phrase, the phrase alone
    // when there is none - a lone word is what it is least sure about.
    assert.match(handler, /detectLanguage\(request\.context \?\? request\.text\)/, "the detector reads something other than the sentence around the phrase");
  });

  it("speaks in the dictionary's language then, with the engine on as well", async () => {
    const voice = bodyOf(await reading(), "readingLanguage");
    assert.match(
      voice,
      /if \(!noTranslation\) return current !== null && current\.answered\.length > 0 \? current\.answered : ttsLang;/,
      "the engine's bubble speaks in the pair's voice over a word of another language",
    );
  });
});
