/**
 * The site somebody types into the settings to switch re/read off on (D189).
 *
 * The popup's switch stores the page's own `location.hostname`, exact, and the
 * content script matches against that list exactly (`pageMode`). What a
 * person types has to end up in the same shape: whatever they paste - a bare
 * name, a page's whole address, an address with a port or a path - the site
 * part is what is kept, in the browser's own normalised form (lowercase,
 * punycode), which is the form `location.hostname` has. The browser's URL
 * parser does the normalising, and does it the same way it does for the page.
 */

import { t } from "./i18n.js";
import { siteOf } from "./site.js";

/** @typedef {"empty" | "invalid"} HostProblem */

/** A scheme in front, with the slashes an address has. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;

/**
 * @param {string} text what was typed, as is
 * @returns {{ ok: true, value: string } | { ok: false, problem: HostProblem }}
 */
export function parseHostname(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, problem: "empty" };

  const withScheme = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  /** @type {URL} */
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, problem: "invalid" };
  }

  const host = url.hostname;
  if (host.length === 0) return { ok: false, problem: "invalid" };
  // Stored without a leading `www.`, the site's own name: the list then
  // reads "reapps.eu" whichever way the address was typed, and the match
  // (`sameSite`) treats both forms as one site anyway.
  return { ok: true, value: siteOf(host) };
}

/**
 * @param {HostProblem} problem
 * @returns {string} something to show whoever pressed Add
 */
export function describeHostProblem(problem) {
  return problem === "empty" ? t("options_host_empty") : t("options_host_invalid");
}
