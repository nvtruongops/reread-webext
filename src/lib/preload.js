/**
 * Preloads bundled translation models (English <-> Vietnamese) and StarDict
 * dictionary (tudien Anh-Việt tổng hợp) on extension install/startup for a
 * zero-setup out-of-the-box experience.
 */

import { webext } from "./browser.js";
import { readConfig, writeConfig } from "./config.js";
import { openDictionary, entriesOf, aliasesOf } from "./dict/import.js";
import { rowBatches } from "./dict/rows.js";
import {
  beginImport,
  finishImport,
  deleteDictionary,
  listDictionaries,
  openWriter,
} from "./dict/store.js";
import { writeInventory } from "./models/inventory.js";
import { listModels, putModel } from "./models/store.js";

/**
 * Reads a file bundled inside the extension package.
 *
 * @param {string} path relative to extension root, e.g. "assets/models/envi/..."
 * @returns {Promise<ArrayBuffer>}
 */
async function readPackageFile(path) {
  const url = webext().runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return await response.arrayBuffer();
}

/**
 * Unpacks gzipped bytes using standard browser DecompressionStream.
 *
 * @param {ArrayBuffer} buffer
 * @returns {Promise<ArrayBuffer>}
 */
async function gunzipBuffer(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  const response = new Response(stream);
  return await response.arrayBuffer();
}

/**
 * Sets the default pair to en -> vi if none has been selected yet.
 */
export async function preloadConfig() {
  const config = await readConfig();
  if (config.sourceLang === null || config.targetLang === null) {
    await writeConfig({ sourceLang: "en", targetLang: "vi" });
  }
}

/**
 * Pre-installs envi and vien translation models from package assets into IndexedDB.
 */
export async function preloadModels() {
  const installed = await listModels();
  const installedPairs = new Set(installed.map((m) => m.pair));

  if (!installedPairs.has("envi")) {
    try {
      const [modelGz, shortlistGz, vocabGz] = await Promise.all([
        readPackageFile("assets/models/envi/model.envi.intgemm.alphas.bin.gz"),
        readPackageFile("assets/models/envi/lex.50.50.envi.s2t.bin.gz"),
        readPackageFile("assets/models/envi/vocab.envi.spm.gz"),
      ]);
      const [model, shortlist, vocab] = await Promise.all([
        gunzipBuffer(modelGz),
        gunzipBuffer(shortlistGz),
        gunzipBuffer(vocabGz),
      ]);
      await putModel(
        {
          pair: "envi",
          model,
          shortlist,
          vocabs: [vocab],
        },
        {
          from: "en",
          to: "vi",
          sourceUrl: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-vi/exported/model.envi.intgemm.alphas.bin.gz",
        },
      );
    } catch (error) {
      console.warn("Preloading envi model failed:", error);
    }
  }

  if (!installedPairs.has("vien")) {
    try {
      const [modelGz, shortlistGz, vocabGz] = await Promise.all([
        readPackageFile("assets/models/vien/model.vien.intgemm.alphas.bin.gz"),
        readPackageFile("assets/models/vien/lex.50.50.vien.s2t.bin.gz"),
        readPackageFile("assets/models/vien/vocab.vien.spm.gz"),
      ]);
      const [model, shortlist, vocab] = await Promise.all([
        gunzipBuffer(modelGz),
        gunzipBuffer(shortlistGz),
        gunzipBuffer(vocabGz),
      ]);
      await putModel(
        {
          pair: "vien",
          model,
          shortlist,
          vocabs: [vocab],
        },
        {
          from: "vi",
          to: "en",
          sourceUrl: "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/vi-en/exported/model.vien.intgemm.alphas.bin.gz",
        },
      );
    } catch (error) {
      console.warn("Preloading vien model failed:", error);
    }
  }

  await writeInventory(await listModels()).catch(() => undefined);
}

/**
 * Pre-installs the bundled StarDict English - Vietnamese dictionary into IndexedDB.
 */
export async function preloadDictionary() {
  const dicts = await listDictionaries();
  const hasEnVi = dicts.some((d) => d.ready && d.langFrom === "en" && d.langTo === "vi");
  if (hasEnVi) return;

  const baseName = "EN - VI";
  const credit = "redphx/tudien (235k từ)";

  try {
    // 1. Fast path: prebuilt JSON rows (2.5s vs 50s, safe from SW 30s termination watchdog)
    let prebuiltGz = null;
    try {
      prebuiltGz = await readPackageFile("assets/dictionaries/tudien-stardict-en-vi.prebuilt.json.gz");
    } catch {
      prebuiltGz = null;
    }

    if (prebuiltGz !== null) {
      const jsonBuf = await gunzipBuffer(prebuiltGz);
      const text = new TextDecoder().decode(jsonBuf);
      /** @type {{ summary?: import("./dict/rows.js").RowSummary, rows: [string, string, string[]][] }} */
      const data = JSON.parse(text);

      const dictRecord = await beginImport({
        name: baseName,
        langFrom: "en",
        langTo: "vi",
        credit,
      });

      const writer = await openWriter(dictRecord.id);
      const BATCH_SIZE = 10000;
      let at = 0;
      try {
        while (at < data.rows.length) {
          const chunk = data.rows.slice(at, at + BATCH_SIZE);
          const rows = chunk.map(([key, headword, senses]) => ({
            dictId: dictRecord.id,
            key,
            headword,
            senses,
          }));
          at += chunk.length;
          const mark = {
            name: baseName,
            credit,
            progress: {
              phase: /** @type {const} */ ("entries"),
              next: at,
              skipped: [],
              done: at,
              entryCount: at,
              aliasCount: 0,
              bytes: 0,
              total: data.rows.length,
              appended: 0,
            },
          };
          await writer.put(rows, [], mark);
        }

        await finishImport(dictRecord.id, {
          entryCount: data.summary?.entryCount ?? data.rows.length,
          aliasCount: data.summary?.aliasCount ?? 0,
          bytes: data.summary?.bytes ?? 0,
        });
      } finally {
        writer.close();
      }
      return;
    }

    // 2. Fallback path: parse raw StarDict files if prebuilt is absent
    const [ifo, idx, dict] = await Promise.all([
      readPackageFile("assets/dictionaries/tudien-stardict-en-vi-20260411.ifo"),
      readPackageFile("assets/dictionaries/tudien-stardict-en-vi-20260411.idx"),
      readPackageFile("assets/dictionaries/tudien-stardict-en-vi-20260411.dict.dz"),
    ]);

    const opened = await openDictionary({ ifo, idx, dict }, { fallbackName: baseName });
    if (!opened.ok) {
      console.warn("Failed to open preloaded dictionary:", opened.problem);
      return;
    }

    const dictRecord = await beginImport({
      name: baseName,
      langFrom: "en",
      langTo: "vi",
      credit,
    });

    const total = opened.value.words + opened.value.synonyms;
    const batches = rowBatches(
      dictRecord.id,
      {
        entries: entriesOf(opened.value),
        aliases: aliasesOf(opened.value),
      },
      {},
    );

    const writer = await openWriter(dictRecord.id);
    let appended = 0;
    try {
      let step = batches.next();
      while (!step.done) {
        const batch = step.value;
        const writing = writer.put(batch.rows, batch.additions, {
          name: baseName,
          credit,
          progress: { ...batch.progress, total, appended },
        });
        step = batches.next();
        appended += await writing;
      }

      const summary = step.value;
      if (summary.entryCount > 0) {
        await finishImport(dictRecord.id, {
          entryCount: summary.entryCount,
          aliasCount: summary.aliasCount,
          bytes: summary.bytes + appended,
        });
      } else {
        await deleteDictionary(dictRecord.id);
      }
    } finally {
      writer.close();
    }
  } catch (error) {
    console.warn("Preloading dictionary failed:", error);
  }
}

/** @type {Promise<void> | null} */
let preloadingPromise = null;

/**
 * Ensures that config, models, and dictionary are initialized.
 * Safe to call multiple times concurrently; only runs once.
 *
 * @returns {Promise<void>}
 */
export function ensurePreloaded() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve();
  }
  if (preloadingPromise !== null) return preloadingPromise;

  preloadingPromise = (async () => {
    await preloadConfig();
    await preloadModels();
    await preloadDictionary();
  })();

  return preloadingPromise;
}
