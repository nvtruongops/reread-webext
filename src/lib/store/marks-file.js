/**
 * The file the highlights travel out in - and only out (D106): a plain
 * Markdown page of quotes, grouped by document, made to be pasted into
 * notes. It is deliberately not a backup format: the marks travel back with
 * the reading list's own `.json`, anchored and restorable, while this file
 * is the quotes as a reader wants to keep them - a document's title, where
 * it came from, and the passages that were worth a pen. It is also the one
 * honest way article text leaves the reader, which refuses drag-to-copy
 * (D80/D86 paid that): highlight it, export it.
 *
 * Everything here is a value in and a value out; the database lives in
 * `marks.js`, and the reader page dresses the map it returns in titles.
 */

/** @typedef {import("../reader/marks.js").Mark} Mark */

/**
 * What the exported file is called. No date in the name for the reason the
 * articles file has none: the highlights are one list, and a browser numbers
 * a second download by itself.
 */
export const MARKS_FILENAME = "reread-highlights.md";

/**
 * One document as the file wants it: its title, where it came from (an
 * article's address, a book's author - whichever the document has), when it
 * entered the list, and its marks in reading order.
 *
 * @typedef {{ title: string, source: string | null, at: number, marks: Mark[] }} MarkedDoc
 */

/**
 * The whole file, as one string. Documents come out oldest first with the
 * title as the tie - the same promise the articles file makes: two exports
 * of the same list are the same file. No "generated at" line for exactly
 * that reason.
 *
 * A quote spanning blocks arrives with line breaks in it (`quoteOf` put one
 * at every boundary); each of its lines is prefixed on its own, so the whole
 * quote stays one blockquote to any Markdown reader and one indented passage
 * to a plain-text one.
 *
 * A mark's note (D118) stands under its quote as plain paragraphs: the quote
 * is the document's words and wears the quote dress, the note is the
 * reader's own and wears none - and none means no markup wrapped around
 * text this module did not write.
 *
 * @param {MarkedDoc[]} docs only documents that have marks - the caller's cut
 * @returns {string}
 */
export function toMarksFile(docs) {
  /** @type {string[]} */
  const lines = ["# re/read highlights"];

  const ordered = [...docs].sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
  for (const doc of ordered) {
    lines.push("", `## ${doc.title}`, "");
    const where = doc.source === null || doc.source.length === 0 ? [] : [doc.source];
    const when = Number.isFinite(doc.at) && doc.at > 0 ? [isoDay(doc.at)] : [];
    const detail = [...where, ...when].join(" - ");
    if (detail.length > 0) lines.push(detail, "");

    for (const [index, mark] of doc.marks.entries()) {
      if (index > 0) lines.push("");
      for (const line of mark.text.split("\n")) lines.push(`> ${line}`);
      if (mark.note !== undefined) {
        // The blank line closes the blockquote, so the note reads as the
        // reader's own paragraph rather than more of the quote.
        lines.push("");
        for (const line of mark.note.split("\n")) lines.push(line);
      }
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * A timestamp as the day it names, UTC - stable wherever the file is
 * written, which "the same list makes the same file" quietly requires.
 *
 * @param {number} at
 * @returns {string}
 */
function isoDay(at) {
  return new Date(at).toISOString().slice(0, 10);
}
