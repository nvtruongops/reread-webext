/**
 * The shape of a saved article and the rules of the reading list, with no
 * database in sight - the same split as `phrase.js` next to `vocab.js`, so
 * that everything this module decides runs under `node --test`.
 *
 * What gets saved is the *rebuilt* article - our own markup from the allowed
 * list in `lib/reader/sanitize.js` - never the page's raw HTML. And it is not
 * trusted back: on open the content goes through the rebuild again, so a
 * tightening of the allowed list reaches entries saved before it.
 */

/**
 * What the list shows about a saved article, and nothing heavier: the row can
 * be rendered without the article's content ever entering memory.
 *
 * `readAt` is a timestamp because "when" costs nothing over a flag, and null
 * means still to be read. It is set and cleared only by hand, from the article
 * view - opening an article is not reading it.
 *
 * `pictures` is the row's account of the article's pictures (D145) - how
 * many and how much they take - so that the list and the menu can say so
 * without reading a byte of them. Absent for an article that has none,
 * which is every article saved before pictures and every one whose reader
 * never asked for them.
 *
 * @typedef {{
 *   url: string,
 *   hostname: string,
 *   title: string,
 *   savedAt: number,
 *   readAt: number | null,
 *   pictures?: import("../reader/pictures.js").PicturesSummary,
 * }} SavedMeta
 */

/**
 * The whole of a saved article. `dir` and `lang` are what the extractor said
 * about the text, kept so that an article in Arabic still lays out as one when
 * it is opened offline - they describe the content, so they travel with it.
 *
 * @typedef {SavedMeta & { content: string, dir: string | null, lang: string | null }} SavedArticle
 */

import { t } from "../i18n.js";
import { asPicturesSummary } from "../reader/pictures.js";

/** The two segments of the list, and the only filter it has. */
export const Segment = Object.freeze({
  UNREAD: "unread",
  READ: "read",
});

/** @typedef {(typeof Segment)[keyof typeof Segment]} SegmentValue */

/**
 * The schemes an article's address may have: the web's two, and a file on
 * this device. An article is a page somebody read, and those are the places
 * a page is read from - anything else (`javascript:`, `data:`, `blob:`) is
 * no address to come back to, and the reader puts the address into a link
 * (D171): what a hand-made backup file names must not become an `href` the
 * reader would hand out.
 */
const ARTICLE_SCHEMES = new Set(["http:", "https:", "file:"]);

/**
 * Builds the record a save press writes, or nothing when there is nothing
 * worth writing - no address to come back to, or no content to keep.
 *
 * The hostname is derived here, once, so the list never parses URLs to render
 * rows. A URL without a hostname (`file:`) is still an article; its row just
 * has no domain to show, and the title falls back to the address rather than
 * to an empty line.
 *
 * @param {{
 *   url: string,
 *   title: string,
 *   content: string,
 *   dir?: string | null,
 *   lang?: string | null,
 *   savedAt: number,
 * }} input
 * @returns {SavedArticle | null}
 */
export function savedArticle({ url, title, content, dir, lang, savedAt }) {
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof content !== "string" || content.length === 0) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;

  /** @type {string} */
  let hostname;
  try {
    const address = new URL(url);
    if (!ARTICLE_SCHEMES.has(address.protocol)) return null;
    hostname = address.hostname;
  } catch {
    // Not an address anybody could return to - not an article to keep.
    return null;
  }

  const shown = typeof title === "string" ? title.trim() : "";

  return {
    url,
    hostname,
    title: shown.length > 0 ? shown : hostname.length > 0 ? hostname : url,
    savedAt,
    readAt: null,
    content,
    dir: keptWord(dir),
    lang: keptWord(lang),
  };
}

/**
 * `dir` and `lang` as they are worth storing: a short token or nothing. They
 * end up as attributes on the reader's own document, so anything long or empty
 * is dropped rather than carried.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function keptWord(value) {
  if (typeof value !== "string") return null;
  const word = value.trim();
  return word.length > 0 && word.length <= 40 ? word : null;
}

/**
 * A meta row as it came back from the database, narrowed field by field. Rows
 * are somebody's saved reading, so the lean is toward keeping them: a missing
 * title renders as the hostname it still has, a broken `readAt` reads as
 * unread. Only a row without an address is dropped - there is nothing to open.
 *
 * @param {unknown} value
 * @returns {SavedMeta | null}
 */
export function asSavedMeta(value) {
  if (typeof value !== "object" || value === null) return null;
  const { url, hostname, title, savedAt, readAt, pictures } = /** @type {Record<string, unknown>} */ (
    value
  );
  if (typeof url !== "string" || url.length === 0) return null;

  const host = typeof hostname === "string" ? hostname : "";
  const shown = typeof title === "string" && title.length > 0 ? title : host.length > 0 ? host : url;
  const kept = asPicturesSummary(pictures);

  return {
    url,
    hostname: host,
    title: shown,
    savedAt: typeof savedAt === "number" && Number.isFinite(savedAt) ? savedAt : 0,
    readAt: typeof readAt === "number" && Number.isFinite(readAt) ? readAt : null,
    // The field stands only where there are pictures: a row without it is
    // one shape everywhere, and a row from before pictures reads as one.
    ...(kept === null ? {} : { pictures: kept }),
  };
}

/**
 * The rows one segment of the list shows, most recent activity first, where
 * activity is the later of saving and reading (`lastReadAt`, the position
 * row's clock - a row without one has only its saving to stand on). One axis,
 * not two groups: the document last touched - opened, read in, or freshly
 * added - is the one "where was I?" means, and a page saved this morning
 * should not sink under everything ever opened. Sorting lives here rather
 * than in the database because the key is derived across two stores, and no
 * index orders by a maximum.
 *
 * Generic over the row, because the list holds more than articles now: a
 * book enters dressed in the same fields (`list-view.js`), and whatever else
 * it carries has to come out the other side.
 *
 * @template {SavedMeta & { lastReadAt?: number | null }} T
 * @param {T[]} metas
 * @param {SegmentValue} segment
 * @returns {T[]}
 */
export function listedRows(metas, segment) {
  /** @param {T} meta @returns {number} */
  const activity = (meta) => Math.max(meta.savedAt, meta.lastReadAt ?? 0);
  return metas
    .filter((meta) => (segment === Segment.READ ? meta.readAt !== null : meta.readAt === null))
    .sort((a, b) => activity(b) - activity(a) || a.url.localeCompare(b.url));
}

/**
 * The one sentence an empty list says, picked by what kind of empty it is:
 * nothing saved at all, or just nothing in this segment.
 *
 * @param {number} total how many articles are saved altogether
 * @param {SegmentValue} segment
 * @returns {string}
 */
export function emptySentence(total, segment) {
  if (total === 0) {
    // The button it names is `reader_save`, quoted verbatim so the sentence
    // and the button cannot drift apart in any language.
    return t("reader_empty_none", t("reader_save"));
  }
  return segment === Segment.READ
    ? t("reader_empty_none_read")
    : t("reader_empty_all_read");
}
