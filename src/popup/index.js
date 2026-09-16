/**
 * The toolbar popup: the basic acts on top, the door to the settings at the
 * bottom, in the place every user already looks for them. Whether re/read
 * runs on this site, this page in the reader, which pair is being read, a
 * word to look up (D197), the extension's own rooms, then the two reading
 * preferences somebody flips depending on what is read - reader-only mode
 * (D111) and translation itself (D128) - the settings, and nothing else.
 *
 * The order is the popup's one rule: from what is pressed daily down to what
 * is flipped seldom. Which rows stand at all is `rows.js`, because a fresh
 * install and the translation-off setting each take some of them away.
 *
 * The popup knows which tab it stands over and nothing more: `tabs.query`
 * without the `tabs` permission answers with an id and no address, on purpose.
 * The address never becomes its business either - it asks the tab itself
 * (`page-info`), and the content script that is already on every ordinary page
 * answers with its hostname. No answer means a page this extension does not
 * run on (`about:`, the add-ons site, the PDF viewer), and the row says so
 * instead of showing a switch; the reader answers "I am the reader", and the
 * switch and the reader button disappear together, because neither means
 * anything there.
 *
 * The switch and the pair are both one write to the settings, the same write
 * the settings page makes. Every open tab reacts through `storage.onChanged` -
 * the toggle tears the page's reading side down or starts it, with no reload
 * and no message addressed to anybody.
 */

import { followTheme } from "../lib/appearance.js";
import { webext } from "../lib/browser.js";
import { chosenPair, effectiveReaderOnly, platformOs, readConfig, writeConfig } from "../lib/config.js";
import { localizePage, t } from "../lib/i18n.js";
import { pairLabel } from "../lib/language.js";
import { mountLookupBox } from "../lib/lookup-box.js";
import { isSwitchedOff, sameSite, siteOf } from "../lib/site.js";
import { dresser } from "../lib/user-css.js";
import { listDictionaries } from "../lib/dict/store.js";
import { listModels } from "../lib/models/store.js";
import { ErrorCode, Message, asPageInfo, asResult, fail } from "../lib/protocol.js";
import { MIRROR_KEY, asMirror, mirrorMatches } from "../lib/store/mirror.js";
import { watchToolbarScheme } from "../lib/theme-icon.js";
import { primaryLanguage, setSpeechOff } from "../lib/tts.js";
import { pairChoices } from "./choices.js";
import { lookupRowStands, popupRows, siteRowStands } from "./rows.js";
import { ensurePreloaded } from "../lib/preload.js";

// First, so the rows are already in the catalogue's language when they show.
localizePage();
// The toolbar icon follows the browser's scheme where the manifest cannot
// say so (Chromium, no theme_icons there) - a no-op on Firefox.
watchToolbarScheme();
// The paper follows the theme the Aa panels write (D104): a popup opened over
// a sepia article is part of the same room.
followTheme();
// The reader's own rules (D176) dress this window too, read with the rest of
// the config below: a popup is opened fresh every time, so once is every time.
const dressPopup = dresser(document);

const siteRow = document.getElementById("site-row");
const siteLabel = document.getElementById("site-label");
const siteNote = document.getElementById("site-note");
const siteToggle = /** @type {HTMLInputElement | null} */ (document.getElementById("site-toggle"));
const pairRow = document.getElementById("pair-row");
const setupRow = document.getElementById("setup-row");
const pairSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById("pair"));
const readerButton = document.getElementById("open-reader");
const lookupHead = document.getElementById("lookup-head");
const lookupForm = document.getElementById("lookup-form");
const lookupAnswer = document.getElementById("lookup-answer");
const lookupBack = document.getElementById("lookup-back");
const lookupDoor = document.getElementById("lookup-door");
const libraryButton = document.getElementById("open-library");
const marksButton = document.getElementById("open-marks");
const vocabularyButton = document.getElementById("open-vocabulary");
const settingsButton = document.getElementById("open-settings");
const supportButton = document.getElementById("open-support");

/**
 * The one outward address in the popup - the foundation's support page, the
 * same one the README and the settings' Support section name. Navigation on
 * a press, never a request the extension makes itself.
 */
const SUPPORT_URL = "https://reapps.eu/#support";
const readerOnlyToggle = /** @type {HTMLInputElement | null} */ (
  document.getElementById("reader-only")
);
const translationToggle = /** @type {HTMLInputElement | null} */ (
  document.getElementById("no-translation")
);

/** The tab under the popup, and what it said about itself. */
/** @type {{ tabId: number | null, hostname: string | null }} */
const over = { tabId: null, hostname: null };

/**
 * Whether the site row may stand at all (`rows.js`, D149): written by
 * `showRows`, read by `renderSite`, because the page answers which site this
 * is after the rows have been decided.
 */
let siteStands = true;

/** @type {import("./choices.js").PairChoice[]} */
let choices = [];

/**
 * The settings as last read, for the look-up field: which language it reads
 * aloud in and which pair's copy of the vocabulary it consults. Written by
 * every read and write the popup makes, so the field never asks storage for
 * what the popup already knows.
 *
 * @type {import("../lib/config.js").Config | null}
 */
let settings = null;

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

/**
 * What a phrase means now, from the copy of the vocabulary the pages read
 * (`mirror.js`): one storage read, no background woken - the same copy every
 * page consults before it underlines anything. A copy of another pair, or
 * none, answers "not saved", which is the truth about this pair.
 *
 * @param {string} normalized
 * @returns {Promise<string[]>}
 */
async function savedMeanings(normalized) {
  if (settings === null) return [];
  const stored = await webext().storage.local.get(MIRROR_KEY);
  const mirror = asMirror(stored[MIRROR_KEY]);
  if (mirror === null || !mirrorMatches(mirror, settings)) return [];
  return mirror.entries.find(([key]) => key === normalized)?.[1] ?? [];
}

/**
 * The phrase the look-up field is showing, for the door under the answer:
 * the saved-phrases page opens with it already looked up.
 *
 * @type {{ text: string, normalized: string } | null}
 */
let lookedUp = null;

/**
 * The popup in its results mode or back in its hallway (D197): once the
 * field has answered, every other row leaves and the answer takes the popup
 * under the stuck field - the rows below a long entry meant nothing while it
 * was read, and the popup scrolled as one. The stylesheet reads the mode
 * off the body; the arrow in the field's row brings the hallway back, the
 * word kept in the field.
 *
 * @param {boolean} results
 */
function showResults(results) {
  if (results) document.body.dataset["mode"] = "lookup";
  else delete document.body.dataset["mode"];
}

/**
 * What the field is showing, landed in the popup's own two pieces: the mode,
 * and the door to the saved-phrases page under the answer - "Add to saved
 * phrases" for a phrase not saved yet, "Open in saved phrases" for one that
 * is - shown once the dictionaries have answered.
 *
 * @param {import("../lib/lookup-box.js").LookupState} state
 */
function onLookupState(state) {
  lookedUp = state.phrase;
  // An answer turns the popup into its results mode; the answer taken down
  // (the field emptied by its own "x") brings the hallway back.
  showResults(state.phrase !== null);
  if (lookupDoor === null) return;
  lookupDoor.hidden = state.phrase === null || state.pending;
  lookupDoor.textContent = state.saved ? t("popup_lookup_open") : t("popup_lookup_add");
}

/**
 * The look-up field (D197), built before anything is awaited so it stands
 * in the first frame with the rest of the rows. The word "settings" in its
 * line about a missing dictionary opens the settings at the dictionaries,
 * the bubble's own door (D192), and closes the popup the way every room's
 * row does. Read-only here (`readOnly`): the field's one act is the door
 * below it, to the page where a press on a meaning saves. And no "Show all"
 * fold (`foldAt: null`, D207): the answer scrolls in a box of its own with
 * nothing under it but the door, so every line of a book stands open, as
 * in the bubble - the phrases page keeps the fold for the list under its
 * panel.
 */
const lookupBox =
  lookupForm === null || lookupAnswer === null
    ? null
    : mountLookupBox(
        { form: lookupForm, answer: lookupAnswer },
        {
          ask,
          savedMeanings,
          openDictionaries: () => {
            void ask({ kind: Message.OPEN_SETTINGS, section: "dictionaries" });
            window.close();
          },
          voice: () => {
            const lang = settings?.sourceLang ?? null;
            if (settings === null || lang === null) return null;
            return {
              lang,
              voiceURI: settings.ttsVoices[primaryLanguage(lang)],
              rate: settings.ttsRate / 100,
            };
          },
        },
        { readOnly: true, foldAt: null, onState: onLookupState },
      );

/**
 * The door under the answer: the saved-phrases page, one tab like every room
 * (`open-vocabulary`), with the phrase riding along to be looked up in its
 * "Add a phrase" fold on arrival - where a press on a meaning saves and the
 * list under the fold shows it.
 */
async function openVocabularyWith() {
  if (lookedUp === null) return;
  await ask({ kind: Message.OPEN_VOCABULARY, text: lookedUp.text });
  window.close();
}

// The site row stands from the first paint (D194), its host still to come:
// the label says the host is being asked, the switch waits disabled (see the
// markup), and `renderSite` lands the answer in place. Set before anything
// is awaited, so the first frame already shows it.
if (siteLabel !== null) siteLabel.textContent = t("popup_site_enabled", "...");

/**
 * @returns {Promise<number | null>}
 */
async function currentTabId() {
  const tabs = await webext().tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  return typeof id === "number" ? id : null;
}

/**
 * @param {number | null} tabId
 * @returns {Promise<import("../lib/protocol.js").PageInfo | null>}
 */
async function askPage(tabId) {
  if (tabId === null) return null;
  try {
    const answer = asResult(await webext().tabs.sendMessage(tabId, { kind: Message.PAGE_INFO }));
    return answer.ok ? asPageInfo(answer.value) : null;
  } catch {
    // Nothing in the tab is listening - no content script runs there. That is
    // an answer too, just not one that travels as a message.
    return null;
  }
}

/**
 * @param {import("../lib/config.js").Config} config
 */
function renderPair(config) {
  if (pairSelect === null) return;
  pairSelect.replaceChildren();
  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.pair;
    option.textContent = pairLabel(choice.from, choice.to);
    option.selected = choice.from === config.sourceLang && choice.to === config.targetLang;
    pairSelect.append(option);
  }
}

/**
 * @param {import("../lib/protocol.js").PageInfo | null} info
 * @param {import("../lib/config.js").Config} config
 */
function renderSite(info, config) {
  if (info?.reader === true) {
    // On the reader both rows about "this page" go: there is no site behind it
    // to switch off, and no page behind it to read. The one answer that
    // moves the rows below - within the first frames, since the page is
    // asked before anything else (`render`).
    stand(siteRow, false);
    if (readerButton !== null) readerButton.hidden = true;
    return;
  }

  if (info === null) {
    // Nothing in the tab is listening: the note takes the switch's place, a
    // row of the same height, so nothing below moves. The reading view has
    // no page to read there either - a press would open the reader to find
    // nothing behind it, right under a note saying re/read does not work on
    // this page - so its row stays, in place, and goes quiet: a row that
    // left would move the rows below it under a cursor already on its way
    // (D194), and a row that pressed would make the note a lie.
    stand(siteRow, false);
    if (siteNote !== null) siteNote.hidden = false;
    if (readerButton instanceof HTMLButtonElement) readerButton.disabled = true;
    return;
  }

  over.hostname = info.hostname;
  // Named, not just shown: a bare hostname next to a checkbox says nothing
  // about which way the checkbox points. "Enabled on ..." does.
  if (siteLabel !== null) siteLabel.textContent = t("popup_site_enabled", info.hostname);
  if (siteToggle !== null) {
    siteToggle.checked = !isSwitchedOff(config.disabledHosts, info.hostname);
    siteToggle.disabled = false;
  }
  stand(siteRow, siteStands);
  if (readerButton instanceof HTMLButtonElement) readerButton.disabled = false;
}

async function toggleSite() {
  const host = over.hostname;
  if (host === null || siteToggle === null) return;

  // Read fresh before writing: another surface may have moved the list since
  // this popup drew itself, and the write must lose only this one site -
  // under either of its names (D189), so turning reapps.eu back on also
  // takes a www.reapps.eu entry away. A new entry goes in as the site's own
  // name, without the www.
  const current = await readConfig();
  const hosts = siteToggle.checked
    ? current.disabledHosts.filter((one) => !sameSite(one, host))
    : [...current.disabledHosts, siteOf(host)];
  await writeConfig({ disabledHosts: hosts });
}

async function toggleTranslationOff() {
  if (translationToggle === null) return;
  // The settings page's own write, and then the popup redraws itself: this is
  // the one switch here that changes what the popup is - the pair, the
  // phrases and the two switches below it come and go with it - and a hallway
  // left describing the mode before the press would be lying about the press
  // that was just made. Every open page follows the same write through
  // `storage.onChanged`, launcher or reading side, no reload.
  await writeConfig({ translationOff: translationToggle.checked });
  const config = await readConfig();
  settings = config;
  const installed = await installedModels();
  showRows(config, installed.length);
  // The select's offer changes with the mode too (D165): under the trim the
  // dictionaries' pairs join the models', and leave with it.
  choices = await choicesFor(config, installed);
  renderPair(config);
}

async function toggleReaderOnly() {
  if (readerOnlyToggle === null) return;
  // The settings page's own write: the first press stores a real choice, and
  // from then on the platform default has no say. Open pages change modes on
  // the spot through `storage.onChanged` - launcher or reading side, no
  // reload.
  await writeConfig({ readerOnly: readerOnlyToggle.checked });
}

async function choosePair() {
  if (pairSelect === null) return;
  const choice = choices.find((one) => one.pair === pairSelect.value);
  if (choice === undefined) return;

  // The same write the settings page makes: every open page notices through
  // `storage.onChanged` and asks the background for the vocabulary of the new
  // pair, so nothing here has to tell them.
  settings = await writeConfig({ sourceLang: choice.from, targetLang: choice.to });
  // The look-up field's answer was in the old pair's language.
  lookupBox?.reset();
  showResults(false);
}

async function openReader() {
  const request =
    over.tabId === null
      ? { kind: Message.OPEN_READER }
      : { kind: Message.OPEN_READER, sourceTabId: over.tabId };
  try {
    await webext().runtime.sendMessage(request);
  } catch {
    // The background was mid-restart. The press can be repeated; a popup that
    // throws instead of closing cannot.
  }
  window.close();
}

async function openLibrary() {
  try {
    // Its own message, carrying nothing: the list is not about any tab, least
    // of all the one this popup happens to live in on Android.
    await webext().runtime.sendMessage({ kind: Message.OPEN_LIBRARY });
  } catch {
    // Same as the reader: repeatable beats stuck.
  }
  window.close();
}

async function openMarks() {
  try {
    // The highlights page is the reader tab's own view - the message both
    // turns it there and raises it, and carries nothing for the list's reason.
    await webext().runtime.sendMessage({ kind: Message.OPEN_MARKS });
  } catch {
    // Same as the reader: repeatable beats stuck.
  }
  window.close();
}

async function openVocabulary() {
  try {
    // Carries nothing for the reading list's reason: the page shows the pair
    // from the settings, and no tab is any of its business.
    await webext().runtime.sendMessage({ kind: Message.OPEN_VOCABULARY });
  } catch {
    // Same again: repeatable beats stuck.
  }
  window.close();
}

async function openSettings() {
  try {
    // Through the background like the other three rows (D147): the settings
    // tab raised if one stands, a tab of ours turned to it otherwise, a
    // fresh one last - where `openOptionsPage` knew only the first.
    await webext().runtime.sendMessage({ kind: Message.OPEN_SETTINGS });
  } catch {
    // Same as the others: repeatable beats stuck.
  }
  window.close();
}

async function openSupport() {
  try {
    await webext().tabs.create({ url: SUPPORT_URL });
  } catch {
    // The tab did not open - nothing to do but let the press be repeated.
  }
  window.close();
}

siteToggle?.addEventListener("change", () => void toggleSite());
// The arrow in the field's row: the hallway back, the word and its answer
// kept for the next press of the field's button.
lookupBack?.addEventListener("click", () => showResults(false));
lookupDoor?.addEventListener("click", () => void openVocabularyWith());
readerOnlyToggle?.addEventListener("change", () => void toggleReaderOnly());
translationToggle?.addEventListener("change", () => void toggleTranslationOff());
pairSelect?.addEventListener("change", () => void choosePair());
readerButton?.addEventListener("click", () => void openReader());
libraryButton?.addEventListener("click", () => void openLibrary());
marksButton?.addEventListener("click", () => void openMarks());
vocabularyButton?.addEventListener("click", () => void openVocabulary());
settingsButton?.addEventListener("click", () => void openSettings());
supportButton?.addEventListener("click", () => void openSupport());
// The signpost is a door to the same place the settings row leads.
setupRow?.addEventListener("click", () => void openSettings());

/**
 * The translation models on this device. A database that cannot be opened
 * reads as none, and the popup then points at the settings - which is where
 * the truth gets told either way.
 *
 * @returns {Promise<import("./choices.js").PairChoice[]>}
 */
async function installedModels() {
  return await listModels().catch(() => []);
}

/**
 * @param {Element | null} row
 * @param {boolean} shown
 */
function stand(row, shown) {
  if (row !== null) row.toggleAttribute("hidden", !shown);
}

/**
 * Which rows stand, from the rule in `rows.js` - the whole of what a fresh
 * install and the translation-off setting (D120) do to this popup. Called on
 * every draw and again the moment the switch that decides it is flipped.
 *
 * @param {import("../lib/config.js").Config} config
 * @param {number} installed how many models this device holds
 */
function showRows(config, installed) {
  const rows = popupRows({
    translationOff: config.translationOff,
    bubbleOff: config.bubbleOff,
    fresh: installed === 0,
    pair: chosenPair(config) !== null,
  });
  // The site row is revealed by the page's own answer (`renderSite`), which
  // arrives after this; the rule is kept for it - and applied here too, for
  // the switch pressed after that answer, which has to be able to take the
  // row away again.
  siteStands = rows.site;
  if (over.hostname !== null) stand(siteRow, rows.site);
  stand(pairRow, rows.pair);
  stand(setupRow, rows.setup);
  stand(lookupHead, rows.lookup);
  stand(vocabularyButton, rows.vocabulary);
  stand(document.getElementById("reader-only-row"), rows.readerOnly);
  stand(document.getElementById("no-translation-row"), rows.translation);
}

/**
 * The pairs the dictionaries offer (D165), for the select under the trim -
 * there they are what works. A dictionary still importing is not one yet,
 * and a store that will not open offers nothing rather than an error: the
 * popup is a hallway, not the place to explain a database.
 *
 * @returns {Promise<import("./choices.js").PairChoice[]>}
 */
async function dictionaryPairs() {
  try {
    return (await listDictionaries())
      .filter((dictionary) => dictionary.ready)
      .map(({ langFrom, langTo }) => ({ pair: `${langFrom}${langTo}`, from: langFrom, to: langTo }));
  } catch {
    return [];
  }
}

/**
 * What the pair select offers: the models, and under the trim the
 * dictionaries' pairs beside them (`pairChoices`).
 *
 * @param {import("../lib/config.js").Config} config
 * @param {import("./choices.js").PairChoice[]} installed
 * @returns {Promise<import("./choices.js").PairChoice[]>}
 */
async function choicesFor(config, installed) {
  return pairChoices(config, installed, config.translationOff ? await dictionaryPairs() : []);
}

async function render() {
  await ensurePreloaded();
  // The page is asked first and on its own (D194). Its answer decides the
  // two rows at the top, and every other read the popup makes - the models,
  // the dictionaries under the trim - used to stand between the question and
  // those rows: they appeared a second or two after the rest, pushing the
  // rows below down under a cursor already on its way to Settings (Michał's
  // report, 2026-09-11). Asked first, the answer lands within the first
  // frames; and the site row stands from the first paint either way, so a
  // late answer moves nothing - it fills the row in.
  const [tabId, config, os] = await Promise.all([currentTabId(), readConfig(), platformOs()]);
  over.tabId = tabId;
  settings = config;
  const page = askPage(tabId);

  // The look-up row is the settings' alone to decide (D197, the site row's
  // rule): settled here, before the models are read, so it never arrives
  // late under a cursor. The reading-aloud switch (D148) reaches its speaker
  // the way it reaches every page's: one gate, set from the settings.
  setSpeechOff(config.ttsOff);
  stand(lookupHead, lookupRowStands({ pair: chosenPair(config) !== null }));

  // The stylesheet reads the platform off the body: on Android the popup is a
  // page over the whole window and fills it, on desktop it is a panel that
  // measures the page. Which is which is runtime knowledge, not a media query.
  document.body.dataset["os"] = os;
  dressPopup(config.customCss);
  // The reader-only switch shows the mode as it acts, not as it is stored
  // (the settings page's rule): with nothing chosen, the box reflects the
  // platform's default - on this Android popup it opens checked.
  if (readerOnlyToggle !== null) readerOnlyToggle.checked = effectiveReaderOnly(config, os);
  if (translationToggle !== null) translationToggle.checked = config.translationOff;
  // The settings alone say whether the site switch may stand (D149): decided
  // here, before the page answers, so the row it takes away goes at once.
  siteStands = siteRowStands(config);
  if (!siteStands) stand(siteRow, false);
  const landed = page.then((info) => renderSite(info, config));

  const installed = await installedModels();
  showRows(config, installed.length);
  choices = await choicesFor(config, installed);
  renderPair(config);
  await landed;
}

void render();
