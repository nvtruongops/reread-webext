/**
 * The saved-phrases page: everything kept for the pair being read, with the
 * two acts the bubble offers - Learned and Edit - available in one place
 * instead of wherever the word last appeared.
 *
 * Reads go straight to the vocabulary database, the way the settings page
 * reads the model store: extension pages share the extension's origin, and a
 * read takes no message and changes nothing. Writes still travel through the
 * background (`save-phrase`, `forget-phrase`), because a vocabulary write is
 * two steps - the row, then the mirror - and `background/vocabulary.js` is
 * where that rule is enforced.
 *
 * The pair select is the popup's control by another door: it writes the
 * settings, and this page follows them. The whole extension has one notion of
 * "the pair being read" - a pair private to this page would be a second one,
 * and the messages the buttons send would act on the wrong vocabulary.
 *
 * Freshness rides on `storage.onChanged`: every vocabulary write ends in the
 * mirror, so the mirror doubles as the change signal, and a phrase learned in
 * a bubble on some other tab leaves this list by itself.
 */

import { applyReading } from "../lib/appearance.js";
import { webext } from "../lib/browser.js";
import { clearableField } from "../lib/clear-field.js";
import { CONFIG_KEY, SIZE, TTS_RATE, chosenPair, isFont, isTheme, readConfig, writeConfig } from "../lib/config.js";
import { fileSize, localizePage, plural, t, uiLocale } from "../lib/i18n.js";
import { privateNote } from "../lib/private-note.js";
import { pairLabel } from "../lib/language.js";
import { toMeanings } from "../lib/gloss.js";
import { mountLookupBox } from "../lib/lookup-box.js";
import { editedMeanings } from "../lib/meanings.js";
import { describeError } from "../lib/messages.js";
import { speakerIcon } from "../lib/speaker-icon.js";
import { armBackArrow } from "../lib/back-arrow.js";
import { armFullscreenTool } from "../lib/fullscreen-tool.js";
import { ErrorCode, Message, asResult, fail } from "../lib/protocol.js";
import { BACK_ROAD_KEY, writeVocabTab } from "../lib/session.js";
import { restoreVocabulary } from "../lib/store/backup.js";
import { migrateSemicolonsOnce } from "../lib/store/semicolon-migration.js";
import { MIRROR_KEY } from "../lib/store/mirror.js";
import { countsOf, hasSentence } from "../lib/store/phrase.js";
import { ankiExportFilename, exportFilename, fromTsv, pairFromFilename, toAnkiTsv, toTsv } from "../lib/store/tsv.js";
import { listPairs, listPhrases } from "../lib/store/vocab.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import {
  canSpeak,
  primaryLanguage,
  setSpeechOff,
  speak,
  speaking,
  speechSupported,
  stop as stopSpeaking,
  voicesFor,
} from "../lib/tts.js";
import { filterActive } from "../options/models-view.js";
import {
  Order,
  anyCounted,
  asOrder,
  listView,
  markSegments,
  newestFirst,
  ordered,
  pairChoicesFor,
  sentenceSegments,
} from "./list-view.js";

// First, so the static text is already the catalogue's language when it shows.
localizePage();
// Then the private-browsing sentence, when this page runs in one: what an
// empty list would otherwise say wrongly, said first and in the catalogue's
// words (`private-note.js`).
privateNote();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The colophon's version, from the one place that knows it.
const versionSpan = document.getElementById("version");
if (versionSpan !== null) versionSpan.textContent = webext().runtime.getManifest().version;

/** @typedef {import("../lib/store/phrase.js").Phrase} Phrase */

const brandButton = document.getElementById("brand");
// The bar the header wears: presses inside it (or inside either panel) are
// the panels' own business, the way presses inside the reader's chrome are
// (see the pointerdown below).
const pageBar = document.querySelector(".page-bar");
const displayButton = document.getElementById("display");
const displayPanel = document.getElementById("display-panel");
const sizeValue = document.getElementById("size-value");
const voiceSetting = document.getElementById("voice-setting");
const voiceChoice = /** @type {HTMLSelectElement | null} */ (
  document.getElementById("voice-choice")
);
const rateSetting = document.getElementById("rate-setting");
const rateValue = document.getElementById("rate-value");
const menuButton = document.getElementById("menu");
const menuPanel = document.getElementById("menu-panel");
const panelScrim = document.getElementById("panel-scrim");
const navLibrary = document.getElementById("nav-library");
const navMarks = document.getElementById("nav-marks");
const navSettings = document.getElementById("nav-settings");
const pairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("pair"));
const introLine = document.getElementById("intro");
const countLine = document.getElementById("count");
const exportButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("export"));
const ankiButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("export-anki"));
const importButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("import"));
const importInput = /** @type {HTMLInputElement | null} */ (document.getElementById("import-file"));
const importConfirm = document.getElementById("import-confirm");
const importSummary = document.getElementById("import-summary");
const importSample = document.getElementById("import-sample");
const importSentences = document.getElementById("import-sentences");
const importPairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("import-pair"));
const importRun = /** @type {HTMLButtonElement | null} */ (document.getElementById("import-run"));
const importCancel = /** @type {HTMLButtonElement | null} */ (document.getElementById("import-cancel"));
const transferLine = document.getElementById("transfer-status");
const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById("filter"));
const filterStatus = document.getElementById("filter-status");
const legendLine = document.getElementById("legend");
const orderSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("order"));
const addFold = /** @type {HTMLDetailsElement | null} */ (document.getElementById("add-phrase"));
const lookupHost = document.getElementById("lookup-box");
const listContainer = document.getElementById("list");
const statusLine = document.getElementById("status");
const pager = document.getElementById("pager");
const pageLabel = document.getElementById("page-label");
const prevButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("prev"));
const nextButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("next"));

/** @type {import("../lib/config.js").Config | null} */
let config = null;
/** @type {Phrase[]} newest first */
let phrases = [];
/** @type {ReturnType<typeof pairChoicesFor>} */
let choices = [];
/** Which pair the list on screen belongs to, so a change resets the page. */
let shownPair = "";
let query = "";
let page = 1;
/**
 * The order the list is shown in (D209): the page's own state, like the
 * filter - chosen on the page, starting over with it.
 * @type {import("./list-view.js").OrderValue}
 */
let order = Order.NEWEST;

/**
 * The row being edited, by its key, and the editor's unsaved text. State
 * rather than a DOM node, so that a re-render - a save on another tab, a
 * pressed filter - rebuilds the editor with the draft intact instead of
 * pulling the text out from under the keyboard.
 */
/** @type {string | null} */
let editing = null;
let draft = "";

/**
 * The file waiting for the reader's yes: its name, its rows as parsed, and
 * how many lines were not rows at all. State rather than DOM for the same
 * reason the editor's draft is - a re-render must not eat it.
 */
/** @type {{ name: string, rows: import("../lib/store/tsv.js").TsvRow[], invalid: number } | null} */
let pending = null;

/**
 * What the confirmation's pair select offers, kept so the pressed choice can
 * be looked up the way the header select's is.
 */
/** @type {ReturnType<typeof pairChoicesFor>} */
let importChoices = [];

/** How many rows the confirmation quotes before asking. */
const SAMPLE_ROWS = 3;

/**
 * The row whose phrase is on its way out loud, by its key: pressing that
 * row's speaker again stops it, pressing any other row's simply speaks - the
 * engine replaces what was playing. A key gone stale (the utterance ended on
 * its own) is harmless, because `speaking()` answers for the engine.
 *
 * @type {string | null}
 */
let sounding = null;

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} label
 * @returns {HTMLButtonElement}
 */
function button(label) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  return node;
}

/**
 * Speaks a row's phrase - the phrase as the page had it, never the meanings
 * (D83) - or stops it when it is the one already sounding. The language is
 * the row's own, the voice and the speed are the settings every speaker of
 * this extension reads (`ttsVoices`, `ttsRate`).
 *
 * @param {Phrase} phrase
 */
async function speakPhrase(phrase) {
  if (config === null) return;
  if (speaking() && sounding === phrase.normalized) {
    stopSpeaking();
    sounding = null;
    return;
  }
  sounding = phrase.normalized;
  // The voice is stored under the primary subtag (the rule every speaker of
  // this extension shares), so the row's language is narrowed the same way.
  const spoke = await speak(
    phrase.phrase,
    phrase.langFrom,
    config.ttsVoices[primaryLanguage(phrase.langFrom)],
    config.ttsRate / 100,
  );
  // Refused for want of an offline voice (D155): said in the page's own
  // status line, because a speaker that does nothing says nothing.
  if (!spoke) {
    sounding = null;
    status(t("speech_no_offline_voice"), "error");
  }
}

/**
 * @param {string} text
 * @param {"error"} [tone]
 */
function status(text, tone) {
  if (statusLine === null) return;
  statusLine.textContent = text;
  if (tone === undefined) delete statusLine.dataset["tone"];
  else statusLine.dataset["tone"] = tone;
}

/**
 * The transfer's own status line, under its own buttons: an import report
 * next to the pager would be an answer far from its question.
 *
 * @param {string} text
 * @param {"error"} [tone]
 */
function transferStatus(text, tone) {
  if (transferLine === null) return;
  transferLine.textContent = text;
  if (tone === undefined) delete transferLine.dataset["tone"];
  else transferLine.dataset["tone"] = tone;
}

/**
 * One road for everything the config decides about this page's dress (D104):
 * the paper, the face and size the phrases wear, the panel's own controls,
 * and the voice the rows' speakers use. Fed with what was actually stored
 * rather than with what was asked for - at either end of a scale the honest
 * answer is "it did not move", and the controls should show that (the
 * reader's rule).
 *
 * @param {import("../lib/config.js").Config} fresh
 */
function adoptConfig(fresh) {
  config = fresh;
  // The reading-aloud switch (D148), before anything below asks `canSpeak`:
  // the two voice rows fold with it, a phrase being read falls silent, and
  // the rows' speakers follow on the next draw (the storage listener redraws
  // the list when the answer moved).
  setSpeechOff(fresh.ttsOff);
  if (voiceSetting !== null) voiceSetting.hidden = !canSpeak();
  if (rateSetting !== null) rateSetting.hidden = !canSpeak();
  applyReading(document.documentElement, fresh.reader);
  if (sizeValue !== null) sizeValue.textContent = String(fresh.reader.fontSize);
  if (rateValue !== null) rateValue.textContent = `${(fresh.ttsRate / 100).toFixed(1)}×`;
  for (const button of document.querySelectorAll("[data-theme], [data-font]")) {
    const wanted = button.getAttribute("data-theme") ?? button.getAttribute("data-font");
    const current = button.hasAttribute("data-theme") ? fresh.reader.theme : fresh.reader.font;
    button.setAttribute("aria-pressed", String(wanted === current));
  }
  renderVoiceChoice();
}

/**
 * The voice select in the panel: this device's voices able to read the
 * phrases' language - the pair's source - behind a first line that means
 * "let the browser pick". Redrawn when the settings move and when the
 * engine's list arrives: `getVoices` answers nothing until the browser has
 * loaded the voices, and `voiceschanged` is the only appointment it keeps.
 */
function renderVoiceChoice() {
  if (voiceChoice === null || config === null) return;
  // No pair means no language to list voices for: the select stands on the
  // browser default alone, and the change listener's own guard keeps an
  // empty key out of the map.
  const lang = config.sourceLang ?? "";
  const stored = lang === "" ? undefined : config.ttsVoices[primaryLanguage(lang)];
  const voices = canSpeak() && lang !== "" ? voicesFor(speechSynthesis.getVoices(), lang) : [];

  const fallback = document.createElement("option");
  fallback.value = "";
  fallback.textContent = t("options_tts_default");
  fallback.selected = stored === undefined;

  voiceChoice.replaceChildren(
    fallback,
    ...voices.map((voice) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      // The voice's own name plus its tag: two voices called "English"
      // differ only by where they are from, and the name alone would be a
      // coin toss.
      option.textContent = `${voice.name} (${voice.lang})`;
      option.selected = voice.voiceURI === stored;
      return option;
    }),
  );
}

/**
 * The panel's presses - the reader's handler, minus the rows this page does
 * not carry (measure, links). The steppers read first and step from wherever
 * the setting is now, because another page may have moved it since this one
 * drew itself.
 *
 * @param {Event} event
 */
async function onDisplayPress(event) {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;

  const rate = button.getAttribute("data-rate");
  if (rate !== null) {
    const current = (await readConfig()).ttsRate;
    adoptConfig(await writeConfig({ ttsRate: clamp(current + Number(rate), TTS_RATE) }));
    return;
  }

  const theme = button.getAttribute("data-theme");
  const font = button.getAttribute("data-font");
  const size = button.getAttribute("data-size");

  /** @type {Partial<import("../lib/config.js").ReaderConfig>} */
  let patch = {};
  if (isTheme(theme)) patch = { theme };
  else if (isFont(font)) patch = { font };
  else if (size !== null) {
    const current = (await readConfig()).reader;
    patch = { fontSize: clamp(current.fontSize + Number(size), SIZE) };
  } else return;

  adoptConfig(await writeConfig({ reader: patch }));
}

/**
 * @param {number} value
 * @param {{ min: number, max: number }} range
 * @returns {number}
 */
function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * @param {import("../lib/protocol.js").Request} request
 * @returns {Promise<import("../lib/protocol.js").Result<unknown>>}
 */
async function ask(request) {
  try {
    return asResult(await webext().runtime.sendMessage(request));
  } catch {
    // The background was mid-restart. The press can be repeated.
    return fail(ErrorCode.INTERNAL);
  }
}

async function reload() {
  try {
    const fresh = await readConfig();
    adoptConfig(fresh);
    const chosen = chosenPair(fresh);
    const pair = chosen === null ? "" : `${chosen.from}${chosen.to}`;
    // The fold for a phrase added by hand (D197) stands wherever there is a
    // pair to file it under - the same condition the popup's row keeps.
    if (addFold !== null) addFold.hidden = chosen === null;
    // A different pair is a different list, and page 7 of the old one means
    // nothing on it - and the look-up field's answer was in the old pair's
    // language. Only a pair *changed*: the first draw has no old pair, and a
    // reset there emptied the field the address had just filled (Michał's
    // screenshot, 2026-09-11).
    if (pair !== shownPair) {
      if (shownPair !== "") lookupBox?.reset();
      shownPair = pair;
      page = 1;
    }

    // A vocabulary the browser deleted comes back from its copy before the
    // list is read (`backup.js`) - this page reads the store directly, so it
    // cannot lean on the background having settled it first. What came back
    // the pages learn through the background's mirror, which LIST_PHRASES
    // asks it to rebuild.
    if ((await restoreVocabulary()) > 0) {
      void webext().runtime.sendMessage({ kind: Message.LIST_PHRASES }).catch(() => {});
    }
    // The one-time migrations before the first read (D205), after the
    // restore so what came back is migrated too; after the first run this
    // is one read of a flag. Under the lock the background's start holds
    // while it runs the same, so the list never shows the state before it.
    // Quiet on failure: the list still shows, and the next start tries again.
    await migrateSemicolonsOnce().catch(() => undefined);

    // With no pair chosen there is no current list to show - the page opens
    // on its empty state, and the select below still offers every pair that
    // holds phrases.
    const [saved, list] = await Promise.all([
      listPairs(),
      chosen === null
        ? Promise.resolve([])
        : listPhrases({ langFrom: chosen.from, langTo: chosen.to }),
    ]);
    choices = pairChoicesFor(fresh, saved);
    phrases = newestFirst(list);

    // The phrase being edited can be learned from a bubble on another tab; an
    // editor for a row that no longer exists must not lie in wait for the day
    // the phrase is saved again.
    if (editing !== null && !phrases.some((one) => one.normalized === editing)) {
      editing = null;
      draft = "";
    }

    render();
  } catch {
    status(describeError(ErrorCode.INTERNAL), "error");
  }
}

function render() {
  renderPair();
  renderList();
  // Exporting nothing would download an empty file; the buttons say so first.
  if (exportButton !== null) exportButton.disabled = phrases.length === 0;
  if (ankiButton !== null) ankiButton.disabled = phrases.length === 0;
}

function renderPair() {
  if (pairSelect === null || config === null) return;
  pairSelect.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    // No count in the options: the counter under the title is the one place
    // this page says how much a pair holds, and two numbers for one list
    // drift apart in the eye. (The import offer's select keeps its counts -
    // there they say what a file would land next to.)
    option.textContent = pairLabel(choice.from, choice.to);
    option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
    pairSelect.append(option);
  }
}

/**
 * The one counter, under the title: the whole pair, or "8 of 26" while the
 * filter narrows it down.
 *
 * @param {number} matching
 */
function renderCount(matching) {
  if (countLine === null) return;
  countLine.hidden = phrases.length === 0;
  countLine.textContent =
    query.trim().length > 0
      ? plural(phrases.length, "vocab_count_filtered", [matching.toLocaleString()])
      : plural(phrases.length, "phrases");
}

function renderList() {
  if (listContainer === null) return;

  // Ordered before it is filtered and paged (D209): the page's copy stays
  // newest first, the store's order for an export; the order chosen on the
  // page is the view's alone. The collator speaks the phrases' language.
  const view = listView(ordered(phrases, order, config?.sourceLang ?? ""), { query, page });
  page = view.page;
  // The counter follows every repaint of the list, so a keystroke in the
  // filter and a phrase learned on another tab both keep it true - and so
  // does the filter's state over the list.
  renderCount(view.matching);
  renderFilterStatus(view.matching);

  // A re-render can land mid-keystroke (a save on another tab rebuilds the
  // mirror); the draft survives as state, and the keyboard should too.
  const editorHadFocus =
    document.activeElement instanceof HTMLTextAreaElement &&
    listContainer.contains(document.activeElement);

  listContainer.replaceChildren();

  // A filter that matches nothing leaves the list empty under the state
  // line, which already says "0 of 827 phrases for ..." and offers the way
  // out: a second sentence about it here would be the same thing twice.
  if (phrases.length === 0) {
    listContainer.append(element("p", "empty", t("vocab_empty", t("bubble_save"))));
  } else {
    for (const phrase of view.rows) listContainer.append(phraseRow(phrase));
  }
  // The key to the count glyphs (D211) stands only while a row on this page
  // has a glyph to explain: a page of phrases never checked and never met
  // in a finished text reads as it did before the counts.
  if (legendLine !== null) legendLine.hidden = !anyCounted(view.rows);

  if (editorHadFocus) {
    const editor = listContainer.querySelector("textarea");
    if (editor instanceof HTMLTextAreaElement) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
  }

  renderPager(view);
}

/**
 * @param {{ page: number, pages: number }} view
 */
function renderPager(view) {
  if (pager === null) return;
  pager.hidden = view.pages <= 1;
  if (pageLabel !== null) {
    pageLabel.textContent = t("pager_page_of", [view.page.toLocaleString(), view.pages.toLocaleString()]);
  }
  if (prevButton !== null) prevButton.disabled = view.page <= 1;
  if (nextButton !== null) nextButton.disabled = view.page >= view.pages;
}

/**
 * The filter's matches lit up inside the text with <mark> - built from text
 * nodes, never markup, because the strings come from pages this extension
 * does not trust. With no filter the text goes in whole.
 *
 * @param {HTMLElement} node
 * @param {string} text
 */
function fillHighlighted(node, text) {
  for (const segment of markSegments(text, query)) {
    if (segment.hit) {
      const mark = document.createElement("mark");
      mark.textContent = segment.text;
      node.append(mark);
    } else {
      node.append(segment.text);
    }
  }
}

/**
 * The filter's state over the list it narrows: "1 of 827 phrases for
 * "news"" in the counter's own voice, with "Clear filter" beside it -
 * right where the rows are, because the filter box at the top of the page
 * is off the screen by the time the list is read, and "Show in list" in
 * the fold fills that box unseen. Only while the filter asks anything;
 * otherwise hidden and out of the flow, so nothing under it moves.
 *
 * @param {number} matching how many rows the filter keeps
 */
function renderFilterStatus(matching) {
  if (filterStatus === null) return;
  const asking = filterActive(query);
  filterStatus.hidden = !asking;
  filterStatus.replaceChildren();
  if (!asking) return;
  // The plural family runs over the total, as the counter's does; the
  // matching count and the query ride along as $2 and $3.
  filterStatus.append(
    element("span", "filter-status-text", plural(phrases.length, "vocab_filter_status", [matching.toLocaleString(), query.trim()])),
  );
  const dot = element("span", "filter-status-dot", String.fromCodePoint(0x00b7));
  dot.setAttribute("aria-hidden", "true");
  const clear = button(t("vocab_filter_clear"));
  clear.className = "quiet quiet-clear";
  clear.addEventListener("click", () => clearFilter());
  filterStatus.append(dot, clear);
}

/**
 * The filter emptied from the state line: the whole list is back on its
 * first page, and the page stays where it was scrolled - the filter box at
 * the top is not the place to jump to. The button pressed left with the
 * line, so the focus lands on the list itself, where the eye is.
 */
function clearFilter() {
  query = "";
  page = 1;
  if (filterInput !== null) filterInput.value = "";
  filterClear?.refresh();
  renderList();
  listContainer?.focus({ preventScroll: true });
}

/**
 * @param {Phrase} phrase
 * @returns {HTMLElement}
 */
function phraseRow(phrase) {
  const row = element("div", "phrase-row");
  // How the closed editor finds its row again to hand focus back.
  row.dataset["key"] = phrase.normalized;

  // Three parts in one order on every width (D211): the head - the phrase
  // with its counts beside it - then the body - the meanings with the
  // sentence under them - then the actions. The DOM order is what the
  // keyboard and a screen reader walk: the sentence's fold before the
  // buttons, the buttons last; where the screen puts the actions on the
  // phrase's line is the stylesheet's business.
  const head = element("div", "phrase-head");
  const word = element("span", "phrase-word");
  fillHighlighted(word, phrase.phrase);
  // The day it was kept, on hover: useful now and then, clutter always.
  word.title = new Date(phrase.createdAt).toLocaleDateString(uiLocale());
  head.append(word);

  // The two counts (D209) beside the phrase, each only once it has
  // something to say, and the group only when one has: a phrase never
  // checked and never met in a finished text keeps the row it always had.
  const { recalls, reads } = countsOf(phrase);
  if (recalls > 0 || reads > 0) {
    const counts = element("span", "phrase-counts");
    if (recalls > 0) counts.append(countStat("i-lookup", recalls, plural(recalls, "vocab_recalls")));
    if (reads > 0) counts.append(countStat("i-read", reads, plural(reads, "vocab_reads")));
    head.append(counts);
  }
  row.append(head);

  // The body: the meanings, or the editor in their place - the edit box
  // with its hint here, Save and Cancel in the actions' own slot below, so
  // an unfolded row keeps the shape of a folded one (D211). The attribute
  // is what the sheet lays the unfolded row out by.
  const body = element("div", "phrase-body");
  /** @type {HTMLElement | null} */
  let editActions = null;
  if (editing === phrase.normalized) {
    const unfolded = editorFor(phrase);
    body.append(unfolded.editor);
    editActions = unfolded.actions;
    row.dataset["editing"] = "true";
  } else {
    const meanings = element("span", "phrase-meanings");
    fillHighlighted(meanings, phrase.translations.join("; "));
    body.append(meanings);
  }

  // The sentence the phrase was kept from (D210), when the row has one: a
  // native fold whose summary is the sentence itself - one line with an
  // ellipsis while closed, the whole sentence open - so the list stays a
  // list of phrases and the sentence is a press away, with the keyboard and
  // the screen reader served by the element's own conduct and no script of
  // ours. Text from a page, so text nodes and nothing else; not through
  // `fillHighlighted`, because the filter does not read the sentence and a
  // mark in it would say it did - the one mark here is the phrase's own
  // place in its sentence (D211, `sentenceSegments`), which the sheet shows
  // only once the fold is open. At rest it stands in the body under the
  // meanings; unfolded, it stands after Save and Cancel - the editor is one
  // unit, the box with its hint and the two buttons, and the sentence is
  // the context under it (Michał's screenshot, 2026-09-14: on a phone,
  // with the sentence between the box and the buttons, the buttons read as
  // the row's, not the box's). The DOM says so too, for the keyboard: box,
  // Save, Cancel, then the sentence.
  /** @type {HTMLElement | null} */
  let fold = null;
  if (hasSentence(phrase)) {
    fold = element("details", "phrase-sentence");
    const summary = element("summary", "");
    for (const segment of sentenceSegments(/** @type {string} */ (phrase.context), phrase.phrase)) {
      if (segment.hit) {
        const mark = document.createElement("mark");
        mark.textContent = segment.text;
        summary.append(mark);
      } else {
        summary.append(segment.text);
      }
    }
    fold.append(summary);
  }
  if (editActions === null && fold !== null) body.append(fold);
  row.append(body);

  if (editActions !== null) {
    row.append(editActions);
    if (fold !== null) row.append(fold);
    return row;
  }

  // The buttons speak for themselves to the eye; to a screen reader a bare
  // "Edit" in a list of a hundred names nothing, so each carries its phrase.
  const edit = button(t("bubble_edit"));
  edit.className = "quiet quiet-edit";
  edit.setAttribute("aria-label", t("vocab_edit_aria", phrase.phrase));
  edit.addEventListener("click", () => {
    editing = phrase.normalized;
    draft = phrase.translations.join("\n");
    renderList();
    // The editor replaced the button that had focus; typing is what it is for.
    listContainer?.querySelector("textarea")?.focus();
  });

  const learned = button(t("bubble_learned"));
  learned.className = "quiet quiet-learned";
  learned.setAttribute("aria-label", t("vocab_learned_aria", phrase.phrase));
  learned.addEventListener("click", () => void forget(phrase, learned));

  const actions = element("div", "phrase-actions");
  // The speaker leads the row where the device can speak at all, the bubble's
  // own order (D83): hearing the phrase is about the phrase, not about the
  // vocabulary - the one action here that never writes.
  if (canSpeak()) {
    const speaker = button("");
    speaker.className = "quiet quiet-speak";
    speaker.setAttribute("aria-label", t("vocab_speak_aria", phrase.phrase));
    speaker.title = t("bubble_speak");
    speaker.append(speakerIcon());
    speaker.addEventListener("click", () => void speakPhrase(phrase));
    actions.append(speaker);
  }
  actions.append(edit, learned);
  row.append(actions);
  return row;
}

/**
 * One of the two counts as the row shows it (D211): the glyph with the
 * number after it, and the whole sentence - "Checked 3 times" - as the
 * accessible name and the hover title, so the eye gets a glyph and a
 * number, a screen reader the sentence, and a mouse both. `role="img"`
 * makes the span one thing to assistive tech: the glyph is decoration
 * inside it and the digits are not read twice. The legend over the list is
 * what says the same to a finger, which has no hover.
 *
 * @param {"i-lookup" | "i-read"} glyph the symbol's id in the page's sprite
 * @param {number} count
 * @param {string} said the count as the catalogue's sentence
 * @returns {HTMLElement}
 */
function countStat(glyph, count, said) {
  const stat = element("span", "phrase-count");
  stat.setAttribute("role", "img");
  stat.setAttribute("aria-label", said);
  stat.title = said;
  stat.append(countIcon(glyph), count.toLocaleString());
  return stat;
}

/**
 * A count's glyph: a reference into the sprite the page carries (one
 * drawing per symbol, `<use>` in every row), sized by the sheet to the
 * counts' own em. Decoration - the stat's label carries the words.
 *
 * @param {"i-lookup" | "i-read"} glyph
 * @returns {SVGSVGElement}
 */
function countIcon(glyph) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "phrase-count-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#${glyph}`);
  svg.append(use);
  return svg;
}

/**
 * The row, unfolded: the meanings as lines in a textarea, the bubble's editor
 * by other means - Enter keeps, Shift+Enter adds a line, Escape backs out,
 * and there is nothing to keep when no line has anything on it. The same
 * rule as the bubble's at the save (D203, `editedMeanings`): a line the box
 * opened with stays as it is, a line written or changed is split at its
 * semicolons - and the same one line under the box says so. Two pieces for
 * two places in the row (D211): the box with its hint for the body, Save
 * and Cancel for the slot the row's quiet actions stood in.
 *
 * @param {Phrase} phrase
 * @returns {{ editor: HTMLElement, actions: HTMLElement }}
 */
function editorFor(phrase) {
  const wrap = element("div", "phrase-edit");

  const editor = document.createElement("textarea");
  editor.value = draft;
  editor.rows = Math.max(2, draft.split("\n").length);

  const save = button(t("bubble_save"));
  const cancel = button(t("action_cancel"));

  const empty = () => editor.value.split("\n").every((line) => line.trim().length === 0);

  save.disabled = empty();
  editor.addEventListener("input", () => {
    draft = editor.value;
    save.disabled = empty();
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!save.disabled) void saveEdit(phrase);
    }
    if (event.key === "Escape") closeEditor();
  });

  save.addEventListener("click", () => void saveEdit(phrase));
  cancel.addEventListener("click", () => closeEditor());

  const actions = element("div", "phrase-actions");
  actions.append(save, cancel);
  wrap.append(editor, element("p", "phrase-edit-hint", t("bubble_edit_separator_hint")));
  return { editor: wrap, actions };
}

/**
 * Hands focus back to a row's Edit button - the one that opened the editor -
 * after the editor holding it left the DOM: Escape, Cancel and Save all
 * remove the textarea under the keyboard, and without this the focus falls
 * to the body.
 *
 * @param {string} key the row's normalized phrase
 */
function refocusRow(key) {
  if (listContainer === null) return;
  for (const row of listContainer.querySelectorAll(".phrase-row")) {
    if (row instanceof HTMLElement && row.dataset["key"] === key) {
      const edit = row.querySelector("button.quiet-edit");
      if (edit instanceof HTMLButtonElement) edit.focus();
      return;
    }
  }
}

function closeEditor() {
  const closed = editing;
  editing = null;
  draft = "";
  renderList();
  if (closed !== null) refocusRow(closed);
}

/**
 * Removes the phrase the moment the button is pressed - no dialog, no undo:
 * a slip is repaired by selecting the phrase while reading, the ordinary
 * save path.
 *
 * @param {Phrase} phrase
 * @param {HTMLButtonElement} trigger the row's own Learned button
 */
async function forget(phrase, trigger) {
  // The pressed button is about to leave the DOM, and focus would fall to
  // the body. Its place in the list, counted first, names the successor:
  // the next row's Learned, the previous one's after the last row, the
  // filter once the list is empty.
  const learnedButtons = () =>
    listContainer === null ? [] : [...listContainer.querySelectorAll("button.quiet-learned")];
  const at = learnedButtons().indexOf(trigger);

  const answer = await ask({ kind: Message.FORGET_PHRASE, text: phrase.phrase });
  if (!answer.ok) {
    status(describeError(answer.code), "error");
    return;
  }
  status("");
  // The mirror event lands too; reloading here as well makes the row's
  // disappearance a consequence of the answer, not of an event arriving.
  await reload();

  if (at === -1) return;
  const successor = learnedButtons()[Math.min(at, learnedButtons().length - 1)];
  if (successor instanceof HTMLButtonElement) successor.focus();
  else filterInput?.focus();
}

/**
 * @param {Phrase} phrase
 */
async function saveEdit(phrase) {
  const translations = editedMeanings(phrase.translations, toMeanings(draft));
  if (translations.length === 0) return;

  const answer = await ask({ kind: Message.SAVE_PHRASE, text: phrase.phrase, translations });
  if (!answer.ok) {
    // The editor stays open with the draft: an error must not eat the text.
    status(describeError(answer.code), "error");
    return;
  }
  status("");
  editing = null;
  draft = "";
  await reload();
  // Editing keeps the row's place (the store keeps id and createdAt), so
  // the button focus returns to is where the eye already is.
  refocusRow(phrase.normalized);
}

/**
 * The whole pair as a file - fresh from the database rather than from the
 * page's copy, because the copy is newest first and an export is the
 * vocabulary, not the view: oldest first, the order that keeps two exports
 * diffable. Downloading is a blob and an anchor; no permission asks for less.
 *
 * Two files from one button row (D210): the sister plugin's two columns,
 * which travel back in through Import, and the three-column file for Anki
 * with the sentence each phrase was kept from - its own name, so the two
 * never overwrite each other in a downloads folder.
 *
 * @param {"plugin" | "anki"} shape which of the two files to write
 */
async function exportPhrases(shape) {
  if (config === null) return;
  // The export is "the whole current pair as a file"; with no pair chosen
  // the button has nothing to name - and the list above it is empty anyway.
  const chosen = chosenPair(config);
  if (chosen === null) return;
  const pair = { langFrom: chosen.from, langTo: chosen.to };
  try {
    const list = await listPhrases(pair);
    if (list.length === 0) return;
    const name = shape === "anki" ? ankiExportFilename(pair) : exportFilename(pair);
    const text = shape === "anki" ? toAnkiTsv(list) : toTsv(list);
    const blob = new Blob([text], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    // The URL has to outlive the click long enough for the download to take
    // it. A minute is comfortably that, and then the blob can go.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    // The export says what it wrote (D153): a download is a quiet thing, and
    // a press nobody meant would otherwise go unnoticed - the name, the count
    // and the size, in the section's own status line, the reading list's way.
    transferStatus(plural(list.length, "vocab_export_done", [name, fileSize(blob.size)]));
  } catch {
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * @param {File} file
 */
async function offerImport(file) {
  try {
    const parsed = fromTsv(await file.text());
    if (parsed.rows.length === 0) {
      pending = null;
      renderImportOffer();
      transferStatus(t("vocab_import_nothing"), "error");
      return;
    }
    pending = { name: file.name, rows: parsed.rows, invalid: parsed.invalid };
    transferStatus("");
    renderImportOffer();
  } catch {
    pending = null;
    renderImportOffer();
    transferStatus(describeError(ErrorCode.INTERNAL), "error");
  }
}

/**
 * The moment of consent: what the file holds and where it would go, before
 * anything is written.
 */
function renderImportOffer() {
  if (importConfirm === null) return;
  importConfirm.hidden = pending === null;
  if (pending === null) return;

  if (importSummary !== null) {
    importSummary.textContent = plural(pending.rows.length, "vocab_import_summary", [pending.name]);
  }

  // How many rows bring a sentence (D212), said before the yes: a sentence
  // is the one thing an import may add to a phrase already saved, and the
  // line says under what rule.
  if (importSentences !== null) {
    const withSentence = pending.rows.filter((row) => row.context !== undefined).length;
    importSentences.hidden = withSentence === 0;
    importSentences.textContent = withSentence === 0 ? "" : plural(withSentence, "vocab_import_with_sentence");
  }

  if (importSample !== null) {
    importSample.replaceChildren();
    for (const row of pending.rows.slice(0, SAMPLE_ROWS)) {
      const item = document.createElement("li");
      item.textContent = `${row.text} → ${row.translations.join("; ")}`;
      importSample.append(item);
    }
  }

  renderImportPair();
}

/**
 * The pair select starts on what the file's name says when it says anything,
 * and on the pair being shown when it does not - a guess is fine as a
 * starting point and never as a decision. A named pair with nothing saved
 * yet is offered too: vocabulary may arrive before its model does.
 */
function renderImportPair() {
  if (importPairSelect === null || config === null || pending === null) return;

  const named = pairFromFilename(pending.name);
  importChoices = [...choices];
  if (named !== null && !importChoices.some((one) => one.from === named.langFrom && one.to === named.langTo)) {
    importChoices.unshift({
      pair: `${named.langFrom}${named.langTo}`,
      from: named.langFrom,
      to: named.langTo,
      count: 0,
    });
  }

  // The file's own pair first; then the pair being read; with neither, the
  // empty key matches nothing and the select opens on its first row.
  const chosen = chosenPair(config);
  const preferred =
    named !== null
      ? `${named.langFrom}${named.langTo}`
      : chosen !== null
        ? `${chosen.from}${chosen.to}`
        : "";

  importPairSelect.replaceChildren();
  for (const choice of importChoices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    option.textContent =
      choice.count > 0
        ? `${pairLabel(choice.from, choice.to)} (${choice.count.toLocaleString()})`
        : pairLabel(choice.from, choice.to);
    option.selected = choice.pair === preferred;
    importPairSelect.append(option);
  }
}

function closeImportOffer() {
  pending = null;
  renderImportOffer();
}

async function runImport() {
  if (pending === null || importRun === null || importPairSelect === null) return;
  const choice = importChoices.find((one) => one.pair === importPairSelect.value);
  if (choice === undefined) return;

  importRun.disabled = true;
  try {
    // The same global switch the select at the top makes, committed by this
    // press: the import goes to the configured pair, like every message this
    // page sends, and the page follows the configuration to the result.
    if (config === null || config.sourceLang !== choice.from || config.targetLang !== choice.to) {
      await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
    }

    const offered = pending;
    const answer = await ask({ kind: Message.IMPORT_PHRASES, rows: offered.rows });
    if (!answer.ok) {
      // The offer stays open: an error must not eat the file the reader
      // already picked and read.
      transferStatus(describeError(answer.code), "error");
      return;
    }

    const report = /** @type {import("../lib/protocol.js").ImportReport} */ (answer.value);
    const unreadable = report.invalid + offered.invalid;
    const sentences = [plural(report.added, "vocab_import_added")];
    if (report.skipped > 0) sentences.push(plural(report.skipped, "vocab_import_skipped"));
    if (report.sentenced > 0) sentences.push(plural(report.sentenced, "vocab_import_sentenced"));
    if (unreadable > 0) sentences.push(plural(unreadable, "vocab_import_unreadable"));
    transferStatus(sentences.join(" "));

    closeImportOffer();
    await reload();
  } finally {
    importRun.disabled = false;
  }
}

// The mark at the top is the door to the settings, the same one the reader's
// bar carries, and since D147 it goes the way the reader's does: through
// the background, which raises the settings tab if one stands and turns
// this tab to the settings otherwise - a walk in place, with this page one
// Back away. The marker in this tab's own `sessionStorage` is what tells
// the settings page so (D140): it wears its arrow, and the arrow pops the
// entry the system's back gesture pops. Turned or not, the marker stays
// true: it is read only by a settings page that arrives in this tab, and
// one that arrives here always has this page behind it. A background
// mid-restart answers nothing; then the walk is made here, as it was.
/**
 * @param {import("../lib/protocol.js").SettingsSection} [section] where on
 *   the settings page to land (D192): the look-up field's "settings" word
 *   opens them at the dictionaries
 */
function goToSettings(section) {
  try {
    sessionStorage.setItem(BACK_ROAD_KEY, "vocab");
  } catch {
    // The arrow is an enhancement; the walk works without it.
  }
  const landing = section === undefined ? "" : `#${section}`;
  void webext()
    .runtime.sendMessage(
      section === undefined
        ? { kind: Message.OPEN_SETTINGS }
        : { kind: Message.OPEN_SETTINGS, section },
    )
    .catch(() => location.assign(webext().runtime.getURL(`options/options.html${landing}`)));
}

/**
 * "Show in list" under the field's answer: the saved phrase's own row
 * brought into view, where Edit and Learned are. The filter is set to the
 * phrase - which also walks past the pages, so a phrase on page three is on
 * page one of the narrowed list - and the page is scrolled to the filter's
 * state line over the list, so that the sentence about the filter and the
 * phrase's row are on the screen together, with the way out of the filter
 * under the keyboard's focus: Enter undoes the side effect at once. The
 * fold stays open above. No smooth scrolling: on e-ink an animated scroll
 * is a run of flashes.
 *
 * @param {{ text: string, normalized: string }} phrase
 */
function showInList(phrase) {
  query = phrase.text;
  page = 1;
  if (filterInput !== null) filterInput.value = phrase.text;
  filterClear?.refresh();
  renderList();
  if (filterStatus === null) return;
  filterStatus.scrollIntoView({ block: "start" });
  const clear = filterStatus.querySelector("button");
  if (clear instanceof HTMLButtonElement) clear.focus({ preventScroll: true });
}

/**
 * The look-up field (D197) behind the "Add a phrase" fold: the background
 * asked the way the rows ask it, the phrase's standing read off the list
 * this page already holds (fresh through the mirror, like the rows), the
 * pair's voice for its speaker, and the list under the fold as the place
 * "Show in list" points at. The fold opening puts the caret in the field:
 * opening it is what somebody does to type.
 */
const lookupBox =
  lookupHost === null
    ? null
    : mountLookupBox(
        { form: lookupHost, answer: lookupHost },
        {
          ask,
          savedMeanings: (normalized) =>
            Promise.resolve(phrases.find((one) => one.normalized === normalized)?.translations ?? []),
          openDictionaries: () => goToSettings("dictionaries"),
          showInList,
          voice: () => {
            const lang = config?.sourceLang ?? null;
            if (config === null || lang === null) return null;
            return {
              lang,
              voiceURI: config.ttsVoices[primaryLanguage(lang)],
              rate: config.ttsRate / 100,
            };
          },
        },
      );

addFold?.addEventListener("toggle", () => {
  if (addFold.open) lookupBox?.focus();
});

/**
 * A phrase handed over in the address (D197): the popup's look-up field
 * only reads, and its door opens this page with `#lookup=<phrase>` - on a
 * fresh tab as the page loads, on an open one as the tab is turned to the
 * fragment (`hashchange`, the same document). The fold opens, the field is
 * asked, and the fragment is taken off the address: a reload should show
 * the list, not ask the word again. The phrase arrives as typed, encoded by
 * the background; anything that is not that shape is no phrase.
 */
function arriveWithPhrase() {
  const match = /^#lookup=(.*)$/.exec(location.hash);
  if (match === null) return;
  /** @type {string} */
  let text;
  try {
    text = decodeURIComponent(String(match[1]));
  } catch {
    return;
  }
  history.replaceState(history.state, "", location.pathname + location.search);
  if (text.trim().length === 0 || addFold === null || lookupBox === null) return;
  // The list narrowed to the phrase as well (the fourth brief): the row
  // the ticks below make - or the one that is there - stands right under
  // the panel, and the state line over the list says which filter is on.
  query = text;
  page = 1;
  if (filterInput !== null) filterInput.value = text;
  filterClear?.refresh();
  renderList();
  addFold.open = true;
  void lookupBox.search(text);
}

window.addEventListener("hashchange", arriveWithPhrase);

brandButton?.addEventListener("click", () => goToSettings());

// The way back to the reading (D141/D142): walked here from the reader, the
// arrow pops the same history entry as the system's back gesture; raised
// here from the popup or the settings menu with the reading standing in
// another tab, it brings that tab forward. The three states and their order
// live in `lib/back-arrow.js`, shared with the settings page.
armBackArrow();

// The bar's full-screen tool (D195; every page since D220): the reader
// bar's own, in `lib/fullscreen-tool.js` - where the browser has a full
// screen to give and the row has room, with the open panel put away before
// the screen changes.
armFullscreenTool(document.getElementById("fullscreen"), closePanels);

// The phrases-tab bookkeeping, the reader's exactly (D139/D140, applied here
// by D141): this tab is the one phrases tab for as long as the phrases are
// what it shows - signed in on every arrival (`pageshow`, the back/forward
// cache included), signed out on every way out (`pagehide`). A walked-to
// page announces itself the same way, so the popup's press raises this tab
// instead of opening a copy beside it; a write the browser drops is caught
// by the witness in `vocab-tab.js`.
window.addEventListener("pageshow", () => {
  void webext()
    .tabs.getCurrent()
    .then((tab) => (typeof tab?.id === "number" ? writeVocabTab(tab.id) : undefined))
    .catch(() => undefined);
});
window.addEventListener("pagehide", () => {
  void writeVocabTab(null).catch(() => undefined);
});

/**
 * The bar's two disclosure buttons and their panels, the reader's rule: one
 * panel at a time, so the header never stands two panels tall.
 *
 * @param {HTMLElement | null} button
 * @param {HTMLElement | null} panel
 * @param {boolean} open
 */
function setPanel(button, panel, open) {
  if (button === null || panel === null) return;
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  // The page dims under whichever panel is open, and clears with the last.
  // The chrome needs no holding meanwhile: it is stuck to the window's top
  // (D219, `.page-chrome` in page.css).
  if (panelScrim !== null) panelScrim.hidden = !anyPanelOpen();
}

displayButton?.addEventListener("click", () => {
  const opening = displayPanel?.hidden === true;
  setPanel(menuButton, menuPanel, false);
  setPanel(displayButton, displayPanel, opening);
});

// The menu behind the bar's drawn button - the reader's, minus the row for
// this page (D93).
menuButton?.addEventListener("click", () => {
  const opening = menuPanel?.hidden === true;
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, opening);
});

function anyPanelOpen() {
  return displayPanel?.hidden === false || menuPanel?.hidden === false;
}

// Every menu row leaves this tab standing, so each one also puts the panels
// away - coming back must not find the hallway still open.
function closePanels() {
  setPanel(displayButton, displayPanel, false);
  setPanel(menuButton, menuPanel, false);
}

displayPanel?.addEventListener("click", (event) => void onDisplayPress(event));

// The voice for the phrases' language, the same stored choice the reader's
// panel writes: the patch replaces the whole map (config.js's rule), and the
// first line means "no stored choice" - the engine's default for the language.
voiceChoice?.addEventListener("change", () => {
  if (voiceChoice === null || config === null) return;
  const key = primaryLanguage(config.sourceLang ?? "");
  if (key === "") return;
  const map = { ...config.ttsVoices };
  if (voiceChoice.value === "") delete map[key];
  else map[key] = voiceChoice.value;
  void writeConfig({ ttsVoices: map }).then(adoptConfig);
});

// The engine's voice list arrives on its own schedule - after first paint on
// most platforms, never at all on some (Android speaks anyway, see
// lib/tts.js). The bare API question, not `canSpeak`: the listener watches
// the engine, and the voice rows follow the settings (`adoptConfig`).
if (speechSupported()) speechSynthesis.addEventListener("voiceschanged", renderVoiceChoice);

// The reading-list row goes through the background exactly as the popup's
// does: `openLibrary` points the reader at nothing and raises its one tab
// (`reader-tab.js`) - or, when no reader stands anywhere, turns this very
// tab into one (D147), the list one Back away from these phrases. A
// rejection means the background was mid-restart - the press can be
// repeated; the popup's rows make the same bargain.
navLibrary?.addEventListener("click", () => {
  closePanels();
  void webext()
    .runtime.sendMessage({ kind: Message.OPEN_LIBRARY })
    .catch(() => undefined);
});

// The highlights row goes the reading list's way: the same one reader tab,
// turned to the highlights page by the message - this tab, if no reader
// stands.
navMarks?.addEventListener("click", () => {
  closePanels();
  void webext()
    .runtime.sendMessage({ kind: Message.OPEN_MARKS })
    .catch(() => undefined);
});

// The settings row is the mark's press with a word on it.
navSettings?.addEventListener("click", () => {
  closePanels();
  goToSettings();
});

// An open panel yields to the page underneath, exactly as the reader's panels
// do (Michał's report, 2026-08-16): a press anywhere but the bar and the
// panels puts them away, and Escape does the same from the keyboard - handing
// focus back to the button whose panel held it. Presses inside the bar and
// the panels are their own business, the reader's rule for its chrome: the
// toggles' click handlers decide.
document.addEventListener("pointerdown", (event) => {
  if (!anyPanelOpen()) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (
    pageBar?.contains(target) === true ||
    displayPanel?.contains(target) === true ||
    menuPanel?.contains(target) === true
  ) {
    return;
  }
  closePanels();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !anyPanelOpen()) return;
  const focus = document.activeElement;
  if (focus instanceof Node && displayPanel?.contains(focus) === true) displayButton?.focus();
  else if (focus instanceof Node && menuPanel?.contains(focus) === true) menuButton?.focus();
  closePanels();
});

pairSelect?.addEventListener("change", () => {
  if (pairSelect === null) return;
  const choice = choices.find((one) => one.pair === pairSelect.value);
  if (choice === undefined) return;
  // The same write the popup makes. The storage listener below is the render
  // path, so switching here and switching there repaint this page the same way.
  void writeConfig({ sourceLang: choice.from, targetLang: choice.to });
});

exportButton?.addEventListener("click", () => void exportPhrases("plugin"));
ankiButton?.addEventListener("click", () => void exportPhrases("anki"));

importButton?.addEventListener("click", () => importInput?.click());

importInput?.addEventListener("change", () => {
  if (importInput === null) return;
  const file = importInput.files?.[0];
  // Cleared so that the same file, picked again, fires this again.
  importInput.value = "";
  if (file !== undefined) void offerImport(file);
});

importRun?.addEventListener("click", () => void runImport());

importCancel?.addEventListener("click", () => {
  closeImportOffer();
  transferStatus("");
});

// A new order starts the list over at its first page (D209): the page that
// was open belonged to the old order.
orderSelect?.addEventListener("change", () => {
  order = asOrder(orderSelect.value);
  page = 1;
  renderList();
});

filterInput?.addEventListener("input", () => {
  if (filterInput === null) return;
  query = filterInput.value;
  page = 1;
  renderList();
});

/**
 * The filter's cross, the look-up field's own (`clear-field.js`): a press
 * empties the filter, puts the whole list back on page one and keeps the
 * caret in the filter for the next word - the same effect as "Clear
 * filter" in the state line over the list, from the field itself.
 */
const filterClear =
  filterInput === null
    ? null
    : clearableField(filterInput, {
        label: t("vocab_filter_clear"),
        onClear: () => {
          query = "";
          page = 1;
          renderList();
        },
      });

prevButton?.addEventListener("click", () => {
  page -= 1;
  renderList();
});

nextButton?.addEventListener("click", () => {
  page += 1;
  renderList();
});

webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // The mirror is how a vocabulary write anywhere - a bubble on some tab,
  // this page itself - announces itself: the list is stale, reload it.
  if (changes[MIRROR_KEY] !== undefined) {
    void reload();
    return;
  }
  if (changes[CONFIG_KEY] === undefined) return;
  // The config carries the pair and the dress. A change that kept the pair
  // only dressed the page - the rows stand as they are, which on e-ink is
  // the difference between nothing and a flash per stepper press.
  void readConfig().then((fresh) => {
    const pair = `${fresh.sourceLang}${fresh.targetLang}`;
    const spoke = canSpeak();
    adoptConfig(fresh);
    if (pair !== shownPair) void reload();
    // The rows draw their speakers as they are made: the reading-aloud switch
    // moving (D148) is the one dress change worth a redraw.
    else if (spoke !== canSpeak()) renderList();
  });
});

// The intro quotes the bubble's own button labels, so the two can never drift
// apart - which is also why it cannot be a `data-i18n` swap.
const intro = t("vocab_intro", [t("bubble_learned"), t("bubble_edit")]);
if (introLine !== null && intro.length > 0) introLine.textContent = intro;

// The phrase the address brought is looked up once the list is in: the
// field reads the phrase's standing off that list, and asked before the
// first draw it read an empty one.
void reload().then(arriveWithPhrase);
