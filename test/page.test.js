import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPage } from "../src/background/page.js";
import { ErrorCode, Message, fail, ok } from "../src/lib/protocol.js";
import { READER_SOURCE_KEY } from "../src/lib/session.js";
import { fakeBrowser } from "./fake-browser.js";

const PAGE = { url: "https://example.test/article", title: "An article", html: "<html></html>" };

/**
 * A tab with a content script in it, answering the one question the background
 * ever asks a page.
 *
 * @param {number} id
 * @param {unknown} [answer]
 * @returns {import("./fake-browser.js").FakeTab}
 */
function readable(id, answer = ok(PAGE)) {
  return { id, respond: () => answer };
}

describe("reading the page the reader was pointed at", () => {
  it("asks the tab the button was pressed on, and hands back what it said", async () => {
    const { state, api } = fakeBrowser({
      tabs: [readable(4)],
      session: { [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    const result = await readPage(api);

    assert.deepEqual(result, ok(PAGE));
    assert.deepEqual(state.asked, [{ tabId: 4, message: { kind: Message.GRAB_PAGE } }]);
  });

  it("says there is no page when the button was never pressed", async () => {
    const { state, api } = fakeBrowser({ tabs: [readable(4)] });

    assert.deepEqual(await readPage(api), fail(ErrorCode.NO_PAGE));
    // Nothing to ask, so nobody is asked.
    assert.deepEqual(state.asked, []);
  });

  it("says there is no page when the tab is gone", async () => {
    const { api } = fakeBrowser({ session: { [READER_SOURCE_KEY]: { tabId: 4, at: 1 } } });

    assert.deepEqual(await readPage(api), fail(ErrorCode.NO_PAGE));
  });

  it("says there is no page where no content script runs", async () => {
    // `about:config`, the PDF viewer, addons.mozilla.org: the tab exists and
    // nothing in it is listening.
    const { api } = fakeBrowser({
      tabs: [{ id: 4 }],
      session: { [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    assert.deepEqual(await readPage(api), fail(ErrorCode.NO_PAGE));
  });

  it("passes the page's own refusal through, because it says more", async () => {
    const { api } = fakeBrowser({
      tabs: [readable(4, fail(ErrorCode.TOO_LONG))],
      session: { [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
    });

    assert.deepEqual(await readPage(api), fail(ErrorCode.TOO_LONG));
  });

  it("refuses an answer that is not a page", async () => {
    for (const answer of [ok({ url: 1, html: "<p>" }), ok({ url: "x" }), ok(null), "hello", null]) {
      const { api } = fakeBrowser({
        tabs: [readable(4, answer)],
        session: { [READER_SOURCE_KEY]: { tabId: 4, at: 1 } },
      });

      const result = await readPage(api);
      assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(answer)}`);
    }
  });

  it("ignores a remembered source that is not a tab id and a time", async () => {
    for (const source of [{ tabId: "4", at: 1 }, { tabId: 4 }, 4, null]) {
      const { api } = fakeBrowser({
        tabs: [readable(4)],
        session: { [READER_SOURCE_KEY]: source },
      });

      assert.deepEqual(await readPage(api), fail(ErrorCode.NO_PAGE));
    }
  });
});
