/**
 * What the saved-phrases page shows, without the DOM.
 *
 * A vocabulary is thousands of rows after a season of reading, so the page
 * needs the same two things the long lists in the settings needed - a filter
 * and an order - plus one they did not: pages, because five thousand rows in
 * one column is a scroll nobody finishes. All three are rules, rules can be
 * wrong quietly, and so all three live here, under `node --test`.
 */

import { countsOf } from "../lib/store/phrase.js";
import { matchesFilter, sortByLabel } from "../options/models-view.js";

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

/**
 * A hundred rows: enough that a page of vocabulary feels like a list rather
 * than a peephole, few enough that rebuilding one is nothing.
 */
export const PAGE_SIZE = 100;

/**
 * Newest first - the store keeps oldest first, because that is the order an
 * export has to be stable in, but what a reader opens this page for is "what
 * did I just save". The id tiebreak is the store's, mirrored, so two phrases
 * saved in the same millisecond hold their order between renders.
 *
 * @param {Phrase[]} phrases as `listPhrases` answers, oldest first
 * @returns {Phrase[]}
 */
export function newestFirst(phrases) {
  return [...phrases].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

/**
 * The orders the page offers (D209). Newest first is the page's own since
 * D65; the two counts order by what the reader did with a phrase - the most
 * checked, the most read; the alphabet is for finding a word whose spelling
 * is known. Strings, so the select's value can be one.
 */
export const Order = Object.freeze({
  NEWEST: "newest",
  RECALLED: "recalled",
  READ: "read",
  ALPHABETICAL: "alphabetical",
});

/** @typedef {(typeof Order)[keyof typeof Order]} OrderValue */

/**
 * @param {unknown} value
 * @returns {OrderValue} the order named, newest first for anything else
 */
export function asOrder(value) {
  return Object.values(Order).find((one) => one === value) ?? Order.NEWEST;
}

/**
 * The list in one of the orders, as a copy. The counts order descending,
 * the other count second - among phrases checked equally often, the one
 * read more stands first - and newest first after that, so the order never
 * depends on how the store happened to list two rows. The alphabet is the
 * phrases' own language's: its collator puts an accented letter beside its
 * plain one and knows the order of the letters of Ukrainian, which a
 * code-point sort does not.
 *
 * @param {Phrase[]} phrases as `listPhrases` answers or as the page keeps them
 * @param {OrderValue} order
 * @param {string} lang the phrases' language, for the collator; empty for the browser's
 * @returns {Phrase[]}
 */
export function ordered(phrases, order, lang) {
  const newest = newestFirst(phrases);
  if (order === Order.NEWEST) return newest;
  if (order === Order.ALPHABETICAL) {
    const collator = new Intl.Collator(lang.length > 0 ? lang : undefined, { sensitivity: "base", numeric: true });
    return newest.sort((a, b) => collator.compare(a.phrase, b.phrase));
  }
  return newest.sort((a, b) => {
    const one = countsOf(a);
    const two = countsOf(b);
    const byRecalls = two.recalls - one.recalls;
    const byReads = two.reads - one.reads;
    return order === Order.RECALLED ? byRecalls || byReads : byReads || byRecalls;
  });
}

/**
 * Whether any of the rows on screen carries a count to explain (D211): the
 * legend over the list stands only then, so a page of phrases nobody has
 * checked or met in a finished text reads as it did before the counts.
 *
 * @param {Phrase[]} rows the rows of the page shown
 * @returns {boolean}
 */
export function anyCounted(rows) {
  return rows.some((phrase) => {
    const counts = countsOf(phrase);
    return counts.recalls > 0 || counts.reads > 0;
  });
}

/**
 * Everything a row can be found by: how the phrase is written and every
 * meaning it was kept for.
 *
 * @param {Phrase} phrase
 * @returns {string}
 */
export function searchablePhrase(phrase) {
  return [phrase.phrase, ...phrase.translations].join(" ").toLowerCase();
}

/**
 * The page as it should be rendered: which rows, which page that turned out to
 * be, out of how many. The page number asked for is clamped rather than
 * trusted, because the list moves under it - Learned takes the last row of the
 * last page, a filter narrows ten pages to one - and a blank page with a
 * pager pointing back at it is a dead end nobody should have to notice.
 *
 * @param {Phrase[]} phrases newest first, as the page keeps them
 * @param {{ query: string, page: number }} shown what the reader asked for
 * @returns {{ rows: Phrase[], page: number, pages: number, matching: number }}
 */
export function listView(phrases, { query, page }) {
  const matching = phrases.filter((phrase) => matchesFilter(searchablePhrase(phrase), query));
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
  };
}

/**
 * Where the filter's words sit in a row's text, as segments to render: the
 * matched stretches marked, everything else plain. The match rule is
 * `matchesFilter`'s - every word, anywhere, case-folded - so what lights up
 * is exactly why the row is on screen.
 *
 * Case folding can change a string's length (one dotted capital I becomes
 * two code units); when it does, the folded indexes no longer point into the
 * original, and the text comes back unmarked rather than marked wrong.
 *
 * @param {string} text as the row shows it
 * @param {string} query as typed into the filter
 * @returns {Array<{ text: string, hit: boolean }>} the whole text, in order
 */
export function markSegments(text, query) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  const folded = text.toLowerCase();
  if (words.length === 0 || folded.length !== text.length) return [{ text, hit: false }];

  const hit = new Array(text.length).fill(false);
  for (const word of words) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      hit.fill(true, at, at + word.length);
    }
  }

  /** @type {Array<{ text: string, hit: boolean }>} */
  const segments = [];
  let from = 0;
  for (let at = 1; at <= text.length; at += 1) {
    if (at === text.length || hit[at] !== hit[from]) {
      segments.push({ text: text.slice(from, at), hit: hit[from] === true });
      from = at;
    }
  }
  return segments;
}

/**
 * Where the phrase stands in the sentence it was kept from (D210), as
 * segments to render (D211): the first occurrence marked, case-folded,
 * everything else plain - so the opened sentence shows what it is an
 * example of. The first only: a sentence quotes the phrase once as the
 * place it was saved from, and a second marking would say nothing more.
 * No occurrence - the sentence holds another form of the word (D208), or
 * was saved around a longer selection - hands the sentence back plain,
 * which is no error: the example still reads.
 *
 * The same folding guard as `markSegments`: when lower-casing changes the
 * length, the folded index no longer points into the original, and the
 * sentence comes back unmarked rather than marked wrong.
 *
 * @param {string} sentence as the row shows it
 * @param {string} phrase as saved
 * @returns {Array<{ text: string, hit: boolean }>} the whole sentence, in order
 */
export function sentenceSegments(sentence, phrase) {
  const needle = phrase.trim().toLowerCase();
  const folded = sentence.toLowerCase();
  const plain = [{ text: sentence, hit: false }];
  if (needle.length === 0 || folded.length !== sentence.length) return plain;
  const at = folded.indexOf(needle);
  if (at === -1) return plain;
  /** @type {Array<{ text: string, hit: boolean }>} */
  const segments = [];
  if (at > 0) segments.push({ text: sentence.slice(0, at), hit: false });
  segments.push({ text: sentence.slice(at, at + needle.length), hit: true });
  if (at + needle.length < sentence.length) segments.push({ text: sentence.slice(at + needle.length), hit: false });
  return segments;
}

/**
 * Which pairs the select offers: every pair with anything saved, by name, and
 * the configured pair even when nothing is saved for it yet - a control must
 * never disagree with the settings it shows, which is the popup's rule for the
 * same select. Counts ride along so the choice reads as "what is where"
 * before it is made.
 *
 * @param {{ sourceLang: string | null, targetLang: string | null }} config
 * @param {Array<{ langFrom: string, langTo: string, count: number }>} saved
 * @returns {Array<{ pair: string, from: string, to: string, count: number }>}
 */
export function pairChoicesFor(config, saved) {
  const rows = sortByLabel(
    saved.map(({ langFrom, langTo, count }) => ({
      pair: `${langFrom}${langTo}`,
      from: langFrom,
      to: langTo,
      count,
    })),
  );

  // No pair chosen adds no row: the select is exactly the pairs that hold
  // phrases - on a fresh install, an empty select behind the page's own
  // empty state.
  if (config.sourceLang === null || config.targetLang === null) return rows;
  const known = rows.some((row) => row.from === config.sourceLang && row.to === config.targetLang);
  if (known) return rows;

  return [
    {
      pair: `${config.sourceLang}${config.targetLang}`,
      from: config.sourceLang,
      to: config.targetLang,
      count: 0,
    },
    ...rows,
  ];
}
