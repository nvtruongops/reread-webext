/**
 * Where the vocabulary lives: the one thing in this extension that cannot be
 * downloaded again.
 *
 * Its own database, separate from `reread-models` (D13). Models are replaceable
 * bytes; phrases are the reader's own work, so clearing every model must never
 * be a way to lose one, and neither schema constrains the other's upgrades.
 *
 * One store, and the shape of a row is in `phrase.js`. The uniqueness the brief
 * asks for - one row per (language pair, normalized phrase) - is a unique index
 * rather than the primary key, so that a future change to `normalize()` rebuilds
 * an index instead of rewriting the identity of every row (D20).
 *
 * Only the background writes this. Content scripts read a derived copy from
 * `storage.local` (`mirror.js`) and ask the background to write; the
 * saved-phrases page - an extension page, so the same origin as this
 * database - reads it directly and writes through the background like
 * everything else, because a write is two steps (the row, then the mirror)
 * and `background/vocabulary.js` is where that rule is enforced.
 */

import { counted, countsOf, hasSentence, resaved, restored, withImportedSentence, withSentence } from "./phrase.js";

const DB_NAME = "reread-vocab";
const DB_VERSION = 1;
const PHRASES = "phrases";

/** `(langFrom, langTo, normalized)` - the key from the brief, unique. */
const BY_KEY = "by_key";
/** Everything saved for one language pair: the mirror, and the export. */
const BY_PAIR = "by_pair";

/**
 * @typedef {import("./phrase.js").Phrase} Phrase
 * @typedef {{ langFrom: string, langTo: string }} Pair
 * @typedef {{ langFrom: string, langTo: string, normalized: string }} PhraseKey
 */

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(PHRASES)) return;
      const phrases = db.createObjectStore(PHRASES, { keyPath: "id" });
      phrases.createIndex(BY_KEY, ["langFrom", "langTo", "normalized"], { unique: true });
      phrases.createIndex(BY_PAIR, ["langFrom", "langTo"], { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the vocabulary database"));
    // A page holding an older version open would block the upgrade forever, and
    // waiting in silence is worse than saying so.
    request.onblocked = () => reject(new Error("The vocabulary database is in use by another page"));
  });
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withPhrases(mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction([PHRASES], mode);
    const result = await work(transaction.objectStore(PHRASES));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Vocabulary transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Vocabulary transaction aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

/**
 * @param {PhraseKey} key
 * @returns {[string, string, string]}
 */
function indexKey({ langFrom, langTo, normalized }) {
  return [langFrom, langTo, normalized];
}

/**
 * Saves a phrase, replacing the meanings of one already saved under the same
 * key. Lookup and write happen in one transaction: two tabs saving the same
 * word at the same moment must not end up as two rows, and the unique index
 * would reject the second one anyway.
 *
 * @param {Phrase} phrase
 * @returns {Promise<void>}
 */
export async function putPhrase(phrase) {
  await withPhrases("readwrite", async (store) => {
    const existing = /** @type {Phrase | undefined} */ (
      await promisify(store.index(BY_KEY).get(indexKey(phrase)))
    );
    await promisify(store.put(existing === undefined ? phrase : resaved(existing, phrase)));
  });
}

/**
 * Writes the phrases that are not already saved, and counts both outcomes -
 * and, since D212, gives a saved row the file's sentence when the row has
 * none of its own.
 *
 * One transaction for the whole batch, each lookup paired with its write, for
 * the same reason `putPhrase` pairs them: an import must not race a bubble's
 * save into a duplicate row, and the unique index would throw where this
 * counts. A file's own duplicate meets the row its first copy just wrote and
 * is skipped like anything else already there - the first spelling wins.
 *
 * Unlike `putPhrase` this never rewrites what an existing row says: an
 * import is somebody's past, a save is this reader's decision, and the
 * second must not be overwritten by the first. The one thing an import may
 * add to a saved row is a sentence where there was none
 * (`withImportedSentence`) - the first sentence stays, as it does on a
 * bubble's re-save (D210).
 *
 * @param {Phrase[]} phrases
 * @returns {Promise<{ added: number, skipped: number, sentenced: number }>}
 *   `sentenced` counts the saved rows that took a sentence from the file
 */
export async function putMissingPhrases(phrases) {
  return await withPhrases("readwrite", async (store) => {
    const index = store.index(BY_KEY);
    let added = 0;
    let skipped = 0;
    let sentenced = 0;
    for (const phrase of phrases) {
      const existing = /** @type {Phrase | undefined} */ (await promisify(index.get(indexKey(phrase))));
      if (existing === undefined) {
        await promisify(store.put(phrase));
        added += 1;
        continue;
      }
      skipped += 1;
      const filled = withImportedSentence(existing, phrase);
      if (filled !== existing) {
        await promisify(store.put(filled));
        sentenced += 1;
      }
    }
    return { added, skipped, sentenced };
  });
}

/**
 * Writes the rows of the backup of everything (D213): a phrase not yet
 * saved is added as the file has it - its day, its sentence, its counts -
 * and a saved one takes only what it lacks (`restored`): the sentence
 * where there was none, the greater of each count. Its meanings are never
 * rewritten, and the same file twice writes nothing the second time. One
 * transaction, each lookup paired with its write, the import's own reason.
 *
 * @param {Phrase[]} phrases every pair at once - the row carries its own
 * @returns {Promise<{ added: number, skipped: number, sentenced: number, counted: number }>}
 *   `sentenced` and `counted` count the saved rows that took a sentence,
 *   and those whose counts rose
 */
export async function restorePhrases(phrases) {
  return await withPhrases("readwrite", async (store) => {
    const index = store.index(BY_KEY);
    let added = 0;
    let skipped = 0;
    let sentenced = 0;
    let risen = 0;
    for (const phrase of phrases) {
      const existing = /** @type {Phrase | undefined} */ (await promisify(index.get(indexKey(phrase))));
      if (existing === undefined) {
        await promisify(store.put(phrase));
        added += 1;
        continue;
      }
      skipped += 1;
      const merged = restored(existing, phrase);
      if (merged === existing) continue;
      await promisify(store.put(merged));
      if (hasSentence(merged) !== hasSentence(existing)) sentenced += 1;
      const before = countsOf(existing);
      const after = countsOf(merged);
      if (after.recalls > before.recalls || after.reads > before.reads) risen += 1;
    }
    return { added, skipped, sentenced, counted: risen };
  });
}

/**
 * Rewrites phrases that are already there, all in one transaction: the
 * one-time migration's write (D205), which must land whole or not at all -
 * a store half rewritten when the browser closed would be the state nothing
 * can reason about. Each row goes in under its own id, so it replaces the
 * row it came from; a row that is not there any more is written back as it
 * was read, which is what a copy taken a moment earlier would restore too.
 *
 * @param {Phrase[]} phrases
 * @returns {Promise<void>}
 */
export async function putPhrases(phrases) {
  await withPhrases("readwrite", async (store) => {
    for (const phrase of phrases) await promisify(store.put(phrase));
  });
}

/**
 * Adds a batch of counts (D209) to the rows of one pair, in one transaction:
 * a key that is not there any more - learned between the page's report and
 * this write - is skipped, and a row the batch adds nothing to is not
 * written. Only the count fields move (`counted`); the row's identity, its
 * text and its meanings are read and put back as they were.
 *
 * @param {Pair} pair
 * @param {Map<string, import("./phrase.js").Counts>} counts by normalized key
 * @param {number} now epoch milliseconds
 * @returns {Promise<number>} how many rows were written
 */
export async function countPhrases(pair, counts, now) {
  return await withPhrases("readwrite", async (store) => {
    const index = store.index(BY_KEY);
    let written = 0;
    for (const [normalized, batch] of counts) {
      const existing = /** @type {Phrase | undefined} */ (
        await promisify(index.get(indexKey({ ...pair, normalized })))
      );
      if (existing === undefined) continue;
      const next = counted(existing, batch, now);
      if (next === existing) continue;
      await promisify(store.put(next));
      written += 1;
    }
    return written;
  });
}

/**
 * Fills the sentence a bubble opened in (D216) into the rows of one pair
 * that have none, in one transaction: a key that is not there any more -
 * learned between the page's report and this write - is skipped, and a
 * row that has its sentence is not written (`withSentence`). Only the
 * sentence moves; the row's identity, its text, its meanings and its
 * counts are read and put back as they were.
 *
 * @param {Pair} pair
 * @param {Map<string, string>} sentences by normalized key
 * @returns {Promise<number>} how many rows took a sentence
 */
export async function fillSentences(pair, sentences) {
  return await withPhrases("readwrite", async (store) => {
    const index = store.index(BY_KEY);
    let filled = 0;
    for (const [normalized, sentence] of sentences) {
      const existing = /** @type {Phrase | undefined} */ (
        await promisify(index.get(indexKey({ ...pair, normalized })))
      );
      if (existing === undefined) continue;
      const next = withSentence(existing, sentence);
      if (next === existing) continue;
      await promisify(store.put(next));
      filled += 1;
    }
    return filled;
  });
}

/**
 * @param {PhraseKey} key
 * @returns {Promise<Phrase | null>}
 */
export async function getPhrase(key) {
  const record = await withPhrases("readonly", (store) =>
    promisify(store.index(BY_KEY).get(indexKey(key))),
  );
  return record ?? null;
}

/**
 * @param {PhraseKey} key
 * @returns {Promise<boolean>} whether there was anything to forget
 */
export async function deletePhrase(key) {
  return await withPhrases("readwrite", async (store) => {
    const id = await promisify(store.index(BY_KEY).getKey(indexKey(key)));
    if (id === undefined) return false;
    await promisify(store.delete(id));
    return true;
  });
}

/**
 * Everything saved for one language pair, oldest first.
 *
 * Sorted here rather than by the index, which orders by its own key: what a
 * reader means by "my vocabulary" is the order they collected it in, and an
 * export that reshuffles itself between runs is an export nobody can diff.
 *
 * @param {Pair} pair
 * @returns {Promise<Phrase[]>}
 */
export async function listPhrases(pair) {
  const records = /** @type {Phrase[]} */ (
    await withPhrases("readonly", (store) =>
      promisify(store.index(BY_PAIR).getAll([pair.langFrom, pair.langTo])),
    )
  );
  return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Which pairs have anything saved, and how much. The saved-phrases page offers
 * these rather than the installed models, because vocabulary outlives its
 * model: deleting the `enpl` model must not hide the phrases saved with it.
 *
 * Distinct pairs come off the index keys (`nextunique`), so nothing here loads
 * a phrase - the counts are index counts, a handful of point queries in the
 * same transaction.
 *
 * @returns {Promise<Array<Pair & { count: number }>>}
 */
export async function listPairs() {
  return await withPhrases("readonly", async (store) => {
    const index = store.index(BY_PAIR);

    /** @type {Pair[]} */
    const pairs = [];
    await new Promise((resolve, reject) => {
      const request = index.openKeyCursor(null, "nextunique");
      request.onerror = () => reject(request.error ?? new Error("Cannot list the saved language pairs"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor === null) {
          resolve(undefined);
          return;
        }
        const [langFrom, langTo] = /** @type {[string, string]} */ (cursor.key);
        pairs.push({ langFrom, langTo });
        cursor.continue();
      };
    });

    const counts = await Promise.all(
      pairs.map((pair) => promisify(index.count([pair.langFrom, pair.langTo]))),
    );
    return pairs.map((pair, at) => ({ ...pair, count: counts[at] ?? 0 }));
  });
}

/**
 * Everything saved, every pair, oldest first - what the copy that outlives
 * the database is made of (`backup.js`). One `getAll` rather than a walk
 * over the pairs, because the copy wants the rows exactly as they are stored.
 *
 * @returns {Promise<Phrase[]>}
 */
export async function allPhrases() {
  const records = /** @type {Phrase[]} */ (
    await withPhrases("readonly", (store) => promisify(store.getAll()))
  );
  return records.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Whether anything at all is saved - the one question a restore asks, and
 * the cheapest the store can answer: a count, no row loaded.
 *
 * @returns {Promise<boolean>}
 */
export async function hasPhrases() {
  return (await withPhrases("readonly", (store) => promisify(store.count()))) > 0;
}
