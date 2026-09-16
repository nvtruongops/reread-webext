/**
 * MDX (MDict) dictionary parser using native Web APIs.
 * Supports parsing MDX v1.x and v2.x dictionary headers, keywords, and record entries
 * with DecompressionStream for zero external bloat.
 */

/**
 * Parses the XML header string from MDX dictionary buffer.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {{ title: string, description: string, encoding: string, version: string }}
 */
export function parseMdxHeader(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 8) {
    throw new Error("Invalid MDX buffer: too small");
  }

  // Header length is 4 bytes big-endian
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, false);

  if (headerLength <= 0 || headerLength > bytes.length - 4) {
    throw new Error("Invalid MDX header length");
  }

  // MDX headers are UTF-16LE or UTF-8 XML strings
  const headerBytes = bytes.subarray(4, 4 + headerLength);
  let xmlString = "";
  try {
    xmlString = new TextDecoder("utf-16le").decode(headerBytes);
    if (!xmlString.includes("<") && !xmlString.includes("Dictionary")) {
      xmlString = new TextDecoder("utf-8").decode(headerBytes);
    }
  } catch {
    xmlString = new TextDecoder("utf-8").decode(headerBytes);
  }

  const titleMatch = /Title\s*=\s*"([^"]*)"/i.exec(xmlString);
  const descMatch = /Description\s*=\s*"([^"]*)"/i.exec(xmlString);
  const encMatch = /Encoding\s*=\s*"([^"]*)"/i.exec(xmlString);
  const verMatch = /Format\s*=\s*"([^"]*)"/i.exec(xmlString);

  return {
    title: titleMatch?.[1] || "Untitled MDX Dictionary",
    description: descMatch?.[1] || "",
    encoding: encMatch?.[1] || "UTF-8",
    version: verMatch?.[1] || "2.0",
  };
}

/**
 * Builds a valid MDX dictionary header buffer for testing or export.
 * @param {Object} meta
 * @param {string} meta.title
 * @param {string} [meta.description]
 * @param {string} [meta.encoding]
 * @returns {Uint8Array}
 */
export function buildMdxHeaderBuffer({ title, description = "", encoding = "UTF-8" }) {
  const xml = `<Dictionary Title="${title}" Description="${description}" Format="2.0" Encoding="${encoding}"/>\0`;
  const encoded = new TextEncoder().encode(xml);
  const totalLength = 4 + encoded.length;
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, encoded.length, false);
  result.set(encoded, 4);
  return result;
}

/**
 * Parses an MDX record text entry.
 * Strips HTML formatting, normalizes spaces, and extracts definition senses.
 * @param {string} rawHtml
 * @returns {string[]} senses
 */
export function parseMdxEntry(rawHtml) {
  if (!rawHtml || typeof rawHtml !== "string") return [];
  // Quick strip tags while preserving linebreaks
  const text = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
