/**
 * The background's half of the vocabulary: the database, and the copy pages
 * are allowed to read.
 *
 * Every write here is three steps - the row, then the mirror, then the copy
 * that outlives the database (`backup.js`) - and they are in this module
 * rather than in the router so that no future caller can do the first without
 * the others. Both copies are rebuilt in full from what the database just
 * said; a cache that patched itself would be a second version of the truth,
 * and neither is allowed to have opinions. And before every write the store
 * is settled: a vocabulary the browser deleted comes back from its copy
 * first, so a save can never land on a freshly emptied store and rebuild the
 * copy from that one phrase.
 *
 * Nothing here catches: the message router turns an exception into `internal`,
 * and a database that cannot be opened is exactly that.
 */

import { normalize } from "../lib/normalize.js";
import { chosenPair, readConfig } from "../lib/config.js";
import { mergeCounts, mergeSentences } from "../lib/counting.js";
import { ErrorCode, fail, ok } from "../lib/protocol.js";
import { ensureBackup, rebuildBackup, restoreVocabulary } from "../lib/store/backup.js";
import { migrateSemicolonsOnce, sweepSemicolonBackup } from "../lib/store/semicolon-migration.js";
import { mirrorWithForms } from "../lib/store/forms.js";
import { writeMirror } from "../lib/store/mirror.js";
import { buildPhrase, withRestoredCounts } from "../lib/store/phrase.js";
import {
  countPhrases as countRows,
  deletePhrase,
  fillSentences,
  listPhrases,
  putMissingPhrases,
  putPhrase,
  restorePhrases,
} from "../lib/store/vocab.js";

/**
 * The chosen pair in the store's spelling, or null while nobody has chosen
 * one. Null is a state every write below has to answer for, not a default to
 * fill in: a phrase saved to a guessed pair would surface under a pair the
 * reader picks later, wearing a language it was never in.
 *
 * @param {import("../lib/config.js").Config} config
 * @returns {{ langFrom: string, langTo: string } | null}
 */
function pairOf(config) {
  const pair = chosenPair(config);
  return pair === null ? null : { langFrom: pair.from, langTo: pair.to };
}

/**
 * With no pair there is nothing to mirror, and the empty mirror is still
 * written: pages match it against the pairless settings and stay quiet,
 * instead of reading its absence as "ask the background", forever.
 *
 * The other forms of the words ride along (D208, `lib/store/forms.js`):
 * computed from the dictionaries for the words the standing mirror does not
 * have them for, and only while the switch asks for them.
 *
 * @param {import("../lib/config.js").Config} config
 * @returns {Promise<import("../lib/protocol.js").VocabEntry[]>}
 */
async function rebuildMirror(config) {
  const pair = pairOf(config);
  const phrases = pair === null ? [] : await listPhrases(pair);
  const mirror = await mirrorWithForms(config, phrases);
  await writeMirror(mirror);
  return mirror.entries;
}

/**
 * The two copies that follow every write to the database - the pages' mirror
 * and the copy that outlives the database - both rebuilt in full from what
 * the database just said.
 *
 * @param {import("../lib/config.js").Config} config
 * @returns {Promise<void>}
 */
async function afterWrite(config) {
  await rebuildMirror(config);
  await rebuildBackup();
}

/**
 * The store settled: whatever the browser deleted is back from its copy
 * before the caller reads or writes. Asked before every write and not only
 * at start, because a deletion can land while the background is alive; on
 * every ordinary call it costs one count. The pages' mirror is the caller's
 * to rebuild when something came back - the writes rebuild it anyway.
 *
 * @returns {Promise<number>} how many phrases came back
 */
function settled() {
  return restoreVocabulary();
}

/**
 * Every start of the background: the store settled - with the mirror
 * rebuilt if something came back, so the pages' underlines return with the
 * words - and a copy written for a vocabulary that has none yet, which is
 * every installation that kept its phrases before the copy existed. Then the
 * one-time migrations (D205: the semicolons in the meanings saved before
 * D203), after the store is settled so a vocabulary just restored is
 * migrated too, and before any message reads or writes a phrase - every
 * door below waits on this. Its own copy is swept last. Quiet on failure: a
 * start must not hang on it, the next write asks again, and a migration
 * that failed left no flag and tries again at the next start.
 */
const started = settled()
  .then(async (restored) => {
    if (restored > 0) await rebuildMirror(await readConfig());
    await ensureBackup();
    await migrateSemicolonsOnce();
    await sweepSemicolonBackup();
  })
  .catch(() => undefined);

/**
 * Kept out of the message path: an install or an update is the one moment the
 * mirror can be missing while the database is not - a new version with a
 * different shape, or storage cleared under a database that survived. The
 * copy too: an update is what hands it to installations that predate it.
 *
 * @returns {Promise<void>}
 */
export async function refreshVocabulary() {
  await started;
  await afterWrite(await readConfig());
}

/**
 * @param {import("../lib/protocol.js").SavePhraseRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<null>>}
 */
export async function savePhrase(request) {
  await started;
  await settled();
  const config = await readConfig();
  const pair = pairOf(config);
  // Unreachable through the UI - a bubble with no pair shows the model error
  // and offers no Save - so this is the belt for a stale page mid-change:
  // the same code, pointing at the same settings page.
  if (pair === null) return fail(ErrorCode.MODEL_MISSING);
  const built = buildPhrase({
    text: request.text,
    translations: request.translations,
    langFrom: pair.langFrom,
    langTo: pair.langTo,
    id: crypto.randomUUID(),
    now: Date.now(),
    // The sentence the phrase stood in (D210) is kept only while the setting
    // asks for it, and the setting is read here, fresh, on every save: the
    // page sends what it has, and this is the one place that knows whether
    // the reader wanted it kept. Without the setting the sentence goes no
    // further than this line.
    context: config.saveSentence ? request.context : undefined,
  });
  if (!built.ok) return built;

  await putPhrase(built.value);
  await afterWrite(config);
  return ok(null);
}

/**
 * Forgetting something that was never saved is not a failure - the button says
 * "learned", and it is true either way.
 *
 * @param {import("../lib/protocol.js").ForgetPhraseRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<null>>}
 */
export async function forgetPhrase(request) {
  const normalized = normalize(request.text);
  if (normalized.length === 0) return ok(null);

  await started;
  const restored = await settled();
  const config = await readConfig();
  const pair = pairOf(config);
  // No pair holds no phrases, so there is nothing to forget - true, not an error.
  if (pair === null) return ok(null);
  const forgotten = await deletePhrase({ ...pair, normalized });
  // Only when something changed: an untouched mirror written again is a storage
  // event in every open tab, and every one of them would rebuild for nothing.
  // A restore is a change too - the pages must learn what came back.
  if (forgotten || restored > 0) await afterWrite(config);
  return ok(null);
}

/**
 * A page's report of what the reader did with the phrases it was handed
 * (D209): bubble openings, and the occurrences in a text finished. Added to
 * the rows and to nothing else - not the mirror, not the copy. The mirror
 * carries no count, and rewriting it would be a storage event in every open
 * tab, each repainting its page for a number it never shows; the copy
 * catches up with the next save, Learned or import, and the counts gathered
 * since are what a deletion of the database costs - statistics, not the
 * vocabulary. A key the store no longer holds is skipped: Learned may have
 * taken it between the report and this write. A restore on the way is the
 * one thing the pages must learn about, as with forgetting.
 *
 * The sentence a bubble opened in rides the same report (D216) and fills
 * the rows kept without one - only while the setting asks for it, read
 * here fresh as on every save: the page sends what it has, and this is the
 * one place that knows whether the reader wanted a sentence kept. A
 * sentence filled in is vocabulary, not a count, so the copy is rebuilt
 * for it - a deletion of the database must not lose it again - and the
 * mirror is not, for the counts' own reason: it carries no sentence, and
 * rewriting it would repaint every open tab for nothing.
 *
 * @param {import("../lib/protocol.js").CountPhrasesRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<null>>}
 */
export async function countPhrases(request) {
  await started;
  const restored = await settled();
  const config = await readConfig();
  const pair = pairOf(config);
  // No pair holds no phrases, so there is nothing to count - true, not an error.
  if (pair === null) return ok(null);
  const counts = mergeCounts(request);
  if (counts.size > 0) await countRows(pair, counts, Date.now());
  const sentences = config.saveSentence ? mergeSentences(request) : null;
  const filled = sentences === null || sentences.size === 0 ? 0 : await fillSentences(pair, sentences);
  if (restored > 0) await afterWrite(config);
  else if (filled > 0) await rebuildBackup();
  return ok(null);
}

/**
 * A file's worth of phrases, added to the configured pair - and only added:
 * a phrase already saved keeps its meanings. Rows the store cannot accept -
 * too long, or nothing left once normalized - are counted rather than fatal,
 * because one broken line must not cost the rest of the file.
 *
 * `createdAt` steps by one millisecond per row, so the file's order survives
 * into the next export - which is what keeps oldest-first meaning something
 * across a roundtrip through another device.
 *
 * @param {import("../lib/protocol.js").ImportPhrasesRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").ImportReport>>}
 */
export async function importPhrases(request) {
  await started;
  const restored = await settled();
  const config = await readConfig();
  // An import lands in the configured pair, and with none there is nowhere
  // for it to land - importing into a guessed pair would be data loss wearing
  // a success message. The vocabulary page does not offer the import without
  // a pair; this is the belt behind that.
  const pair = pairOf(config);
  if (pair === null) return fail(ErrorCode.MODEL_MISSING);
  const now = Date.now();

  /** @type {import("../lib/store/phrase.js").Phrase[]} */
  const rows = [];
  let invalid = 0;
  for (const [at, row] of request.rows.entries()) {
    const built = buildPhrase({
      text: row.text,
      translations: row.translations,
      langFrom: pair.langFrom,
      langTo: pair.langTo,
      id: crypto.randomUUID(),
      now: now + at,
      // The file's sentence (D212), whatever the setting says: the setting
      // is about what the bubble writes on its own, and a file is the
      // reader's own choice.
      context: row.context,
    });
    if (built.ok) rows.push(built.value);
    else invalid += 1;
  }

  const { added, skipped, sentenced } = await putMissingPhrases(rows);
  // Nothing added means the mirror already tells the truth, and rewriting it
  // would ping every open tab for nothing - the same restraint as forgetting.
  // A restore is a change too - the pages must learn what came back - and so
  // is a sentence filled into a saved row: the mirror carries none, but the
  // copy does, and `afterWrite` rebuilds both.
  if (added > 0 || sentenced > 0 || restored > 0) await afterWrite(config);
  return ok({ added, skipped, sentenced, invalid });
}

/**
 * The vocabulary of the backup of everything (D213) written back: every
 * pair the file holds, whatever the settings say the pair being read is -
 * a backup restores what was, not what is chosen now. A phrase not yet
 * saved is added as the file has it - the day it was kept, its sentence,
 * its counts; a saved one takes only what it lacks (`restored`). The
 * setting for the sentence does not enter, as it does not for the TSV
 * import (D212): the file is the reader's own.
 *
 * @param {import("../lib/protocol.js").RestoreVocabularyRequest} request
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").RestoreReport>>}
 */
export async function restoreFromBackup(request) {
  await started;
  const restored = await settled();
  const config = await readConfig();
  const now = Date.now();

  /** @type {import("../lib/store/phrase.js").Phrase[]} */
  const rows = [];
  let invalid = 0;
  for (const [at, row] of request.rows.entries()) {
    const built = buildPhrase({
      text: row.text,
      translations: row.translations,
      langFrom: row.langFrom,
      langTo: row.langTo,
      id: crypto.randomUUID(),
      // The day the file says it was kept, or this moment: a row without
      // one is a hand-made file, and it goes to the end of the list.
      now: row.createdAt ?? now + at,
      context: row.context,
    });
    if (built.ok) rows.push(withRestoredCounts(built.value, row));
    else invalid += 1;
  }

  const report = await restorePhrases(rows);
  // Anything written reaches the mirror and the copy; a restore of what the
  // browser deleted is a change too.
  if (report.added > 0 || report.sentenced > 0 || report.counted > 0 || restored > 0) await afterWrite(config);
  return ok({ ...report, invalid });
}

/**
 * The repair path. A page asks for this when the mirror it found describes a
 * different language pair than the one being read, and the answer doubles as
 * the rebuild - settled first, so a page asking after a deletion gets the
 * vocabulary back rather than an honest nothing. The settings page asks for
 * it too, for the rebuild alone (D208): when the switch for the other forms
 * is turned on, and when a dictionary comes or goes while it is on - the
 * forms come out of the dictionaries, and the dictionaries change on that
 * page, where no storage event says so.
 *
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").VocabEntry[]>>}
 */
export async function listVocabulary() {
  await started;
  await settled();
  return ok(await rebuildMirror(await readConfig()));
}
