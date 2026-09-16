/**
 * Footnotes as popups (mobileread request, accepted plan): the rules of
 * recognizing a footnote reference and of shaping its note's text, kept pure
 * so `node --test` can hold them. The DOM walk that applies them lives in
 * `reader/import-book.js`.
 *
 * The brief still stands: a book is prose to read, not a page to leave -
 * the import strips every href, and nothing here navigates. A footnote is
 * the one link whose whole meaning fits beside the sentence, so its text is
 * resolved AT IMPORT and rides in an attribute (`data-note`) the render
 * turns into a small popover. No store, no schema, no id kept in the DOM.
 *
 * The recognition is deliberately conservative: EPUB 3 says `noteref` out
 * loud, and everything else must look like a footnote mark - a short run of
 * digits or note symbols, optionally bracketed - AND point at a fragment
 * inside the book that actually holds text. The book's own table of
 * contents, "see chapter 5" cross-references and external links all fail
 * one of those and stay what they are today: plain words.
 */

/**
 * The most a note may carry, in characters. A belt at import
 * (`cleanNoteText`) and braces at render: the article rebuild caps the
 * attribute again (`reader/article.js`), so a hand-crafted page cannot ride
 * an oversized value through the sanitizer.
 */
export const NOTE_TEXT_LIMIT = 2000;

/**
 * Whether an anchor reads as a footnote reference, judged from what the
 * import can hand in as strings: the `epub:type` attribute and the link's
 * own text. EPUB 3 marks noterefs explicitly; older books are recognized by
 * the mark itself - `1`, `[2]`, `(3)`, `*`, `†` and their kin, at most four
 * characters. What this deliberately does not do is guess from position or
 * styling: a link that says "Chapter One" is never a footnote here.
 *
 * @param {string | null} epubType the anchor's `epub:type`, if any
 * @param {string} markerText the anchor's visible text
 * @returns {boolean}
 */
export function isNoteref(epubType, markerText) {
  if (typeof epubType === "string" && /(^|\s)noteref(\s|$)/.test(epubType)) return true;
  const marker = markerText.trim();
  if (marker.length === 0 || marker.length > 4) return false;
  // Digits and the classical note symbols (dagger, double dagger, section,
  // pilcrow, asterisk), optionally in one pair of brackets.
  return new RegExp("^[\\[(]?[0-9*\\u2020\\u2021\\u00a7\\u00b6]+[\\])]?$").test(marker);
}

/**
 * An href taken apart as a target inside the book, or null when it is not
 * one: no fragment means a jump to a file (navigation, not a note), and a
 * scheme or protocol-relative prefix means the world outside.
 *
 * @param {string | null} href as the book wrote it
 * @returns {{ path: string | null, id: string } | null} `path` null when the
 *   fragment names this same file
 */
export function internalTarget(href) {
  if (typeof href !== "string") return null;
  const hash = href.indexOf("#");
  if (hash === -1) return null;
  const id = href.slice(hash + 1);
  if (id.length === 0) return null;
  const path = href.slice(0, hash);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return null;
  return { path: path.length === 0 ? null : path, id };
}

/**
 * A note's text as the popover will show it: whitespace collapsed the way
 * the store collapses everything, the backlink arrow most books close a
 * note with taken off the end (it points at a place this popover makes
 * meaningless), and the cap applied with an honest ellipsis. Variation
 * selectors ride with the arrows, spelled as codes - a literal invisible
 * character in the source is a character nobody would see in a diff.
 *
 * @param {string} raw the target block's textContent
 * @returns {string} "" when nothing readable is left
 */
export function cleanNoteText(raw) {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const trimmed = collapsed
    .replace(new RegExp("[\\s]*[\\u2190\\u21a9\\u21b5\\u21e6]+[\\ufe0e\\ufe0f]?$"), "")
    .trimEnd();
  if (trimmed.length <= NOTE_TEXT_LIMIT) return trimmed;
  return trimmed.slice(0, NOTE_TEXT_LIMIT - 1).trimEnd() + "…";
}
