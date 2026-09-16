/**
 * The freshest list of dictionaries this device has seen, and how it gets
 * fresher - the dictionary catalogue's twin of `models/live.js`.
 *
 * The settings page asks WikDict's listing when its update button is pressed -
 * never by itself - and keeps the answer in `storage.local`, so the list
 * somebody sees is the list from the last time the network answered - dated,
 * never blank. The ETag from last time rides along, and an unchanged listing
 * costs a 304 and no transfer.
 *
 * What comes back is not an index file but a directory listing (nginx
 * autoindex HTML), so the conversion is a pattern, not a parse: one
 * `wikdict-xx-yy.zip` name per dictionary, the same contract
 * `tools/wikdict-catalog.mjs` reads when it writes the packaged catalogue.
 * Addresses are never taken from the page - each one is built here from the
 * packaged source and the matched name, so nothing a listing says can point a
 * download anywhere else.
 *
 * Failure is survivable by design: no network, a refused request, a listing
 * that matches nothing - the cached list (or the packaged catalogue) simply
 * remains what the page shows, dated. The one thing failure must never do is
 * erase a good cache. And the cache is re-checked on the way out, not only on
 * the way in: bytes on disk are data, not gospel.
 */

import { webext } from "../browser.js";
import { underPrefix } from "../models/upstream.js";
import { answeredByHost } from "../same-host.js";
import { catalogSource, parseCatalog } from "./catalog.js";

/** The one key this module owns in `storage.local`. */
export const LIVE_DICTIONARIES_KEY = "dictionariesIndex";

/**
 * @typedef {object} LiveDictionaries
 * @property {string} fetchedAt `YYYY-MM-DD`, the day the network last answered
 * @property {import("./catalog.js").CatalogDictionary[]} dictionaries
 */

/**
 * The listing turned into catalogue entries.
 *
 * The pattern is the contract: anything the regex does not match is not a
 * dictionary archive and is left where it is. Every URL is `source + name`,
 * and the name is two matched language codes and a fixed frame - which is the
 * guard, structurally: there is no way to build an address outside the source.
 *
 * @param {string} html the autoindex page
 * @param {string} source the packaged catalogue's listing URL, ending in `/`
 * @returns {import("./catalog.js").CatalogDictionary[]}
 */
export function convertListing(html, source) {
  /** @type {import("./catalog.js").CatalogDictionary[]} */
  const entries = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const match of html.matchAll(/href="(wikdict-([a-z]{2,3})-([a-z]{2,3})\.zip)"/g)) {
    const [, name, from, to] = match;
    if (name === undefined || from === undefined || to === undefined) continue;
    if (from === to || seen.has(name)) continue;
    seen.add(name);
    entries.push({ from, to, url: `${source}${name}` });
  }

  entries.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return entries;
}

/**
 * @param {unknown} stored value under `LIVE_DICTIONARIES_KEY`
 * @returns {(LiveDictionaries & { etag: string | null }) | null}
 */
function readStored(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { fetchedAt, etag, dictionaries } = /** @type {Record<string, unknown>} */ (stored);
  if (typeof fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) return null;

  // Through the same defensive parse the packaged file gets, then through the
  // source guard: a cache written by a future version, or damaged, or somehow
  // tampered with, must not become a way around either.
  const { source } = catalogSource();
  if (source === "") return null;
  const parsed = parseCatalog({ dictionaries });
  const kept = parsed.dictionaries.filter((entry) => underPrefix(entry.url, source));
  if (kept.length === 0) return null;

  return { fetchedAt, etag: typeof etag === "string" ? etag : null, dictionaries: kept };
}

/**
 * @returns {Promise<LiveDictionaries | null>} the cached list, or null when there is none worth showing
 */
export async function readLiveDictionaries() {
  try {
    const stored = await webext().storage.local.get(LIVE_DICTIONARIES_KEY);
    const read = readStored(stored[LIVE_DICTIONARIES_KEY]);
    return read === null ? null : { fetchedAt: read.fetchedAt, dictionaries: read.dictionaries };
  } catch {
    return null;
  }
}

/**
 * @typedef {{ ok: true, changed: boolean, value: LiveDictionaries } | { ok: false, detail: string }} DictRefreshResult
 */

/**
 * Asks the listing's host what the list is today.
 *
 * @param {{ fetch?: typeof fetch, today?: string }} [options] for tests
 * @returns {Promise<DictRefreshResult>}
 */
export async function refreshLiveDictionaries(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const { source } = catalogSource();
  if (source === "") return { ok: false, detail: "no source in the packaged catalogue" };

  /** @type {(LiveDictionaries & { etag: string | null }) | null} */
  let cached = null;
  try {
    const stored = await webext().storage.local.get(LIVE_DICTIONARIES_KEY);
    cached = readStored(stored[LIVE_DICTIONARIES_KEY]);
  } catch {
    // A cache that cannot be read is a cache that will be replaced.
  }

  let response;
  try {
    response = await fetchImpl(source, {
      // The conditional request is the whole economy of this refresh; the
      // browser's own cache underneath it would only blur whose answer this is.
      cache: "no-store",
      // Nothing of the reader's rides along - said rather than defaulted (D171).
      credentials: "omit",
      redirect: "follow",
      ...(cached?.etag ? { headers: { "If-None-Match": cached.etag } } : {}),
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  // The listing from its own host or from nobody (D171): an answer redirected
  // elsewhere is not WikDict's directory, whatever it lists.
  if (!answeredByHost(response, source)) return { ok: false, detail: "answered from another host" };

  if (response.status === 304 && cached !== null) {
    // Unchanged upstream. The date still moves: it answers "when did the
    // network last confirm this list", not "when did it last differ".
    const value = { fetchedAt: today, dictionaries: cached.dictionaries };
    await write({ ...value, etag: cached.etag });
    return { ok: true, changed: false, value };
  }

  if (!response.ok) {
    return { ok: false, detail: `${response.status} ${response.statusText}`.trim() };
  }

  /** @type {string} */
  let html;
  try {
    html = await response.text();
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  const dictionaries = convertListing(html, source);
  // A listing that matches nothing is an answer to distrust, not to show:
  // keeping yesterday's list beats presenting an empty catalogue as news.
  if (dictionaries.length === 0) return { ok: false, detail: "the listing held no dictionaries" };

  const value = { fetchedAt: today, dictionaries };
  await write({ ...value, etag: response.headers.get("ETag") });
  return { ok: true, changed: true, value };
}

/**
 * @param {LiveDictionaries & { etag: string | null }} value
 */
async function write(value) {
  try {
    await webext().storage.local.set({ [LIVE_DICTIONARIES_KEY]: value });
  } catch {
    // A cache that cannot be written costs one refresh next time, nothing more.
  }
}
