/**
 * The other forms of a saved word, for the underline (D208): the dictionary's
 * word on which of the forms `deinflect.js` proposes are really forms of it.
 *
 * The rules propose; a dictionary decides, and it decides in two voices. An
 * alias row is the loud one: the dictionary's own .syn file says `reads` is
 * `read` (D30), and a form that is an alias of some other word - `cared`,
 * of `care`, when the saved word is `car` - is refused on the same authority.
 * A form the dictionary has as a word in its own right is the quiet voice:
 * `reading` is a noun with an entry of its own, so the .syn line pointing it
 * at `read` was never written (an alias never shadows a word - `rows.js`),
 * and the row says nothing about `read` at all. For those the question is
 * turned around: of the words the form could be stripped back to
 * (`baseForms`), which does the dictionary know? `reading` strips to `read`
 * and `reade`; the dictionary knows `read`, so `reading` is `read`'s. `used`
 * strips to `us` and `use`, and the dictionary knows both - the longer base
 * wins, because a longer match is the more specific one: `used` is `use`'s,
 * and a saved `us` does not underline it. Two bases of one length pointing
 * at different words are no answer, and the form is refused.
 *
 * Grades - comparatives and superlatives - take only the loud voice: `bigger`
 * is `big`'s because the .syn says so, while `lover` and `reader` are words
 * of their own and would pass the quiet test for `love` and `read` on the
 * strength of nothing but their ending.
 *
 * What this cannot tell apart, because the rows cannot: a word of its own
 * that merely looks like a form of a shorter word the dictionary knows and
 * has no longer base - `news` for `new`, `evening` for `even`, `herring` for
 * `her`. The bubble over such an underline names the saved word (its
 * `savedWord` line), so a wrong guess is visible for what it is; and the
 * switch that turns all of this on is off by default.
 *
 * Pure, given a way to read one dictionary's rows: `store.js` runs it over
 * the installed dictionaries of the language, under one transaction, and
 * keeps what they answered under a stamp of the dictionaries that answered.
 */

import { baseForms, inflectedForms } from "./deinflect.js";

/**
 * Bumped whenever the rules here or in `deinflect.js` change. It is part of
 * the stamp the cached forms carry (`formsStamp`), so a version with other
 * rules computes every word's forms again instead of trusting a cache the
 * old rules wrote.
 */
export const FORMS_REVISION = 1;

/**
 * As much of a dictionary row as the decision reads: whether it is there,
 * and which word it is an alias of when it is one.
 *
 * @typedef {{ aliasOf?: string }} FormRow
 * @typedef {(key: string) => Promise<FormRow | undefined>} RowReader
 */

/**
 * The entry a word the dictionary has in its own right belongs to, by the
 * quiet voice: the longest of its possible bases the dictionary knows, and
 * the word itself when it knows none - or when two of the same length point
 * at different entries.
 *
 * @param {string} form a key the dictionary has a row of its own for
 * @param {RowReader} row
 * @returns {Promise<string>}
 */
async function ownerOf(form, row) {
  /** @type {{ base: string, entry: string }[]} */
  const known = [];
  for (const base of baseForms(form, ["ending"])) {
    const found = await row(base);
    if (found !== undefined) known.push({ base, entry: found.aliasOf ?? base });
  }
  if (known.length === 0) return form;

  const longest = Math.max(...known.map((one) => one.base.length));
  const top = known.filter((one) => one.base.length === longest);
  const entry = top[0]?.entry ?? form;
  return top.every((one) => one.entry === entry) ? entry : form;
}

/**
 * The forms of a saved word this dictionary vouches for.
 *
 * The saved word may itself be a form the dictionary knows as an alias
 * (`went`, `flies`): then the entry it points at is the word whose forms are
 * asked about, and the entry itself is one of them - a saved `went`
 * underlines `go` and `goes`. A word the dictionary does not know at all has
 * no forms here: there is nobody to vouch for them.
 *
 * @param {string} word a saved key: normalized, a single word
 * @param {RowReader} row one dictionary's rows
 * @returns {Promise<string[]>} never including the word itself
 */
export async function formsIn(word, row) {
  const own = await row(word);
  if (own === undefined) return [];
  const entry = own.aliasOf ?? word;
  const { endings, grades } = inflectedForms(entry);

  /** @type {string[]} */
  const found = [];

  /**
   * @param {string} form
   * @param {boolean} quietly whether the quiet voice may vouch for it too
   */
  const consider = async (form, quietly) => {
    if (form === word || found.includes(form)) return;
    const candidate = await row(form);
    if (candidate === undefined) return;
    const accepted =
      candidate.aliasOf !== undefined
        ? candidate.aliasOf === entry
        : form === entry || (quietly && (await ownerOf(form, row)) === entry);
    if (accepted) found.push(form);
  };

  if (entry !== word) await consider(entry, false);
  for (const form of endings) await consider(form, true);
  for (const form of grades) await consider(form, false);
  return found;
}

/**
 * What a set of forms was computed from, in one string: the rules' revision,
 * the language, and every dictionary that answers for it with the counts
 * that change when it is imported again. Forms kept under a stamp that no
 * longer matches were vouched for by a shelf that is gone, and are computed
 * again (`store.js`, `readForms`).
 *
 * @param {string} lang
 * @param {readonly { id: string, langFrom: string, ready: boolean, entryCount: number, aliasCount: number }[]} dictionaries
 * @returns {string}
 */
export function formsStamp(lang, dictionaries) {
  const books = dictionaries
    .filter((dictionary) => dictionary.ready && dictionary.langFrom === lang)
    .map((dictionary) => `${dictionary.id}:${dictionary.entryCount}:${dictionary.aliasCount}`)
    .sort();
  return [String(FORMS_REVISION), lang, ...books].join("|");
}
