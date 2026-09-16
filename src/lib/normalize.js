/**
 * How a selected phrase is reduced to the key everything else agrees on.
 *
 * This is the most expensive function in the project to change: it decides
 * which phrase is "the same phrase" for the vocabulary store, for the
 * highlighter, and for import - so changing it after the first release means
 * rewriting stored keys, not just recompiling. Anything added here should be a
 * difference nobody would call a difference: a line break inside a selection, a
 * non-breaking space, a soft hyphen left over from justified text, the comma a
 * drag-selection caught on its way past.
 *
 * Deliberately not done here:
 *   - lemmatisation. Out of scope by decision: matching is literal.
 *   - anything that depends on the language being read. One key function, or
 *     the same phrase would mean different things in different profiles.
 */

/**
 * Invisible characters that only ever come from how the text was laid out:
 * U+00AD, a soft hyphen left by justification, and U+200B, a zero-width space
 * marking a break opportunity. Built from a string of escapes rather than
 * written into a regex literal, because a literal one in the source is a
 * character nobody can see in a diff.
 */
const LAYOUT_ARTEFACTS = new RegExp("[\\u00AD\\u200B]", "gu");

/**
 * Punctuation and symbols at either end of a phrase, and only at the ends.
 *
 * Selecting by dragging catches a trailing comma or a closing quote about as
 * often as it does not, and a phrase stored as `word,` would never underline
 * anything: page text is matched token by token, and no tokeniser produces a
 * token with a comma in it. So the two selections have to reduce to one key.
 *
 * Only the edges. `e-mail`, `don't` and `U.S.A.` are one word each, and a rule
 * that reached inside them would be inventing words nobody selected.
 */
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * The phrase as the page had it: original case, with the line breaks taken out.
 *
 * The building block of the two functions below rather than something to use
 * directly. What a selection turns into - for the engine, for the bubble and
 * for the database alike - is `trimPhrase`.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapseWhitespace(text) {
  return text.normalize("NFC").replace(LAYOUT_ARTEFACTS, "").replace(/\s+/gu, " ").trim();
}

/**
 * The phrase as it is translated, shown and stored: `collapseWhitespace` with
 * the punctuation stripped off both ends. Keeps the case, because that is what
 * a reader wants to see again and what an export to Anki should carry.
 *
 * The engine gets this and not the raw selection. Dragging over a word catches
 * the comma after it, and `Pacific,` comes back translated as `Pacyfiku,` -
 * punctuation nobody selected, kept in the vocabulary and exported onto a
 * flashcard. A single word without a comma also stands a better chance of
 * coming back in its dictionary form.
 *
 * @param {string} text
 * @returns {string}
 */
export function trimPhrase(text) {
  // Trimmed again afterwards: taking a comma off `word ,` leaves a space behind.
  return collapseWhitespace(text).replace(EDGE_PUNCTUATION, "").trim();
}

/**
 * The matching key: `trimPhrase` plus case folding.
 *
 * `toLowerCase` and not `toLocaleLowerCase`: the key must not depend on the
 * locale of the browser that produced it, or the same phrase saved on a Turkish
 * profile would stop matching itself anywhere else.
 *
 * An empty answer is meaningful - it says the selection was nothing but
 * punctuation, and there is no phrase there to save or to look up.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return trimPhrase(text).toLowerCase();
}
