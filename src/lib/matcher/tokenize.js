/**
 * Turning text into the units phrases are matched in.
 *
 * A token is a run of letters and digits, and everything between tokens is
 * ignored - which is the whole trick. It means `don't` matches `don’t` however
 * the page spells its apostrophe, `e-mail` matches `e mail`, and a phrase saved
 * with a comma in the middle still finds the same words on a page without one.
 * Matching by tokens is also why the key drops punctuation at its edges: the
 * two rules are the same rule, seen from different sides.
 *
 * Each token carries where it was found in the string it came from. Nothing
 * here may change those offsets, which is why the text is normalized per token
 * rather than in one pass: NFC can change the length of a string, and a length
 * that shifts is a highlight painted over the wrong words.
 */

/**
 * @typedef {object} Token
 * @property {string} text NFC, lower case - the form that gets compared
 * @property {number} start index in the original string
 * @property {number} end index in the original string, exclusive
 */

/**
 * Letters, digits, and the marks that belong to them. `\p{M}` is not decoration
 * here: a page that writes `z` with a separate combining dot above would
 * otherwise tokenize as a bare `z`, and no Polish or Czech phrase would ever
 * match on it. The mark stays in the token, and composing happens after.
 */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/**
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  WORD.lastIndex = 0;
  for (let match = WORD.exec(text); match !== null; match = WORD.exec(text)) {
    tokens.push({
      text: match[0].normalize("NFC").toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/**
 * The tokens of a stored key, without the positions - a key is compared, never
 * pointed at.
 *
 * @param {string} normalized
 * @returns {string[]}
 */
export function keyTokens(normalized) {
  return tokenize(normalized).map((token) => token.text);
}
