/**
 * The page as the reader gets it: a serialization of the live document that
 * parses back into the tree the page had.
 *
 * `documentElement.outerHTML` is not quite that, because of one element. A
 * page with scripting on reads `<noscript>` as raw text: everything up to the
 * first `</noscript>` is a single text node, and a `</noscript>` with nothing
 * left to close is dropped. Serialized, that text comes out verbatim. The
 * reader parses it with `DOMParser`, which has no scripting and so reads
 * `<noscript>` as an element with children - and a fallback nested inside a
 * fallback (LiteSpeed's lazy-load copy of a Tag Manager iframe, on every
 * goodereader.com article, 2026-09-05) then opens two `<noscript>` and closes
 * one: the rest of the page, article included, lands inside the survivor, and
 * Readability drops `noscript` whole - "there was no article on that page".
 * Firefox's reader view never meets this: `XMLSerializer` writes that text
 * escaped, and a failed parse there is retried from the network anyway,
 * which this extension has promised never to do.
 *
 * So the page goes out as a copy in a document without scripting, where the
 * text each `<noscript>` holds has been parsed into the elements it spells:
 * balanced by construction, and still elements, which is what Readability's
 * `<noscript><img>` unwrapping reads. The copy is inert (no browsing context,
 * so nothing loads and nothing runs), and the live page is not touched.
 */

/**
 * @typedef {object} Spelled
 *   the two halves of a parsed document, in as much of one as the copy reads
 * @property {{ childNodes: Iterable<Node | string> }} head
 * @property {{ childNodes: Iterable<Node | string> }} body
 */

/**
 * @typedef {object} PageHtmlDeps
 * @property {(html: string) => Spelled} [parse]
 *   the HTML parser without scripting; `DOMParser` unless a test says otherwise
 */

/**
 * @param {Document} doc the live page
 * @param {PageHtmlDeps} [deps]
 * @returns {string} the page's markup; empty when the page has no root element
 */
export function pageHtml(doc, deps = {}) {
  const root = doc.documentElement;
  if (root === null) return "";
  // With no `noscript` anywhere there is no raw text to re-read, and the live
  // tree's own serialization parses back faithfully - no copy needed.
  if (doc.getElementsByTagName("noscript").length === 0) return root.outerHTML;

  const parse =
    deps.parse ?? ((html) => new DOMParser().parseFromString(html, "text/html"));
  const copy = doc.implementation.createHTMLDocument("");
  copy.documentElement.replaceWith(copy.importNode(root, true));
  for (const noscript of copy.querySelectorAll("noscript")) {
    // Element children mean a script built this one: already a tree, nothing
    // to re-read. The parser's own `<noscript>` holds text and nothing else.
    if (noscript.childElementCount > 0) continue;
    const text = noscript.textContent ?? "";
    if (text.trim() === "") continue;
    // A whole document rather than a fragment, so the head's share (a
    // stylesheet link, a meta) keeps its place ahead of the body's. The
    // nodes adopt into the copy as they are appended.
    const spelled = parse(text);
    noscript.replaceChildren(...spelled.head.childNodes, ...spelled.body.childNodes);
  }
  return copy.documentElement.outerHTML;
}
