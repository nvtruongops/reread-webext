/**
 * The address somebody pastes to have a dictionary fetched from it.
 *
 * The catalogue's addresses are written into the package and held to it; an
 * address typed into the settings page is the reader's own, and what stands
 * guard is the shape of it, judged before anything is asked of the network.
 * The rules are few, and each is a refusal with a sentence:
 *
 * - `https` only. The package's policy allows nothing else, and a plain `http`
 *   link would hand the download to whoever is on the wire.
 * - No user name or password in it. A download carries nothing of the
 *   reader's (D171), and an address that smuggles credentials in is not one
 *   to follow.
 *
 * The scheme may be missing: `www.example.org/dict.zip` is how an address is
 * copied off a page, and `https://` is the only thing it could have meant.
 * What comes back is the address as the browser normalises it, without a
 * fragment - nothing after `#` ever reaches a server.
 */

import { t } from "../i18n.js";

/** @typedef {"empty" | "invalid" | "not_https" | "credentials"} LinkProblem */

/** A scheme in front: a letter, then what a scheme may hold, then a colon. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

/**
 * @param {string} text what was pasted, as is
 * @returns {{ ok: true, value: string } | { ok: false, problem: LinkProblem }}
 */
export function parseDictionaryLink(text) {
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

  if (url.protocol !== "https:") return { ok: false, problem: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, problem: "credentials" };
  if (url.hostname === "") return { ok: false, problem: "invalid" };

  url.hash = "";
  return { ok: true, value: url.href };
}

/**
 * @param {LinkProblem} problem
 * @returns {string} something to show whoever pressed Download
 */
export function describeLinkProblem(problem) {
  switch (problem) {
    case "empty":
      return t("dict_link_empty");
    case "not_https":
      return t("dict_link_not_https");
    case "credentials":
      return t("dict_link_credentials");
    default:
      return t("dict_link_invalid");
  }
}
