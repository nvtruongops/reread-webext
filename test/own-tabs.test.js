import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tabsShowing, tabsShowingAny } from "../src/lib/own-tabs.js";

const READER_URL = "moz-extension://uuid/reader/reader.html";
const SETTINGS_URL = "moz-extension://uuid/options/options.html";

/**
 * The witness of what this extension's tabs actually show (D140), on which
 * both the background's single-tab raising and the pages' back arrow (D142)
 * now stand. The live half is `runtime.getContexts`; what is tested is the
 * reading of its answer - which shapes count as a page seen, and that a
 * missing or broken witness answers null, never "no tabs".
 */
describe("the tabs a page of ours is seen in", () => {
  it("collects the tabs whose document is the asked-for page", async () => {
    const seen = await tabsShowing(READER_URL, async () => [
      { contextType: "TAB", documentUrl: READER_URL, tabId: 7 },
      { contextType: "TAB", documentUrl: `${READER_URL}#saved`, tabId: 9 },
      { contextType: "TAB", documentUrl: "moz-extension://uuid/options/options.html", tabId: 5 },
    ]);

    assert.deepEqual(seen, [7, 9]);
  });

  it("collects the tabs showing any of several pages, in the browser's order and each once", async () => {
    // The rooms a tab may be turned from (D147): one witness call, every
    // room at once - and a tab counted once however many of its contexts
    // the browser lists.
    const seen = await tabsShowingAny([READER_URL, SETTINGS_URL], async () => [
      { contextType: "TAB", documentUrl: SETTINGS_URL, tabId: 5 },
      { contextType: "TAB", documentUrl: "moz-extension://uuid/popup/index.html", tabId: 6 },
      { contextType: "TAB", documentUrl: READER_URL, tabId: 7 },
      { contextType: "TAB", documentUrl: `${READER_URL}#saved`, tabId: 7 },
    ]);

    assert.deepEqual(seen, [5, 7]);
  });

  it("drops entries that are not pages in tabs", async () => {
    const seen = await tabsShowing(READER_URL, async () => [
      // A context with no tab behind it answers -1; a popup and the
      // background have no document this page could be.
      { contextType: "TAB", documentUrl: READER_URL, tabId: -1 },
      { contextType: "BACKGROUND", tabId: 4 },
      null,
      "garbage",
    ]);

    assert.deepEqual(seen, []);
  });

  it("answers null - no witness - when the browser cannot say", async () => {
    assert.equal(
      await tabsShowing(READER_URL, async () => {
        throw new Error("no such API");
      }),
      null,
    );
    assert.equal(await tabsShowing(READER_URL, async () => "not a list"), null);
    assert.equal(await tabsShowing(READER_URL, async () => undefined), null);
  });
});
