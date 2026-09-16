/**
 * Bionic Reading visual fixation engine.
 * Emboldens the initial 30-50% of each word to create artificial fixation points
 * that guide the eye and improve foreign language reading speed.
 */

/**
 * Calculates the number of fixation characters to embolden for a given word length.
 * @param {number} length
 * @returns {number}
 */
export function fixationLength(length) {
  if (length <= 1) return 1;
  if (length <= 3) return 1;
  if (length <= 5) return 2;
  if (length <= 7) return 3;
  return Math.min(length, Math.ceil(length * 0.45));
}

/**
 * Converts a single word token into Bionic formatted HTML snippet.
 * Preserves leading/trailing punctuation and handles non-Latin UTF-8 letters.
 * @param {string} token
 * @returns {string}
 */
export function formatBionicWord(token) {
  if (!token || typeof token !== "string") return "";

  // Split into leading punctuation, word letters, and trailing punctuation
  const match = /^([^\p{L}\p{N}]*)([\p{L}\p{N}]+)([^\p{L}\p{N}]*)$/u.exec(token);
  if (!match) {
    return token;
  }

  const [, leading = "", word = "", trailing = ""] = match;
  if (word.length === 0) {
    return token;
  }

  const fixLen = fixationLength(word.length);
  const fixPart = word.slice(0, fixLen);
  const restPart = word.slice(fixLen);

  return `${leading}<b>${fixPart}</b>${restPart}${trailing}`;
}

/**
 * Transforms a plain text string or sentence into Bionic Reading HTML.
 * @param {string} text
 * @returns {string}
 */
export function toBionicHtml(text) {
  if (!text || typeof text !== "string") return "";

  // Split text by whitespace while preserving whitespace tokens
  const tokens = text.split(/(\s+)/);
  const transformed = tokens.map((part) => {
    if (/^\s+$/.test(part)) return part;
    return formatBionicWord(part);
  });

  return transformed.join("");
}
