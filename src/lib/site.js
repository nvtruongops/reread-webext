/**
 * What counts as the same site (D189).
 *
 * A switched-off site is stored as a hostname and matched against the page's
 * own `location.hostname`. Exactly, but for one thing: `www.example.org` and
 * `example.org` are the same site to everyone but the DNS, and a person who
 * switched one off meant the other too - Michał switched off `www.reapps.eu`
 * and found `reapps.eu` still translating. So a leading `www.` is dropped on
 * both sides before comparing. Nothing else is folded: a subdomain such as
 * `news.example.org` is a separate site, because it usually is one.
 *
 * Pure, so the content script, the popup and the settings page share one
 * rule and `node --test` reads it.
 */

/**
 * The part of a hostname that names the site: lowercase, without a leading
 * `www.`. This is the form new entries are stored in; older entries may still
 * carry the `www.`, which is why comparisons go through it on both sides.
 *
 * @param {string} hostname
 * @returns {string}
 */
export function siteOf(hostname) {
  return hostname.toLowerCase().replace(/^www\./u, "");
}

/**
 * @param {string} a a stored entry or a page's hostname
 * @param {string} b
 * @returns {boolean}
 */
export function sameSite(a, b) {
  return siteOf(a) === siteOf(b);
}

/**
 * @param {readonly string[]} hosts the switched-off list, as stored
 * @param {string} hostname the page's own
 * @returns {boolean}
 */
export function isSwitchedOff(hosts, hostname) {
  return hosts.some((one) => sameSite(one, hostname));
}
