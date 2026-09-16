import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PICTURE_CHARS, framedPictureHref, packedChars } from "../src/lib/book/pictures.js";
import { archiveSrc } from "../src/lib/reader/sanitize.js";

/**
 * The four properties the walk reads, hand-built - the same fakes
 * `opf.test.js` builds, for the same reason.
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

describe("a book's pictures (D183)", () => {
  it("weighs a picture as a screen of text in the packer's budget", () => {
    assert.equal(packedChars(0, 0), 0);
    assert.equal(packedChars(500, 0), 500);
    assert.equal(packedChars(500, 2), 500 + 2 * PICTURE_CHARS);
    // A plate on its own still weighs something, or a book of plates would
    // pack every plate into one segment.
    assert.ok(packedChars(0, 1) > 0);
  });

  it("unwraps the cover page's SVG frame around one picture, in either spelling of the address", () => {
    const epub3 = el("svg", { viewBox: "0 0 600 900" }, [
      el("image", { href: "../images/cover.jpg", width: "600", height: "900" }),
    ]);
    assert.equal(framedPictureHref(epub3), "../images/cover.jpg");

    const xlink = el("svg", {}, [
      el("title", {}, [], "Cover"),
      el("g", {}, [el("image", { "xlink:href": " cover.jpg " })]),
    ]);
    assert.equal(framedPictureHref(xlink), "cover.jpg");
  });

  it("leaves every other SVG to the sanitizer", () => {
    // Nothing inside, two pictures, a drawing beside the picture, a
    // picture with no address: none of them is a frame.
    assert.equal(framedPictureHref(el("svg")), null);
    assert.equal(
      framedPictureHref(el("svg", {}, [el("image", { href: "a.jpg" }), el("image", { href: "b.jpg" })])),
      null,
    );
    assert.equal(
      framedPictureHref(el("svg", {}, [el("rect", { width: "1" }), el("image", { href: "a.jpg" })])),
      null,
    );
    assert.equal(framedPictureHref(el("svg", {}, [el("image", { href: "  " })])), null);
    assert.equal(framedPictureHref(el("svg", {}, [el("image")])), null);
  });

  it("resolves a picture's address to its path in the archive, against the chapter", () => {
    assert.equal(archiveSrc("../images/f0010-01.jpg", "OEBPS/xhtml"), "OEBPS/images/f0010-01.jpg");
    assert.equal(archiveSrc("images/cover.jpg", "OEBPS"), "OEBPS/images/cover.jpg");
    assert.equal(archiveSrc("/OEBPS/images/cover.jpg", "OEBPS/xhtml"), "OEBPS/images/cover.jpg");
    assert.equal(archiveSrc("My%20Picture.png?x=1#frag", ""), "My Picture.png");
    // The stored address is whole already; against the root it stays as it is.
    assert.equal(archiveSrc("OEBPS/images/cover.jpg", ""), "OEBPS/images/cover.jpg");
  });

  it("refuses what is not an entry of the archive: an address with a scheme, a climb out, nothing", () => {
    assert.equal(archiveSrc("https://cdn.test/photo.jpg", "OEBPS"), null);
    assert.equal(archiveSrc("data:image/gif;base64,R0lGODlh", "OEBPS"), null);
    assert.equal(archiveSrc("javascript:alert(1)", "OEBPS"), null);
    assert.equal(archiveSrc("../../etc/passwd", "OEBPS"), null);
    assert.equal(archiveSrc("", "OEBPS"), null);
    assert.equal(archiveSrc(null, "OEBPS"), null);
    assert.equal(archiveSrc("#only-a-fragment", "OEBPS"), null);
    // A colon inside a name is not a scheme.
    assert.equal(archiveSrc("images/a:b.jpg", "OEBPS"), "OEBPS/images/a:b.jpg");
  });
});
