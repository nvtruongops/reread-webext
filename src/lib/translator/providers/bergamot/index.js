/**
 * The provider that puts the engine behind the translator facade.
 *
 * Everything expensive lives on the other side of a worker: this file only
 * knows how to ask it something, how to stand its engine up and give it a
 * model it does not have yet, and how to turn its failures into codes the
 * bubble can say out loud.
 */

import { webext } from "../../../browser.js";
import { getModelFiles, getModelMeta } from "../../../models/store.js";
import { ErrorCode, fail, ok } from "../../../protocol.js";
import { readEngineBinary } from "./binary.js";

const WORKER_PATH = "background/engine.worker.js";

/**
 * @typedef {object} Link
 * @property {Worker} worker
 * @property {Map<number, { resolve: (value: any) => void, reject: (error: Error) => void }>} pending
 * @property {Promise<unknown>} started settles once the worker's engine stands:
 *   the binary read on this side, handed over and instantiated over there.
 *   Rejects when any of that failed, or when the worker was dropped meanwhile.
 */

/** @type {Link | null} */
let link = null;

let serial = 0;

/**
 * Calls are run one after another. Translating is synchronous inside the
 * worker, so there is nothing to win by overlapping - and quite a lot to lose,
 * because two requests for the same missing model would both load it.
 */
let queue = Promise.resolve();

/**
 * Drops the worker. The next call builds a new one, which is also how this
 * recovers from a background page that was suspended mid-sentence.
 *
 * @param {Error} reason
 */
function reset(reason) {
  const dying = link;
  link = null;
  // A new worker starts empty, so what the old one held is no longer true.
  loadedStamp.clear();
  if (dying === null) return;
  for (const { reject } of dying.pending.values()) reject(reason);
  dying.pending.clear();
  dying.worker.terminate();
}

/**
 * @returns {Link}
 */
function connect() {
  if (link !== null) return link;

  const worker = new Worker(webext().runtime.getURL(WORKER_PATH));
  /** @type {Link} */
  const fresh = {
    worker,
    pending: new Map(),
    // Filled in below, once `fresh` exists for `send` to address.
    started: Promise.resolve(),
  };

  worker.addEventListener("message", (event) => {
    const { id, result, error } = event.data ?? {};
    const waiting = fresh.pending.get(id);
    if (waiting === undefined) return;
    fresh.pending.delete(id);
    if (error) waiting.reject(new Error(error.message ?? "engine failed"));
    else waiting.resolve(result);
  });

  worker.addEventListener("error", (event) => {
    reset(new Error(`translation engine failed to start: ${event.message ?? "unknown error"}`));
  });

  link = fresh;

  // The engine's binary is read here, on the page, and handed over as the
  // worker's first message - never fetched by the worker itself, whose
  // `fetch()` Firefox refuses while the network link is down (D196; the
  // reason in full in `binary.js`). Started with the worker, so that the read
  // overlaps the model coming out of the database; awaited by `ensureModel`
  // before the first load. Observed here as well, so that a read failing
  // before anybody awaits it is not an unhandled rejection - the caller that
  // awaits it still gets the error.
  fresh.started = readEngineBinary().then((binary) => send(fresh, "start", [binary], [binary]));
  fresh.started.catch(() => {});
  return fresh;
}

/**
 * @param {Link} target the worker to ask
 * @param {string} name
 * @param {unknown[]} args
 * @param {Transferable[]} [transfer]
 * @returns {Promise<any>}
 */
function send(target, name, args, transfer = []) {
  // A worker dropped by `reset` is not asked anything more - and not revived
  // by a late arrival, which is what routing through `connect()` would do
  // with the binary of a worker that died while it was being read.
  if (target !== link) return Promise.reject(new Error("the engine worker was dropped"));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    target.pending.set(id, { resolve, reject });
    target.worker.postMessage({ id, name, args }, transfer);
  });
}

/**
 * @param {string} name
 * @param {unknown[]} args
 * @param {Transferable[]} [transfer]
 * @returns {Promise<any>}
 */
function call(name, args, transfer = []) {
  return send(connect(), name, args, transfer);
}

/**
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
function serialized(work) {
  // Runs whether or not the previous call succeeded; a failure is that call's
  // problem, not the next caller's.
  const result = queue.then(work, work);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Which model, by `addedAt`, this worker was given for a pair. Without it,
 * replacing a model in the settings page would change nothing until the
 * background happened to be suspended - the worker would keep translating with
 * the copy it already had.
 *
 * @type {Map<string, number>}
 */
const loadedStamp = new Map();

/**
 * @param {string} from
 * @param {string} to
 * @returns {Promise<boolean>} false when there is no such model on this device
 */
async function ensureModel(from, to) {
  const pair = `${from}${to}`;

  // Metadata first, always: it is kilobytes, and it answers both "is there one"
  // and "is it still the one we loaded" without touching the payload.
  const meta = await getModelMeta(pair);
  if (meta === null) return false;

  // From here on a worker is needed, and spawning it now rather than at the
  // first call lets the engine's binary come in while the model comes out
  // of the database.
  connect();

  if (loadedStamp.get(pair) === meta.addedAt && (await call("loaded", [{ from, to }]))) {
    return true;
  }

  const stored = await getModelFiles(pair);
  if (stored === null) return false;

  if (loadedStamp.has(pair)) await call("unload", [{ from, to }]);

  // The engine has to be standing before a model goes into it: the binary
  // handed over and instantiated (`connect`). A start that failed surfaces
  // here, and `translate` drops the worker like any other failure.
  await connect().started;

  // Transferred rather than copied: these buffers are tens of megabytes, they
  // came straight out of the database, and nothing here needs them afterwards.
  // Deduplicated because the same vocabulary buffer is usually listed twice and
  // transferring one buffer twice throws.
  const buffers = [stored.model, stored.shortlist, ...stored.vocabs];
  const transfer = buffers.filter((buffer, index) => buffers.indexOf(buffer) === index);

  await call(
    "load",
    [
      { from, to },
      {
        model: stored.model,
        shortlist: stored.shortlist,
        vocabs: stored.vocabs,
        config: stored.config ?? {},
      },
    ],
    transfer,
  );
  loadedStamp.set(pair, meta.addedAt);
  return true;
}

/** @type {import("../../index.js").Provider} */
export const bergamot = {
  id: "bergamot",

  translate({ text, context, from, to }) {
    return serialized(async () => {
      try {
        if (!(await ensureModel(from, to))) return fail(ErrorCode.MODEL_MISSING);

        // One batch, not two calls: the engine decides a batch together, and a
        // sentence next to the phrase is both the second line of the bubble and
        // the long row that keeps the phrase from coming back cut short - the
        // job `padding.js` otherwise has to do with a sentence nobody wrote.
        const texts = context === undefined ? [text] : [text, context];
        const translated = await call("translate", [{ from, to }, texts]);
        const rows = Array.isArray(translated) ? translated : [];

        return ok({
          gloss: rows[0] ?? "",
          sentence: context === undefined ? null : (rows[1] ?? null),
        });
      } catch (error) {
        // A worker that failed once tends to keep failing. Dropping it costs a
        // few seconds of reloading and beats an extension that stays broken
        // until the browser restarts.
        reset(error instanceof Error ? error : new Error(String(error)));
        return fail(ErrorCode.INTERNAL);
      }
    });
  },
};
