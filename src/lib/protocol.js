/**
 * What content scripts and extension pages may ask the background for, and what
 * they get back.
 *
 * Two rules hold everywhere downstream of this file:
 *
 * 1. Nothing that crosses this boundary throws. A failure is a value with a
 *    code from `ErrorCode`, because the receiving side has to render it, and
 *    "render an exception" has no good answer.
 * 2. A new error code is a UI change, not an implementation detail: something
 *    has to be able to say it in a sentence a reader understands.
 */

/**
 * Message kinds. The `kind` field is the discriminator on every request.
 *
 * All of them travel page to background, except the last two, which go the
 * other way - to a tab, because the side that asks is not the side that knows:
 * `grab-page` is the background fetching the page the reader was pointed at,
 * and `page-info` is the popup asking the tab it stands over what it is.
 * `asRequest` narrows the first group, `asPageRequest` the second - one list
 * of kinds, two directions, and neither validator accepts the other's.
 */
export const Message = Object.freeze({
  TRANSLATE: "translate",
  LOOK_UP: "look-up",
  OPEN_READER: "open-reader",
  OPEN_LIBRARY: "open-library",
  OPEN_MARKS: "open-marks",
  OPEN_VOCABULARY: "open-vocabulary",
  OPEN_SETTINGS: "open-settings",
  SAVE_PHRASE: "save-phrase",
  FORGET_PHRASE: "forget-phrase",
  LIST_PHRASES: "list-phrases",
  IMPORT_PHRASES: "import-phrases",
  RESTORE_VOCABULARY: "restore-vocabulary",
  COUNT_PHRASES: "count-phrases",
  READ_PAGE: "read-page",
  GRAB_PAGE: "grab-page",
  PAGE_INFO: "page-info",
});

/**
 * How many keys one `count-phrases` batch may carry, in either list: the
 * vocabulary budget from the brief. A page reports the keys it was handed
 * in the mirror, so a batch past this size is not a big vocabulary, it is
 * a bug - and refused like a broken import row, not trimmed.
 */
export const MAX_COUNTED_KEYS = 10_000;

/**
 * The places on the settings page a press may ask to land on (D192), by the
 * anchor the page gives them - one so far: the bubble's "settings", in the
 * line about a missing dictionary, opens the dictionaries. A closed list, so
 * that a request names a section and never an address: the background puts
 * the name on as a fragment, and a name it does not know is dropped like
 * every other extra (the settings then open at the top, as before).
 */
export const SETTINGS_SECTIONS = Object.freeze(/** @type {const} */ (["dictionaries"]));

/** @typedef {(typeof SETTINGS_SECTIONS)[number]} SettingsSection */

/**
 * @param {unknown} value
 * @returns {value is SettingsSection}
 */
function isSettingsSection(value) {
  return typeof value === "string" && SETTINGS_SECTIONS.some((section) => section === value);
}

/** Every way a request can fail, and the whole list of them. */
export const ErrorCode = Object.freeze({
  /** No translation engine is bundled yet (the state before M1 lands). */
  ENGINE_MISSING: "engine_missing",
  /** The engine is there, the model for this language pair is not. */
  MODEL_MISSING: "model_missing",
  /** No model exists for this pair at all. */
  UNSUPPORTED_PAIR: "unsupported_pair",
  /** Longer than the tooltip is meant for - a page, not a phrase. */
  TOO_LONG: "too_long",
  /**
   * There is nothing for the reader to take: the tab it was pointed at is gone,
   * or it is a page no content script runs in - `about:`, the PDF viewer, the
   * add-ons site. Not an error in the sense of something being broken.
   */
  NO_PAGE: "no_page",
  /** A request the background does not know. Reaching a user means a bug. */
  UNKNOWN_MESSAGE: "unknown_message",
  /** Anything that got as far as an exception. */
  INTERNAL: "internal",
});

/** @typedef {(typeof ErrorCode)[keyof typeof ErrorCode]} ErrorCodeValue */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, code: ErrorCodeValue }} Result
 */

/**
 * One saved phrase, as small as it can be sent: its key and what it means.
 * `[normalized, translations]`. No id and no display form - a page knows the
 * text it is looking at, and ids are the database's business.
 *
 * @typedef {[string, string[]]} VocabEntry
 */

/**
 * One dictionary's answer about a word: which book, how that book spells the
 * word it found, and what it says. The headword is worth carrying because it is
 * not always what was selected - a dictionary asked about `watches` answers
 * about `watch`, and a reader should be able to see that is what happened.
 *
 * @typedef {{ dictionary: string, headword: string, senses: string[] }} DictEntry
 *
 * What the dictionaries said about a phrase and how many of them were asked
 * (D164): `dictionaries` counts the installed dictionaries that answer for
 * the language, zero saying there is none - the one fact that tells "not in
 * your dictionaries" from "no dictionary for this language" in the bubble.
 * `lang` is the language they were asked in (D191): the pair's or the page's,
 * decided in the background where the pair lives - the bubble names it in
 * "no dictionary for ...", reads the phrase aloud in it once a dictionary
 * knew the phrase, and says where Save would file the phrase (D167) only
 * when it is not the pair's.
 * @typedef {{ entries: DictEntry[], dictionaries: number, lang: string }} LookUp
 */

/**
 * What comes back from a translation: the phrase, the sentence it was in when
 * there was one worth showing, and whatever the installed dictionaries have to
 * say about it.
 *
 * The gloss is what the bubble shows and what gets saved - always the phrase
 * translated as a phrase, never a piece cut out of the sentence, because this
 * engine cannot say which piece that would be. The sentence and the dictionary
 * entries are the second layer, shown only when asked for, and neither is ever
 * stored.
 *
 * `entries` is optional here and always present on the wire: a provider
 * produces a translation and knows nothing about dictionaries, the background
 * fills them in, and `asTranslation` gives the receiving side an array either
 * way. That is what keeps "is there a second layer" one question rather than
 * three states.
 *
 * `dictionaries` is the `look-up` answer's count (D164) riding along with a
 * translation (D192): how many installed dictionaries answer for the pair's
 * source language, zero saying there is none. It is what lets the bubble
 * over a word or two the engine translated alone say which of two things the
 * empty entries mean - no dictionary to ask, or dictionaries that did not
 * know the word - and point at the right remedy. Absent when the lookup gave
 * no answer at all (a database that would not open), and from a background
 * older than this field: the bubble says nothing then, by D164's rule that a
 * fault must never read as a missing dictionary.
 *
 * `language` says the phrase is not in the pair's source language at all
 * (D193), and which one it is in: the browser's detector read the sentence
 * as the reader's own language, or a dictionary of another language knew
 * the word while the pair's did not. The engine is not asked then - it
 * translates from the pair's language or not at all - so the gloss comes
 * empty and the sentence null, and the entries and the count are about the
 * language named: what the bubble shows instead of a guess. Absent for a
 * phrase in the pair's language, which is every translation there was
 * before D193.
 *
 * @typedef {{ gloss: string, sentence: string | null, entries?: DictEntry[], dictionaries?: number, language?: string }} Translation
 */

/**
 * A translate request carries the text, and the sentence around it when the
 * page had one: the language pair lives in the settings, the settings live in
 * the background, and a content script that never has to look them up is a
 * content script that cannot disagree with the background about which pair is
 * configured. The same is true of every request below - phrases are addressed
 * by their text, and the background is the only side that normalizes it.
 *
 * `context` is the sentence, not a promise about it: the background may ignore
 * it, and nothing about the answer's shape depends on whether it was sent. On
 * a `translate` it exists on the wire and nowhere else. On a `save-phrase` it
 * is, since D210, the sentence the phrase is being kept from - the same one
 * the bubble had, as the page shows it, never its translation - and the
 * background writes it into the row only while the setting that asks for it
 * (`saveSentence`) is on: the content script sends what it has, the settings
 * live in the background, and a page that never reads them cannot disagree
 * with them. Sent without the setting it is dropped, like every other extra.
 * A phrase kept once keeps its first sentence: a later save with another
 * sentence changes the meanings and leaves the sentence alone (`resaved`).
 * That is what closed O2 - the field was reserved until a feature showed it,
 * and the phrases page and the export for Anki are that feature.
 *
 * `look-up` is the dictionaries alone (D162): what the quiet vocabulary asks
 * from a page that has no database in reach - the reader page reads its own.
 * It carries the text, and since D165 the language the page declares for it
 * (`lang`, absent when the page says nothing). The background asks in the
 * pair's language first and in the page's second (D191, `languagesToAsk`) -
 * a localised site declares the language of its buttons, not of its posts -
 * and the pair stays the background's business alone: the content only
 * reports what the page said.
 * The answer is a `LookUp` (D164): the entries, how many dictionaries were
 * asked and in which language (D191) - the bubble says "not in your
 * dictionaries" or "no dictionary for this language" by the count, which a
 * bare list could never tell it, and names the language by `lang`.
 * No language to ask in at all, or a database that would not open, answers
 * `null`: no answer rather than an error, and the bubble says nothing on it
 * - a note sending somebody to the settings has to be about a dictionary,
 * not a fault.
 *
 * Saving replaces the meanings of a phrase with the ones given, which is what
 * makes "the phrase means exactly what the bubble is showing" one rule instead
 * of two messages.
 *
 * `open-reader` may say which tab the reader should read - the popup knows,
 * because it stood over it, and passes the id along. Without one the reader
 * only comes forward, which is all a press on a page nobody can read can mean.
 *
 * `open-library` opens the reader on its reading list instead. Its own kind
 * rather than a flag on `open-reader`, because the two mean opposite things
 * about tabs: `open-reader` without an id falls back to the tab the message
 * came from, and on Android the popup is itself a page in a tab - the fallback
 * would point the reader at the popup. "The list, from anywhere" must not
 * carry a tab at all.
 *
 * `open-marks` turns the same one reader tab to the highlights page - every
 * kept quote. It carries nothing for `open-library`'s reason: the view is
 * not about any tab, and its scoped variant (one document's quotes) exists
 * only inside the reader, which needs no message to turn its own view.
 *
 * `open-vocabulary` brings the saved-phrases page forward, one tab like the
 * reader. It carries no tab and no pair for the same reason `open-library`
 * carries nothing: the page shows the vocabulary of the configured pair, and
 * the pair lives in the settings, not in a message. Since D197 it may carry
 * `text` - a phrase to look up on arrival, in the page's "Add a phrase" fold:
 * the popup's look-up field only reads, and this is its door to the page
 * where a press on a meaning saves. An extra like the settings' `section`:
 * kept when it is a non-empty string, dropped otherwise, never a refusal;
 * the page reduces it the way it reduces anything typed into the field.
 *
 * `import-phrases` adds a file's worth of rows to the configured pair - and
 * only adds: a phrase already saved keeps its meanings. Like every request
 * here it names no pair; the page that offers the import switches the
 * settings first, through the same control the pair select is. The answer
 * counts what happened, because "added 1200, skipped 43" is the whole reason
 * to trust an import that says nothing else.
 *
 * `count-phrases` is the one request that carries keys rather than text
 * (D209): a page reports what the reader did with phrases it was handed in
 * the mirror - `recalled` names a key once per bubble opening, `read` pairs
 * a key with how many times it occurred in a text the reader finished - and
 * the keys are the mirror's own, written by the background, so nothing here
 * is normalized a second time. The lists are exact: a key that is not a
 * string, a count that is not a whole positive number, or more keys than
 * the vocabulary budget refuse the message, the way a broken import row
 * does - the sender is our own page, and half a batch counted quietly is
 * the worse outcome. A key the store does not know is the background's to
 * skip, not a refusal: Learned may have taken it between the report and the
 * write.
 * Since D216 the report may carry `sentences` as well: for a key whose
 * bubble opened with a sentence around it, that sentence once per key -
 * the page's own text, the same one `save-phrase` carries - so a phrase
 * kept without one (before the setting was on, from the phrases page, from
 * a two-column file) takes the sentence it is next met in. The setting
 * stays the background's to read, as on a save: the page sends what it
 * has. The one list a page may leave out, because a page older than the
 * field never had it - read as empty then - and exact like the other two
 * once it is there.
 *
 * @typedef {{ kind: typeof Message.TRANSLATE, text: string, context?: string, lang?: string }} TranslateRequest
 * @typedef {{ kind: typeof Message.LOOK_UP, text: string, lang?: string }} LookUpRequest
 * @typedef {{ kind: typeof Message.OPEN_READER, sourceTabId?: number }} OpenReaderRequest
 * @typedef {{ kind: typeof Message.OPEN_LIBRARY }} OpenLibraryRequest
 * @typedef {{ kind: typeof Message.OPEN_MARKS }} OpenMarksRequest
 * @typedef {{ kind: typeof Message.OPEN_VOCABULARY, text?: string }} OpenVocabularyRequest
 * @typedef {{ kind: typeof Message.OPEN_SETTINGS, section?: SettingsSection }} OpenSettingsRequest
 * @typedef {{ kind: typeof Message.SAVE_PHRASE, text: string, translations: string[], context?: string }} SavePhraseRequest
 * @typedef {{ kind: typeof Message.FORGET_PHRASE, text: string }} ForgetPhraseRequest
 * @typedef {{ kind: typeof Message.LIST_PHRASES }} ListPhrasesRequest
 * @typedef {{ text: string, translations: string[], context?: string }} ImportRow
 * @typedef {{ kind: typeof Message.IMPORT_PHRASES, rows: ImportRow[] }} ImportPhrasesRequest
 * @typedef {{ added: number, skipped: number, sentenced: number, invalid: number }} ImportReport
 * @typedef {{
 *   langFrom: string,
 *   langTo: string,
 *   text: string,
 *   translations: string[],
 *   createdAt?: number,
 *   context?: string,
 *   recallCount?: number,
 *   lastRecallAt?: number,
 *   readCount?: number,
 *   lastReadAt?: number,
 * }} RestoreRow one phrase as the backup of everything carries it (D213) - its pair in the row, so one file holds every pair
 * @typedef {{ kind: typeof Message.RESTORE_VOCABULARY, rows: RestoreRow[] }} RestoreVocabularyRequest
 * @typedef {{ added: number, skipped: number, sentenced: number, counted: number, invalid: number }} RestoreReport
 * @typedef {{ kind: typeof Message.COUNT_PHRASES, recalled: string[], read: Array<[string, number]>, sentences: Array<[string, string]> }} CountPhrasesRequest
 * @typedef {{ kind: typeof Message.READ_PAGE }} ReadPageRequest
 * @typedef {TranslateRequest
 *   | LookUpRequest
 *   | OpenReaderRequest
 *   | OpenLibraryRequest
 *   | OpenMarksRequest
 *   | OpenVocabularyRequest
 *   | OpenSettingsRequest
 *   | SavePhraseRequest
 *   | ForgetPhraseRequest
 *   | ListPhrasesRequest
 *   | ImportPhrasesRequest
 *   | RestoreVocabularyRequest
 *   | CountPhrasesRequest
 *   | ReadPageRequest} Request
 */

/**
 * A page as the reader gets it: the address, the title the tab had, and the
 * document serialized as it stands - after scripts have run, which is the whole
 * reason this comes from the page rather than from a second download.
 *
 * It is not stored anywhere at either end. It travels as the answer to one
 * question, lives in the reader tab for as long as that tab shows it, and that
 * is the end of it.
 *
 * @typedef {{ url: string, title: string, html: string }} Page
 * @typedef {{ kind: typeof Message.GRAB_PAGE }} GrabPageRequest
 */

/**
 * What a tab says about itself when the popup asks: which site it is, or that
 * it is the reader. The hostname is the whole answer on an ordinary page - it
 * is the key the per-site switch writes, and nothing more about the page
 * travels. The reader answers `reader: true` instead, and the popup hides the
 * switch and the reader button: switching the reader off on the reader means
 * nothing.
 *
 * @typedef {{ hostname: string, reader: boolean }} PageInfo
 * @typedef {{ kind: typeof Message.PAGE_INFO }} PageInfoRequest
 */

/**
 * How much serialized HTML may cross the message boundary. Generous on purpose:
 * a long article with its markup is a few hundred kilobytes, and the pages that
 * blow past this are applications rather than things to read. Refusing early
 * beats a structured clone of several megabytes that ends in an article nobody
 * wanted.
 */
export const MAX_PAGE_HTML = 8_000_000;

/**
 * @template T
 * @param {T} value
 * @returns {Result<T>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * @param {ErrorCodeValue} code
 * @returns {Result<never>}
 */
export function fail(code) {
  return { ok: false, code };
}

/**
 * Narrows what came back from the background. A malformed answer means the
 * background is broken, not the caller, so it becomes `internal` rather than an
 * exception in a content script that has a bubble open.
 *
 * @template T
 * @param {unknown} response
 * @returns {Result<T>}
 */
export function asResult(response) {
  if (typeof response !== "object" || response === null || !("ok" in response)) {
    return fail(ErrorCode.INTERNAL);
  }
  return /** @type {Result<T>} */ (response);
}

/**
 * Narrows the value of a successful translation. `asResult` checks that an
 * answer is an answer; this checks that it is the answer to this question -
 * which matters because a page can be running a content script from before an
 * update while the background is already the new one, and a bubble that throws
 * puts a stack trace in the console of somebody else's page.
 *
 * @param {unknown} value
 * @returns {Translation}
 */
export function asTranslation(value) {
  if (typeof value !== "object" || value === null) return { gloss: "", sentence: null, entries: [] };
  const { gloss, sentence, entries, dictionaries, language } = /** @type {Record<string, unknown>} */ (value);

  const answer = typeof gloss === "string" ? gloss : "";
  // A phrase found to be in another language (D193) comes with no gloss on
  // purpose, and its entries are the answer: the one case an empty first
  // line has something to stand over.
  const foreign = typeof language === "string" && language.length > 0 ? language : "";
  const answered = answer.length > 0 || foreign.length > 0;
  // The sentence is an extra to the gloss, so without a gloss there is nothing
  // for it to be extra to: a bubble with an empty first line and a "More" that
  // has something behind it is a state nobody should have to make sense of.
  const second = answer.length > 0 && typeof sentence === "string" ? sentence : null;

  /** @type {Translation} */
  const translation = { gloss: answer, sentence: second, entries: answered ? asDictEntries(entries) : [] };
  // The count is an extra to the entries the same way (D192), and it is a
  // count or nothing: a value that is not a whole non-negative number says
  // nothing about the dictionaries, so it is left out rather than read as one.
  if (answered && typeof dictionaries === "number" && Number.isInteger(dictionaries) && dictionaries >= 0) {
    translation.dictionaries = dictionaries;
  }
  if (foreign.length > 0) translation.language = foreign;
  return translation;
}

/**
 * Dictionary entries as they can be rendered, or none.
 *
 * Every field is checked rather than trusted, for the same reason as above and
 * one more: these strings started life in a file somebody downloaded, and the
 * gap between "the background sent an array of entries" and "the background is
 * an older version that sent something else" is exactly where a bubble would
 * throw into somebody's page.
 *
 * Exported since D162 for the `look-up` answer, whose entries come through
 * this same door as the translation's always have (`asLookUp` below wraps it
 * since D164, when the answer grew a count).
 *
 * @param {unknown} value
 * @returns {DictEntry[]}
 */
export function asDictEntries(value) {
  if (!Array.isArray(value)) return [];

  /** @type {DictEntry[]} */
  const entries = [];
  for (const one of value) {
    if (typeof one !== "object" || one === null) continue;
    const { dictionary, headword, senses } = /** @type {Record<string, unknown>} */ (one);
    if (!Array.isArray(senses)) continue;

    const lines = senses.filter((line) => typeof line === "string" && line.length > 0);
    if (lines.length === 0) continue;

    entries.push({
      dictionary: typeof dictionary === "string" ? dictionary : "",
      headword: typeof headword === "string" ? headword : "",
      senses: lines,
    });
  }

  return entries;
}

/**
 * The `look-up` answer narrowed the way every answer is (D164): the entries
 * through `asDictEntries`, the count a whole number, the language a name
 * (D191). Anything else - null, an older background's bare list or its answer
 * without a language, a count that is not one - is no answer, and the bubble
 * says nothing rather than something wrong: a "no dictionary" line off a
 * malformed count, or naming a language nobody asked in, would send somebody
 * to the settings for nothing.
 *
 * @param {unknown} value
 * @returns {LookUp | null}
 */
export function asLookUp(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { entries, dictionaries, lang } = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(entries) || typeof dictionaries !== "number") return null;
  if (!Number.isInteger(dictionaries) || dictionaries < 0) return null;
  if (typeof lang !== "string" || lang.length === 0) return null;
  return { entries: asDictEntries(entries), dictionaries, lang };
}

/**
 * A language code as the model registry and the settings spell one: two or
 * three letters, with an underscored script tag when there is one
 * (`zh_hant`) - the shape `pairFromFilename` reads off a file name.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isLanguageCode(value) {
  return typeof value === "string" && /^[a-z]{2,3}(?:_[a-z]{4})?$/.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is number} a moment in epoch milliseconds, or as good as one
 */
function isMoment(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @returns {value is number} a count worth carrying - whole and above zero
 */
function isTally(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * One row of the vocabulary as the backup of everything carries it (D213),
 * narrowed field by field - the shape the file and the wire share, so a
 * file read on the page and a row that reaches the background are one
 * rule. The pair and the phrase must be there; everything else rides along
 * when it is what it says it is and is dropped when it is not: a broken
 * count must not cost the phrase, and a broken phrase costs only its row.
 *
 * @param {unknown} value
 * @returns {RestoreRow | null}
 */
export function asRestoreRow(value) {
  if (typeof value !== "object" || value === null) return null;
  const { langFrom, langTo, text, translations, createdAt, context, recallCount, lastRecallAt, readCount, lastReadAt } =
    /** @type {Record<string, unknown>} */ (value);
  if (!isLanguageCode(langFrom) || !isLanguageCode(langTo)) return null;
  if (typeof text !== "string" || text.length === 0) return null;
  if (!Array.isArray(translations) || !translations.every((one) => typeof one === "string")) return null;
  /** @type {RestoreRow} */
  const row = { langFrom, langTo, text, translations: /** @type {string[]} */ ([...translations]) };
  if (isMoment(createdAt)) row.createdAt = createdAt;
  if (typeof context === "string" && context.length > 0) row.context = context;
  if (isTally(recallCount)) {
    row.recallCount = recallCount;
    if (isMoment(lastRecallAt)) row.lastRecallAt = lastRecallAt;
  }
  if (isTally(readCount)) {
    row.readCount = readCount;
    if (isMoment(lastReadAt)) row.lastReadAt = lastReadAt;
  }
  return row;
}

/**
 * Narrows whatever arrived over `runtime.sendMessage` - which is to say,
 * anything at all - to a request this extension sends.
 *
 * @param {unknown} message
 * @returns {Request | null}
 */
export function asRequest(message) {
  if (typeof message !== "object" || message === null) return null;
  const kind = /** @type {{ kind?: unknown }} */ (message).kind;

  if (kind === Message.OPEN_LIBRARY) return { kind: Message.OPEN_LIBRARY };
  if (kind === Message.OPEN_MARKS) return { kind: Message.OPEN_MARKS };
  if (kind === Message.OPEN_VOCABULARY) {
    // The phrase to look up on arrival (D197) is an extra like the settings'
    // section: kept when it is a string with something in it, dropped
    // otherwise - the page opens on its list, as before.
    const text = /** @type {Record<string, unknown>} */ (message)["text"];
    return typeof text === "string" && text.trim().length > 0
      ? { kind: Message.OPEN_VOCABULARY, text }
      : { kind: Message.OPEN_VOCABULARY };
  }
  if (kind === Message.OPEN_SETTINGS) {
    // The section is an extra like the reader's tab id: kept when it names
    // one the page has, dropped otherwise, never a reason to refuse.
    const section = /** @type {Record<string, unknown>} */ (message)["section"];
    return isSettingsSection(section)
      ? { kind: Message.OPEN_SETTINGS, section }
      : { kind: Message.OPEN_SETTINGS };
  }
  if (kind === Message.LIST_PHRASES) return { kind: Message.LIST_PHRASES };
  if (kind === Message.READ_PAGE) return { kind: Message.READ_PAGE };

  const { text, translations, context, sourceTabId, rows } = /** @type {Record<string, unknown>} */ (message);

  if (kind === Message.OPEN_READER) {
    // A tab id that is not one is dropped rather than refused, for the reason
    // `context` is: it is an extra, and the reader opening without it beats
    // the reader not opening over something nobody can see.
    return typeof sourceTabId === "number"
      ? { kind: Message.OPEN_READER, sourceTabId }
      : { kind: Message.OPEN_READER };
  }

  if (kind === Message.TRANSLATE) {
    if (typeof text !== "string") return null;
    // A context that is not a string is dropped rather than refused: it is an
    // extra the answer does not depend on, and refusing would cost the reader
    // the translation over something they cannot see. The page's declared
    // language (D193) is the same kind of extra, read the way `look-up`
    // reads it: the dictionaries are asked in it second, the engine never.
    /** @type {TranslateRequest} */
    const request = { kind: Message.TRANSLATE, text };
    if (typeof context === "string") request.context = context;
    const lang = /** @type {Record<string, unknown>} */ (message)["lang"];
    if (typeof lang === "string" && lang.length > 0) request.lang = lang;
    return request;
  }

  if (kind === Message.LOOK_UP) {
    if (typeof text !== "string") return null;
    // The page's own language, when it declared one (D165); anything else
    // is "the page said nothing", and the background falls back to the pair.
    const lang = /** @type {Record<string, unknown>} */ (message)["lang"];
    return typeof lang === "string" && lang.length > 0
      ? { kind: Message.LOOK_UP, text, lang }
      : { kind: Message.LOOK_UP, text };
  }

  if (kind === Message.FORGET_PHRASE) {
    if (typeof text !== "string") return null;
    return { kind: Message.FORGET_PHRASE, text };
  }

  if (kind === Message.SAVE_PHRASE) {
    if (typeof text !== "string") return null;
    if (!Array.isArray(translations)) return null;
    if (!translations.every((one) => typeof one === "string")) return null;
    // The sentence (D210) is an extra, read the way `translate` reads its
    // own: a string rides along, anything else is dropped - a save must not
    // fail over the part of it the reader never asked to see.
    /** @type {SavePhraseRequest} */
    const request = { kind: Message.SAVE_PHRASE, text, translations };
    if (typeof context === "string") request.context = context;
    return request;
  }

  if (kind === Message.IMPORT_PHRASES) {
    if (!Array.isArray(rows)) return null;
    // One broken row refuses the message, where `context` would be dropped:
    // the sender is our own page reading a parsed file, a row that is not one
    // means a bug, and importing half a file quietly is the worse outcome.
    /** @type {ImportRow[]} */
    const clean = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) return null;
      const one = /** @type {Record<string, unknown>} */ (row);
      if (typeof one["text"] !== "string") return null;
      if (!Array.isArray(one["translations"])) return null;
      if (!one["translations"].every((meaning) => typeof meaning === "string")) return null;
      /** @type {ImportRow} */
      const sound = { text: one["text"], translations: one["translations"] };
      // The sentence (D212) rides along the way a save's does: a string is
      // kept, anything else dropped - the row itself is sound without it.
      if (typeof one["context"] === "string" && one["context"].length > 0) sound.context = one["context"];
      clean.push(sound);
    }
    return { kind: Message.IMPORT_PHRASES, rows: clean };
  }

  if (kind === Message.RESTORE_VOCABULARY) {
    if (!Array.isArray(rows)) return null;
    // As the TSV import's rows: one broken row refuses the message - the
    // sender is our own page reading a file it parsed by this same rule,
    // and a row that is not one means a bug.
    /** @type {RestoreRow[]} */
    const clean = [];
    for (const row of rows) {
      const one = asRestoreRow(row);
      if (one === null) return null;
      clean.push(one);
    }
    return { kind: Message.RESTORE_VOCABULARY, rows: clean };
  }

  if (kind === Message.COUNT_PHRASES) {
    const { recalled, read, sentences } = /** @type {Record<string, unknown>} */ (message);
    if (!Array.isArray(recalled) || !Array.isArray(read)) return null;
    if (recalled.length > MAX_COUNTED_KEYS || read.length > MAX_COUNTED_KEYS) return null;
    if (!recalled.every((key) => typeof key === "string" && key.length > 0)) return null;
    /** @type {Array<[string, number]>} */
    const occurrences = [];
    for (const pair of read) {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      const [key, count] = pair;
      if (typeof key !== "string" || key.length === 0) return null;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return null;
      occurrences.push([key, count]);
    }
    // The sentences (D216): absent from a page older than the field, and
    // exact like the two lists once present - the sender is our own page,
    // and a pair that is not one means a bug, not a sentence to drop.
    /** @type {Array<[string, string]>} */
    const met = [];
    if (sentences !== undefined) {
      if (!Array.isArray(sentences) || sentences.length > MAX_COUNTED_KEYS) return null;
      for (const pair of sentences) {
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        const [key, sentence] = pair;
        if (typeof key !== "string" || key.length === 0) return null;
        if (typeof sentence !== "string" || sentence.length === 0) return null;
        met.push([key, sentence]);
      }
    }
    return { kind: Message.COUNT_PHRASES, recalled: [...recalled], read: occurrences, sentences: met };
  }

  return null;
}

/**
 * The other direction, and the whole of it. A tab answers exactly two
 * questions - the background's `grab-page` and the popup's `page-info` - and
 * ignores everything else that arrives, including every request above, which
 * is addressed to the background and would otherwise be answered twice by
 * whoever felt like it.
 *
 * @param {unknown} message
 * @returns {GrabPageRequest | PageInfoRequest | null}
 */
export function asPageRequest(message) {
  if (typeof message !== "object" || message === null) return null;
  const kind = /** @type {{ kind?: unknown }} */ (message).kind;
  if (kind === Message.GRAB_PAGE) return { kind: Message.GRAB_PAGE };
  if (kind === Message.PAGE_INFO) return { kind: Message.PAGE_INFO };
  return null;
}

/**
 * A tab's answer about itself, as the popup can use it, or null when there is
 * none to be had. On the wire each side says only its half - a page sends its
 * hostname, the reader sends `reader: true` - and this is where the two become
 * one shape. A page with no hostname to speak of (`file:`, mostly) answers
 * null like a page that never answered: there is no site to switch off, and
 * the popup says so the same way.
 *
 * @param {unknown} value
 * @returns {PageInfo | null}
 */
export function asPageInfo(value) {
  if (typeof value !== "object" || value === null) return null;
  const { hostname, reader } = /** @type {Record<string, unknown>} */ (value);
  if (reader === true) return { hostname: "", reader: true };
  if (typeof hostname !== "string" || hostname.length === 0) return null;
  return { hostname, reader: false };
}

/**
 * Narrows a page as it came off the wire. The reader is about to hand this to
 * an HTML parser and then to Readability, so "it is a string" is the difference
 * between a page that failed to arrive and a stack trace on the reader tab.
 *
 * @param {unknown} value
 * @returns {Page | null}
 */
export function asPage(value) {
  if (typeof value !== "object" || value === null) return null;
  const { url, title, html } = /** @type {Record<string, unknown>} */ (value);
  if (typeof url !== "string" || typeof html !== "string") return null;
  if (html.length === 0) return null;
  // A tab without a title is ordinary; the article's own heading is what the
  // reader shows anyway.
  return { url, title: typeof title === "string" ? title : "", html };
}
