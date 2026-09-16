/**
 * The message shape between the background and the engine host - the offscreen
 * document that runs the engine on Chromium, where a service worker cannot
 * spawn the engine's worker (the service worker spec forbids nested workers).
 *
 * Deliberately not the shape in `protocol.js`, and deliberately without its
 * `kind` field: that one is a contract with content scripts, this one is an
 * implementation detail between two contexts that ship together. A message
 * sent with `runtime.sendMessage` reaches every open extension page, so the
 * shape is also each side's filter - the host answers exactly these and
 * nothing else, and every other listener's narrowing (`asRequest`,
 * `asPageRequest`) already returns null for an object with no `kind`.
 */

/** The discriminator on every call addressed to the engine host. */
export const ENGINE_HOST = "bergamot-host";

/**
 * @typedef {import("../../index.js").TranslateInput} TranslateInput
 * @typedef {{ host: typeof ENGINE_HOST, job: TranslateInput }} EngineCall
 */

/**
 * @param {TranslateInput} job
 * @returns {EngineCall}
 */
export function engineCall(job) {
  return { host: ENGINE_HOST, job };
}

/**
 * Narrows whatever arrived over `runtime.sendMessage` to a call the engine
 * host answers. Checked field by field even though the sender is our own
 * background: an extension page can outlive the background that opened it
 * across an update, and the two ends of this channel are then two versions.
 *
 * @param {unknown} message
 * @returns {TranslateInput | null}
 */
export function asEngineCall(message) {
  if (typeof message !== "object" || message === null) return null;
  const { host, job } = /** @type {Record<string, unknown>} */ (message);
  if (host !== ENGINE_HOST) return null;
  if (typeof job !== "object" || job === null) return null;

  const { text, from, to, context } = /** @type {Record<string, unknown>} */ (job);
  if (typeof text !== "string" || typeof from !== "string" || typeof to !== "string") return null;
  // A context that is not a string is dropped rather than refused, exactly as
  // `asRequest` drops it: it is an extra the answer does not depend on.
  return typeof context === "string" ? { text, from, to, context } : { text, from, to };
}

/**
 * The channel's other direction, and the only thing that travels it: the host
 * telling the background which color scheme the browser is in, because the
 * host can ask `matchMedia` and a service worker cannot - and the background
 * is the one that can reach `action.setIcon` while no page is open. Sent
 * whenever the host stands up and again when the scheme flips under it.
 *
 * @typedef {{ host: typeof ENGINE_HOST, scheme: { dark: boolean } }} SchemeReport
 */

/**
 * @param {boolean} dark
 * @returns {SchemeReport}
 */
export function schemeReport(dark) {
  return { host: ENGINE_HOST, scheme: { dark } };
}

/**
 * @param {unknown} message
 * @returns {{ dark: boolean } | null}
 */
export function asSchemeReport(message) {
  if (typeof message !== "object" || message === null) return null;
  const { host, scheme } = /** @type {Record<string, unknown>} */ (message);
  if (host !== ENGINE_HOST) return null;
  if (typeof scheme !== "object" || scheme === null) return null;
  const { dark } = /** @type {Record<string, unknown>} */ (scheme);
  return typeof dark === "boolean" ? { dark } : null;
}
