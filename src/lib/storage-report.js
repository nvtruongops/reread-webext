/**
 * What the browser says about the extension's own storage, and the one thing
 * asked of it: to keep that storage.
 *
 * Everything this extension keeps - the vocabulary, the reading list, the
 * models, the dictionaries - lives in the extension origin's IndexedDB, and a
 * browser is free to clear an origin's storage to make room unless the origin
 * is *persisted* (`navigator.storage.persist()`). What that promise is worth
 * differs by engine, read from the sources (2026-08-26):
 *
 * - Firefox grants `persistent-storage` to every extension that declares
 *   `unlimitedStorage` (`Extension.sys.mjs`), and its quota manager never
 *   evicts a `moz-extension` origin at all - the call answers true and asks
 *   nobody anything.
 * - Chromium never prompts either; `unlimitedStorage` already keeps the origin
 *   out of eviction, whatever `persisted()` answers.
 * - WebKit (Safari 18) evicts least-recently-used origins once the store
 *   passes 80% of the volume, sparing persisted ones - and grants
 *   `persist()` only to domains its tracking prevention exempts from its own
 *   deletion (`NetworkStorageManager::persistOrigin`). That deletion is the
 *   real hazard: script-written storage of a domain goes after 30 days of
 *   Safari use without a user interaction on its pages, exemptions aside
 *   (`ResourceLoadStatisticsStore::shouldRemoveAllButCookiesFor`), and the
 *   extension's pages are a domain like any other. So on WebKit the answer to
 *   `persist()` is also the answer to "is this extension's data exempt" - a
 *   probe as much as a request, which is why the settings page shows it.
 *
 * The functions take the storage manager as a parameter so that the answers
 * can be tested against a stand-in; callers pass nothing.
 */

/** The vendor string every WebKit browser reports, and no other engine does. */
const WEBKIT_VENDOR = "Apple Computer, Inc.";

/**
 * @typedef {object} StorageReport
 * @property {number | null} usage bytes in use by this origin, null when the engine will not say
 * @property {boolean | null} persisted whether the origin is persisted, null when the engine will not say
 */

/**
 * @typedef {{ persisted?: () => Promise<boolean>, persist?: () => Promise<boolean>, estimate?: () => Promise<{ usage?: number }> }} StorageLike
 */

/**
 * @returns {StorageLike | null}
 */
function defaultStorage() {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return null;
  return navigator.storage;
}

/**
 * Whether this page runs in a WebKit browser - the engine whose "not
 * persisted" means "may be deleted", where every other engine's means
 * nothing the user should hear about.
 *
 * @param {{ vendor?: string }} [nav]
 * @returns {boolean}
 */
export function isWebKit(nav = typeof navigator === "undefined" ? {} : navigator) {
  return nav.vendor === WEBKIT_VENDOR;
}

/**
 * Asks for the storage to be kept, once: an origin already persisted is left
 * alone, so the call costs the engine nothing on the second start. Quiet on
 * every failure - persistence is a wish, and a start must not hang on it.
 *
 * @param {StorageLike | null} [storage]
 * @returns {Promise<boolean | null>} the answer, or null when the engine has no such API
 */
export async function ensurePersistent(storage = defaultStorage()) {
  if (storage === null || typeof storage.persist !== "function") return null;
  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}

/**
 * The origin's usage and standing, each null where the engine keeps it to
 * itself - a page reports what it can and says nothing about the rest.
 *
 * @param {StorageLike | null} [storage]
 * @returns {Promise<StorageReport>}
 */
export async function readStorage(storage = defaultStorage()) {
  /** @type {StorageReport} */
  const report = { usage: null, persisted: null };
  if (storage === null) return report;
  if (typeof storage.estimate === "function") {
    try {
      const estimate = await storage.estimate();
      if (typeof estimate.usage === "number" && Number.isFinite(estimate.usage)) report.usage = estimate.usage;
    } catch {
      // Left null: an engine that refuses to estimate is not an engine in trouble.
    }
  }
  if (typeof storage.persisted === "function") {
    try {
      report.persisted = await storage.persisted();
    } catch {
      // Left null, same reason.
    }
  }
  return report;
}

/**
 * Which sentence the settings page owes the reader about persistence, if any.
 * "granted" is worth saying everywhere - it is the promise kept. "at risk" is
 * said only on WebKit, where a refusal means the engine may delete the data
 * on its own schedule; on Chromium a refusal changes nothing (the origin is
 * unlimited, not evictable), and on Firefox it does not happen.
 *
 * @param {{ persisted: boolean | null, webkit: boolean }} state
 * @returns {"granted" | "at-risk" | null}
 */
export function persistenceNote({ persisted, webkit }) {
  if (persisted === true) return "granted";
  if (persisted === false && webkit) return "at-risk";
  return null;
}
