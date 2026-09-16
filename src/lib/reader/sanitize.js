/**
 * What of somebody else's HTML is allowed into the reader, decided without
 * touching a DOM so that it can be tested.
 *
 * This is the security boundary of the whole extension. The reader is an
 * extension page, and an extension page with `<all_urls>` running a script from
 * a website would be the worst thing that could happen in this codebase. Three
 * barriers stand in the way and each works on its own: the document is parsed
 * by `DOMParser`, which has no browsing context and runs nothing; the tree is
 * rebuilt from this list rather than assigned as `innerHTML`; and the manifest's
 * content security policy denies every remote resource.
 *
 * The list is an allow list, not a deny list. Anything nobody thought about
 * loses its element - never its text.
 */

import { resolveZipPath } from "../book/opf.js";

/**
 * Elements copied as themselves: the shape of a text, and nothing that loads,
 * runs, submits or plays.
 */
const KEPT = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "q", "cite", "pre", "code", "kbd", "samp", "var",
  "em", "strong", "i", "b", "u", "s", "del", "ins", "small", "mark", "sub", "sup",
  "abbr", "time", "span", "div", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd",
  "figure", "figcaption", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a",
]);

/**
 * Elements dropped with everything inside them. Two kinds, and the second is
 * the reason this list is not simply "things that execute":
 *
 *   - anything that runs, loads or submits (`script`, `iframe`, `form`, ...),
 *   - anything whose text is not text for reading - `head`, `style`, and
 *     `noscript`, whose content is markup the browser deliberately did not use.
 *
 * `img` is not here, and not on the kept list either: it is the one element
 * with a fourth answer (D145). A picture is never loaded from where the page
 * had it - the reader's policy forbids every remote picture, and this
 * extension fetches one only on the press of "Save pictures" - but its
 * address is kept, in an attribute nothing loads from (`article.js`), so
 * that the press has something to ask for. `picture` is left to unwrap: its
 * `<source>` variants go, its `<img>` stays.
 */
const DROPPED = new Set([
  "script", "style", "noscript", "template", "head", "title", "meta", "link", "base",
  "iframe", "frame", "frameset", "object", "embed", "applet", "portal",
  "canvas", "svg", "math", "video", "audio", "source", "track", "map", "area",
  "form", "input", "button", "select", "textarea", "option", "optgroup", "label",
  "fieldset", "legend", "dialog", "menu", "slot",
]);

/**
 * Attributes kept per element. Everything else goes, including `class`, `id`
 * and `style` - which is not only safety. Dropping them is what makes the
 * reader's typography the reader's: a page cannot bring its own layout in.
 */
const ATTRIBUTES = new Map([
  // `data-note` is our own footnote carrier (book/notes.js): the note's text,
  // resolved at book import, shown by the reader in a popover through
  // `textContent` and nothing else. Letting it through is a deliberate
  // widening of this boundary - the value is inert prose by construction,
  // never parsed, never an address - and the article rebuild caps its length
  // (`article.js`), so no page can ride an oversized value through here.
  ["a", ["href", "data-note"]],
  ["abbr", ["title"]],
  ["time", ["datetime"]],
  ["th", ["colspan", "rowspan", "scope"]],
  ["td", ["colspan", "rowspan"]],
  ["ol", ["start", "reversed", "type"]],
  ["li", ["value"]],
  ["blockquote", ["cite"]],
  ["q", ["cite"]],
  // Its address is not an attribute copied but a decision made (`safeSrc`).
  ["img", ["alt"]],
]);

/** Kept on anything, because both are about reading the text, not styling it. */
const EVERYWHERE = ["lang", "dir"];

/**
 * Schemes a link may point at. `javascript:` is the one everybody names, but
 * `data:` matters as much: a `data:text/html` link opens a document that would
 * inherit this page's origin in some browsers, and no article needs one.
 */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** @typedef {"keep" | "drop" | "unwrap" | "image"} Decision */

/**
 * Four answers, not two. Unwrapping is what keeps an article whose paragraphs
 * live inside `<article>`, `<section>` or some site's own custom element: the
 * element goes, its children stay. Dropping that instead would lose the text
 * for no gain, since the element itself carries nothing once its attributes are
 * gone. The fourth is `img` alone: kept as a picture, which is neither a copy
 * of the element nor nothing - `article.js` decides what of it stands.
 *
 * @param {string} tagName as the DOM spells it, any case
 * @returns {Decision}
 */
export function decide(tagName) {
  const name = tagName.toLowerCase();
  if (name === "img") return "image";
  if (DROPPED.has(name)) return "drop";
  if (KEPT.has(name)) return "keep";
  return "unwrap";
}

/**
 * @param {string} tagName
 * @returns {string[]} attribute names worth asking this element for
 */
export function allowedAttributes(tagName) {
  return [...(ATTRIBUTES.get(tagName.toLowerCase()) ?? []), ...EVERYWHERE];
}

/**
 * A link's destination, made absolute, or nothing.
 *
 * Absolute because the reader is served from `moz-extension://` and a relative
 * link would resolve against that - a link into the extension's own package
 * rather than the site. Readability does this too, but only when it was given a
 * base URL; this is the place that cannot be skipped.
 *
 * @param {unknown} value the `href` as written in the page
 * @param {string} base the address the page came from
 * @returns {string | null}
 */
export function safeHref(value, base) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value, base);
    return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    // Not a URL at all, which is a link nobody can follow either way.
    return null;
  }
}

/**
 * A picture's address, made absolute, or nothing - and `https:` alone. The
 * reader page may connect to nothing else (`connect-src`), so any other
 * scheme is a picture "Save pictures" could never fetch; `data:` in
 * particular would be the picture's bytes riding in the text of every save,
 * asked for or not. Absolute for the reason `safeHref` gives, and with no
 * base to resolve against every address fails - which is what a book's
 * pictures would meet here, and why they take `archiveSrc` instead.
 *
 * @param {unknown} value the `src` as written in the page
 * @param {string} base the address the page came from
 * @returns {string | null}
 */
export function safeSrc(value, base) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** An address that names its scheme - `https:`, `data:`, `javascript:` - rather than a path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A picture's place inside a book's archive (D183), or nothing. A book's
 * pictures are not on any server: they sit in the file the book came from,
 * and their address is the entry's path in that archive - resolved at
 * import against the chapter that shows them, and at render against the
 * root, where the stored address is already whole. `resolveZipPath` settles
 * the path and refuses one that climbs out of the archive; an address with
 * a scheme is refused before it: a remote picture in a book is not in the
 * file, and `data:` would be the picture's bytes riding in the text.
 *
 * @param {unknown} value the `src` as the chapter writes it, or as stored
 * @param {string} directory the archive directory the address is written against
 * @returns {string | null}
 */
export function archiveSrc(value, directory) {
  if (typeof value !== "string" || value.length === 0 || SCHEME.test(value)) return null;
  return resolveZipPath(directory, value);
}
