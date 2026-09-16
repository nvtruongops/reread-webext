/**
 * The rules of the two counts a saved phrase carries (D209), with no DOM and
 * no database in them: what a page tallies before it reports, what the
 * reader may count as a finished text, and what the background adds up
 * from a report. The row's own arithmetic is in `store/phrase.js`
 * (`counted`); this is everything on the way there.
 *
 * Two counts, two gestures. A bubble opening is reported as it happens - a
 * press on an underline, or a selection of a phrase already kept - and the
 * page batches them for the idle moment after. Since D216 an opening also
 * carries the sentence the phrase stood in, when the page had one: not a
 * count, but the one moment a phrase kept without a sentence is met in one
 * again, and the same batch is how it reaches the row. A text counts as
 * finished only through the gestures that prove the reader reached its end: the Next
 * button under a book part's text, and Mark as read - which, over a book,
 * counts the part on screen and never the whole book, so the parts already
 * counted on the way are not counted twice. Nothing else counts: not
 * opening a text, not scrolling it, not the Next button in the bar above
 * it, not a page the reader never finished.
 */

/** @typedef {import("./store/phrase.js").Counts} Counts */

/**
 * Which parts of which document the reader already counted, so that one
 * pass over a part is one count however the reader moves: Next under the
 * text, Previous, Next again in one sitting is one reading of that part.
 * The memory is one document deep - opening another document forgets the
 * first, and opening the first again tomorrow counts its parts again,
 * which is what a second reading is. It lives in the reader page's memory
 * and nowhere else: a reload forgets too, and that is the cheaper error.
 */
export class ReadLedger {
  /** @type {string} */
  #document = "";
  /** @type {Set<number>} */
  #parts = new Set();

  /**
   * @param {string} document the document's own id - a saved article's
   *   address, a book's id
   * @param {number} part the part on screen, zero for an article
   * @returns {boolean} whether this part is now claimed for the first time
   *   since the document was last opened
   */
  claim(document, part) {
    if (document !== this.#document) {
      this.#document = document;
      this.#parts.clear();
    }
    if (this.#parts.has(part)) return false;
    this.#parts.add(part);
    return true;
  }
}

/**
 * The occurrences a page painted, tallied by the saved phrase they belong
 * to. A painted range names the text it matched, which under D208 may be
 * a form of the saved word rather than the word - `keyOf` says which key
 * the form stands for, and null for a text that is nobody's (a form whose
 * key was learned a moment ago). Sorted by key so that two tallies of the
 * same page are the same list.
 *
 * @param {Iterable<string>} painted the normalized text of every painted
 *   range, one entry per occurrence
 * @param {(normalized: string) => string | null} keyOf
 * @returns {Array<[string, number]>}
 */
export function tallyRead(painted, keyOf) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const normalized of painted) {
    const key = keyOf(normalized);
    if (key === null) continue;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A report added up by key, the shape the store writes: every key once,
 * with everything the report said about it. `recalled` may name a key
 * more than once - the page opened its bubble more than once before the
 * batch went - and each naming is one opening; `read` may too, when two
 * reports were joined, and the counts add.
 *
 * @param {{ recalled: string[], read: Array<[string, number]> }} report
 * @returns {Map<string, Counts>}
 */
export function mergeCounts(report) {
  /** @type {Map<string, Counts>} */
  const counts = new Map();
  /**
   * @param {string} key
   * @returns {Counts}
   */
  const line = (key) => {
    let one = counts.get(key);
    if (one === undefined) {
      one = { recalled: 0, read: 0 };
      counts.set(key, one);
    }
    return one;
  };
  for (const key of report.recalled) line(key).recalled += 1;
  for (const [key, count] of report.read) line(key).read += count;
  return counts;
}

/**
 * The sentences a report carries (D216), by key - the first named per key,
 * which is the one the reader met first: the page sends one per key
 * already, and a report naming a key twice is a hand-made message that
 * must not turn "the first sentence stays" into "the last one wins". A
 * report from a page older than the field carries none.
 *
 * @param {{ sentences?: Array<[string, string]> }} report
 * @returns {Map<string, string>}
 */
export function mergeSentences(report) {
  /** @type {Map<string, string>} */
  const sentences = new Map();
  for (const [key, sentence] of report.sentences ?? []) {
    if (!sentences.has(key)) sentences.set(key, sentence);
  }
  return sentences;
}

/**
 * What a page has to report, gathered between two flushes: openings as they
 * came, and the tallies of the texts finished meanwhile - joined into one
 * message so that a finished part and the bubble opened on its last line
 * wake the background once, not twice.
 */
export class CountReport {
  /** @type {string[]} */
  #recalled = [];
  /** @type {Array<[string, number]>} */
  #read = [];
  /**
   * The sentence each recalled phrase stood in (D216), the first of the
   * batch per key: a row takes one sentence and keeps it, so a second
   * opening in another sentence carries nothing the store could use.
   *
   * @type {Map<string, string>}
   */
  #sentences = new Map();

  /**
   * @param {string} key a saved phrase's own key
   * @param {string | null} [sentence] the sentence the bubble opened in, as
   *   the page shows it, when the page had one (D216) - what fills a row
   *   kept without a sentence, if the setting asks for it; the page sends
   *   what it has, the setting is the background's to read
   */
  recalled(key, sentence = null) {
    this.#recalled.push(key);
    if (sentence !== null && sentence.length > 0 && !this.#sentences.has(key)) this.#sentences.set(key, sentence);
  }

  /** @param {Array<[string, number]>} tally what `tallyRead` found */
  read(tally) {
    this.#read.push(...tally);
  }

  /** @returns {boolean} */
  isEmpty() {
    return this.#recalled.length === 0 && this.#read.length === 0;
  }

  /**
   * Everything gathered, and the report emptied - what one message carries.
   *
   * @returns {{ recalled: string[], read: Array<[string, number]>, sentences: Array<[string, string]> } | null} null when there was nothing
   */
  take() {
    if (this.isEmpty()) return null;
    const batch = { recalled: this.#recalled, read: this.#read, sentences: [...this.#sentences] };
    this.#recalled = [];
    this.#read = [];
    this.#sentences = new Map();
    return batch;
  }
}
