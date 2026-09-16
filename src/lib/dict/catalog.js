/**
 * The list of dictionaries the settings page offers to download.
 *
 * A file in the package (`catalog.json`), not something fetched at runtime,
 * for the same reason the model registry is: the addresses the extension is
 * willing to contact are part of what somebody installed and can read. What it
 * deliberately does not carry is checksums - WikDict rebuilds its archives in
 * place, and a sum pinned here would break with every rebuild. What stands in
 * for it is written down in `download.js`.
 *
 * Parsing is defensive the way the model registry's is: this is data, data
 * gets regenerated and hand-edited, and one bad entry must not take the other
 * five hundred down with it.
 */

import catalogData from "./catalog.json" with { type: "json" };

/**
 * @typedef {object} CatalogDictionary
 * @property {string} from language of the headwords, the one being read
 * @property {string} to language the meanings are written in
 * @property {string} url the archive, https
 */

/**
 * The code shapes WikDict actually uses - two or three letters. The same rule
 * the model registry applies, minus the script suffix nothing here has.
 *
 * @param {string} code
 * @returns {boolean}
 */
function isLanguageCode(code) {
  return /^[a-z]{2,3}$/.test(code);
}

/**
 * @param {unknown} raw
 * @param {number} index
 * @returns {{ ok: true, value: CatalogDictionary } | { ok: false, problem: string }}
 */
function parseEntry(raw, index) {
  const where = `dictionary ${index}`;
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${where}: not an object` };
  const { from, to, url } = /** @type {Record<string, unknown>} */ (raw);

  if (typeof from !== "string" || typeof to !== "string" || !isLanguageCode(from) || !isLanguageCode(to)) {
    return { ok: false, problem: `${where}: from and to must be language codes like en` };
  }
  if (from === to) return { ok: false, problem: `${where}: a dictionary from ${from} to itself` };
  // Plain http would hand the download to whoever is on the wire, and unlike
  // the models there is no checksum behind it to catch that.
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return { ok: false, problem: `${where}: url is not https` };
  }

  return { ok: true, value: { from, to, url } };
}

/**
 * @param {unknown} raw
 * @returns {{ dictionaries: CatalogDictionary[], problems: string[] }}
 */
export function parseCatalog(raw) {
  if (typeof raw !== "object" || raw === null) {
    return { dictionaries: [], problems: ["catalog is not an object"] };
  }

  const list = /** @type {Record<string, unknown>} */ (raw)["dictionaries"];
  if (!Array.isArray(list)) return { dictionaries: [], problems: ["catalog has no dictionaries array"] };

  /** @type {CatalogDictionary[]} */
  const dictionaries = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const seen = new Set();

  for (const [index, entry] of list.entries()) {
    const result = parseEntry(entry, index);
    if (!result.ok) {
      problems.push(result.problem);
      continue;
    }
    const key = `${result.value.from}-${result.value.to}`;
    if (seen.has(key)) {
      problems.push(`dictionary ${index}: ${key} is listed twice`);
      continue;
    }
    seen.add(key);
    dictionaries.push(result.value);
  }

  dictionaries.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { dictionaries, problems };
}

/** @type {{ dictionaries: CatalogDictionary[], problems: string[] } | null} */
let parsed = null;

/**
 * @returns {CatalogDictionary[]} every dictionary that can be downloaded
 */
export function catalogDictionaries() {
  parsed ??= parseCatalog(catalogData);
  return parsed.dictionaries;
}

/**
 * Where the addresses came from, so the settings page can say it rather than
 * leave a reader to guess who is about to be contacted.
 *
 * @returns {{ source: string, checkedAt: string }}
 */
export function catalogSource() {
  const { source, checkedAt } = /** @type {Record<string, unknown>} */ (catalogData);
  return {
    source: typeof source === "string" ? source : "",
    checkedAt: typeof checkedAt === "string" ? checkedAt : "",
  };
}
