/**
 * Getting the page the reader was pointed at.
 *
 * The background is the only side that can do this: the toolbar button is heard
 * here, the reader lives in a different tab, and a tab cannot talk to another
 * tab. So the reader asks this, and this asks the content script - the one
 * message in the extension that travels background to page.
 *
 * The page is fetched when the reader asks, not when the button is pressed.
 * Holding several megabytes of somebody's article in an event page that Firefox
 * kills whenever it likes would be state that has to survive and cannot, and
 * writing it to storage would be keeping what somebody reads. Asking twice
 * costs one `outerHTML`; the alternatives cost correctness.
 *
 * Every failure here is `no_page`, and that is deliberate: from the reader's
 * side "the tab is gone", "there is no content script on `about:config`" and
 * "the answer made no sense" are one situation - there is nothing to read - and
 * one sentence covers all three.
 */

import { webext } from "../lib/browser.js";
import { ErrorCode, Message, asPage, asResult, fail, ok } from "../lib/protocol.js";
import { readReaderSource } from "../lib/session.js";

/**
 * @typedef {object} ReadPageDeps
 * @property {Pick<WebExtBrowser["tabs"], "sendMessage">} [tabs]
 * @property {WebExtBrowser["storage"]["session"]} [session]
 */

/**
 * @param {ReadPageDeps} [deps]
 * @returns {Promise<import("../lib/protocol.js").Result<import("../lib/protocol.js").Page>>}
 */
export async function readPage(deps = {}) {
  const tabs = deps.tabs ?? webext().tabs;
  const session = deps.session ?? webext().storage.session;

  // A source pointing at the highlights page has no tab behind it either -
  // and the reader never asks over one; the branch is for the type's sake
  // and for the stray message that could still arrive.
  const source = await readReaderSource(session);
  if (source === null || "marks" in source) return fail(ErrorCode.NO_PAGE);

  /** @type {unknown} */
  let answer;
  try {
    answer = await tabs.sendMessage(source.tabId, { kind: Message.GRAB_PAGE });
  } catch {
    // The tab was closed, or it is a page this extension does not run in.
    return fail(ErrorCode.NO_PAGE);
  }

  const result = asResult(answer);
  // A content script that refused - too much HTML, most likely - has a code of
  // its own, and it says more than `no_page` would.
  if (!result.ok) return result;

  const page = asPage(result.value);
  return page === null ? fail(ErrorCode.NO_PAGE) : ok(page);
}
