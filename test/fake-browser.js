/**
 * As much of a browser as the background modules talk to: tabs that exist, the
 * one that is selected, which window each is in, and whether a tab has a
 * content script listening.
 *
 * Shared by the tests for the reader's tab and for fetching a page, because
 * both are about the same three calls and a fake that disagrees with itself
 * between two files is worse than no fake.
 *
 * Everything a test wants to assert is readable off `state` afterwards, which
 * is why this counts calls rather than recording them.
 */

/**
 * @typedef {object} FakeTab
 * @property {number} id
 * @property {number} [windowId]
 * @property {(message: unknown) => unknown} [respond] absent = no content script there
 */

/**
 * @param {{ tabs?: FakeTab[], session?: Record<string, unknown> }} [initial]
 */
export function fakeBrowser(initial = {}) {
  const tabs = new Map((initial.tabs ?? []).map((tab) => [tab.id, tab]));
  /** @type {Record<string, unknown>} */
  const stored = { ...(initial.session ?? {}) };

  const state = {
    stored,
    created: /** @type {string[]} */ ([]),
    /** The tabs turned to a page of ours, and to which (D147). */
    turned: /** @type {Array<{ tabId: number, url: string }>} */ ([]),
    asked: /** @type {Array<{ tabId: number, message: unknown }>} */ ([]),
    selected: /** @type {number | null} */ (null),
    focusedWindow: /** @type {number | null} */ (null),
    nextId: 100,
    /** Set to fail the next `windows.update`, the way a closed window would. */
    windowGone: false,
    /** Set to make `tabs.create` answer without an id. */
    createWithoutId: false,
  };

  const api = {
    tabs: {
      /** @param {{ url: string }} properties */
      async create(properties) {
        state.created.push(properties.url);
        if (state.createWithoutId) return {};
        const tab = { id: state.nextId++, windowId: 1 };
        tabs.set(tab.id, tab);
        state.selected = tab.id;
        return tab;
      },
      /**
       * @param {number} tabId
       * @param {{ active?: boolean, url?: string }} properties
       */
      async update(tabId, properties) {
        const tab = tabs.get(tabId);
        // What the browser does for an id that is no longer a tab, and the only
        // way this can be learned without the `tabs` permission.
        if (tab === undefined) throw new Error(`Invalid tab ID: ${tabId}`);
        if (typeof properties.url === "string") state.turned.push({ tabId, url: properties.url });
        state.selected = tabId;
        return tab;
      },
      /**
       * @param {number} tabId
       * @param {unknown} message
       */
      async sendMessage(tabId, message) {
        state.asked.push({ tabId, message });
        const tab = tabs.get(tabId);
        // Both real cases reject the same way: the tab is gone, or nothing in
        // it is listening because no content script runs there.
        if (tab?.respond === undefined) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return tab.respond(message);
      },
    },
    windows: {
      /**
       * @param {number} windowId
       * @param {{ focused?: boolean }} _properties
       */
      async update(windowId, _properties) {
        if (state.windowGone) throw new Error(`Invalid window ID: ${windowId}`);
        state.focusedWindow = windowId;
        return {};
      },
    },
    session: {
      /** @param {string | string[] | null} [keys] */
      async get(keys) {
        if (typeof keys !== "string") return { ...stored };
        return keys in stored ? { [keys]: stored[keys] } : {};
      },
      /** @param {Record<string, unknown>} items */
      async set(items) {
        Object.assign(stored, items);
      },
      /** @param {string | string[]} keys */
      async remove(keys) {
        for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
      },
    },
  };

  return { state, api };
}
