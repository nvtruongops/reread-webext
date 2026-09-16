/**
 * The one-time migration of semicolons in the meanings already saved (D205).
 *
 * Until D203 a meaning typed as "uleganie; kapitulacja" reached the store as
 * one meaning with a semicolon in it. Since D203 the field and the edit
 * boxes split such a line as it is saved; what was saved before them still
 * stands joined. This runs once after the update and splits those - and
 * only those: a book's own line with a semicolon in it ("powiadomić kogoś;
 * powiedzieć komuś o czymś") is a meaning the reader chose whole, and it
 * stays whole.
 *
 * Which is which is reconstructed the way the shelf would show it: a
 * meaning with a semicolon that is, word for word, one of the lines a
 * dictionary installed for the phrase's language offers for that phrase is
 * the book's; every other one is the reader's and is split (D1 of the
 * brief). A phrase with no dictionary for its language cannot be checked,
 * and its semicolons are split too - unverified means the reader's (D2),
 * counted apart in the log. The residue accepted (D4): a book's line
 * whose book was uninstalled before this ran is split; the text is not
 * lost, and the edit box mends it.
 *
 * The order of the write is the whole safety of it: a copy of every phrase
 * as stored, then the changed phrases in one transaction, then the flag -
 * so a failure anywhere leaves the flag unset and the store as it was, and
 * the next start tries again. An empty store gets the flag and no copy. The
 * copy stays for thirty days or until the next version, whichever comes
 * first (`sweepSemicolonBackup`). Both homes of the vocabulary run this
 * before their first read - the background and the phrases page - under
 * one lock, so the second waits for the first and finds the flag.
 *
 * Nothing here is shown: the changelog says it once, the console says the
 * numbers.
 */

import { webext } from "../browser.js";
import { chosenPair, readConfig } from "../config.js";
import { lookupKeys } from "../dict/lookup.js";
import { lookupEntries } from "../dict/store.js";
import { entryGroups } from "../lookup.js";
import { splitMeanings } from "../meanings.js";
import { rebuildBackup } from "./backup.js";
import { mirrorWithForms } from "./forms.js";
import { writeMirror } from "./mirror.js";
import { allPhrases, listPhrases, putPhrases } from "./vocab.js";

/** @typedef {import("./phrase.js").Phrase} Phrase */

/**
 * @typedef {object} MigrationDeps
 * @property {() => Promise<unknown>} readFlags what stands under `MIGRATIONS_KEY`
 * @property {(flags: Record<string, string>) => Promise<void>} writeFlags
 * @property {() => Promise<Phrase[]>} list every phrase, as stored
 * @property {(phrases: Phrase[]) => Promise<void>} putAll the changed phrases, one transaction
 * @property {(phrase: Phrase) => Promise<Set<string> | null>} dictionaryLines the lines the
 *   installed dictionaries of the phrase's language offer for it, trimmed - null
 *   when there is no dictionary for that language at all
 * @property {() => Promise<unknown>} readBackup what stands under `SEMICOLON_BACKUP_KEY`
 * @property {(backup: SemicolonBackup) => Promise<void>} writeBackup
 * @property {() => Promise<void>} removeBackup
 * @property {() => Promise<void>} afterWrite the pages' mirror and the vocabulary's
 *   copy rebuilt from the store, once the changed phrases are in
 * @property {() => number} now epoch milliseconds
 * @property {() => string} version the extension's, as the manifest says
 * @property {(line: string) => void} log
 */

/**
 * @typedef {object} SemicolonBackup
 * @property {1} version
 * @property {number} writtenAt epoch milliseconds
 * @property {string} extension the version that wrote it
 * @property {Phrase[]} phrases every phrase as it stood before the write
 */

/**
 * @typedef {object} MigrationReport
 * @property {boolean} ran false when the flag already stood
 * @property {number} phrases how many were read
 * @property {number} candidates how many carried a semicolon in a meaning
 * @property {number} split meanings split into pieces
 * @property {number} kept meanings with a semicolon kept as a book's line
 * @property {number} withoutDictionary candidates whose language has no dictionary installed
 * @property {number} written phrases rewritten
 * @property {number} durationMs
 */

/** The key in `storage.local`: which one-time migrations have run. */
export const MIGRATIONS_KEY = "vocabMigrations";

/** The key in `storage.local` of the copy written before the semicolons were split. */
export const SEMICOLON_BACKUP_KEY = "vocabBackupPreSemicolon";

/** How long the copy stays, at most. */
export const BACKUP_DAYS = 30;

const SEMICOLON = "semicolon";
const DONE = "done";
const LOCK = "reread-vocab-migration";

/**
 * @returns {MigrationDeps}
 */
function defaults() {
  return {
    readFlags: async () => (await webext().storage.local.get(MIGRATIONS_KEY))[MIGRATIONS_KEY],
    writeFlags: async (flags) => {
      await webext().storage.local.set({ [MIGRATIONS_KEY]: flags });
    },
    list: allPhrases,
    putAll: putPhrases,
    dictionaryLines: async (phrase) => {
      const keys = lookupKeys(phrase.phrase, phrase.langFrom) ?? [];
      const answer = await lookupEntries([{ lang: phrase.langFrom, keys }]);
      if (answer.dictionaries === 0) return null;
      const groups = entryGroups(answer.entries, phrase.normalized, phrase.langFrom);
      return new Set(groups.flatMap((group) => group.lines).map((line) => line.trim()));
    },
    readBackup: async () => (await webext().storage.local.get(SEMICOLON_BACKUP_KEY))[SEMICOLON_BACKUP_KEY],
    writeBackup: async (backup) => {
      await webext().storage.local.set({ [SEMICOLON_BACKUP_KEY]: backup });
    },
    removeBackup: async () => {
      await webext().storage.local.remove(SEMICOLON_BACKUP_KEY);
    },
    afterWrite: async () => {
      // The same two copies every write in the background rebuilds
      // (`background/vocabulary.js`): the pages' mirror of the chosen pair
      // and the copy that outlives the database. Rebuilt here as well, since
      // the phrases page may be the home that ran the migration.
      await rebuildBackup();
      const config = await readConfig();
      const pair = chosenPair(config);
      const phrases = pair === null ? [] : await listPhrases({ langFrom: pair.from, langTo: pair.to });
      await writeMirror(await mirrorWithForms(config, phrases));
    },
    now: () => Date.now(),
    version: () => webext().runtime.getManifest().version,
    log: (line) => console.info(line),
  };
}

/**
 * @param {unknown} stored
 * @returns {Record<string, string>}
 */
function asFlags(stored) {
  if (typeof stored !== "object" || stored === null) return {};
  /** @type {Record<string, string>} */
  const flags = {};
  for (const [key, value] of Object.entries(stored)) if (typeof value === "string") flags[key] = value;
  return flags;
}

/**
 * Whether a phrase has anything this migration is about.
 *
 * @param {Phrase} phrase
 * @returns {boolean}
 */
export function hasSemicolon(phrase) {
  return phrase.translations.some((meaning) => meaning.includes(";"));
}

/**
 * One phrase's meanings after the split, pure: a meaning with a semicolon
 * that stands, trimmed, among the dictionary's lines is kept as it is;
 * any other one with a semicolon is split, its pieces in its place; a
 * meaning without one is untouched. A meaning said twice afterwards is
 * kept once, where it first stood. No lines at all (no dictionary for the
 * language) keeps nothing.
 *
 * @param {readonly string[]} translations as stored
 * @param {ReadonlySet<string> | null} lines the dictionaries' lines for the phrase, trimmed
 * @returns {{ translations: string[], split: number, kept: number }}
 */
export function splitStoredMeanings(translations, lines) {
  /** @type {string[]} */
  const out = [];
  let split = 0;
  let kept = 0;
  for (const meaning of translations) {
    /** @type {string[]} */
    let pieces;
    if (!meaning.includes(";")) {
      pieces = [meaning];
    } else if (lines !== null && lines.has(meaning.trim())) {
      pieces = [meaning];
      kept += 1;
    } else {
      pieces = splitMeanings(meaning);
      split += 1;
    }
    for (const piece of pieces) if (!out.includes(piece)) out.push(piece);
  }
  return { translations: out, split, kept };
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameList(a, b) {
  return a.length === b.length && a.every((one, at) => one === b[at]);
}

/**
 * Runs the migration once: the flag read first, nothing done when it
 * stands; the phrases read whole; only those with a semicolon in a meaning
 * looked up; a copy, one write, the flag - in that order.
 *
 * @param {MigrationDeps} [deps]
 * @returns {Promise<MigrationReport>}
 */
export async function migrateSemicolons(deps = defaults()) {
  const start = deps.now();
  const flags = asFlags(await deps.readFlags());
  const report = { ran: false, phrases: 0, candidates: 0, split: 0, kept: 0, withoutDictionary: 0, written: 0, durationMs: 0 };
  if (flags[SEMICOLON] === DONE) {
    deps.log("re/read: the semicolon migration already ran - nothing to do");
    return report;
  }
  report.ran = true;

  const phrases = await deps.list();
  report.phrases = phrases.length;

  /** @type {Phrase[]} */
  const changed = [];
  for (const phrase of phrases) {
    if (!hasSemicolon(phrase)) continue;
    report.candidates += 1;
    const lines = await deps.dictionaryLines(phrase);
    if (lines === null) report.withoutDictionary += 1;
    const next = splitStoredMeanings(phrase.translations, lines);
    report.split += next.split;
    report.kept += next.kept;
    if (next.translations.length > 0 && !sameList(next.translations, phrase.translations)) {
      changed.push({ ...phrase, translations: next.translations });
    }
  }

  if (changed.length > 0) {
    // The copy first, of every phrase as it stood; then the changed ones in
    // one transaction; the flag only after both - a failure in between
    // leaves the flag unset and the store untouched.
    await deps.writeBackup({ version: 1, writtenAt: deps.now(), extension: deps.version(), phrases });
    await deps.putAll(changed);
    report.written = changed.length;
    await deps.afterWrite();
  }
  await deps.writeFlags({ ...flags, [SEMICOLON]: DONE });

  report.durationMs = deps.now() - start;
  deps.log(
    `re/read: semicolon migration - ${report.phrases} phrases read, ${report.candidates} with a semicolon, ` +
      `${report.split} meanings split, ${report.kept} kept as a dictionary's line, ` +
      `${report.withoutDictionary} without a dictionary for the language, ${report.written} phrases rewritten, ` +
      `${report.durationMs} ms`,
  );
  return report;
}

/**
 * The migration under the one lock both homes of the vocabulary share: the
 * second to arrive waits for the first and finds the flag. Where the
 * browser has no locks, the flag alone guards it - the two homes rarely
 * start in the same second, and a second run over an already split store
 * changes nothing.
 *
 * @param {MigrationDeps} [deps]
 * @returns {Promise<MigrationReport>}
 */
export async function migrateSemicolonsOnce(deps = defaults()) {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return await navigator.locks.request(LOCK, () => migrateSemicolons(deps));
  }
  return await migrateSemicolons(deps);
}

/**
 * @param {unknown} stored
 * @returns {{ writtenAt: number, extension: string } | null}
 */
function asBackupHead(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, writtenAt, extension } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== 1 || typeof writtenAt !== "number" || typeof extension !== "string") return null;
  return { writtenAt, extension };
}

/**
 * The copy taken away once it has served: after thirty days, or at the
 * first start of a later version - whichever comes first. A copy of a
 * shape this version does not know is taken away too: it is nobody's.
 *
 * @param {MigrationDeps} [deps]
 * @returns {Promise<boolean>} whether a copy was removed
 */
export async function sweepSemicolonBackup(deps = defaults()) {
  const stored = await deps.readBackup();
  if (stored === undefined || stored === null) return false;
  const head = asBackupHead(stored);
  const stale =
    head === null || head.extension !== deps.version() || deps.now() - head.writtenAt > BACKUP_DAYS * 24 * 60 * 60 * 1000;
  if (!stale) return false;
  await deps.removeBackup();
  return true;
}
