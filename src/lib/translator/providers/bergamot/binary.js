/**
 * The engine's binary, read out of the package by the page that owns the
 * worker - the background, the Chromium engine host, the settings page - and
 * handed over in the worker's first message. The worker never fetches it
 * itself (D196).
 *
 * Why the page and not the worker, where the bytes are needed: Firefox
 * routes a worker's `fetch()` through the parent process (`FetchChild` to
 * `FetchService`, pref `dom.workers.pFetch.enabled`, on by default), and that
 * service refuses every request while the network link is down -
 * `FetchService::Fetch` answers `NS_ERROR_OFFLINE` to anything but localhost,
 * a `moz-extension:` address included, from the moment `nsIOService` reports
 * connectivity lost until it reports it back. The package is never opened;
 * the scheme is never looked at. So the first engine start after the event
 * page had slept in airplane mode failed ("something went wrong inside the
 * extension") and kept failing until the browser was restarted - the service
 * reads its initial state from `Services.io.offline`, which airplane mode
 * never sets (Michał's Boox Page, 2026-09-11). A page's own `fetch()` takes
 * the direct path, `FetchDriver` in the page's process, and reads the package
 * offline like any other resource; the worker's glue still arrives through
 * `importScripts`, a script load that goes nowhere near the fetch service.
 * Read in Firefox's sources, not its docs (the decision names the files).
 * Chromium and WebKit have no such gate and lose nothing by the same
 * arrangement.
 *
 * The bytes are handed to the worker transferred, not copied: five megabytes
 * the page has no further use for.
 */

import { webext } from "../../../browser.js";

/** Where the engine's binary lives in the package. */
export const ENGINE_BINARY = "vendor/bergamot/bergamot-translator-worker.wasm";

/**
 * @param {typeof globalThis.fetch} [fetchImpl] a stand-in for tests
 * @returns {Promise<ArrayBuffer>}
 */
export async function readEngineBinary(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(webext().runtime.getURL(ENGINE_BINARY));
  if (!response.ok) {
    throw new Error(`engine binary is missing from the package (HTTP ${response.status})`);
  }
  // Read whole rather than streamed: five megabytes off the local disk, and
  // the worker instantiates from a buffer - `instantiateStreaming` would
  // additionally depend on the browser labelling extension resources with
  // the right MIME type.
  return await response.arrayBuffer();
}
