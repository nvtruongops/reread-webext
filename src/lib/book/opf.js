/**
 * Reading an EPUB's table of contents - the OCF container, the OPF package -
 * without a parser in sight. The caller parses XML (`DOMParser` on the reader
 * page); this module only walks what came out, through four properties an
 * element has in any DOM: `localName`, `getAttribute`, `children`,
 * `textContent`. That is what lets every decision here run under `node --test`
 * against hand-built trees.
 *
 * Namespaces are deliberately ignored: elements are matched by `localName`
 * alone. EPUB 2 writes `<dc:title>` and EPUB 3 may write it with any prefix,
 * but the local names - `rootfile`, `item`, `itemref`, `title`, `creator`,
 * `language` - are the stable part of both editions, and matching them is
 * what makes one path serve the two.
 */

/**
 * The least an element has to be to be walked here. A DOM `Element`
 * satisfies it as-is.
 *
 * @typedef {{
 *   localName: string,
 *   getAttribute: (name: string) => string | null,
 *   children: Iterable<XmlEl>,
 *   textContent: string | null,
 * }} XmlEl
 */

/** Spine entries are text; anything else a spine points at is skipped. */
const CONTENT_TYPES = new Set(["application/xhtml+xml", "text/html"]);

/**
 * @param {XmlEl} root
 * @param {string} localName
 * @returns {XmlEl[]} every element under (and including) `root` by that name
 */
function elements(root, localName) {
  /** @type {XmlEl[]} */
  const found = [];
  /** @type {XmlEl[]} */
  const queue = [root];
  while (queue.length > 0) {
    const el = /** @type {XmlEl} */ (queue.shift());
    if (el.localName === localName) found.push(el);
    for (const child of el.children) queue.push(child);
  }
  return found;
}

/**
 * @param {XmlEl} root
 * @param {string} localName
 * @returns {string | null} the first such element's text, trimmed, or nothing
 */
function firstText(root, localName) {
  for (const el of elements(root, localName)) {
    const text = (el.textContent ?? "").trim();
    if (text.length > 0) return text;
  }
  return null;
}

/**
 * Where the package document lives, read from `META-INF/container.xml`: the
 * first `rootfile` that declares the OPF media type. Or nothing, which means
 * the file is not an EPUB anybody can open.
 *
 * @param {XmlEl} containerRoot
 * @returns {string | null} a path inside the archive
 */
export function containerOpfPath(containerRoot) {
  for (const rootfile of elements(containerRoot, "rootfile")) {
    if (rootfile.getAttribute("media-type") !== "application/oebps-package+xml") continue;
    const path = rootfile.getAttribute("full-path");
    if (typeof path === "string" && path.length > 0) return path;
  }
  return null;
}

/**
 * What of the OPF this extension reads: three metadata strings and the spine
 * as hrefs, in reading order. EPUB 2 and 3 come through the same walk.
 *
 * The spine is `itemref`s resolved through the manifest, minus what is not
 * text to read: entries whose manifest item is missing or not XHTML, and
 * entries marked `linear="no"` - covers and inserts the spec itself says are
 * outside the reading order.
 *
 * @param {XmlEl} packageRoot
 * @returns {{
 *   title: string | null,
 *   author: string | null,
 *   lang: string | null,
 *   spineHrefs: string[],
 * }}
 */
export function opfPackage(packageRoot) {
  /** @type {Map<string, { href: string, mediaType: string }>} */
  const manifest = new Map();
  for (const item of elements(packageRoot, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") ?? "";
    if (typeof id === "string" && id.length > 0 && typeof href === "string" && href.length > 0) {
      manifest.set(id, { href, mediaType });
    }
  }

  /** @type {string[]} */
  const spineHrefs = [];
  for (const itemref of elements(packageRoot, "itemref")) {
    if (itemref.getAttribute("linear") === "no") continue;
    const idref = itemref.getAttribute("idref");
    if (typeof idref !== "string") continue;
    const item = manifest.get(idref);
    if (item !== undefined && CONTENT_TYPES.has(item.mediaType)) spineHrefs.push(item.href);
  }

  return {
    title: firstText(packageRoot, "title"),
    author: firstText(packageRoot, "creator"),
    lang: firstText(packageRoot, "language"),
    spineHrefs,
  };
}

/**
 * The directory an OPF's hrefs are written against - the path of the OPF
 * itself, minus its file name.
 *
 * @param {string} opfPath
 * @returns {string} `"OEBPS"`, or `""` for an OPF at the archive root
 */
export function opfDirectory(opfPath) {
  const at = opfPath.lastIndexOf("/");
  return at === -1 ? "" : opfPath.slice(0, at);
}

/**
 * A manifest href as a key into the archive: fragment and query stripped,
 * percent-escapes decoded (`My%20Book.xhtml` names `My Book.xhtml` in the
 * ZIP), `.` and `..` resolved against the OPF's directory. Nothing may climb
 * out of the archive - an href that ends up above the root is answered with
 * nothing, not with a guess.
 *
 * @param {string} baseDir as `opfDirectory` answers
 * @param {string} href as written in the manifest
 * @returns {string | null}
 */
export function resolveZipPath(baseDir, href) {
  const bare = href.split("#")[0]?.split("?")[0] ?? "";
  if (bare.length === 0) return null;

  /** @type {string} */
  let decoded;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A percent sign that is not an escape. The ZIP may genuinely contain
    // such a name, so the href is taken as written rather than dropped.
    decoded = bare;
  }

  // An absolute href is archive-rooted; a relative one starts at the OPF.
  const fromRoot = decoded.startsWith("/");
  const start = fromRoot ? [] : baseDir.split("/").filter((part) => part.length > 0);

  /** @type {string[]} */
  const parts = start;
  for (const part of decoded.split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length === 0 ? null : parts.join("/");
}

/**
 * Whether the archive declares encrypted content - the standard place DRM
 * announces itself. Presence is enough: a book whose text is encrypted
 * cannot be imported, and saying so beats failing chapter by chapter.
 *
 * @param {string[]} names every entry name in the archive
 * @returns {boolean}
 */
export function hasEncryption(names) {
  return names.includes("META-INF/encryption.xml");
}

/**
 * An archive entry as text. EPUB mandates UTF-8 or UTF-16 for its XML, and
 * UTF-16 must carry a byte-order mark - so the mark is the whole decision.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeXml(bytes) {
  const label =
    bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  return new TextDecoder(label).decode(bytes);
}
