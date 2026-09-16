/**
 * The copies in `storage.local` and private browsing (D171).
 *
 * Firefox gives an extension page in a private window its own IndexedDB -
 * in memory, empty, gone with the session (D156) - but `storage.local` is
 * one store for private and normal windows alike: its principal carries no
 * private-browsing attribute (`ExtensionStorageIDB.sys.mjs`,
 * `getStoragePrincipal`). The reading list's copy and the highlights' copy
 * are written by the pages, so without this rule an article saved, a book
 * imported or a highlight made in a private window would outlive the
 * session in the copy - the one trace private browsing promises not to
 * leave - and a deletion there would take a document out of the copy the
 * normal window still relies on.
 *
 * So in a private context the copies are read-only: restoring into the
 * empty in-memory database still works (the reading list shows there, which
 * is what a reader who slipped into private browsing wanted), and every
 * write and every removal is a no-op. The vocabulary's copy is untouched by
 * this - only the background writes it, and the background is never private.
 * Chromium's extension pages never report a private context (D156), so
 * nothing changes there.
 */

import { inPrivateContext } from "../browser.js";

/**
 * Whether this context may write the copies in `storage.local`.
 *
 * @param {() => boolean} [isPrivate] for tests; the browser's answer by default
 * @returns {boolean}
 */
export function copiesWritable(isPrivate = inPrivateContext) {
  return !isPrivate();
}
