/**
 * Finding saved phrases in a piece of text.
 *
 * The budget from the brief is ten thousand phrases without a page feeling
 * slower, so the shape is an index by first token: a page has a few thousand
 * tokens, and each of them costs one lookup in a Map plus, in the rare case of
 * a hit, a comparison of the two or three tokens that follow. Aho-Corasick
 * would win on paper and is the thing to reach for if a measurement ever says
 * so - not before, because this fits on a screen and that does not.
 *
 * Two rules decide what a match is:
 *
 *   - the longest phrase starting at a token wins. Saving both `ocean` and
 *     `world's oceans` should underline the longer one where it occurs, not
 *     leave half of it out.
 *   - matches never overlap. A range painted twice is a range the highlight
 *     registry cannot draw sensibly, and a reader clicking it would have to be
 *     told which of two phrases they meant.
 */

import { keyTokens, tokenize } from "./tokenize.js";

/**
 * @typedef {import("./tokenize.js").Token} Token
 * @typedef {{ tokens: string[], normalized: string }} Candidate
 * @typedef {Map<string, Candidate[]>} PhraseIndex
 * @typedef {{ start: number, end: number, normalized: string }} Match
 */

/**
 * @param {Iterable<string>} keys normalized phrases
 * @returns {PhraseIndex}
 */
export function buildIndex(keys) {
  /** @type {PhraseIndex} */
  const index = new Map();

  for (const normalized of keys) {
    const tokens = keyTokens(normalized);
    const first = tokens[0];
    // A key that is nothing but punctuation cannot be found in a page, and
    // nothing should have stored one in the first place.
    if (first === undefined) continue;

    const candidates = index.get(first);
    if (candidates === undefined) index.set(first, [{ tokens, normalized }]);
    else candidates.push({ tokens, normalized });
  }

  for (const candidates of index.values()) {
    candidates.sort((a, b) => b.tokens.length - a.tokens.length);
  }
  return index;
}

/**
 * @param {Token[]} tokens
 * @param {number} at
 * @param {string[]} wanted
 * @returns {boolean}
 */
function matchesAt(tokens, at, wanted) {
  if (at + wanted.length > tokens.length) return false;
  for (let offset = 1; offset < wanted.length; offset += 1) {
    if (tokens[at + offset]?.text !== wanted[offset]) return false;
  }
  return true;
}

/**
 * @param {string} text
 * @param {PhraseIndex} index
 * @returns {Match[]} in the order they occur, never overlapping
 */
export function findMatches(text, index) {
  const tokens = tokenize(text);
  /** @type {Match[]} */
  const matches = [];

  for (let at = 0; at < tokens.length; ) {
    const token = tokens[at];
    if (token === undefined) break;

    const candidate = index.get(token.text)?.find((one) => matchesAt(tokens, at, one.tokens));
    if (candidate === undefined) {
      at += 1;
      continue;
    }

    const last = tokens[at + candidate.tokens.length - 1];
    if (last !== undefined) {
      matches.push({ start: token.start, end: last.end, normalized: candidate.normalized });
    }
    at += candidate.tokens.length;
  }

  return matches;
}
