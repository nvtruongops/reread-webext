/**
 * Which language a phrase is in, when it is not the pair's (D193).
 *
 * The engine translates from the pair's source language or not at all, and
 * a page in the reader's own language feeds it the wrong one: "książkach" on
 * a Polish page under en → pl came back glossed "księgowa", the sentence
 * around it word salad (Michał's screenshot, 2026-09-11). Two witnesses can
 * say a phrase is not in the pair's language, and both are local:
 *
 * The browser's own detector, `i18n.detectLanguage` - CLD2 in a worker that
 * ships inside Firefox (`resource://gre/modules/translations/cld-worker.js`),
 * CLD3 linked into Chromium's renderer (`third_party/cld_3`); read in both
 * browsers' sources, not their docs: no model is fetched, nothing is sent,
 * the text never leaves the browser (PRIVACY.md, "Language detection").
 * Permission-free, and reliable on a sentence, which is what it is handed
 * (the sentence around the phrase, the phrase alone when there is none -
 * CLD3 calls anything under 50 bytes unreliable). It is trusted narrowly:
 * only where its confident verdict is the pair's target language - the
 * reader's own, the one case that matters - or the language the page
 * declares, two witnesses agreeing. Not any language it names: detectors
 * confuse close relatives (Norwegian's kinds, Croatian and Serbian), and a
 * pair whose source is one of them must not lose its engine to the other.
 *
 * A dictionary of another language than the pair's knowing the word while
 * the pair's dictionaries do not (`answeredElsewhere`, D167's two signals):
 * the fallback for the word the detector was unsure about - a heading, a
 * single word with no sentence around it.
 *
 * Safari's WebKit does not promise the detector; the call is guarded and
 * its absence means "no verdict", never a fault.
 */

import { webext } from "./browser.js";
import { answeredElsewhere } from "./gloss.js";

/**
 * What the browser's detector answers: whether it is confident, and the
 * languages it saw with the share of the text in each.
 *
 * @typedef {{ isReliable: boolean, languages: { language: string, percentage: number }[] }} Detection
 */

/**
 * The share of the text the leading language must hold before the verdict
 * counts: a sentence with a quoted term in another language still reads as
 * its own, a text split down the middle is nobody's.
 */
const MIN_SHARE = 70;

/**
 * The most the detector is ever handed: the sentence around the phrase, cut
 * to this many characters. CLD is sure of a language well within a hundred
 * bytes, so a longer sample buys nothing - and what is handed to a browser
 * component is worth keeping as small as the job allows, whatever the
 * component does with it today (PRIVACY.md says what).
 */
export const SAMPLE_CHARS = 400;

/**
 * The text as the detector gets it: the first `SAMPLE_CHARS` of it, trimmed.
 * Pure, so the promise in PRIVACY.md ("at most the sentence around the
 * selection, never more than four hundred characters") has a test.
 *
 * @param {string} text
 * @returns {string}
 */
export function sample(text) {
  return text.trim().slice(0, SAMPLE_CHARS);
}

/**
 * "en-US", "zh-CN" and "en" all answer their primary subtag - the shape the
 * pair's codes and the page's declaration are compared in.
 *
 * @param {string} tag
 * @returns {string}
 */
function primary(tag) {
  return tag.toLowerCase().split(/[-_]/, 1)[0] ?? "";
}

/**
 * The detector's verdict, narrowed to the one case it is trusted for: a
 * confident reading, the leading language holding most of the text, and
 * that language being the pair's target or the page's declaration - never
 * the pair's source, never anything else. Pure: the tests hand it answers.
 *
 * @param {Detection | null} detection what the detector said, or null for
 *   no detector and no answer
 * @param {{ from: string, to: string, declared: string | null }} pair the
 *   pair's source and target, and the page's declaration for the phrase
 * @returns {string} the primary subtag the phrase is in, or "" for no verdict
 */
export function foreignLanguage(detection, { from, to, declared }) {
  if (detection === null || !detection.isReliable) return "";
  const leading = [...detection.languages].sort((a, b) => b.percentage - a.percentage)[0];
  if (leading === undefined || leading.percentage < MIN_SHARE) return "";
  const language = primary(leading.language);
  if (language.length === 0 || language === primary(from)) return "";
  const page = primary(declared ?? "");
  return language === primary(to) || (page.length > 0 && language === page) ? language : "";
}

/**
 * The browser's detector asked about a text. Null for every way of not
 * getting an answer - a browser without the call (Safari), a call that
 * throws - so that the caller's rule stays one rule: no verdict, the engine
 * is asked as before.
 *
 * @param {string} text
 * @returns {Promise<Detection | null>}
 */
export async function detectLanguage(text) {
  try {
    const { i18n } = webext();
    if (typeof i18n.detectLanguage !== "function") return null;
    const handed = sample(text);
    if (handed.length === 0) return null;
    return await i18n.detectLanguage(handed);
  } catch {
    return null;
  }
}

/**
 * The language a phrase turned out to be in, when it is not the pair's
 * source - by the detector where it had a verdict, and otherwise by the
 * dictionary that knew the word (`answeredElsewhere`). Empty for the pair's
 * own language, which is to say: the engine's answer stands.
 *
 * @param {{ detected: string, answered: string | null, entries: number, pairFrom: string }} of
 *   the detector's verdict (`foreignLanguage`, "" for none), the language the
 *   dictionaries answered in (null for no answer), how many entries they
 *   returned, and the pair's source
 * @returns {string}
 */
export function phraseLanguage({ detected, answered, entries, pairFrom }) {
  if (detected.length > 0) return detected;
  const reading = primary(answered ?? "");
  return answeredElsewhere({ entries, reading, pairFrom: primary(pairFrom) }) ? reading : "";
}
