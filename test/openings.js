/**
 * The bubble's openings as text, for the tests that read call sites.
 *
 * Some regressions are a call site saying nothing - an opening that forgets a
 * setting, an ask that forgets its pending line - and no unit test catches
 * those by asking a function a question. The tests that do (`bubble-fold`,
 * `bubble-pending`) read `reading.js` instead, and this is the one piece of
 * parsing they share.
 */

/**
 * The text of every `tooltip.show({ ... })` argument in a file, braces
 * balanced - the calls nest object literals, so a regex to the first `}`
 * would stop inside one.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function openings(source) {
  /** @type {string[]} */
  const found = [];
  const marker = "tooltip.show({";
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let depth = 0;
    for (let i = at + marker.length - 1; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          found.push(source.slice(at, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

/**
 * The body of one top-level function, braces balanced the same way: from the
 * `{` after its parameter list to the one that closes it. Empty when the file
 * has no such function - the assertion on it then says which one went
 * missing.
 *
 * @param {string} source
 * @param {string} name
 * @returns {string}
 */
export function bodyOf(source, name) {
  const at = source.indexOf(`function ${name}(`);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
}
