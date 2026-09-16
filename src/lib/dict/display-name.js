/**
 * The name a dictionary is shown under (D199).
 *
 * What a .ifo calls its book is a sentence - "English-język polski
 * FreeDict+WikDict dictionary (en-pl)" - and as the name of a group on the
 * shelf it breaks into two or three lines in the panel, the popup and the
 * bubble. So a reader may give a book a short name of their own on the
 * settings page, and that name stands wherever the book's entries are
 * grouped; an empty field means the file's name, as before.
 *
 * The rules live here rather than in `store.js` for the reason `order.js`
 * does: they are rules, not storage - what a typed name becomes, which name
 * a book is shown under, and when a name is refused - and `node --test`
 * reaches them without an IndexedDB.
 *
 * Refused when another book already stands under it. The shelf groups an
 * answer's entries by the name (`entryGroups`), so two books of one name
 * would fold into one group with the entries of both under it. Compared
 * without regard to case: two names a reader cannot tell apart are one name.
 */

/**
 * The most a name may be. One line of a group's summary at the bubble's
 * width, with the count beside it; the settings field stops typing there too.
 */
export const DISPLAY_NAME_LIMIT = 40;

/**
 * What a typed name becomes in the record: the whitespace inside collapsed
 * to single spaces, the ends trimmed, the rest cut to the limit - by code
 * points, so a character outside the basic plane is never cut in half.
 * Nothing left means the reader gave no name.
 *
 * @param {string} raw
 * @returns {string | null}
 */
export function cleanDisplayName(raw) {
  const tidy = raw.replace(/\s+/g, " ").trim();
  if (tidy.length === 0) return null;
  const cut = [...tidy].slice(0, DISPLAY_NAME_LIMIT).join("").trimEnd();
  return cut.length > 0 ? cut : null;
}

/**
 * The name a book is shown under: the reader's own when they gave one, else
 * what the file calls it.
 *
 * @param {{ name: string, displayName?: string }} dictionary
 * @returns {string}
 */
export function shownName(dictionary) {
  const own = dictionary.displayName;
  return own !== undefined && own.length > 0 ? own : dictionary.name;
}

/**
 * The other book already shown under this name, if there is one - under a
 * name of its own or under its file's, since either is what stands on the
 * shelf. A book's own file name does not count against it: a book may be
 * given the name it already has.
 *
 * @template {{ id: string, name: string, displayName?: string }} T
 * @param {ReadonlyArray<T>} dictionaries
 * @param {string} id the book being named
 * @param {string} candidate the name, already cleaned
 * @returns {T | null}
 */
export function nameHolder(dictionaries, id, candidate) {
  const wanted = candidate.toLocaleLowerCase();
  const holder = dictionaries.find(
    (other) => other.id !== id && shownName(other).toLocaleLowerCase() === wanted,
  );
  return holder ?? null;
}
