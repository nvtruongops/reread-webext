import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { inPrivateContext } from "../src/lib/browser.js";
import { privateNote } from "../src/lib/private-note.js";

const original = /** @type {any} */ (globalThis).browser;

afterEach(() => {
  /** @type {any} */ (globalThis).browser = original;
});

/**
 * The extension API as a page sees it: the catalogue the test process already
 * carries, plus what the browser says about privacy - or nothing at all, the
 * way a browser without `extension.inIncognitoContext` says it.
 *
 * @param {boolean | undefined} incognito
 */
function install(incognito) {
  /** @type {any} */ (globalThis).browser = {
    runtime: { id: "test" },
    i18n: original.i18n,
    ...(incognito === undefined ? {} : { extension: { inIncognitoContext: incognito } }),
  };
}

/** A page with the note's element in it, and nothing else. */
function fakePage() {
  const note = { textContent: "", hidden: true };
  const doc = /** @type {any} */ ({
    /** @param {string} id */
    getElementById: (id) => (id === "private-note" ? note : null),
  });
  return { note, doc };
}

describe("private browsing", () => {
  it("is what the extension API says it is", () => {
    install(true);
    assert.equal(inPrivateContext(), true);
    install(false);
    assert.equal(inPrivateContext(), false);
  });

  it("is not private on a browser that never says", () => {
    install(undefined);
    assert.equal(inPrivateContext(), false);
  });

  it("shows the note, in the catalogue's words, in a private tab", () => {
    const { note, doc } = fakePage();
    assert.equal(privateNote(doc, () => true), true);
    assert.equal(note.hidden, false);
    assert.match(note.textContent, /^You are in private browsing\./);
    assert.match(note.textContent, /Open re\/read from a normal tab/);
  });

  it("leaves the note hidden and empty in a normal tab", () => {
    const { note, doc } = fakePage();
    assert.equal(privateNote(doc, () => false), false);
    assert.equal(note.hidden, true);
    assert.equal(note.textContent, "");
  });

  it("has nothing to do on a page without the note", () => {
    const doc = /** @type {any} */ ({ getElementById: () => null });
    assert.equal(privateNote(doc, () => true), false);
  });
});
