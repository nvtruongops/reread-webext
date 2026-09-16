/**
 * Vietnamese (vi) language utilities.
 * Vietnamese is an isolating language without inflectional affixes,
 * but relies heavily on Unicode NFC normalization and compound word phrasing.
 */

/**
 * Normalizes Vietnamese text to canonical Unicode NFC.
 * @param {string} text
 * @returns {string}
 */
export function normalizeVietnamese(text) {
  return typeof text === "string" ? text.normalize("NFC") : "";
}

/**
 * Decomposes Vietnamese compound phrases into individual syllables / tokens.
 * @param {string} phrase
 * @returns {string[]}
 */
export function vietnameseTokens(phrase) {
  if (!phrase || typeof phrase !== "string") return [];
  const normalized = normalizeVietnamese(phrase.trim());
  return normalized.split(/\s+/).filter((s) => s.length > 0);
}
