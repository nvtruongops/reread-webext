// The WebExtension surface this extension is allowed to touch.
//
// Hand-written rather than pulled from `@types/*` on purpose: the list is short,
// it is the same list the README justifies to anyone reading the permissions,
// and a new API showing up here is a visible diff instead of an autocomplete.
// Adding an entry means the extension does something new - say so in the README.

interface WebExtEvent<Listener extends (...args: never[]) => unknown> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
  hasListener(listener: Listener): boolean;
}

interface WebExtMessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

interface WebExtTab {
  id?: number;
  url?: string;
  windowId?: number;
}

interface WebExtBrowser {
  runtime: {
    id: string;
    getURL(path: string): string;
    getManifest(): { name: string; version: string } & Record<string, unknown>;
    // Which of this extension's own pages are open, and in which tabs - the
    // background's witness that the tab remembered as "the reader" still
    // shows the reader before it is raised (D140): a tab id cannot say what
    // the tab shows, and extension pages sit outside `<all_urls>`, so this is
    // the one permissionless answer. Optional, because Firefox grew it in
    // 126; without it the stored id is trusted as before.
    getContexts?(filter: {
      contextTypes?: string[];
    }): Promise<{ contextType: string; documentUrl?: string; tabId: number }[]>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: WebExtEvent<
      (
        message: unknown,
        sender: WebExtMessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined
    >;
    onInstalled: WebExtEvent<(details: { reason: string }) => void>;
    // The browser launching with this profile - the one moment the toolbar
    // icon is guaranteed stale on Chromium (setIcon state does not survive a
    // restart) and nothing else is awake to correct it.
    onStartup: WebExtEvent<() => void>;
    // Opening the settings from the bubble. Needs no permission: it is this
    // extension's own page.
    openOptionsPage(): Promise<void>;
    // Which OS this is - the whole of how the reader-only default flips on
    // Android. Needs no permission; not available to content scripts, which is
    // why the background publishes the answer to storage (`PLATFORM_KEY`).
    getPlatformInfo(): Promise<{ os: string }>;
  };
  // Whether this page sits in a private window or tab. Firefox gives an
  // extension page there its own storage partition - an IndexedDB in memory,
  // empty, gone with the private session - while the background keeps the
  // real one; the pages say so at their top (`private-note.js`). Optional:
  // Chromium's extension pages share one database in both modes and answer
  // false, which is the right answer there. Needs no permission.
  extension?: { inIncognitoContext: boolean };
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    // Same shape, different lifetime: cleared when the browser closes. That is
    // where the reader's tab id lives, because a tab id outliving the browser
    // would name a different tab. Under the `storage` permission, and out of
    // reach of content scripts unless an extension says otherwise.
    session: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    // How a page finds out that the vocabulary changed in another tab, without
    // anything having to be told which tabs exist.
    onChanged: WebExtEvent<
      (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void
    >;
  };
  tabs: {
    create(properties: { url: string; active?: boolean }): Promise<WebExtTab>;
    // Bringing the reader back instead of opening a second one. Selecting a tab
    // needs no permission; the call rejects for a tab that is gone, which is how
    // this finds out. Reading `url` or `title` is what would need `tabs`, and
    // nothing here does. Turning a tab to another page of this extension
    // (`url`, D147) needs none either: an extension may navigate a tab to its
    // own pages on both engines, and the only address ever passed is one of
    // them.
    update(tabId: number, properties: { active?: boolean; url?: string }): Promise<WebExtTab>;
    // Which tab the popup opened over. Without the `tabs` permission the answer
    // carries an id and no address - and the id is all that is asked for; which
    // site the tab is showing is what the tab itself answers (`page-info`).
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<WebExtTab[]>;
    // Which tab this extension page itself lives in - how the reader signs its
    // own tab id back into session storage on every arrival, the returns
    // through history from the settings walk included (D139). Needs no
    // permission; answers undefined outside a tab.
    getCurrent(): Promise<WebExtTab | undefined>;
    // Asking a page a question - the background for the page itself, the popup
    // for its hostname; the only messages that travel toward a tab. Needs no
    // permission beyond the host permission that put the content script there;
    // rejects when there is no content script to hear it, and that rejection is
    // itself an answer: nothing to read, nothing to switch off.
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  windows: {
    // A tab selected in a window nobody is looking at is not a tab anybody sees.
    // Needs no permission either.
    update(windowId: number, properties: { focused?: boolean }): Promise<unknown>;
  };
  i18n: {
    // The one call the whole of localization needs: a key in, the catalogue's
    // sentence out, `""` for a key no catalogue has. Needs no permission and is
    // available in every context this extension runs in, content scripts
    // included; the catalogue is picked by the browser's UI language, with
    // `default_locale` as the floor.
    getMessage(messageName: string, substitutions?: string | string[]): string;
    // The browser's own language detector (D193): CLD2 behind Firefox's
    // `LanguageDetector`, CLD3 in Chromium - offline, no permission, no
    // network. Optional because WebKit does not promise it; reach it through
    // `detectLanguage` in lib/detect.js, which treats its absence as "no
    // verdict". The languages come with the share of the text in each.
    detectLanguage?(text: string): Promise<{ isReliable: boolean; languages: { language: string; percentage: number }[] }>;
  };
  // Optional because Firefox on Android does not have it - no keyboard, no
  // API - and the type saying "always there" is what let an unguarded access
  // slip through `tsc` and throw partway through the background's top level.
  // Reach it through `commandsApi()` in browser.js, never directly.
  commands?: {
    // The keyboard's way into the reader, `commands` in the manifest - a
    // manifest key, not a permission. The tab is the one the shortcut was
    // pressed over: the same tab `action.onClicked` handed over when the button
    // opened the reader directly, before it opened the popup.
    onCommand: WebExtEvent<(command: string, tab?: WebExtTab) => void>;
  };
  // The right-click menu (D188): Firefox calls it `menus` and answers to
  // `contextMenus` as well; Chromium and Safari know only the latter, so that
  // is the one name used. Under the `contextMenus` permission, which neither
  // store shows a warning for. Optional because Firefox on Android has no
  // menu for extensions at all - reach it through `contextMenusApi()` in
  // browser.js, never directly, for the reason `commands` is guarded.
  contextMenus?: {
    // Rows are kept by the browser once made: Firefox persists an event
    // page's menus and recreates them at startup, Chromium stores a service
    // worker's - so they are created once, in `onInstalled`, after a wipe.
    create(properties: {
      id: string;
      parentId?: string;
      title: string;
      contexts: string[];
      documentUrlPatterns?: string[];
    }): unknown;
    removeAll(): Promise<void>;
    // The tab is the one the menu was opened over - the same tab the keyboard
    // shortcut brings along, and the only way to learn it without `tabs`.
    onClicked: WebExtEvent<(info: { menuItemId: string | number }, tab?: WebExtTab) => void>;
  };
  action: {
    // How the Chromium package matches the toolbar icon to the browser's
    // color scheme (`src/lib/theme-icon.js`) - Chrome has no theme-aware
    // manifest icons. Firefox has the API too, but its `theme_icons` makes
    // calling it unnecessary, and the gating in theme-icon.js never does.
    setIcon(details: { path: Record<number | string, string> }): Promise<void>;
  };
  // Chromium only, under the `offscreen` permission its manifest carries, and
  // absent on Firefox - which is exactly how the background picks an engine
  // path (`offscreenApi()` in browser.js). The one page it creates hosts the
  // translation engine's worker, because a service worker cannot spawn one.
  offscreen?: {
    createDocument(parameters: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
  };
}

declare var browser: WebExtBrowser | undefined;
declare var chrome: WebExtBrowser | undefined;
