import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openSettings, openVocabulary } from "../src/background/room-tab.js";
import { SETTINGS_TAB_KEY, VOCAB_TAB_KEY } from "../src/lib/session.js";
import { fakeBrowser } from "./fake-browser.js";

const READER_URL = "moz-extension://uuid/reader/reader.html";
const VOCAB_URL = "moz-extension://uuid/vocab/vocab.html";
const SETTINGS_URL = "moz-extension://uuid/options/options.html";
const ROOMS = [READER_URL, VOCAB_URL, SETTINGS_URL];

/**
 * @param {{ tabs?: import("./fake-browser.js").FakeTab[], session?: Record<string, unknown> }} [initial]
 */
function vocab(initial) {
  const { state, api } = fakeBrowser(initial);
  return { state, deps: { ...api, url: VOCAB_URL, rooms: ROOMS } };
}

/**
 * @param {{ tabs?: import("./fake-browser.js").FakeTab[], session?: Record<string, unknown> }} [initial]
 */
function settings(initial) {
  const { state, api } = fakeBrowser(initial);
  return { state, deps: { ...api, url: SETTINGS_URL, rooms: ROOMS } };
}

/**
 * @param {string} documentUrl
 * @param {number} tabId
 */
const showing = (documentUrl, tabId) => ({ contextType: "TAB", documentUrl, tabId });

describe("opening the saved-phrases page", () => {
  it("opens a tab when there is none, and remembers it", async () => {
    const { state, deps } = vocab();

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
  });

  it("goes back to the remembered tab instead of opening a second one", async () => {
    const { state, deps } = vocab({
      tabs: [{ id: 7, windowId: 3 }],
      session: { [VOCAB_TAB_KEY]: 7 },
    });

    await openVocabulary(deps);

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
    assert.equal(state.focusedWindow, 3);
  });

  it("opens a new tab when the remembered one is gone, and remembers that one", async () => {
    const { state, deps } = vocab({ session: { [VOCAB_TAB_KEY]: 7 } });

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
  });

  it("lands with the phrase to look up, in a fresh tab and in the one already showing the page (D197)", async () => {
    // The popup's field only reads; its door opens this page with the
    // phrase in the address, encoded so that whatever was typed survives it.
    const fresh = vocab();
    await openVocabulary({ ...fresh.deps, text: "take off #1" });
    assert.deepEqual(fresh.state.created, [`${VOCAB_URL}#lookup=take%20off%20%231`]);
    assert.equal(fresh.state.stored[VOCAB_TAB_KEY], 100);

    // The tab already showing the page is turned to the fragment - the same
    // document, `hashchange` - rather than only raised.
    const open = vocab({ tabs: [{ id: 7, windowId: 3 }], session: { [VOCAB_TAB_KEY]: 7 } });
    await openVocabulary({ ...open.deps, text: "news", contexts: async () => [showing(VOCAB_URL, 7)] });
    assert.deepEqual(open.state.created, []);
    assert.deepEqual(open.state.turned, [{ tabId: 7, url: `${VOCAB_URL}#lookup=news` }]);
    assert.equal(open.state.selected, 7);

    // Without a phrase the page opens on its list, as before.
    const plain = vocab({ tabs: [{ id: 7, windowId: 3 }], session: { [VOCAB_TAB_KEY]: 7 } });
    await openVocabulary({ ...plain.deps, contexts: async () => [showing(VOCAB_URL, 7)] });
    assert.deepEqual(plain.state.turned, []);
    assert.equal(plain.state.selected, 7);
  });

  it("keeps its tab apart from the reader's", async () => {
    // Both pages remember a tab; a shared key would make one button close in
    // on the other's page.
    const { state, deps } = vocab({
      tabs: [{ id: 7, windowId: 3 }],
      session: { readerTabId: 7 },
    });

    await openVocabulary(deps);

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
    assert.equal(state.stored["readerTabId"], 7);
  });
});

/**
 * The settings under the same rule since D147 - one tab, remembered under a
 * key of their own - instead of the browser's `openOptionsPage`, which
 * raises an open settings tab but knows nothing of the extension's other
 * tabs.
 */
describe("opening the settings", () => {
  it("opens a tab when there is none, and remembers it under its own key", async () => {
    const { state, deps } = settings({ session: { [VOCAB_TAB_KEY]: 7 } });

    await openSettings(deps);

    assert.deepEqual(state.created, [SETTINGS_URL]);
    assert.equal(state.stored[SETTINGS_TAB_KEY], 100);
    assert.equal(state.stored[VOCAB_TAB_KEY], 7);
  });

  it("raises the remembered settings tab while the settings really live in it", async () => {
    const { state, deps } = settings({ tabs: [{ id: 7, windowId: 3 }], session: { [SETTINGS_TAB_KEY]: 7 } });

    await openSettings({ ...deps, contexts: async () => [showing(SETTINGS_URL, 7)] });

    assert.deepEqual(state.created, []);
    assert.deepEqual(state.turned, []);
    assert.equal(state.selected, 7);
  });

  it("lands on the section a press names, in a fresh tab and in the one already showing the page (D192)", async () => {
    const fresh = settings();
    await openSettings({ ...fresh.deps, section: "dictionaries" });
    assert.deepEqual(fresh.state.created, [`${SETTINGS_URL}#dictionaries`]);
    assert.equal(fresh.state.stored[SETTINGS_TAB_KEY], 100);

    // The tab already showing the settings is turned to the section - the
    // same document, a fragment on - rather than only raised.
    const open = settings({ tabs: [{ id: 7, windowId: 3 }], session: { [SETTINGS_TAB_KEY]: 7 } });
    await openSettings({ ...open.deps, section: "dictionaries", contexts: async () => [showing(SETTINGS_URL, 7)] });
    assert.deepEqual(open.state.created, []);
    assert.deepEqual(open.state.turned, [{ tabId: 7, url: `${SETTINGS_URL}#dictionaries` }]);
    assert.equal(open.state.selected, 7);

    // A tab of ours turned to the settings lands on the section as well.
    const walked = settings({ tabs: [{ id: 5, windowId: 1 }] });
    await openSettings({ ...walked.deps, from: 5, section: "dictionaries", contexts: async () => [showing(VOCAB_URL, 5)] });
    assert.deepEqual(walked.state.turned, [{ tabId: 5, url: `${SETTINGS_URL}#dictionaries` }]);
  });

  it("still knows its tab once it stands on a section", async () => {
    // The fragment the last press left on the address must not make the
    // settings tab a stranger: raised as it is, no copy opened.
    const { state, deps } = settings({ tabs: [{ id: 7, windowId: 3 }], session: { [SETTINGS_TAB_KEY]: 7 } });

    await openSettings({ ...deps, contexts: async () => [showing(`${SETTINGS_URL}#dictionaries`, 7)] });

    assert.deepEqual(state.created, []);
    assert.deepEqual(state.turned, []);
    assert.equal(state.selected, 7);
  });
});

/**
 * The witness of what the remembered tab shows, the reader's exactly (D140,
 * shared in `single-tab.js`; here since D141): the reader's menu walks to
 * this page in place, so a phrases tab can stop being one - it walked on -
 * and start in a tab nobody remembered, which is adopted rather than
 * duplicated. No witness means the id is trusted the way it always was.
 */
describe("the witness of what the remembered phrases tab shows", () => {
  it("raises the remembered tab while the phrases really live in it", async () => {
    const { state, deps } = vocab({ tabs: [{ id: 7, windowId: 3 }], session: { [VOCAB_TAB_KEY]: 7 } });

    await openVocabulary({ ...deps, contexts: async () => [showing(VOCAB_URL, 7)] });

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 7);
  });

  it("opens a fresh page when the remembered tab shows something else, and nothing of ours is open", async () => {
    const { state, deps } = vocab({ tabs: [{ id: 7, windowId: 3 }], session: { [VOCAB_TAB_KEY]: 7 } });

    await openVocabulary({ ...deps, contexts: async () => [] });

    assert.deepEqual(state.created, [VOCAB_URL]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 100);
  });

  it("adopts the page the reader walked to in its own tab", async () => {
    // The reader's menu row navigated its tab here (D141): no raise ever
    // created this page, so no id remembers it - the witness does.
    const { state, deps } = vocab({ tabs: [{ id: 9, windowId: 2 }] });

    await openVocabulary({ ...deps, contexts: async () => [showing(VOCAB_URL, 9)] });

    assert.deepEqual(state.created, []);
    assert.equal(state.selected, 9);
  });
});

/**
 * A tab of ours turned to the page asked for, before a fresh tab is opened
 * (D147). The pile of settings tabs in Michał's tab bar (2026-08-29) was
 * the reader walking to the settings in place and every next raise of the
 * reader opening a fresh one beside the tab it had left; now the tab that
 * walked away is the first to be turned back, and a menu row pressed in a
 * room turns that room - which is what walking in place always was.
 */
describe("turning a tab of ours to the page asked for", () => {
  it("turns the tab the press came from when no tab shows the page", async () => {
    // The phrases page's Settings row: this very tab becomes the settings,
    // with the phrases one Back away.
    const { state, deps } = settings({ tabs: [{ id: 5, windowId: 1 }] });

    await openSettings({ ...deps, from: 5, contexts: async () => [showing(VOCAB_URL, 5)] });

    assert.deepEqual(state.created, []);
    assert.deepEqual(state.turned, [{ tabId: 5, url: SETTINGS_URL }]);
    assert.equal(state.selected, 5);
    assert.equal(state.focusedWindow, 1);
    assert.equal(state.stored[SETTINGS_TAB_KEY], 5);
  });

  it("turns the remembered tab that walked away before any other tab of ours", async () => {
    const { state, deps } = vocab({
      tabs: [{ id: 7, windowId: 3 }, { id: 8, windowId: 3 }],
      session: { [VOCAB_TAB_KEY]: 7 },
    });

    await openVocabulary({
      ...deps,
      contexts: async () => [showing(SETTINGS_URL, 8), showing(READER_URL, 7)],
    });

    assert.deepEqual(state.turned, [{ tabId: 7, url: VOCAB_URL }]);
    assert.equal(state.stored[VOCAB_TAB_KEY], 7);
  });

  it("raises the page's own tab rather than turning the one the press came from", async () => {
    // Never two of a page: the settings standing in another tab win over
    // the phrases tab the press came from.
    const { state, deps } = settings({ tabs: [{ id: 5, windowId: 1 }, { id: 7, windowId: 2 }] });

    await openSettings({
      ...deps,
      from: 5,
      contexts: async () => [showing(VOCAB_URL, 5), showing(SETTINGS_URL, 7)],
    });

    assert.deepEqual(state.turned, []);
    assert.equal(state.selected, 7);
    assert.equal(state.focusedWindow, 2);
  });

  it("opens a fresh tab without a witness, and beside a page that is not a room", async () => {
    const blind = settings({ tabs: [{ id: 5, windowId: 1 }], session: { [VOCAB_TAB_KEY]: 5 } });
    await openSettings({
      ...blind.deps,
      from: 5,
      contexts: async () => {
        throw new Error("no such API");
      },
    });
    assert.deepEqual(blind.state.turned, []);
    assert.deepEqual(blind.state.created, [SETTINGS_URL]);

    // The popup on Android is a page in a tab, and it closes itself the
    // moment its press is sent: not a tab to hand a page to.
    const popup = settings({ tabs: [{ id: 4, windowId: 1 }] });
    await openSettings({
      ...popup.deps,
      from: 4,
      contexts: async () => [showing("moz-extension://uuid/popup/index.html", 4)],
    });
    assert.deepEqual(popup.state.turned, []);
    assert.deepEqual(popup.state.created, [SETTINGS_URL]);
  });

  it("falls through to a fresh tab when the tab to turn is gone", async () => {
    // The witness spoke a moment ago; the tab closed since.
    const { state, deps } = settings();

    await openSettings({ ...deps, contexts: async () => [showing(READER_URL, 9)] });

    assert.deepEqual(state.turned, []);
    assert.deepEqual(state.created, [SETTINGS_URL]);
    assert.equal(state.stored[SETTINGS_TAB_KEY], 100);
  });
});
