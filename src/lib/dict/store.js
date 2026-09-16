/**
 * Where imported dictionaries live.
 *
 * Its own database, separate from both the models and the vocabulary, for the
 * reason D13 gave: a dictionary can be imported again from the file it came
 * from, a saved phrase cannot be recovered from anywhere. Deleting a dictionary
 * that turned out to be the wrong one must never be a way to lose vocabulary,
 * and an upgrade to one schema must never wait on the other.
 *
 * Two stores, and the split is the same one the models make: `meta` answers
 * "which dictionaries are here" in a few rows, `entries` holds the hundreds of
 * thousands. Nothing ever reads all of `entries`; it is only ever asked about
 * one word.
 *
 * The primary key of `entries` is `[dictId, key]` and there is no index at all.
 * A lookup knows which dictionaries are installed, so it can ask each of them
 * for a word directly - a handful of point reads. An index on the key would be
 * a second copy of every key in the database, bought for nothing.
 *
 * Written by the settings page, read by the background (D14: both are extension
 * pages of the same origin, and a hundred megabytes has no business going
 * through a message port).
 */

import { cleanDisplayName, shownName } from "./display-name.js";
import { formsIn, formsStamp } from "./forms.js";
import { answerOrder, inChosenOrder, nextRank } from "./order.js";
import { mergeSenses, utf8Length } from "./rows.js";
import { TEXT_REVISION, catchUp } from "./text.js";

const DB_NAME = "reread-dicts";

/**
 * Version 2 gave every dictionary a `rank`: the place it answers from, which
 * until then was the order of import and could only be changed by importing
 * again (see `order.js`).
 *
 * Version 3 added the `sources` store, so that an import the browser was
 * killed in the middle of can go on from where it stopped: the files it was
 * reading are kept here until the last row is in, and its `meta` row says how
 * far it got (`progress`) - written in the same transaction as each batch of
 * rows, so the two can never disagree.
 */
const DB_VERSION = 3;
const META = "meta";
const ENTRIES = "entries";
const SOURCES = "sources";

/**
 * @typedef {import("./rows.js").RowProgress & { total: number, appended: number }} ImportProgress
 *   `rows.js`'s own account of where it stands, plus what the page around it
 *   knows: how many records there are in all, and how many bytes the additions
 *   merged into earlier rows added - which the rows' own count cannot see
 */

/**
 * @typedef {object} Dictionary
 * @property {string} id
 * @property {string} name what the .ifo calls it
 * @property {string} langFrom the language of the headwords, chosen at import
 * @property {string} langTo
 * @property {number} entryCount
 * @property {number} aliasCount other spellings from the .syn file
 * @property {number} bytes what the text of it costs
 * @property {number} addedAt epoch milliseconds
 * @property {number} rank where it stands among the others, 0 first
 * @property {boolean} ready false until every row is in
 * @property {string | null} credit author and source, for attribution
 * @property {string} [displayName] the name the reader gave it on the settings
 *   page (D199): what its groups stand under on the shelf in place of `name`;
 *   absent while they gave none, never empty
 * @property {ImportProgress} [progress] while unready: how far the import got,
 *   absent before its first batch landed
 * @property {number} [textRevision] the revision of `text.js`'s cleaning the
 *   rows were written under (`TEXT_REVISION`, since 0.5.56); absent on a
 *   dictionary imported before that, whose senses `shownSenses` brings up to
 *   date as they are read
 */

/**
 * The files an unfinished import is reading, kept until it is finished.
 *
 * Blobs, which IndexedDB stores as files of its own rather than as rows - a
 * fifty-megabyte archive member costs the disk, not the database.
 *
 * @typedef {object} ImportSources
 * @property {string} id the dictionary's
 * @property {Blob} ifo
 * @property {Blob} idx
 * @property {Blob} dict
 * @property {Blob} [syn]
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
 * Writes down the order the dictionaries already answered in.
 *
 * The upgrade to version 2 must not shuffle anybody's bubble: what an
 * unranked store answers in is import order, so import order is what gets
 * written. `answerOrder` says the same thing for records that carry no rank,
 * which is why it is asked rather than repeated here - and why running this
 * twice is a no-op rather than a reshuffle.
 *
 * Fired inside the versionchange transaction, so the puts are part of the
 * upgrade: either the version and the ranks both land, or neither does.
 *
 * @param {IDBObjectStore} meta
 */
function rankExisting(meta) {
  const all = meta.getAll();
  all.onsuccess = () => {
    answerOrder(/** @type {Dictionary[]} */ (all.result)).forEach((dictionary, at) => {
      if (dictionary.rank !== at) meta.put({ ...dictionary, rank: at });
    });
  };
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ENTRIES)) {
        db.createObjectStore(ENTRIES, { keyPath: ["dictId", "key"] });
      }
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: "id" });
      // Null only where there is no upgrade to do, which cannot happen here -
      // but the type says so, and a store nobody could reach is not worth a
      // thrown error inside an event handler.
      const upgrade = request.transaction;
      if (upgrade !== null) rankExisting(upgrade.objectStore(META));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open the dictionary database"));
    request.onblocked = () => reject(new Error("The dictionary database is in use by another page"));
  });
}

/**
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(transaction: IDBTransaction) => Promise<T> | T} work
 * @returns {Promise<T>}
 */
async function withStores(stores, mode, work) {
  const db = await open();
  try {
    const transaction = db.transaction(stores, mode);
    const result = await work(transaction);
    await completed(transaction);
    return result;
  } finally {
    db.close();
  }
}

/**
 * @param {IDBTransaction} transaction
 * @returns {Promise<void>} settled the way the transaction is
 */
function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error("Dictionary transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Dictionary transaction aborted"));
  });
}

/**
 * Every row of one dictionary, as a range over the primary key.
 *
 * `[id]` sorts before `[id, anything]`, and an array sorts after every string
 * in IndexedDB's key order - so an array as the second element is above every
 * key this dictionary could have and below the next dictionary's first row.
 * That is what makes deleting a dictionary one call rather than a cursor walk.
 *
 * @param {string} id
 * @returns {IDBKeyRange}
 */
function rowsOf(id) {
  return IDBKeyRange.bound([id], [id, []]);
}

/**
 * @typedef {object} DictionaryEntry
 * @property {string} dictionary the name of the book it came from - the one
 *   the reader gave it, when they did (D199), else what the .ifo calls it
 * @property {string} headword as that dictionary spells it, which is not always what was selected
 * @property {string[]} senses
 */

/**
 * What the dictionaries here have to say about a word.
 *
 * One transaction over both stores: which dictionaries are installed, then a
 * point read per dictionary per candidate form, language by language in the
 * order asked (D191). A dictionary answers at most once - the first form that
 * hits wins, so `watches` finding `watch` does not also go looking for
 * `watche` - and a language answers for all the later ones: the first whose
 * dictionaries know the word is the answer, so a Polish page's dictionary
 * never gets to second-guess an English word the pair's dictionaries knew.
 *
 * Ordering within a language is the reader's own, as the settings page
 * arranged it (`order.js`); a store nobody has arranged answers in import
 * order, as it always did.
 *
 * Answered with how many dictionaries were asked and in which language, out
 * of the same read (D164, D191): "nothing in three dictionaries" and "no
 * dictionary for this language" are different sentences for a bubble to say,
 * and which language they are about is `settle`'s to decide. Asked even with
 * no keys - a selection that is not a dictionary question still has to learn
 * which of the two silences it met.
 *
 * @param {{ lang: string, keys: string[] }[]} asks the languages in the order
 *   they are asked, each with the word and the forms worth trying instead of it
 * @returns {Promise<LookupAnswer>}
 */
export async function lookupEntries(asks) {
  return await withStores([META, ENTRIES], "readonly", async (transaction) => {
    const installed = /** @type {Dictionary[]} */ (await promisify(transaction.objectStore(META).getAll()));
    const store = transaction.objectStore(ENTRIES);
    /** @type {LookupAnswer[]} */
    const answers = [];

    for (const ask of asks) {
      // Matched on the language of the headwords alone. A dictionary explaining
      // English in English is often the better answer for somebody learning it,
      // and refusing it because the settings say "into Polish" would refuse a
      // book the reader deliberately installed.
      const dictionaries = answerOrder(
        installed.filter((dictionary) => dictionary.ready && dictionary.langFrom === ask.lang),
      );
      const entries = dictionaries.length === 0 ? [] : await readEntries(store, dictionaries, ask.keys);
      answers.push({ entries, dictionaries: dictionaries.length, lang: ask.lang });
      if (entries.length > 0) break;
    }

    return settle(answers);
  });
}

/**
 * @param {IDBObjectStore} store the entries
 * @param {Dictionary[]} dictionaries in the order they answer
 * @param {string[]} keys the word, then the forms worth trying instead of it
 * @returns {Promise<DictionaryEntry[]>}
 */
async function readEntries(store, dictionaries, keys) {
  /** @type {DictionaryEntry[]} */
  const found = [];

  for (const dictionary of dictionaries) {
    for (const key of keys) {
      const row = /** @type {import("./rows.js").DictionaryRow | undefined} */ (
        await promisify(store.get([dictionary.id, key]))
      );
      if (row === undefined) continue;

      // One hop, never two: an alias points at a word, and a word that turned
      // out to be another alias is a dictionary contradicting itself.
      const target =
        row.aliasOf === undefined
          ? row
          : /** @type {import("./rows.js").DictionaryRow | undefined} */ (
              await promisify(store.get([dictionary.id, row.aliasOf]))
            );

      if (target === undefined || target.senses.length === 0) continue;
      found.push({
        dictionary: shownName(dictionary),
        headword: target.headword,
        senses: shownSenses(dictionary, target.senses),
      });
      break;
    }
  }

  return found;
}

/**
 * What the dictionaries said about a phrase, how many of them were asked and
 * in which language.
 * @typedef {{ entries: DictionaryEntry[], dictionaries: number, lang: string }} LookupAnswer
 */

/**
 * The other forms of saved words, as every installed dictionary of the
 * language vouches for them (D208, the rules in `forms.js`) - a form any one
 * dictionary vouches for is kept.
 *
 * Asked with what is already known, because the reads are the cost: a word
 * is a dozen point reads per dictionary, and the background rebuilds the
 * mirror on every save. The forms a word was found to have stay true for as
 * long as the shelf that vouched for them stands, so they come back with a
 * stamp of that shelf (`formsStamp`), and a caller handing the stamp back
 * with the forms it kept gets only the words it did not have computed. A
 * stamp that no longer matches - a dictionary added, removed, imported
 * again, or a version with other rules - throws the kept forms away and
 * computes every word again. One transaction, so the stamp and the forms
 * describe one moment of the shelf.
 *
 * @param {string} lang the language of the words
 * @param {{ keys: string[], known: Record<string, string[]>, stamp: string }} of
 *   the words to answer for, and the forms already kept under which stamp
 * @returns {Promise<{ stamp: string, forms: Record<string, string[]> }>} every
 *   key answered, an empty list for a word with no forms
 */
export async function readForms(lang, { keys, known, stamp }) {
  return await withStores([META, ENTRIES], "readonly", async (transaction) => {
    const installed = /** @type {Dictionary[]} */ (await promisify(transaction.objectStore(META).getAll()));
    const dictionaries = installed.filter((dictionary) => dictionary.ready && dictionary.langFrom === lang);
    const current = formsStamp(lang, dictionaries);
    const reuse = current === stamp ? known : {};
    const store = transaction.objectStore(ENTRIES);

    /** @type {Record<string, string[]>} */
    const forms = {};
    for (const key of keys) {
      const kept = reuse[key];
      if (kept !== undefined) {
        forms[key] = kept;
        continue;
      }
      /** @type {string[]} */
      const union = [];
      for (const dictionary of dictionaries) {
        /** @type {import("./forms.js").RowReader} */
        const row = (one) => promisify(store.get([dictionary.id, one]));
        for (const form of await formsIn(key, row)) {
          if (!union.includes(form)) union.push(form);
        }
      }
      forms[key] = union;
    }
    return { stamp: current, forms };
  });
}

/**
 * Which language's answer the bubble gets, out of the ones asked in order
 * (D191): the first whose dictionaries knew the word; failing that, the first
 * that had dictionaries at all, so "not in your dictionaries" is said of the
 * shelf that was actually consulted; failing that, the first asked - the
 * pair's language when there is a pair - so "no dictionary for English yet"
 * names the language somebody reading with an English pair would install,
 * not the one a Polish-interface site declares for its buttons. Pure, so the
 * rule can be tested without a database.
 *
 * @param {LookupAnswer[]} answers in the order asked
 * @returns {LookupAnswer}
 */
export function settle(answers) {
  const known = answers.find((answer) => answer.entries.length > 0);
  if (known !== undefined) return known;
  const asked = answers.find((answer) => answer.dictionaries > 0);
  if (asked !== undefined) return asked;
  return { entries: [], dictionaries: 0, lang: answers[0]?.lang ?? "" };
}

/**
 * A row's senses as the reader gets them: as stored, unless the dictionary
 * was imported before the whole entity table (`TEXT_REVISION` 2, 0.5.56) -
 * then `catchUp` decodes what that import left as written, `&lsqb;` and the
 * rest, on the way out. Ten short strings per answer, so the reader is not
 * asked to import a dictionary again for it; a dictionary imported since
 * carries the revision on its record and is left exactly as stored. Pure,
 * so the rule can be tested without a database.
 *
 * @param {Dictionary} dictionary the record the row belongs to
 * @param {string[]} senses as stored
 * @returns {string[]}
 */
export function shownSenses(dictionary, senses) {
  return (dictionary.textRevision ?? 1) < TEXT_REVISION ? senses.map(catchUp) : senses;
}

/**
 * @returns {Promise<Dictionary[]>} in the order they are asked in, which is the
 *   order the settings page has to show them in
 */
export async function listDictionaries() {
  const records = /** @type {Dictionary[]} */ (
    await withStores([META], "readonly", (transaction) => promisify(transaction.objectStore(META).getAll()))
  );
  return answerOrder(records);
}

/**
 * The order somebody arranged on the settings page, written down.
 *
 * Every record is renumbered from zero rather than the moved pair being
 * swapped: two numbers swapped in a store whose ranks came from anywhere else
 * (a half-finished write, a dictionary imported by a second page) would leave
 * the gap that put them in the wrong order still there. Renumbering the whole
 * short list is one transaction and leaves nothing to reason about.
 *
 * @param {string[]} ids the installed dictionaries, in the order they should answer
 * @returns {Promise<void>}
 */
export async function reorderDictionaries(ids) {
  await withStores([META], "readwrite", async (transaction) => {
    const store = transaction.objectStore(META);
    const stored = /** @type {Dictionary[]} */ (await promisify(store.getAll()));

    const ordered = inChosenOrder(stored, ids);
    for (const [at, dictionary] of ordered.entries()) {
      if (dictionary.rank === at) continue;
      await promisify(store.put({ ...dictionary, rank: at }));
    }
  });
}

/**
 * The name a reader gave a dictionary on the settings page (D199), written
 * down - or, with `null`, taken back, so the book stands under what its file
 * calls it again.
 *
 * Cleaned here as well as on the page: the record is the one place the rule
 * has to hold, whoever writes it, and a name that cleans to nothing is no
 * name. Whether the name is free is the page's question (`nameHolder`), asked
 * over the list it shows; the store keeps no index to ask it by.
 *
 * @param {string} id
 * @param {string | null} displayName
 * @returns {Promise<void>}
 */
export async function renameDictionary(id, displayName) {
  const name = displayName === null ? null : cleanDisplayName(displayName);
  await withStores([META], "readwrite", async (transaction) => {
    const store = transaction.objectStore(META);
    const existing = /** @type {Dictionary | undefined} */ (await promisify(store.get(id)));
    if (existing === undefined) throw new Error("The dictionary was removed while it was being named");

    const { displayName: _, ...rest } = existing;
    await promisify(store.put(name === null ? rest : { ...rest, displayName: name }));
  });
}

/**
 * Claims a place for a dictionary that is about to be written.
 *
 * The row goes in first and unready, rather than last and complete, because an
 * import that dies halfway - a closed tab, a full disk - would otherwise leave
 * rows behind that nothing knows the name of. Unready means invisible to a
 * lookup; with its sources kept (`stageSources`) it is an import waiting to go
 * on, without them it is collectable by `removeUnfinished`.
 *
 * The name may be provisional: the files have not been opened yet when this
 * is called, and what the .ifo calls the book arrives with the first batch.
 *
 * @param {{ name: string, langFrom: string, langTo: string, credit: string | null }} about
 * @returns {Promise<Dictionary>}
 */
export async function beginImport({ name, langFrom, langTo, credit }) {
  return await withStores([META], "readwrite", async (transaction) => {
    const store = transaction.objectStore(META);
    const stored = /** @type {Dictionary[]} */ (await promisify(store.getAll()));

    /** @type {Dictionary} */
    const dictionary = {
      id: crypto.randomUUID(),
      name,
      langFrom,
      langTo,
      entryCount: 0,
      aliasCount: 0,
      bytes: 0,
      addedAt: Date.now(),
      rank: nextRank(stored),
      ready: false,
      credit,
      textRevision: TEXT_REVISION,
    };

    await promisify(store.put(dictionary));
    return dictionary;
  });
}

/**
 * Keeps the files of an import, so that it can go on after the page is gone.
 *
 * Before a word is read: the moment a browser on a small tablet may be killed
 * is any moment, and an import that has to start over from a file picker the
 * page no longer has is an import lost. The files are taken back by
 * `readSources` and dropped by `finishImport`, or with the dictionary.
 *
 * @param {string} id
 * @param {{ ifo: Blob, idx: Blob, dict: Blob, syn?: Blob }} files
 * @returns {Promise<void>}
 */
export async function stageSources(id, files) {
  /** @type {ImportSources} */
  const sources = { id, ifo: files.ifo, idx: files.idx, dict: files.dict, ...(files.syn === undefined ? {} : { syn: files.syn }) };
  await withStores([SOURCES], "readwrite", async (transaction) => {
    await promisify(transaction.objectStore(SOURCES).put(sources));
  });
}

/**
 * @param {string} id
 * @returns {Promise<ImportSources | null>} null when the import has nothing to go on from
 */
export async function readSources(id) {
  const sources = /** @type {ImportSources | undefined} */ (
    await withStores([SOURCES], "readonly", (transaction) => promisify(transaction.objectStore(SOURCES).get(id)))
  );
  return sources ?? null;
}

/**
 * @returns {Promise<Set<string>>} the ids of the dictionaries whose files are kept
 */
async function stagedIds() {
  const keys = /** @type {string[]} */ (
    await withStores([SOURCES], "readonly", (transaction) => promisify(transaction.objectStore(SOURCES).getAllKeys()))
  );
  return new Set(keys);
}

/**
 * Whether an unfinished dictionary can be picked up where it stopped.
 *
 * @param {Dictionary} dictionary
 * @param {Set<string>} staged from `stagedIds`
 * @returns {boolean}
 */
function resumable(dictionary, staged) {
  return !dictionary.ready && staged.has(dictionary.id);
}

/**
 * Senses that belong on rows an earlier batch wrote (see `rowBatches`): each
 * is a read of the row, the merge `rows.js` would have done had the two
 * entries been in one batch, and a put of the result - inside the batch's own
 * transaction, so the batch still lands whole or not at all.
 *
 * @param {IDBObjectStore} store
 * @param {import("./rows.js").SenseAddition[]} additions
 * @returns {Promise<number>} how many bytes were added, for the record's count
 *   of what its text costs
 */
async function mergeAdditions(store, additions) {
  let appended = 0;
  for (const { dictId, key, senses } of additions) {
    const row = /** @type {import("./rows.js").DictionaryRow | undefined} */ (
      await promisify(store.get([dictId, key]))
    );
    if (row === undefined) continue;
    const added = mergeSenses(row.senses, senses);
    if (added.length === 0) continue;
    for (const sense of added) appended += utf8Length(sense);
    store.put(row);
  }
  return appended;
}

/**
 * A connection held open for the length of one import.
 *
 * Every batch is still a transaction of its own - it lands whole or not at
 * all, and the database is never owned for longer than one batch takes - but
 * the connection under them is opened once. That is what lets a batch be
 * handed over and left: `put` queues its rows before it returns, so the page
 * can go and key the next batch while this one is being written, instead of
 * waiting first on an `open` that cannot complete until the page yields.
 *
 * The puts are fired without being awaited one by one: IndexedDB queues them
 * on the transaction, and waiting for each in turn would add a round trip
 * through the microtask queue to every one of a few hundred thousand rows. A
 * failure still aborts the transaction, which is what the wait at the end sees.
 *
 * The dictionary's own row rides in the same transaction, carrying where the
 * import stands once this batch is in (and the book's real name, which the
 * row may still lack). One transaction, so the database never says "these
 * rows are in" about rows that are not, or the other way round - which is the
 * whole of what lets a killed import go on from its last batch.
 *
 * @typedef {object} ImportMark
 * @property {string} name what the .ifo calls the book
 * @property {string | null} credit
 * @property {ImportProgress} progress
 */

/**
 * @typedef {object} DictionaryWriter
 * @property {(rows: import("./rows.js").DictionaryRow[], additions: import("./rows.js").SenseAddition[], mark: ImportMark) => Promise<number>} put
 *   one batch; resolves, once it is on disk, with how many bytes the additions added
 * @property {() => void} close
 */

/**
 * @param {string} id the dictionary being written
 * @returns {Promise<DictionaryWriter>}
 */
export async function openWriter(id) {
  const db = await open();
  // Another page asking for an upgrade must not wait on this import: the
  // connection yields, the batch in flight aborts, and the import fails with
  // a sentence - rather than the other page hanging without one.
  db.onversionchange = () => db.close();

  /**
   * @param {IDBObjectStore} meta
   * @param {ImportMark} mark
   */
  const markProgress = async (meta, mark) => {
    const existing = /** @type {Dictionary | undefined} */ (await promisify(meta.get(id)));
    if (existing === undefined) throw new Error("The dictionary was removed while it was being added");
    meta.put({ ...existing, ...mark });
  };

  return {
    put(rows, additions, mark) {
      const transaction = db.transaction([ENTRIES, META], "readwrite");
      const store = transaction.objectStore(ENTRIES);
      for (const row of rows) store.put(row);
      return Promise.all([
        mergeAdditions(store, additions),
        markProgress(transaction.objectStore(META), mark),
        completed(transaction),
      ]).then(([appended]) => appended);
    },
    close() {
      db.close();
    },
  };
}

/**
 * The last word on an import: the counts, `ready`, and nothing left to go on
 * from - the files staged for it are dropped in the same transaction.
 *
 * @param {string} id
 * @param {{ entryCount: number, aliasCount: number, bytes: number }} counts
 * @returns {Promise<Dictionary>}
 */
export async function finishImport(id, counts) {
  return await withStores([META, SOURCES], "readwrite", async (transaction) => {
    const store = transaction.objectStore(META);
    const existing = /** @type {Dictionary | undefined} */ (await promisify(store.get(id)));
    if (existing === undefined) throw new Error("The dictionary was removed while it was being added");

    const { progress: _, ...rest } = existing;
    /** @type {Dictionary} */
    const ready = { ...rest, ...counts, ready: true };
    await promisify(store.put(ready));
    transaction.objectStore(SOURCES).delete(id);
    return ready;
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteDictionary(id) {
  // Rows first: a meta row without its rows is a dictionary that answers
  // nothing, while rows without a meta row are invisible and collectable.
  await withStores([ENTRIES, SOURCES, META], "readwrite", (transaction) => {
    transaction.objectStore(ENTRIES).delete(rowsOf(id));
    transaction.objectStore(SOURCES).delete(id);
    transaction.objectStore(META).delete(id);
  });
}

/**
 * Throws away what a broken import left behind - and only that.
 *
 * An unfinished dictionary whose files are still here is not a leftover, it
 * is an import waiting to go on (`resumable`), and it stays. What goes is the
 * rest: a dictionary from before the files were kept, or one whose import
 * failed outright and was cleared of its files on the way out.
 *
 * Called when the settings page opens - the moment somebody is looking at
 * this page and can be told about it.
 *
 * @returns {Promise<Dictionary[]>} what was removed, so it can be said out loud
 */
export async function removeUnfinished() {
  const staged = await stagedIds();
  const leftovers = (await listDictionaries()).filter(
    (dictionary) => !dictionary.ready && !resumable(dictionary, staged),
  );
  for (const dictionary of leftovers) await deleteDictionary(dictionary.id);
  return leftovers;
}
