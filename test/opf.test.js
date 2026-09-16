import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  containerOpfPath,
  decodeXml,
  hasEncryption,
  opfDirectory,
  opfPackage,
  resolveZipPath,
} from "../src/lib/book/opf.js";

/**
 * The four properties `opf.js` reads, hand-built - the reason it walks a
 * minimal interface at all.
 *
 * @param {string} localName
 * @param {Record<string, string>} [attrs]
 * @param {import("../src/lib/book/opf.js").XmlEl[]} [children]
 * @param {string} [text]
 * @returns {import("../src/lib/book/opf.js").XmlEl}
 */
function el(localName, attrs = {}, children = [], text = "") {
  return {
    localName,
    getAttribute: (name) => attrs[name] ?? null,
    children,
    textContent: text,
  };
}

describe("containerOpfPath", () => {
  it("finds the rootfile that declares the package", () => {
    const container = el("container", {}, [
      el("rootfiles", {}, [
        el("rootfile", { "full-path": "OEBPS/content.opf", "media-type": "application/oebps-package+xml" }),
      ]),
    ]);
    assert.equal(containerOpfPath(container), "OEBPS/content.opf");
  });

  it("passes over rootfiles of other kinds and answers nothing when none fits", () => {
    const container = el("container", {}, [
      el("rootfile", { "full-path": "cover.pdf", "media-type": "application/pdf" }),
    ]);
    assert.equal(containerOpfPath(container), null);
  });
});

describe("opfPackage", () => {
  /** The shape both EPUB editions share once namespaces are ignored. */
  const pkg = el("package", {}, [
    el("metadata", {}, [
      el("title", {}, [], "Dracula"),
      el("creator", {}, [], "Bram Stoker"),
      el("language", {}, [], "en"),
    ]),
    el("manifest", {}, [
      el("item", { id: "c1", href: "ch1.xhtml", "media-type": "application/xhtml+xml" }),
      el("item", { id: "c2", href: "ch2.xhtml", "media-type": "application/xhtml+xml" }),
      el("item", { id: "cover", href: "cover.jpg", "media-type": "image/jpeg" }),
      el("item", { id: "css", href: "style.css", "media-type": "text/css" }),
    ]),
    el("spine", {}, [
      el("itemref", { idref: "c2" }),
      el("itemref", { idref: "c1" }),
      el("itemref", { idref: "cover" }),
      el("itemref", { idref: "missing" }),
    ]),
  ]);

  it("reads the metadata and the spine in spine order", () => {
    assert.deepEqual(opfPackage(pkg), {
      title: "Dracula",
      author: "Bram Stoker",
      lang: "en",
      spineHrefs: ["ch2.xhtml", "ch1.xhtml"],
    });
  });

  it("skips spine entries marked outside the reading order", () => {
    const linear = el("package", {}, [
      el("manifest", {}, [
        el("item", { id: "c1", href: "ch1.xhtml", "media-type": "application/xhtml+xml" }),
        el("item", { id: "notes", href: "notes.xhtml", "media-type": "application/xhtml+xml" }),
      ]),
      el("spine", {}, [
        el("itemref", { idref: "notes", linear: "no" }),
        el("itemref", { idref: "c1" }),
      ]),
    ]);
    assert.deepEqual(opfPackage(linear).spineHrefs, ["ch1.xhtml"]);
  });

  it("misses no book over missing metadata", () => {
    const bare = el("package", {}, [
      el("manifest", {}, [
        el("item", { id: "c1", href: "only.xhtml", "media-type": "application/xhtml+xml" }),
      ]),
      el("spine", {}, [el("itemref", { idref: "c1" })]),
    ]);
    assert.deepEqual(opfPackage(bare), {
      title: null,
      author: null,
      lang: null,
      spineHrefs: ["only.xhtml"],
    });
  });
});

describe("resolveZipPath", () => {
  it("resolves against the OPF's directory", () => {
    assert.equal(resolveZipPath("OEBPS", "ch1.xhtml"), "OEBPS/ch1.xhtml");
    assert.equal(resolveZipPath("", "ch1.xhtml"), "ch1.xhtml");
    assert.equal(resolveZipPath("OEBPS", "text/ch1.xhtml"), "OEBPS/text/ch1.xhtml");
  });

  it("walks dots the way the archive means them", () => {
    assert.equal(resolveZipPath("OEBPS/text", "../images.xhtml"), "OEBPS/images.xhtml");
    assert.equal(resolveZipPath("OEBPS", "./ch1.xhtml"), "OEBPS/ch1.xhtml");
  });

  it("refuses a path that climbs out of the archive", () => {
    assert.equal(resolveZipPath("OEBPS", "../../etc/passwd"), null);
    assert.equal(resolveZipPath("", ".."), null);
  });

  it("drops fragments and decodes escapes before looking anything up", () => {
    assert.equal(resolveZipPath("OEBPS", "ch1.xhtml#note-3"), "OEBPS/ch1.xhtml");
    assert.equal(resolveZipPath("OEBPS", "My%20Book.xhtml"), "OEBPS/My Book.xhtml");
    assert.equal(resolveZipPath("OEBPS", "100%.xhtml"), "OEBPS/100%.xhtml");
  });

  it("reads an absolute href as archive-rooted", () => {
    assert.equal(resolveZipPath("OEBPS", "/other/ch1.xhtml"), "other/ch1.xhtml");
  });
});

describe("hasEncryption", () => {
  it("knows the one place DRM announces itself", () => {
    assert.equal(hasEncryption(["META-INF/container.xml", "META-INF/encryption.xml"]), true);
    assert.equal(hasEncryption(["META-INF/container.xml", "OEBPS/ch1.xhtml"]), false);
  });
});

describe("decodeXml", () => {
  it("reads UTF-8 without a mark, and UTF-16 by its mark", () => {
    assert.equal(decodeXml(new TextEncoder().encode("<a>ż</a>")), "<a>ż</a>");

    const utf16le = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00, 0x3e, 0x00]);
    assert.equal(decodeXml(utf16le), "<a>");

    const utf16be = new Uint8Array([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x61, 0x00, 0x3e]);
    assert.equal(decodeXml(utf16be), "<a>");
  });
});

describe("opfDirectory", () => {
  it("is the OPF's own directory, or the root", () => {
    assert.equal(opfDirectory("OEBPS/content.opf"), "OEBPS");
    assert.equal(opfDirectory("content.opf"), "");
    assert.equal(opfDirectory("a/b/package.opf"), "a/b");
  });
});
