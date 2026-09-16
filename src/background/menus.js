/**
 * The right-click way into the reader (D188).
 *
 * Two rows under the extension's name, on any web page: the page into the
 * reading view, and the reading list. They exist for whoever never pinned the
 * toolbar button - on a desktop the button lives folded away behind the
 * browser's extensions menu until somebody pins it, and a door nobody can see
 * is a door nobody uses. The rows are the same two the launcher bubble offers
 * on a phone and the popup offers everywhere, by other means.
 *
 * Pure: what the rows are, and which door a click on one means. Making them
 * is the background's business (`installMenus` takes the API as an argument,
 * so `node --test` can hand in a fake); the click handler and the rooms it
 * opens are in `index.js`.
 *
 * Both engines keep the rows once made - Firefox persists an event page's
 * menus and recreates them at startup, Chromium stores a service worker's -
 * so they are created once, in `onInstalled`, and again after an update. That
 * is why the slate is wiped first: creating an id that exists is an error on
 * both, and an update is exactly when a row's wording may have changed.
 */

import { t } from "../lib/i18n.js";

/** The ids the rows are known by; never shown, only clicked on. */
export const MENU = Object.freeze({
  parent: "reread",
  read: "reread-read-page",
  library: "reread-open-library",
});

/**
 * Where the rows show. Not only `page`: over a link, a picture or a frame the
 * browser names the context after what was clicked, and an article is made
 * of links and pictures - a menu that vanished over every one of them would
 * be a menu that vanished over most of the article.
 */
const CONTEXTS = Object.freeze(["page", "frame", "selection", "link", "image"]);

/**
 * Where "read this page" makes sense: the pages the reader can read. On the
 * browser's own pages and the extension's there is nothing to extract, so the
 * row stays away rather than offer a dead press; the reading list is about no
 * page and shows everywhere.
 */
const PAGE_PATTERNS = Object.freeze(["http://*/*", "https://*/*", "file://*/*"]);

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} [parentId]
 * @property {string} title
 * @property {string[]} contexts
 * @property {string[]} [documentUrlPatterns]
 */

/**
 * The rows, parent first - a child is created into its parent, so the order
 * is part of the contract.
 *
 * @returns {MenuItem[]}
 */
export function menuItems() {
  return [
    { id: MENU.parent, title: "re/read", contexts: [...CONTEXTS] },
    {
      id: MENU.read,
      parentId: MENU.parent,
      title: t("open_reader"),
      contexts: [...CONTEXTS],
      documentUrlPatterns: [...PAGE_PATTERNS],
    },
    { id: MENU.library, parentId: MENU.parent, title: t("reading_list"), contexts: [...CONTEXTS] },
  ];
}

/**
 * Wipes and makes the rows.
 *
 * @param {Pick<NonNullable<WebExtBrowser["contextMenus"]>, "create" | "removeAll">} menus the two calls this needs, so a test can hand in that much and no more
 * @returns {Promise<void>}
 */
export async function installMenus(menus) {
  await menus.removeAll();
  for (const item of menuItems()) menus.create(item);
}

/**
 * Which door a click means, or null for a row that is not ours to answer -
 * the parent, which opens the submenu and nothing else, included.
 *
 * @param {string | number} menuItemId
 * @returns {"reader" | "library" | null}
 */
export function menuDoor(menuItemId) {
  if (menuItemId === MENU.read) return "reader";
  if (menuItemId === MENU.library) return "library";
  return null;
}
