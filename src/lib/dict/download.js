/**
 * Fetching a dictionary archive from the catalogue.
 *
 * Deliberately not the model downloader. That one holds every file to a
 * SHA-256 pinned in the package, because Mozilla's bucket keeps a model at one
 * address forever. WikDict rebuilds its files in place - a sum pinned at
 * release would fail the day they regenerate, which is to say: work exactly
 * until it is needed. So there is no pinned sum here, and the honesty is in
 * saying so: what stands between a download and the database is the size cap
 * below, the archive's own structure checks (`zip.js`), and the StarDict
 * parser, which treats every file as hostile no matter where it came from -
 * the same parser that guards the files somebody picks by hand.
 *
 * Progress is best-effort: the catalogue carries no sizes (they change with
 * every rebuild upstream), so the total comes from `Content-Length` when the
 * server sends one, and is zero when it does not - the caller shows a bar
 * without an end rather than a bar that lies.
 */

import { aside, t } from "../i18n.js";
import { answeredByHost } from "../same-host.js";

/**
 * @typedef {"network" | "http" | "too_big" | "cancelled"} DictDownloadProblem
 */

/**
 * @typedef {object} DictDownloadProgress
 * @property {number} received bytes so far
 * @property {number} total from Content-Length, or 0 when the server did not say
 */

/**
 * @typedef {object} DictDownloadOptions
 * @property {(progress: DictDownloadProgress) => void} [onProgress]
 * @property {AbortSignal} [signal]
 * @property {boolean} [anyHost] follow the address wherever its host sends it -
 *   for an address the reader pasted, never for one out of the package
 * @property {typeof fetch} [fetch] for tests; the real one by default
 */

/**
 * @typedef {{ ok: true, value: ArrayBuffer, host: string } | { ok: false, problem: DictDownloadProblem, detail?: string }} DictDownloadResult
 */

/**
 * The largest download this will accept, compressed. A bound on memory, not a
 * judgement on dictionaries: the archive is held whole while it is taken
 * apart, and this is what the settings page can hold on a phone with room for
 * the unpacking behind it. WikDict's biggest archive is a few megabytes; the
 * monolingual English one a reader pastes a link to (reader.dict, 2026) is
 * sixty-three, and rebuilt twice a month.
 */
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/**
 * @param {string} url
 * @returns {string} the last path segment, which is what a reader recognises
 */
function fileName(url) {
  return url.split("?")[0]?.split("/").pop() || url;
}

/**
 * @param {string} url
 * @returns {string} the host part, or the whole string when it does not parse
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * @param {string} url
 * @param {DictDownloadOptions} [options]
 * @returns {Promise<DictDownloadResult>}
 */
export async function downloadArchive(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const { onProgress, signal } = options;

  if (signal?.aborted) return { ok: false, problem: "cancelled" };

  /** @type {Response} */
  let response;
  try {
    // `no-store` for the same reason models use it: these bytes are judged by
    // content, so a stale copy in the HTTP cache could only confuse a retry.
    // `omit` for the models' reason too: nothing of the reader's rides along,
    // and the call says so (D171).
    response = await fetchImpl(url, { signal, cache: "no-store", credentials: "omit", redirect: "follow" });
  } catch (error) {
    if (signal?.aborted) return { ok: false, problem: "cancelled" };
    return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
  }

  // Answered by the host it was asked of, or not at all (D171) - for an
  // address out of the package. An address the reader pasted is theirs to
  // follow wherever its host sends it, the way the browser's own download
  // would go; where it ended up is handed back (`host`) to be said.
  if (!options.anyHost && !answeredByHost(response, url)) {
    return { ok: false, problem: "http", detail: `${fileName(url)}: answered from another host` };
  }
  const host = hostOf(typeof response.url === "string" && response.url !== "" ? response.url : url);

  if (!response.ok) {
    return { ok: false, problem: "http", detail: `${response.status} ${response.statusText} for ${fileName(url)}`.trim() };
  }

  const claimed = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  const total = Number.isSafeInteger(claimed) && claimed > 0 ? claimed : 0;
  if (total > MAX_ARCHIVE_BYTES) {
    return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${total} bytes` };
  }

  const body = response.body;
  if (body === null) {
    // No stream to meter - an old shim or a test double. The size cap still
    // holds; only the progress is coarser.
    const whole = await response.arrayBuffer();
    if (whole.byteLength > MAX_ARCHIVE_BYTES) {
      return { ok: false, problem: "too_big", detail: `${fileName(url)}: ${whole.byteLength} bytes` };
    }
    onProgress?.({ received: whole.byteLength, total });
    return { ok: true, value: whole, host };
  }

  const reader = body.getReader();
  // One buffer, sized by the header when there is one and grown when there is
  // none: each chunk is written straight into it, so the archive is never in
  // memory twice. Joining a list of chunks at the end costs a second copy of
  // the whole for a moment, and at this cap that moment is a quarter of a
  // gigabyte on a phone.
  let all = new Uint8Array(total > 0 ? total : 1 << 20);
  let received = 0;

  for (;;) {
    /** @type {{ done: boolean, value?: Uint8Array }} */
    let step;
    try {
      step = await reader.read();
    } catch (error) {
      if (signal?.aborted) return { ok: false, problem: "cancelled" };
      return { ok: false, problem: "network", detail: `${fileName(url)}: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (step.done) break;
    const chunk = step.value ?? new Uint8Array(0);

    // The cap is enforced on what actually arrives, not on the header - a
    // header is a claim, and the claim is not what fills memory.
    if (received + chunk.byteLength > MAX_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, problem: "too_big", detail: `${fileName(url)}: over ${MAX_ARCHIVE_BYTES} bytes` };
    }
    if (received + chunk.byteLength > all.byteLength) {
      const grown = new Uint8Array(Math.min(MAX_ARCHIVE_BYTES, Math.max(all.byteLength * 2, received + chunk.byteLength)));
      grown.set(all.subarray(0, received));
      all = grown;
    }
    all.set(chunk, received);
    received += chunk.byteLength;
    // A total the server claimed is raised rather than overrun when it turns
    // out to be short; no claim at all stays zero, and the bar stays endless.
    onProgress?.({ received, total: total === 0 ? 0 : Math.max(total, received) });

    // Checked as well as passed to `fetch`: a body already buffered keeps
    // arriving after an abort, and cancel is supposed to mean now.
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, problem: "cancelled" };
    }
  }

  // Exact when the header was right, which is the usual case; a body shorter
  // than announced, or one with no announcement, is cut to what arrived.
  return { ok: true, value: received === all.byteLength ? all.buffer : all.buffer.slice(0, received), host };
}

/**
 * @param {DictDownloadProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever pressed Download
 */
export function describeDictDownloadProblem(problem, detail) {
  switch (problem) {
    case "network":
      return t("dict_download_network", aside(detail));
    case "http":
      return t("dict_download_http", aside(detail));
    case "too_big":
      return t("dict_download_too_big", aside(detail));
    case "cancelled":
      return t("download_cancelled");
    default:
      return t("download_failed");
  }
}
