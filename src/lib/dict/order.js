/**
 * The order the installed dictionaries answer in.
 *
 * Until now that order was the order they were imported in - the only one a
 * reader could predict, and the only one they could change: by deleting a
 * dictionary and importing it again. With two dictionaries of one language
 * that is a real price (a hundred and forty megabytes read back to put the
 * English-to-English one above the English-to-Polish one), so the place a
 * dictionary answers from is now written down beside it, and the settings page
 * moves it with two arrows.
 *
 * The rules live here rather than in `store.js` because they are rules: one
 * comparator and two moves over a list, which `node --test` can reach without
 * an IndexedDB. The database keeps the number, this keeps the meaning.
 *
 * One order across every language, not one per pair. A bubble only ever shows
 * the dictionaries of the language being read, so a single list induces the
 * right order inside each of them, and nobody arranging their books has to
 * first work out which list they are arranging.
 */

/**
 * @typedef {object} Ranked what ordering reads of a dictionary
 * @property {string} id
 * @property {number} addedAt
 * @property {number} [rank] absent in records written before the order existed
 */

/**
 * A dictionary that carries no rank has never been placed, and goes after
 * every dictionary that has - where `addedAt` then decides between them,
 * which is exactly the order such a store already answered in.
 *
 * @param {Ranked} dictionary
 * @returns {number}
 */
function rankOf(dictionary) {
  return typeof dictionary.rank === "number" ? dictionary.rank : Number.MAX_SAFE_INTEGER;
}

/**
 * The dictionaries in the order they answer a lookup - which is the order the
 * settings page lists them in, because a promise about the bubble is only
 * worth anything if the page keeping it shows the same thing.
 *
 * `addedAt` and the id break ties, so that two dictionaries stored in the same
 * millisecond, or a store where nothing has been placed yet, still come out in
 * one order rather than whatever the database happened to hand over.
 *
 * @template {Ranked} T
 * @param {T[]} dictionaries
 * @returns {T[]}
 */
export function answerOrder(dictionaries) {
  return [...dictionaries].sort(
    (a, b) => rankOf(a) - rankOf(b) || a.addedAt - b.addedAt || a.id.localeCompare(b.id),
  );
}

/**
 * The list after one press of an arrow: a swap with the neighbour, never a
 * shuffle. Null when nothing moves - an unknown dictionary, or the one already
 * at the end it was asked to move towards - so the caller writes nothing and
 * the page redraws nothing.
 *
 * @param {string[]} ids the dictionaries as they stand, in answering order
 * @param {string} id the one being moved
 * @param {number} step -1 towards the top, 1 towards the bottom
 * @returns {string[] | null}
 */
export function afterMove(ids, id, step) {
  const at = ids.indexOf(id);
  if (at < 0) return null;

  // A negative index and one past the end both read as nothing, which is what
  // the two ends of the list mean.
  const to = at + step;
  const neighbour = ids[to];
  if (neighbour === undefined) return null;

  const moved = [...ids];
  moved[at] = neighbour;
  moved[to] = id;
  return moved;
}

/**
 * The dictionaries arranged by a list of ids - what the settings page just
 * decided - with anything the list does not name kept after them, in the order
 * it already had. That tail is not a formality: a second settings page, or an
 * import that finished between the render and the press, would otherwise have
 * its dictionary dropped from the order and land wherever a missing rank puts
 * it.
 *
 * @template {Ranked} T
 * @param {T[]} dictionaries
 * @param {string[]} ids
 * @returns {T[]}
 */
export function inChosenOrder(dictionaries, ids) {
  const place = new Map(ids.map((id, at) => [id, at]));

  /** @type {T[]} */
  const chosen = [];
  /** @type {T[]} */
  const rest = [];
  for (const dictionary of answerOrder(dictionaries)) {
    if (place.has(dictionary.id)) chosen.push(dictionary);
    else rest.push(dictionary);
  }

  chosen.sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
  return [...chosen, ...rest];
}

/**
 * The place a dictionary being imported takes: last, behind everything already
 * here. An import must not push its way into the middle of an order somebody
 * arranged - and behind everything is where a reader looks for the book they
 * just added anyway.
 *
 * @param {Ranked[]} dictionaries everything already stored
 * @returns {number}
 */
export function nextRank(dictionaries) {
  let last = -1;
  for (const dictionary of dictionaries) {
    if (typeof dictionary.rank === "number" && dictionary.rank > last) last = dictionary.rank;
  }
  return last + 1;
}
