import { GERMAN_RULES } from "./de.js";
import { FRENCH_RULES } from "./fr.js";
import { SPANISH_RULES } from "./es.js";
import { POLISH_RULES } from "./pl.js";
import { normalizeVietnamese, vietnameseTokens } from "./vi.js";

export { GERMAN_RULES, FRENCH_RULES, SPANISH_RULES, POLISH_RULES, normalizeVietnamese, vietnameseTokens };

/** @type {Record<string, readonly { suffix: string, replacement: string, prefix?: string }[]>} */
export const MULTILINGUAL_RULES = Object.freeze({
  de: GERMAN_RULES,
  fr: FRENCH_RULES,
  es: SPANISH_RULES,
  pl: POLISH_RULES,
});
