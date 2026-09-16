/**
 * The back arrow of the pages that are not the reader - the settings and the
 * saved phrases - and its one promise (D142): from wherever the reading led
 * here, this arrow returns to it. Before D142 the promise held only for a
 * tab the reader had walked to in place (D139-D141); a tab raised from the
 * popup had no history behind it and wore no arrow, so two doors to the same
 * room answered differently (Michał's report).
 *
 * Three states, decided in this order:
 *
 * - the reader walked to this very tab (the `sessionStorage` marker, D140):
 *   the arrow pops the history entry behind - the same one the system's back
 *   gesture pops - and the article comes back with its place (D102);
 * - no marker, but the reading stands in some other tab (the witness,
 *   `own-tabs.js`): the arrow brings that tab forward. Asked again at the
 *   press, not only at the load - tabs close - and if the reading is gone
 *   after all, the arrow opens the reading list (`OPEN_LIBRARY`, the one
 *   raise with no sender trap): the list is where reading starts;
 * - neither: no arrow, because there is nothing to go back to. An engine
 *   without `getContexts` (Firefox before 126) simply never arms the second
 *   state, which is exactly the old behavior.
 *
 * The second state is re-checked whenever the tab is revealed
 * (`visibilitychange`): an arrow is looked at exactly then, and the reader
 * tab may have come or gone since the load.
 */

import { webext } from "./browser.js";
import { Message } from "./protocol.js";
import { tabsShowing } from "./own-tabs.js";
import { BACK_ROAD_KEY } from "./session.js";

const READER_PAGE = "reader/reader.html";

/**
 * Whether the reader navigated this very tab here (D139-D141). A context
 * that refuses its own storage reads as "not walked"; the raised state may
 * still arm the arrow.
 *
 * @returns {boolean}
 */
function walkedHere() {
  try {
    return sessionStorage.getItem(BACK_ROAD_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * The tab the reading stands in right now, if any.
 *
 * @returns {Promise<number | null>}
 */
async function readerTab() {
  const seen = await tabsShowing(webext().runtime.getURL(READER_PAGE), undefined);
  return seen !== null && seen.length > 0 ? (seen[0] ?? null) : null;
}

/**
 * `single-tab.js`'s two-call raise, page-side: selecting a tab and focusing
 * its window need no permission, and each failure means its own thing - a
 * gone tab means false (the caller falls back), a gone window or an Android
 * without `windows` means nothing at all.
 *
 * @param {number} tabId
 * @returns {Promise<boolean>} whether the reading is now in front
 */
async function focusTab(tabId) {
  /** @type {WebExtTab} */
  let tab;
  try {
    tab = await webext().tabs.update(tabId, { active: true });
  } catch {
    return false;
  }
  if (typeof tab.windowId === "number") {
    try {
      await webext().windows.update(tab.windowId, { focused: true });
    } catch {
      // The window closed under us - or this is Android, where the selected
      // tab is the visible one already.
    }
  }
  return true;
}

/** The raised arrow's press: the reading first, the list when it is gone. */
async function toReading() {
  const tab = await readerTab();
  if (tab !== null && (await focusTab(tab))) return;
  await webext()
    .runtime.sendMessage({ kind: Message.OPEN_LIBRARY })
    .catch(() => undefined);
}

/**
 * Wires the page's `#back` button, or does nothing on a page without one.
 * Called once, at load, by the settings and the saved-phrases pages.
 */
export function armBackArrow() {
  const button = document.getElementById("back");
  if (button === null) return;

  if (walkedHere()) {
    button.hidden = false;
    button.addEventListener("click", () => history.back());
    return;
  }

  button.addEventListener("click", () => void toReading());
  const reveal = () =>
    void readerTab().then((tab) => {
      button.hidden = tab === null;
    });
  reveal();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reveal();
  });
}
