/**
 * Looking a word up without a page: the rules behind the "Look up a word"
 * field in the toolbar popup and the "Add a phrase" fold on the saved-phrases
 * page (D197).
 *
 * The field is the bubble over a selection with the page taken away - and
 * with the engine taken away too, on purpose: a word typed on its own has no
 * sentence around it, which is exactly where the engine guesses worst (the
 * bubble says so under every translated word, D192). The dictionaries are the
 * answer, the way they are in the quiet bubble (D121, D158), and a meaning
 * the reader types is the other one. Nothing here touches the DOM or the
 * database: shapes come in, decisions go out, and `lookup-box.js` draws them.
 */

import { classifyLine } from "./dict/line-classifier.js";
import { MEANING_SEPARATOR, afterChoosing, entryBlocks, quietNote, toMeanings } from "./gloss.js";
import { collapseWhitespace, normalize, trimPhrase } from "./normalize.js";
import { MAX_PHRASE_LENGTH } from "./store/phrase.js";

/**
 * What was typed, as a phrase - or nothing to look up.
 *
 * The same two forms a selection is reduced to: `trimPhrase` for what is
 * shown and saved, `normalize` for the key. So a word typed here and the same
 * word selected on a page are one phrase in the vocabulary, and a comma
 * caught at the end costs nothing. Nothing but punctuation is not a question,
 * and neither is more than the store would keep (the bubble's own ceiling).
 *
 * @param {string} input as typed
 * @returns {{ text: string, normalized: string } | null}
 */
export function lookupText(input) {
  if (input.length > MAX_PHRASE_LENGTH) return null;
  const normalized = normalize(input);
  if (normalized.length === 0) return null;
  return { text: trimPhrase(input), normalized };
}

/**
 * The entries come twice: as the bubble's blocks - the label decided, the
 * senses cut into lines to press (`entryBlocks`) - and as they were stored,
 * with the language they came in. Same order, one for one.
 *
 * @typedef {{ kind: "entries", blocks: ReturnType<typeof entryBlocks>, entries: import("./protocol.js").DictEntry[], lang: string }
 *   | { kind: "silence", note: "no-dictionary" | "not-in-dictionary", lang: string }
 *   | { kind: "fault" }} LookupOutcome
 */

/**
 * What the field shows once the dictionaries have answered (`look-up`, D162):
 * the entries as the bubble's blocks, or one sentence about the silence -
 * which of two silences, by the count the answer carries (D164): no
 * dictionary for the language at all, or dictionaries that did not know the
 * word.
 *
 * No answer at all is a fault, and it is said as one. The bubble keeps quiet
 * on it (D164's rule: a fault must never read as a missing dictionary), but
 * the bubble has a page to fall back on and this field has a press to answer -
 * a press answered with nothing reads as a field that hung. The field stands
 * only where a pair is chosen, so "no language to ask in" is never the cause.
 *
 * The bubble's third verdict, "select whole words", is about a selection the
 * matcher could never find again; a typed phrase is whole words by
 * construction, so it does not arise here.
 *
 * @param {import("./protocol.js").LookUp | null} answer
 * @param {string} normalized the phrase's key, for the blocks' labels
 * @returns {LookupOutcome}
 */
export function lookupOutcome(answer, normalized) {
  if (answer === null) return { kind: "fault" };
  const note = quietNote({
    entries: answer.entries.length,
    dictionaries: answer.dictionaries,
    findable: true,
  });
  if (note === null) {
    return {
      kind: "entries",
      blocks: entryBlocks(answer.entries, normalized),
      entries: answer.entries,
      lang: answer.lang,
    };
  }
  // `findable: true` rules the whole-words verdict out; the type of
  // `quietNote` does not know that, so it is folded into the nearest one.
  return { kind: "silence", note: note === "whole-words" ? "not-in-dictionary" : note, lang: answer.lang };
}

/**
 * A line of an entry with what it is (`dict/line-classifier.js`): a meaning
 * to tick, a label to stand over the meanings after it, or a transcription
 * or cross-reference for "More about the word".
 *
 * @typedef {{ kind: import("./dict/line-classifier.js").LineKind, text: string }} EntryRow
 */

/**
 * The entries as one group per dictionary (block 3 of the panel's rebuild):
 * the book's name, and under it every entry it answered with - each with
 * the headword `entryBlocks` decided to name (only when it is not the word
 * typed, D23) and its rows, each row told what it is. The order is the
 * answer's, which is the settings' order of the dictionaries; a book that
 * answered under two headwords (a word and its base form) is still one
 * group, with the meanings of both counted together (`lines`) and what
 * the book says beside its meanings gathered in order (`about`). The name
 * comes from the entry itself, not from the block's label, which drops it
 * when there is one book to tell apart - here every group is named,
 * because the name is the fold's own words.
 *
 * @typedef {{ dictionary: string, entries: Array<{ headword: string, rows: EntryRow[] }>, lines: string[], about: string[] }} EntryGroup
 *
 * @param {import("./protocol.js").DictEntry[]} entries
 * @param {string} normalized the phrase's key
 * @param {string} lang the language the entries are written in - the
 *   dictionaries' source, which the answer names (`LookUp.lang`)
 * @returns {EntryGroup[]}
 */
export function entryGroups(entries, normalized, lang) {
  const blocks = entryBlocks(entries, normalized);
  /** @type {Map<string, EntryGroup>} */
  const groups = new Map();
  entries.forEach((entry, at) => {
    const block = blocks[at];
    if (block === undefined) return;
    let group = groups.get(entry.dictionary);
    if (group === undefined) {
      group = { dictionary: entry.dictionary, entries: [], lines: [], about: [] };
      groups.set(entry.dictionary, group);
    }
    const rows = block.lines.map((text) => ({ kind: classifyLine(text, lang), text }));
    group.entries.push({ headword: block.headword, rows });
    for (const row of rows) {
      if (row.kind === "meaning") group.lines.push(row.text);
      else if (row.kind !== "heading") group.about.push(row.text);
    }
  });
  return [...groups.values()];
}

/**
 * How many of a group's lines stand open before the rest fold under "Show
 * all": enough for a word's meanings in a bilingual book, few enough that
 * a big monolingual entry does not push the list under the panel two
 * screens down (D5 of the rebuild: the height is limited by structure,
 * never by a scrollbar inside the panel). Not by kind of line - nothing in
 * the data says which line is prose (K2, confirmed): the reader's eyes do
 * that, the way they do in the bubble.
 */
export const LINES_OPEN = 8;

/**
 * Where a group's rows are cut (`LINES_OPEN`, or the home's own count),
 * and whether the fold under the cut starts open: it does when a saved
 * meaning would otherwise be out of sight - a tick that cannot be seen is a
 * state the panel is hiding. A home whose own box scrolls (the bubble; the
 * popup, D207) cuts nowhere: `null`.
 *
 * @param {string[]} lines the group's lines, in order
 * @param {string[]} meanings what the phrase means now
 * @param {number | null} [foldAt] lines open before the cut; null for no cut
 * @returns {{ shown: number, unfolded: boolean }} how many lines stand open;
 *   whether the fold with the rest opens by default (false with nothing
 *   folded)
 */
export function foldPoint(lines, meanings, foldAt = LINES_OPEN) {
  const shown = foldAt === null ? lines.length : Math.min(lines.length, foldAt);
  const folded = lines.slice(shown);
  return { shown, unfolded: folded.some((line) => isSaved(meanings, line)) };
}

/**
 * Whether a saved meaning and a dictionary line are one and the same (K3 of
 * the panel's rebuild, Michał's call 2026-09-12): equal once whitespace is
 * folded the way the store folds it on every save (`collapseWhitespace` -
 * the ends trimmed, every run of whitespace one space), and otherwise
 * exact. Case counts: a German noun and the verb it came from differ by a
 * capital, and a meaning the reader typed is the reader's spelling.
 *
 * @param {string} meaning as saved
 * @param {string} line as the book wrote it, or as typed
 * @returns {boolean}
 */
export function sameMeaning(meaning, line) {
  return collapseWhitespace(meaning) === collapseWhitespace(line);
}

/**
 * Whether a dictionary line is among the phrase's saved meanings - what the
 * line's checkbox shows.
 *
 * @param {string[]} meanings what the phrase means now
 * @param {string} line
 * @returns {boolean}
 */
export function isSaved(meanings, line) {
  return meanings.some((meaning) => sameMeaning(meaning, line));
}

/**
 * The meanings that are the reader's own (block 4 of the rebuild): saved,
 * and matching no line of the books that answered - by `sameMeaning`, so a
 * meaning identical to a line stands once, as that line ticked, and not
 * again under "Your own". In the saved order.
 *
 * @param {string[]} meanings what the phrase means now
 * @param {string[]} lines every line the books answered with
 * @returns {string[]}
 */
export function ownMeanings(meanings, lines) {
  return meanings.filter((meaning) => !lines.some((line) => sameMeaning(meaning, line)));
}

/**
 * What a press on a dictionary line does to the phrase - D34's rule seen from
 * the field: the line joins the saved meanings or leaves them, and the phrase
 * is saved with what is left. Taking the last meaning back forgets the
 * phrase: the bubble declines to save an empty gloss and leaves the reader
 * the rest of the bubble, but here the line was the reader's only word about
 * the phrase, and a phrase with nothing to mean has nothing to stay for
 * (K4 of the panel's rebuild, confirmed by Michał 2026-09-12).
 *
 * The meaning taken back is found by `sameMeaning`: a meaning saved from the
 * bubble is the line with its whitespace folded, and it has to leave on the
 * press of the line it came from.
 *
 * @param {string[]} meanings what the phrase means now - empty while it is
 *   not saved
 * @param {string} line the line pressed
 * @returns {{ act: "save", meanings: string[] } | { act: "forget", meanings: string[] }}
 */
export function afterPress(meanings, line) {
  const without = meanings.filter((meaning) => !sameMeaning(meaning, line));
  const next =
    without.length === meanings.length
      ? toMeanings(afterChoosing(meanings.join(MEANING_SEPARATOR), line))
      : without;
  return next.length === 0 ? { act: "forget", meanings: [] } : { act: "save", meanings: next };
}

/**
 * How far a box has to scroll so that a book opened in it stands in view
 * (D214): not at all while the whole book is in view already; the least
 * that brings its end in when it fits below - the name stays where it was
 * pressed and the rows come up under it; and the name to the top edge when
 * the book is taller than the box or starts above it, so the rows begin
 * where the eye lands. A book opened at the bottom edge of a box used to
 * open below it, and the only thing the press seemed to do was draw a
 * scrollbar. Edges in any one set of coordinates, the answer in the same.
 *
 * @param {{ top: number, bottom: number }} view the box's visible edges
 * @param {{ top: number, bottom: number }} book the book's edges, name and rows
 * @returns {number} what to add to the box's scroll position
 */
export function scrollToShow(view, book) {
  if (book.top >= view.top && book.bottom <= view.bottom) return 0;
  if (book.top < view.top || book.bottom - book.top > view.bottom - view.top) return book.top - view.top;
  return book.bottom - view.bottom;
}
