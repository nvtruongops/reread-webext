/**
 * Settings, and the promise that a missing settings file is never a reason for
 * the extension not to work: every field has a default, and reading always
 * answers a complete object.
 */

import { webext } from "./browser.js";
import { DEFAULT_MARK_COLOR, isMarkColor } from "./reader/marks.js";
import { isSwitchedOff } from "./site.js";
import { DEFAULT_UNDERLINE, isUnderlineWeight } from "./underline.js";

/**
 * One key, one object: a versioned shape is easier to migrate than loose keys.
 * Exported because a content script reads the settings and the vocabulary
 * mirror in the same call, and two reads on every page load would be one too
 * many.
 */
export const CONFIG_KEY = "config";

/**
 * @typedef {object} ReaderConfig
 * @property {"auto" | "light" | "sepia" | "dark"} theme `auto` follows the browser.
 * @property {"serif" | "sans" | "custom"} font `custom` puts the typed name
 *   (`fontFamily`) in the lead, with the default serif stack as the fallback
 *   for every character it lacks; the presets are themselves. A third choice
 *   rather than "a name wins whenever set" (the first cut), so the Type row
 *   can offer all three honestly and switching to a preset keeps the name
 *   for the way back. Healed to `serif` when there is no name to lead with.
 * @property {string} fontFamily A font the reader typed the name of, in the
 *   settings page since D163 (the panel is for knobs turned mid-reading, a
 *   name is typed once - and on a phone the field summoned the keyboard over
 *   the article). Applied only while `font` is `custom`. A name and never an
 *   enumeration: asking the browser for the installed fonts is a permission
 *   and a fingerprint (`queryLocalFonts` is also Chromium-only), while a
 *   typed name costs nothing and works everywhere (mobileread request).
 *   Stored clean - quotes, backslashes and control characters out, length
 *   capped - so the stylesheet side can quote it without looking inside,
 *   and nothing typed here can break out of the quoted CSS string it lands
 *   in (`applyReading`).
 * @property {boolean} chromeHidden Whether the reader's bar is folded away
 *   behind its bookmark tab (the ribbon at the bar's far edge). A press on
 *   the tab flips it; nothing else does - the bar never hides on a scroll
 *   (D93: a bar that moved would flash on e-ink). Stored because the point
 *   is a lasting choice about the reading surface, not a per-article whim
 *   (mobileread request, the tab is Michał's design).
 * @property {number} fontSize In pixels.
 * @property {number} measure Column width in characters.
 * @property {"active" | "plain"} links Whether links in the article text answer
 *   a press (D95). The words stay either way - they are part of the sentence -
 *   but the reader's main gesture is selecting a phrase to translate, and a
 *   live link under a slightly short hold turns selection into navigation.
 *   `plain` is the default: reading first, the original is one menu row away.
 * @property {import("./reader/marks.js").MarkColor} markerColor What the
 *   highlighter draws in (D106). One global choice rather than a picker per
 *   mark - a pen has one ink at a time, and drawing over a mark repaints it
 *   in the current one. A name, never a value: the stylesheet holds a wash
 *   for each name in each theme. Marks already made keep the colour they
 *   were drawn in; this only says what the next stroke wears.
 */

/**
 * @typedef {object} Config
 * @property {string | null} sourceLang Language being read, BCP-47. `null`
 *   means nobody has chosen a pair yet - `readerOnly`'s manner: only a hand
 *   picked pair is ever stored (the pair selects, the catalogue's press, and
 *   the first model adopting its own pair), and with none there IS no pair.
 *   Deliberately no computed default: a fresh install showing en->pl as "what
 *   you read" was claiming a choice nobody had made (Michał's call). Every
 *   consumer asks `chosenPair` and has to answer for the null.
 * @property {string | null} targetLang Language it is translated into,
 *   BCP-47. Null exactly when `sourceLang` is - the pair is chosen whole.
 * @property {ReaderConfig} reader How the reader looks. Nothing else uses it.
 * @property {string[]} disabledHosts Sites where re/read stays off. Hostnames -
 *   no port, no scheme, no patterns, no subdomain matching; only a leading
 *   `www.` is folded, on both sides of every comparison (`lib/site.js`, D189).
 *   Every entry is one conscious press of the switch in the toolbar popup or
 *   an address typed on the settings page, which is where the list can be
 *   read and emptied.
 * @property {boolean | null} readerOnly Whether ordinary pages only offer the
 *   reader, never a translation in place. `null` means nobody has chosen, and
 *   the platform decides at read time (`effectiveReaderOnly`): on Android,
 *   iOS and iPadOS on, elsewhere off. Only a hand-set value is ever stored,
 *   so a future change of the default reaches every installation that never
 *   touched the switch.
 * @property {boolean} translationOff Whether the translation half of the
 *   extension is switched off - for reading in one's own language, where the
 *   reader and the reading list are the whole point. Presentation only:
 *   nothing stored is deleted, and switching back on restores everything.
 *   Ordinary pages then only ever offer the reader (`pageMode`); the reader's
 *   bubble keeps the speaker and the clipboard and loses the translation.
 *   Named for the off state so the default (`false`) is the extension as it
 *   has always been, and a stored `true` is always a deliberate press.
 * @property {boolean} bubbleOff Whether, with translation off, selecting text
 *   shows no bubble at all (D149): ordinary pages get nothing - not even the
 *   launcher - and the reader's selection is a highlight for the moment and
 *   nothing else. Only ever read under `translationOff`, exactly as the
 *   settings page shows it: a sub-option of that switch, because with
 *   translation on the bubble is the product, and a stored value under a
 *   hidden row must never act. Asked for by a reader who selects text to keep
 *   their place on the page, not to do anything with the words. Named for
 *   the off state for `translationOff`'s reason.
 * @property {boolean} keepArticles Whether a page opened in the reader is kept
 *   in the offline reading list without being asked (D124). Default `true`:
 *   the reader's whole point is a copy that survives the original moving,
 *   and the Save button was one press between reading a page and having it.
 *   Only ever on the way in, and only when nothing is stored under that
 *   address yet - a stored copy carries the highlights and the reading
 *   position, and writing over it would take both, so reopening a page must
 *   never be what erases them. Live pages only: books and saved articles are
 *   in the list by definition.
 * @property {boolean | null} libraryCopy Whether the reading list keeps a
 *   copy of itself in the extension's own storage, where the loss of the
 *   database does not reach (`lib/store/library-backup.js`). `null` means
 *   nobody has chosen, and the default decides at read time
 *   (`effectiveLibraryCopy`): on, everywhere, since D146 - before it only on
 *   iOS and iPadOS. Only a hand-set value is stored, for the reason
 *   `readerOnly` stores only one: the default can move under an install
 *   that never touched the switch, and D146 is exactly that move.
 * @property {boolean} hideBubbleActions Whether the translation bubble opens
 *   with its action row folded away, unfolding on a click or tap on the bubble
 *   (D81). Save is the standing exception either way: a phrase that does not
 *   keep itself always shows the way to keep it, and an error its one way out.
 *   Default `false` since D125: what the bubble is for - saving, hearing,
 *   editing - should be visible to somebody meeting it for the first time,
 *   and folding it away is the taste of a reader who already knows it is
 *   there. The fold stays one press away in the popup.
 * @property {boolean} showBubbleMore Whether the bubble over a fresh selection
 *   opens with its second layer - the translated sentence and the dictionary
 *   entries - already out, where a press on More used to be the only way to
 *   them (D186). Default `true`, and deliberately so for every profile that
 *   predates the field (Michał's call): a translation model is at its weakest
 *   on a single word out of context, and the dictionary's answer to it stood
 *   one press away from a reader who never went looking. Nothing is fetched
 *   for it - the sentence and the entries ride the same answer as the gloss -
 *   so the whole cost is the bubble's height. Only the fresh selection: the
 *   bubble over an underline is the reader's own saved meaning, and its layer
 *   stays behind More, fetched on that press (D27). Only a stored `false` is
 *   somebody having turned it off.
 * @property {boolean} underlineForms Whether a saved word is underlined in
 *   its other forms as well (D208): `read` in `reads` and `reading`, and the
 *   bubble over any of them is `read`'s. Off by default, and the README's
 *   "matching is literal" holds while it is: a form is a guess by rule
 *   (`dict/deinflect.js`) that an installed dictionary of the language
 *   confirmed (`dict/forms.js`), and a wrong guess is an underline over a
 *   word the reader never saved. English only for now - the one language
 *   with rules - and nothing without a dictionary for it: the forms come
 *   out of the dictionary, never out of the rules alone. They live in the
 *   pages' mirror (`store/mirror.js`), computed by the background as it
 *   rebuilds it, and the pages read them only while this is on.
 * @property {boolean} saveSentence Whether a phrase saved from the bubble
 *   keeps the sentence it stood in (D210): the one the bubble had around the
 *   selection, as the page shows it and never its translation, stored in the
 *   row's `context` and shown under the phrase on the phrases page, folded to
 *   a line; the export for Anki writes it as the third column of a sentence
 *   card. Off by default, and deliberately not reaching any profile that did
 *   not turn it on: a sentence is a piece of the page kept for good, and the
 *   reader is the one to decide that the page's words may stay - the phrase
 *   is a word they chose, the sentence is the text around it. Turned off
 *   again it keeps nothing new; what was kept stays with its phrase, and
 *   Learned takes it with the phrase. A phrase already saved keeps its first
 *   sentence whatever a later save carries (`resaved`); one saved without
 *   a sentence - before the setting was on, from the phrases page, from a
 *   two-column file - takes the sentence it stands in the next time its
 *   bubble opens on a page (D216), while the setting is on.
 * @property {Record<string, string>} ttsVoices Which voice reads a language
 *   aloud (D83): source language to the `voiceURI` chosen for it. Per language
 *   rather than per pair - the voice picked for `en` serves every pair read in
 *   English - and no entry means the engine's own default for the language.
 *   The URIs name this device's voices; a stale one is ignored at speak time
 *   (`lib/tts.js`), never an error.
 * @property {number} ttsRate How fast a voice reads, in percent of its own
 *   normal speed (D87). Percent rather than the engine's factor for the reason
 *   `bubbleScale` is one: it is a stepper's value, and an integer survives
 *   storage, hand-editing and `within`'s clamp without a rounding story. One
 *   number for both places a voice speaks - the bubble's phrase and the
 *   reader's article - because how fast a voice is comfortable is a fact about
 *   the person, not about the surface.
 * @property {boolean} ttsOff Whether reading aloud is switched off (D148): no
 *   speaker in the bubble or on any list, no Read-aloud button in the reader,
 *   and the voice and speed rows folded away. Presentation only - `ttsVoices`
 *   and `ttsRate` stay stored, and switching back on finds them. A choice of
 *   its own rather than a corner of `translationOff`: the voice serves the
 *   trimmed bubble and the reader alike, and the reasons for wanting it gone
 *   - a browser whose engine has no voices, a speaker pressed by accident in
 *   a quiet room - have nothing to do with translating. Named for the off
 *   state for `translationOff`'s reason: the default is the extension as it
 *   has always been, and a stored `true` is always a deliberate press.
 * @property {number} bubbleScale How big the bubble's type is, in percent of
 *   its built-in size (D85). The bubble deliberately ignores the page it
 *   stands on, so no page setting can reach it - this is its one knob, and it
 *   exists because built-in sizes land differently on different screens: an
 *   e-ink tablet can render a CSS pixel visibly smaller than a phone does.
 * @property {import("./underline.js").UnderlineWeight} underline How heavily
 *   a saved phrase is underlined (D130). Not in `reader`, though its dial
 *   sits in the reader's Aa panel: the underline is worn by every page being
 *   read, and `reader` is the reader page's own appearance. A name, never a
 *   measurement - the stylesheet holds a rule per name, because reaching
 *   `::highlight()` with a value would mean setting a property on somebody
 *   else's document.
 * @property {string} customCss Rules somebody typed into the settings (D176)
 *   to dress the bubble and the reader page - and nothing else: never the
 *   page being read, never the settings page (a rule that hid its controls
 *   could not be undone from there). Stored as typed, line breaks and all,
 *   because the screen runs where the rules are applied, not here: the
 *   browser's own parser reads them and refuses the whole sheet at the first
 *   rule that would load anything (`lib/user-css.js`), so PRIVACY.md's
 *   promise that nothing loads from outside the package holds for typed
 *   rules too. The names the rules address are the bubble's own classes and
 *   the reader page's, with no promise between versions; the settings page
 *   says so.
 */

/** @type {readonly string[]} */
const THEMES = ["auto", "light", "sepia", "dark"];
/** @type {readonly string[]} */
const FONTS = ["serif", "sans", "custom"];
/** @type {readonly string[]} */
const LINKS = ["active", "plain"];

/**
 * Type guards rather than casts, and exported because the reader needs the
 * same question answered: a button carries its value as a string attribute,
 * and this is what turns one back into a setting.
 *
 * @param {unknown} value
 * @returns {value is ReaderConfig["theme"]}
 */
export function isTheme(value) {
  return typeof value === "string" && THEMES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {value is ReaderConfig["font"]}
 */
export function isFont(value) {
  return typeof value === "string" && FONTS.includes(value);
}

/**
 * @param {unknown} value
 * @returns {value is ReaderConfig["links"]}
 */
export function isLinks(value) {
  return typeof value === "string" && LINKS.includes(value);
}

/**
 * What the buttons in the reader can reach.
 *
 * The width is in `ch`, the width of a zero in whatever font is set - which is
 * wider than an average letter, so 65 of them hold something like 75 characters
 * of prose. That is the middle of the range typography has agreed on for a
 * century: much below 45 and the eye jumps line to line too often, much above
 * 85 and it loses its place coming back to the left margin.
 */
export const SIZE = Object.freeze({ min: 14, max: 28, step: 1 });
export const MEASURE = Object.freeze({ min: 45, max: 85, step: 5 });

/**
 * What the bubble-size stepper on the settings page can reach, in percent.
 * The floor keeps the bubble readable at all; the ceiling is double, which
 * already covers the worst honest case measured (an e-ink tablet whose CSS
 * pixel is a quarter smaller than a phone's, D84) with room for eyesight.
 */
export const BUBBLE_SCALE = Object.freeze({ min: 80, max: 200, step: 10 });

/**
 * What the reading-speed stepper can reach, in percent of the voice's normal
 * speed. The floor is half speed - slow enough to follow a language being
 * learned word by word, and the point below which most engines start to slur
 * rather than to slow - and the ceiling is double, where a familiar language
 * still parses and an unfamiliar one long since stopped.
 */
export const TTS_RATE = Object.freeze({ min: 50, max: 200, step: 10 });

/** @type {Readonly<ReaderConfig>} */
export const READER_DEFAULTS = Object.freeze({
  theme: "auto",
  font: "serif",
  fontFamily: "",
  chromeHidden: false,
  fontSize: 18,
  measure: 65,
  links: "plain",
  markerColor: DEFAULT_MARK_COLOR,
});

/** @type {Readonly<Config>} */
export const DEFAULTS = Object.freeze({
  sourceLang: null,
  targetLang: null,
  reader: READER_DEFAULTS,
  disabledHosts: [],
  readerOnly: null,
  translationOff: false,
  bubbleOff: false,
  keepArticles: true,
  libraryCopy: null,
  hideBubbleActions: false,
  showBubbleMore: true,
  underlineForms: false,
  saveSentence: false,
  ttsVoices: {},
  ttsRate: 100,
  ttsOff: false,
  bubbleScale: 100,
  underline: DEFAULT_UNDERLINE,
  customCss: "",
});

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function text(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * A number that has to land in a range.
 *
 * Out of range is clamped rather than thrown away, because it says what
 * somebody wanted: a stored 40 from a future version with a wider scale becomes
 * the widest this one has, not the default. Anything that is not a number at
 * all has said nothing, so it gets the default.
 *
 * @param {unknown} value
 * @param {{ min: number, max: number }} range
 * @param {number} fallback
 * @returns {number}
 */
function within(value, range, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * The list of switched-off sites, or as much of it as is really a list of
 * hostnames. Anything else in there was hand-edited; keeping the entries that
 * make sense beats losing the list over one of them. Duplicates are folded
 * here, at the door, so no writer has to remember to.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function hostList(value) {
  if (!Array.isArray(value)) return [];

  /** @type {string[]} */
  const hosts = [];
  for (const one of value) {
    if (typeof one === "string" && one.length > 0 && !hosts.includes(one)) hosts.push(one);
  }
  return hosts;
}

/**
 * The voice map, or as much of it as really maps a language to a voice. Both
 * sides are opaque strings from the platform (a BCP-47ish tag, a `voiceURI`),
 * so the only rule is: strings, non-empty. Whether a voice still exists is
 * not this function's business - the list lives on the device and changes
 * without warning, so existence is checked at speak time, where it can be.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function voiceMap(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  /** @type {Record<string, string>} */
  const map = {};
  for (const [lang, uri] of Object.entries(value)) {
    if (lang.length > 0 && typeof uri === "string" && uri.length > 0) map[lang] = uri;
  }
  return map;
}

/**
 * @param {unknown} stored
 * @returns {ReaderConfig}
 */
function readerWithDefaults(stored) {
  const raw = /** @type {Record<string, unknown>} */ (
    typeof stored === "object" && stored !== null ? stored : {}
  );

  const fontFamily = cleanFontFamily(raw["fontFamily"]);
  const font = isFont(raw["font"]) ? raw["font"] : READER_DEFAULTS.font;

  return {
    theme: isTheme(raw["theme"]) ? raw["theme"] : READER_DEFAULTS.theme,
    // A custom face with no name to lead with is a dead state - clearing the
    // name in the settings hands the Type row back to the default preset.
    font: font === "custom" && fontFamily.length === 0 ? "serif" : font,
    fontFamily,
    chromeHidden: raw["chromeHidden"] === true,
    fontSize: within(raw["fontSize"], SIZE, READER_DEFAULTS.fontSize),
    measure: within(raw["measure"], MEASURE, READER_DEFAULTS.measure),
    links: isLinks(raw["links"]) ? raw["links"] : READER_DEFAULTS.links,
    markerColor: isMarkColor(raw["markerColor"]) ? raw["markerColor"] : READER_DEFAULTS.markerColor,
  };
}

/** More than any real font's name, less than an essay in the settings file. */
const FONT_FAMILY_LIMIT = 100;

/**
 * The typed font name, clean enough to quote: no quotes or backslashes to
 * break out of the quoting, no control characters, no surrounding space, and
 * a cap. The name goes into a stylesheet value through `style.setProperty`,
 * which cannot execute anything - this is about the quoted string staying
 * exactly a string, not about danger. Exported for the settings page, whose
 * field previews itself in the typed face through the same cleaning - the
 * raw value never reaches a style, there or here.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function cleanFontFamily(value) {
  if (typeof value !== "string") return READER_DEFAULTS.fontFamily;
  return value
    .replace(new RegExp('["\\\\\\u0000-\\u001f\\u007f]', "g"), "")
    .trim()
    .slice(0, FONT_FAMILY_LIMIT);
}

/**
 * Pure half of reading the config, so the rules can be tested without a browser.
 *
 * Unknown keys are dropped and wrong types fall back to the default: stored
 * settings survive downgrades and hand-editing, and nothing downstream has to
 * check what it got.
 *
 * @param {unknown} stored
 * @returns {Config}
 */
export function withDefaults(stored) {
  const source = typeof stored === "object" && stored !== null ? stored : {};
  const raw = /** @type {Record<string, unknown>} */ (source);

  return {
    // A pair only ever exists whole: one leg stored without the other (a
    // hand-edited file) is no choice, and half a pair downstream would be a
    // translation into nowhere. Existing installations read as chosen - their
    // stored strings were written by `writeConfig`, and for the profiles that
    // predate this rule that is the honest reading available.
    sourceLang:
      typeof raw["sourceLang"] === "string" &&
      raw["sourceLang"].length > 0 &&
      typeof raw["targetLang"] === "string" &&
      raw["targetLang"].length > 0
        ? raw["sourceLang"]
        : null,
    targetLang:
      typeof raw["sourceLang"] === "string" &&
      raw["sourceLang"].length > 0 &&
      typeof raw["targetLang"] === "string" &&
      raw["targetLang"].length > 0
        ? raw["targetLang"]
        : null,
    reader: readerWithDefaults(raw["reader"]),
    disabledHosts: hostList(raw["disabledHosts"]),
    // Not a boolean means nobody has chosen - which is a state of its own, not
    // `false`: it is what lets the platform keep deciding (`effectiveReaderOnly`).
    readerOnly: typeof raw["readerOnly"] === "boolean" ? raw["readerOnly"] : null,
    translationOff:
      typeof raw["translationOff"] === "boolean" ? raw["translationOff"] : DEFAULTS.translationOff,
    bubbleOff: typeof raw["bubbleOff"] === "boolean" ? raw["bubbleOff"] : DEFAULTS.bubbleOff,
    // Default `true`, so it reaches profiles that predate the switch as well
    // as fresh ones: only a stored `false` is somebody having turned it off.
    keepArticles:
      typeof raw["keepArticles"] === "boolean" ? raw["keepArticles"] : DEFAULTS.keepArticles,
    // As `readerOnly`: not a boolean is nobody having chosen, which the
    // platform then decides (`effectiveLibraryCopy`).
    libraryCopy: typeof raw["libraryCopy"] === "boolean" ? raw["libraryCopy"] : null,
    hideBubbleActions:
      typeof raw["hideBubbleActions"] === "boolean" ? raw["hideBubbleActions"] : DEFAULTS.hideBubbleActions,
    // Default `true`, and meant to reach the profiles that predate the field
    // as well as fresh ones (D186): only a stored `false` is somebody having
    // folded the layer away.
    showBubbleMore:
      typeof raw["showBubbleMore"] === "boolean" ? raw["showBubbleMore"] : DEFAULTS.showBubbleMore,
    // Off unless a stored `true` says otherwise (D208): an underline over a
    // word nobody saved is the wrong direction to fall in.
    underlineForms:
      typeof raw["underlineForms"] === "boolean" ? raw["underlineForms"] : DEFAULTS.underlineForms,
    // Off unless a stored `true` says otherwise (D210): a sentence kept from
    // a page is the reader's to ask for, never a default they have to find.
    saveSentence:
      typeof raw["saveSentence"] === "boolean" ? raw["saveSentence"] : DEFAULTS.saveSentence,
    ttsVoices: voiceMap(raw["ttsVoices"]),
    ttsRate: within(raw["ttsRate"], TTS_RATE, DEFAULTS.ttsRate),
    // As `translationOff`: only a stored boolean is a choice, and a profile
    // from before the switch keeps its voice.
    ttsOff: typeof raw["ttsOff"] === "boolean" ? raw["ttsOff"] : DEFAULTS.ttsOff,
    bubbleScale: within(raw["bubbleScale"], BUBBLE_SCALE, DEFAULTS.bubbleScale),
    // A name the stylesheet knows, or the line as it has always been drawn:
    // a weight this version never heard of has no rule to paint under, and a
    // registration nothing styles underlines nothing at all.
    underline: isUnderlineWeight(raw["underline"]) ? raw["underline"] : DEFAULTS.underline,
    // As typed, or nothing: a value of another type is a hand-edited file,
    // and the screen at the point of use is what decides whether the text
    // dresses anything (D176).
    customCss: typeof raw["customCss"] === "string" ? raw["customCss"] : DEFAULTS.customCss,
  };
}

/**
 * The chosen language pair, or null while nobody has chosen one. The one
 * door to the pair for everything that translates, mirrors or filters by
 * it: asking here is what forces each consumer to answer for the state a
 * fresh install is in, instead of inheriting a pair nobody picked.
 *
 * @param {Pick<Config, "sourceLang" | "targetLang">} config
 * @returns {{ from: string, to: string } | null}
 */
export function chosenPair(config) {
  if (config.sourceLang === null || config.targetLang === null) return null;
  return { from: config.sourceLang, to: config.targetLang };
}

/**
 * @returns {Promise<Config>}
 */
export async function readConfig() {
  const stored = await webext().storage.local.get(CONFIG_KEY);
  return withDefaults(stored[CONFIG_KEY]);
}

/**
 * `reader` is merged a level deeper than the rest, because that is how it is
 * used: the buttons in the reader change one thing at a time, and a patch of
 * `{ reader: { theme } }` that dropped the type size would be a setting quietly
 * resetting another one.
 *
 * `ttsVoices` is deliberately not: the patch replaces the whole map, because
 * the settings page holds the full map and choosing the default voice has to
 * be able to remove an entry - a per-key merge could only ever add.
 *
 * @typedef {object} ConfigPatch What one write may change - every field of
 *   the config but the pair's halves, which only ever travel together.
 * @property {string} [sourceLang]
 * @property {string} [targetLang]
 * @property {Partial<ReaderConfig>} [reader]
 * @property {string[]} [disabledHosts]
 * @property {boolean} [readerOnly]
 * @property {boolean} [translationOff]
 * @property {boolean} [bubbleOff]
 * @property {boolean} [keepArticles]
 * @property {boolean} [libraryCopy]
 * @property {boolean} [hideBubbleActions]
 * @property {boolean} [showBubbleMore]
 * @property {boolean} [underlineForms]
 * @property {boolean} [saveSentence]
 * @property {Record<string, string>} [ttsVoices]
 * @property {number} [ttsRate]
 * @property {boolean} [ttsOff]
 * @property {number} [bubbleScale]
 * @property {import("./underline.js").UnderlineWeight} [underline]
 * @property {string} [customCss]
 */

/**
 * @param {ConfigPatch} patch
 * @returns {Promise<Config>}
 */
export async function writeConfig(patch) {
  const current = await readConfig();
  const next = withDefaults({
    ...current,
    ...patch,
    reader: { ...current.reader, ...patch.reader },
  });
  await webext().storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

/**
 * Where the background publishes which platform this is, for the one context
 * that cannot ask: content scripts get no `runtime.getPlatformInfo`, and the
 * default of `readerOnly` depends on the answer. A separate key rather than a
 * field of the config, because the config is what somebody chose and this is a
 * fact about the device - and because `withDefaults` drops keys it does not
 * know, so anything smuggled into the config would be erased by the next write.
 */
export const PLATFORM_KEY = "platform";

/**
 * The published platform, read back. Anything that is not a string says the
 * background has not published yet (a fresh install's first page can be faster
 * than `onInstalled`), and an empty answer falls back to the desktop default -
 * wrong for at most the moment it takes the real value to arrive through
 * `storage.onChanged`.
 *
 * @param {unknown} stored value under `PLATFORM_KEY`
 * @returns {string} the OS as `getPlatformInfo` names it, or `""` when unknown
 */
export function osFrom(stored) {
  if (typeof stored !== "object" || stored === null) return "";
  const os = /** @type {Record<string, unknown>} */ (stored)["os"];
  return typeof os === "string" ? os : "";
}

/**
 * The one rule about the mode: a hand-set value wins, and with none the
 * platform decides. On Android the reader is the surface that works on a
 * phone - the bubble and the system's own selection toolbar fight over the
 * same spot - and iOS and iPadOS flip for the same reason, seen on the iPad
 * and asked for by Michal (2026-08-25): Safari's selection bar lands on the
 * bubble on ordinary pages, and the reader is where reading works. Both
 * names, because Apple has not said which one `getPlatformInfo` answers on
 * an iPad - the wrong guess would quietly cost the whole default.
 *
 * @param {Pick<Config, "readerOnly">} config
 * @param {string} os as `getPlatformInfo` or `osFrom` names it
 * @returns {boolean}
 */
export function effectiveReaderOnly(config, os) {
  return config.readerOnly ?? (os === "android" || os === "ios" || os === "ipados");
}

/**
 * The same shape of rule for the reading list's copy - a hand-set value
 * wins - with a default that no longer asks the platform: on, everywhere
 * (D146). The copy began as a choice outside iOS and iPadOS, where Safari's
 * tracking prevention deletes an origin's storage after thirty days without
 * a visit to the extension's pages (the probe in `lib/storage-report.js`),
 * on the reasoning that no other browser deletes an extension's database on
 * its own. Neither does clearing the browsing data: Chrome's dialog removes
 * web origins only and Firefox's clears `http`, `https` and `file`, never
 * `moz-extension` (both read in their sources, 2026-08-29). But a database
 * is one set of files, and one set of files is what a damaged profile, a
 * cleaning tool or a hand in the developer tools takes - Michał's own test
 * emptied it and found nothing to come back from. The copy lives in a
 * second store the same loss does not reach, and the space it doubles is
 * cheap next to a reading list gone. Off stays one press away, and a
 * profile that pressed it before keeps its answer.
 *
 * @param {Pick<Config, "libraryCopy">} config
 * @returns {boolean}
 */
export function effectiveLibraryCopy(config) {
  return config.libraryCopy ?? true;
}

/**
 * Which of its three states a page is in - the whole hierarchy of the content
 * script, with silence at the top: a site switched off in the popup gets
 * nothing at all; with translation off every other page gets the launcher,
 * because the one thing left to offer a selection is the reader (the
 * reader-only question has dissolved - there is no translation in place to
 * choose against) - or, with the bubble switched off as well (D149), nothing
 * at all; reader-only mode gets the launcher too; and what remains gets the
 * full reading side. Here rather than in the content script so the hierarchy
 * sits under `node --test`.
 *
 * @param {Pick<Config, "disabledHosts" | "readerOnly" | "translationOff" | "bubbleOff" | "sourceLang" | "targetLang">} config
 * @param {string} os as `getPlatformInfo` or `osFrom` names it
 * @param {string} hostname the page's own, exact - the way `disabledHosts` stores them
 * @returns {"off" | "launcher" | "reading"}
 */
export function pageMode(config, os, hostname) {
  if (isSwitchedOff(config.disabledHosts, hostname)) return "off";
  // The no-bubble sub-option (D149) is the ladder's last rung: with nothing
  // to offer a selection, the page is left entirely alone - the same silence
  // a switched-off site gets - and the reader opens from the toolbar button
  // or its keyboard shortcut instead. Read only under the trim, exactly as
  // the settings page shows it: a stored value under a hidden row never acts.
  if (config.translationOff && config.bubbleOff) return "off";
  // The trim without a pair has nothing to offer a selection but the reader,
  // so the launcher is the whole page. With a pair chosen the quiet
  // vocabulary works here too (D162): the dictionaries answer through the
  // background, the page reads exactly as it would with the engine - and the
  // reader-only choice below keeps its say, instead of being overridden the
  // way it was when the trim's ordinary pages had nothing else left (Michał's
  // call: the switch turns off the model, not the bubble - the bubble has
  // its own two controls).
  if (config.translationOff && chosenPair(config) === null) return "launcher";
  if (effectiveReaderOnly(config, os)) return "launcher";
  return "reading";
}

/**
 * Which platform this is, asked directly - for extension pages, which may.
 * Content scripts read `PLATFORM_KEY` instead.
 *
 * @returns {Promise<string>}
 */
export async function platformOs() {
  try {
    const info = await webext().runtime.getPlatformInfo();
    return info.os;
  } catch {
    // No answer reads as the desktop default, which is the harmless direction.
    return "";
  }
}

/**
 * Asks once and writes the answer down for content scripts. The background
 * calls this from `onInstalled` - installs and updates are the only moments
 * the value can be missing, and a write on every wake would fire a storage
 * event at every open tab for a value that never changes.
 *
 * @returns {Promise<void>}
 */
export async function publishPlatform() {
  const os = await platformOs();
  await webext().storage.local.set({ [PLATFORM_KEY]: { os } });
}
