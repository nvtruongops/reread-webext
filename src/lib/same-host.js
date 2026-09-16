/**
 * Whether an answer came from the host it was asked of (D171).
 *
 * The addresses the extension downloads from are written into the package,
 * and the promise to whoever reads it is that these are the only servers it
 * talks to. `fetch` follows redirects on its own, so a host that answered
 * "go there instead" would have the bytes fetched from wherever "there" is -
 * and the page's policy (`connect-src https:`) holds only the scheme. This is
 * the other half: the answer's own address, checked against the request's
 * origin, and refused when it differs. A redirect within the host (a path
 * moved, `http` upgraded) still passes.
 *
 * `response.url` is empty for a stand-in in tests and for a shim without one;
 * with no address to judge there is no redirect to refuse, and the check
 * stands aside rather than failing every download on a fake.
 *
 * @param {{ url?: string }} response what `fetch` answered
 * @param {string} requested the address that was asked for
 * @returns {boolean}
 */
export function answeredByHost(response, requested) {
  const answered = typeof response.url === "string" ? response.url : "";
  if (answered === "") return true;
  try {
    return new URL(answered).origin === new URL(requested).origin;
  } catch {
    return false;
  }
}
