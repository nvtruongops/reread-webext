/**
 * The reader's own meanings, several at once (the eighth brief, D203).
 *
 * A semicolon between two meanings typed into one field - "uleganie;
 * kapitulacja" - used to reach the store as one meaning with a semicolon in
 * it: told apart from two meanings nowhere the list shows them joined with
 * "; ", and one box on the shelf where there should be two, so neither half
 * could be unticked alone. So what the reader typed is split at its
 * semicolons as it is saved - the data is the view, nothing is parsed on
 * display (D1 of the brief) - while a book's line that carries a semicolon
 * of its own ("powiadomić kogoś; powiedzieć komuś o czymś") stays one
 * meaning: the edit box splits only the lines the reader wrote or changed
 * (D3). Pure, so `node --test` reaches both rules.
 */

/**
 * The pieces of one typed line: apart at the semicolons, each trimmed, the
 * blank ones dropped, in the order they were typed. Nothing else changes -
 * a marker like "☞" in a piece is the reader's to keep.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitMeanings(text) {
  return text
    .split(";")
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * What the edit box saves: every line of the box in the box's order. A line
 * that stood in the box when it opened is kept as it is - a book's meaning
 * with a semicolon in it stays whole until the reader touches it - and a
 * line the reader wrote or changed is split at its semicolons, its pieces
 * standing where the line stood. Blank lines are dropped; a meaning said
 * twice is kept once, where it first stood. The price of the rule is that a
 * typo fixed inside a book's semicolon line splits it in two - rare, and
 * mended in the same box.
 *
 * @param {readonly string[]} initial the lines the box opened with
 * @param {readonly string[]} lines the box's lines at the save
 * @returns {string[]}
 */
export function editedMeanings(initial, lines) {
  const untouched = new Set(initial.map((line) => line.trim()));
  /** @type {string[]} */
  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    for (const piece of untouched.has(line) ? [line] : splitMeanings(line)) {
      if (!kept.includes(piece)) kept.push(piece);
    }
  }
  return kept;
}
