/**
 * The worker the translation engine runs in.
 *
 * It exists because translating blocks: Marian compiled to WebAssembly does its
 * work synchronously, and doing that on the thread that answers messages would
 * freeze the extension for the length of a sentence. Everything here is
 * message-in, message-out, and nothing in this file knows what a browser
 * extension is - it is handed the engine's binary and model bytes, and hands
 * back strings. The binary comes in the first message (`start`) rather than
 * being fetched here, where it is needed: a worker's `fetch()` in Firefox is
 * refused while the network link is down, package or not (D196; the reason
 * in full at `readEngineBinary`). Only the glue is loaded from here, by
 * `importScripts` - a script load, which that refusal never touches.
 *
 * Its own message shape, deliberately not the one in `protocol.js`: that one is
 * a contract with content scripts, this one is an implementation detail between
 * two threads that ship together.
 */

import { modelConfigYaml } from "../lib/translator/providers/bergamot/config.js";
import { companionFor } from "../lib/translator/providers/bergamot/padding.js";

/**
 * The engine imports its matrix multiplication rather than containing it, and
 * separately exports a plain implementation of exactly those seven functions.
 * Wiring one to the other is what makes the binary self-contained.
 *
 * Firefox has a faster native version behind `WebAssembly.mozIntGemm`, but it
 * is not reachable from an extension, so there is nothing to fall back from.
 * Verified against the binary: these are its `wasm_gemm` imports, and these are
 * its exports.
 */
const GEMM_FALLBACKS = Object.freeze({
  int8_prepare_a: "int8PrepareAFallback",
  int8_prepare_b: "int8PrepareBFallback",
  int8_prepare_b_from_transposed: "int8PrepareBFromTransposedFallback",
  int8_prepare_b_from_quantized_transposed: "int8PrepareBFromQuantizedTransposedFallback",
  int8_prepare_bias: "int8PrepareBiasFallback",
  int8_multiply_and_add_bias: "int8MultiplyAndAddBiasFallback",
  int8_select_columns_of_b: "int8SelectColumnsOfBFallback",
});

const ENGINE_GLUE = "../vendor/bergamot/bergamot-translator-worker.js";

/**
 * The engine coming up, from the moment the binary arrives. Null until then:
 * a model load or a translation asked before `start` is a caller's mistake,
 * and it is answered with a sentence, never with a fetch of our own.
 *
 * @type {Promise<BergamotModule> | null}
 */
let starting = null;

/** @type {BergamotBlockingService | null} */
let service = null;

/** @type {Map<string, BergamotTranslationModel>} */
const models = new Map();

/**
 * @param {string} relative
 * @returns {string}
 */
function assetUrl(relative) {
  return new URL(relative, globalThis.location.href).href;
}

/**
 * @returns {WebAssembly.ModuleImports}
 */
function gemmImports() {
  return Object.fromEntries(
    Object.entries(GEMM_FALLBACKS).map(([imported, exported]) => [
      imported,
      // Late-bound on purpose: `Module.asm` does not exist yet at the moment
      // these are handed to `WebAssembly.instantiate`.
      /** @param {number[]} args */ (...args) => Module.asm[exported]?.(...args),
    ]),
  );
}

/**
 * @param {ArrayBuffer} binary the engine's wasm, handed over by the page
 * @returns {Promise<BergamotModule>}
 */
function startEngine(binary) {
  return new Promise((resolve, reject) => {
    /** @type {Partial<BergamotModule>} */
    const bootstrap = {
      instantiateWasm(imports, accept) {
        WebAssembly.instantiate(binary, { ...imports, wasm_gemm: gemmImports() })
          .then((result) => accept(result.instance))
          .catch(reject);
        return {};
      },
      onRuntimeInitialized() {
        resolve(Module);
      },
      print: (message) => console.log("[bergamot]", message),
      printErr: (message) => console.warn("[bergamot]", message),
    };

    // The glue starts with `var Module = typeof Module != "undefined" ? Module : {}`,
    // so it picks this up - but only from the global scope, which the bundle we
    // live in is not.
    globalThis.Module = /** @type {BergamotModule} */ (bootstrap);
    try {
      importScripts(assetUrl(ENGINE_GLUE));
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @returns {Promise<BergamotModule>}
 */
function engine() {
  return starting ?? Promise.reject(new Error("the engine binary was never handed to the worker"));
}

/**
 * The first message: the engine's binary, once. A second `start` changes
 * nothing - the engine that came up stays up - and a start that failed stays
 * failed: the page drops a worker whose engine did not come up and builds a
 * new one, which is where a retry belongs. Answered only once the engine
 * stands, so that the page learns of a binary the engine refused from this
 * call, not from the model load after it.
 *
 * @param {unknown} binary
 * @returns {Promise<boolean>} true once the engine is up
 */
async function startWith(binary) {
  if (!(binary instanceof ArrayBuffer)) throw new Error("the engine binary must be an ArrayBuffer");
  starting ??= startEngine(binary);
  await starting;
  return true;
}

/**
 * Copies a buffer into memory the engine can use. Marian needs its inputs
 * aligned, and the buffers we get came from a file or a download.
 *
 * @param {BergamotModule} module
 * @param {ArrayBuffer} buffer
 * @param {number} alignment
 * @returns {BergamotAlignedMemory}
 */
function alignedCopy(module, buffer, alignment) {
  const bytes = new Int8Array(buffer);
  const memory = new module.AlignedMemory(bytes.byteLength, alignment);
  memory.getByteArrayView().set(bytes);
  return memory;
}

/**
 * @param {{ from: string, to: string }} pair
 * @returns {string}
 */
function keyOf({ from, to }) {
  return `${from}${to}`;
}

/**
 * @param {{ from: string, to: string }} pair
 * @param {{ model: ArrayBuffer, shortlist: ArrayBuffer, vocabs: ArrayBuffer[], config?: Record<string, string | number | boolean> }} files
 * @returns {Promise<boolean>}
 */
async function loadModel(pair, files) {
  const key = keyOf(pair);
  if (models.has(key)) return true;

  const module = await engine();
  const vocabs = new module.AlignedMemoryList();
  // The same file is usually both source and target vocabulary, and handing the
  // same buffer in twice upsets the bindings on the C++ side.
  const unique = files.vocabs.filter((vocab, index) => files.vocabs.indexOf(vocab) === index);
  for (const vocab of unique) vocabs.push_back(alignedCopy(module, vocab, 64));

  models.set(
    key,
    new module.TranslationModel(
      modelConfigYaml(files.config ?? {}),
      alignedCopy(module, files.model, 256),
      alignedCopy(module, files.shortlist, 64),
      vocabs,
      null,
    ),
  );
  return true;
}

/**
 * @param {{ from: string, to: string }} pair
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
async function translate(pair, texts) {
  const key = keyOf(pair);
  const model = models.get(key);
  if (model === undefined) throw new Error(`no model loaded for ${key}`);

  const module = await engine();
  // Marian's own translation cache. Left off: this extension caches at a level
  // where it can see whole phrases, and an unverified size here would be a
  // number nobody could justify.
  service ??= new module.BlockingService({ cacheSize: 0 });

  // Appended last, so what the caller asked for keeps its indices. The engine
  // translates it, we drop it, and the phrase in front of it comes back whole -
  // see `padding.js` for what a batch of one short row does otherwise.
  const companion = companionFor(pair.from, texts);
  const batch = companion === null ? texts : [...texts, companion];

  const input = new module.VectorString();
  const options = new module.VectorResponseOptions();
  for (const text of batch) {
    input.push_back(text);
    // No HTML and no alignment: the bubble shows plain text, and the reader
    // mode that will want HTML is a later milestone. Alignment is not a choice
    // here anyway - this build exposes no way to read one back.
    options.push_back({ alignment: false, html: false, qualityScores: false });
  }

  const responses = service.translate(model, input, options);
  const translated = texts.map((_, index) => responses.get(index).getTranslatedText());

  input.delete();
  options.delete();
  responses.delete();

  return translated;
}

/**
 * @param {{ from: string, to: string }} pair
 * @returns {Promise<boolean>}
 */
async function unloadModel(pair) {
  const key = keyOf(pair);
  const model = models.get(key);
  if (model === undefined) return false;
  models.delete(key);
  model.delete();
  return true;
}

globalThis.addEventListener("message", (event) => {
  const message = /** @type {MessageEvent} */ (event).data;
  if (typeof message !== "object" || message === null) return;

  const { id, name, args } = /** @type {{ id?: unknown, name?: unknown, args?: unknown }} */ (message);
  if (typeof id !== "number" || typeof name !== "string" || !Array.isArray(args)) return;

  const call = async () => {
    switch (name) {
      case "start":
        return startWith(args[0]);
      case "load":
        return loadModel(args[0], args[1]);
      case "translate":
        return translate(args[0], args[1]);
      case "unload":
        return unloadModel(args[0]);
      case "loaded":
        return models.has(keyOf(args[0]));
      default:
        throw new Error(`unknown call: ${name}`);
    }
  };

  void call().then(
    (result) => globalThis.postMessage({ id, result }),
    // An Error does not survive a message port, and the thing the other side
    // needs is the sentence, not the class.
    (error) => globalThis.postMessage({ id, error: { message: String(error?.message ?? error) } }),
  );
});
