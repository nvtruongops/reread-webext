/**
 * Which lines of a dictionary entry are meanings, and which are something
 * else a book writes between them: a transcription, a part-of-speech label,
 * a cross-reference (the "Add a phrase" panel's second round, Michał's
 * brief of 2026-09-12).
 *
 * These are heuristics over plain text, for books that arrive without a
 * structure this extension keeps. The structure exists in the files - WikDict
 * marks its labels `<font class="grammar">` and its transcriptions
 * `<font color="gray">`, reader.dict writes a heading as `<p><b>Noun</b></p>`
 * - but the import keeps an entry as lines of text (`dict/text.js`), and
 * keeping a kind beside each line would change what every dictionary
 * already in a database is stored as. Read off the text, the rules work on
 * what is there, with no dictionary to add again.
 *
 * The lists hold what the files actually write, counted in the raw en-pl
 * and pl-en WikDict builds and in reader.dict's English and Polish editions
 * (2026-09-12), plus the brief's own list - not every label a grammar
 * knows. WikDict writes its labels in English in every language pair
 * (`noun`, `phraseologicalUnit`, `cardinalNumeral` in pl-en as in en-pl),
 * so the English list applies to every book, and the book's own language
 * adds its list for makers who write "Rzeczownik".
 *
 * The known miss, accepted with the brief: a translation that is itself a
 * grammar term - "noun" under the Polish "rzeczownik" in a pl-en book -
 * reads as a heading and cannot be ticked; "Your own" keeps it. Kept small
 * for that reason: words that are also everyday translations in the other
 * direction ("symbol", "idiom", "article", "particle") are left out on
 * purpose, whatever a book uses them for as headings.
 */

/**
 * @typedef {"meaning" | "heading" | "pronunciation" | "reference" | "idiom" | "example"} LineKind
 */

/**
 * The marks that make a run of letters between slashes a transcription
 * rather than a path or a fraction: the brief's set.
 */
export const IPA_MARKS = "ːəʒʃŋɪʊæɑɔʌθðɹɲ";

const IPA = new RegExp(`[${IPA_MARKS}]`, "u");

/** `/…/`, `/…/, /…/` - segments between slashes, commas between them. */
const SLASHED = /^\/[^/]+\/(?:\s*,\s*\/[^/]+\/)*$/u;

/**
 * The part-of-speech labels and section headings, by the language they are
 * written in, lower case. English first and everywhere (see the header).
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const HEADINGS = Object.freeze({
  en: [
    "noun",
    "verb",
    "adjective",
    "adverb",
    "pronoun",
    "preposition",
    "postposition",
    "conjunction",
    "interjection",
    "determiner",
    "numeral",
    "cardinalnumeral",
    "proper noun",
    "phrase",
    "phraseologicalunit",
    "proverb",
    "abbreviation",
    "acronym",
    "prefix",
    "suffix",
    "infix",
    "affix",
    "punctuation mark",
    "synonym",
    "synonyms",
    "usage note",
    "usage notes",
  ],
  pl: [
    "rzeczownik",
    "czasownik",
    "przymiotnik",
    "przysłówek",
    "zaimek",
    "przyimek",
    "spójnik",
    "wykrzyknik",
    "liczebnik",
    "partykuła",
    "skrót",
    "skrótowiec",
    "nazwa własna",
    "fraza",
    "przysłowie",
    "synonimy",
    "odmiana",
    "końcówka",
  ],
  de: [
    "substantiv",
    "verb",
    "adjektiv",
    "adverb",
    "pronomen",
    "präposition",
    "konjunktion",
    "interjektion",
    "numerale",
    "eigenname",
    "abkürzung",
    "redewendung",
    "sprichwort",
    "synonyme",
  ],
  fr: [
    "nom",
    "nom commun",
    "nom propre",
    "verbe",
    "adjectif",
    "adverbe",
    "pronom",
    "préposition",
    "conjonction",
    "interjection",
    "déterminant",
    "numéral",
    "locution",
    "abréviation",
    "synonymes",
  ],
  es: [
    "sustantivo",
    "nombre",
    "nombre propio",
    "verbo",
    "adjetivo",
    "adverbio",
    "pronombre",
    "preposición",
    "conjunción",
    "interjección",
    "determinante",
    "numeral",
    "locución",
    "abreviatura",
    "sinónimos",
  ],
  uk: [
    "іменник",
    "дієслово",
    "прикметник",
    "прислівник",
    "займенник",
    "прийменник",
    "сполучник",
    "вигук",
    "числівник",
    "власна назва",
    "скорочення",
    "фразеологізм",
    "прислів'я",
    "синоніми",
  ],
  vi: [
    "danh từ",
    "động từ",
    "tính từ",
    "phó từ",
    "trạng từ",
    "đại từ",
    "giới từ",
    "liên từ",
    "thán từ",
    "từ hạn định",
    "số từ",
    "tiền tố",
    "hậu tố",
    "từ viết tắt",
    "thành ngữ",
    "tục ngữ",
    "đồng nghĩa",
    "nguồn gốc từ",
    "đồng nghĩa/liên quan",
  ],
});

/**
 * A line that points at other words rather than saying what this one means:
 * the brief's prefixes. With the colon where the brief writes one, so that
 * a definition that happens to begin "Synonym of ..." (reader.dict writes
 * 27,000 of them) stays a meaning, and without it for the two the brief
 * gives bare and for "See also", which reader.dict writes as "See also
 * Thesaurus:...".
 */
const REFERENCE = /^(?:(?:synonyms?|antonyms?|related)\s*:|(?:hyponyms?|hypernyms?|see also)\b)/iu;

const CEFR = /^CEFR:\s*[A-C][1-2]/i;
const WATERMARK = /(?:sachxy\.com|v202[0-9]{5})/i;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isPronunciation(line) {
  const text = line.trim();
  if (CEFR.test(text)) return true;
  if (text.startsWith("/") || text.startsWith("[")) {
    return IPA.test(text) || SLASHED.test(text);
  }
  if ((text.includes(" — /") || text.includes("[UK] /") || text.includes("[US] /")) && (IPA.test(text) || SLASHED.test(text))) {
    return true;
  }
  return false;
}

/**
 * @param {string} line
 * @param {string} lang the language the entry is written in - the book's
 *   source language; a full tag ("en-US") is read by its primary subtag
 * @returns {boolean}
 */
export function isHeading(line, lang) {
  const text = line.trim().replace(/^[■•*—\-–]+\s*/u, "").replace(/\.$/u, "").toLowerCase();
  if (text.length === 0) return false;
  const own = HEADINGS[(lang.split("-")[0] ?? "").toLowerCase()] ?? [];
  return HEADINGS["en"]?.includes(text) === true || HEADINGS["vi"]?.includes(text) === true || own.includes(text);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isReference(line) {
  const text = line.trim();
  if (WATERMARK.test(text)) return true;
  if (text.startsWith("• ") || text.startsWith("■ nguồn gốc từ")) return true;
  return REFERENCE.test(text);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isExample(line) {
  const text = line.trim();
  return text.startsWith("‣") || (text.includes("↔") && !text.startsWith("★"));
}

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isIdiom(line) {
  const text = line.trim();
  return text.startsWith("★");
}

/**
 * What a line of an entry is, in the brief's order: a transcription first,
 * a label second, a cross-reference third, an idiom/example fourth, a meaning otherwise.
 *
 * @param {string} line as the book stored it, one line
 * @param {string} lang the book's source language, primary subtag
 * @returns {LineKind}
 */
export function classifyLine(line, lang) {
  if (isPronunciation(line)) return "pronunciation";
  if (isHeading(line, lang)) return "heading";
  if (isReference(line)) return "reference";
  if (isIdiom(line)) return "idiom";
  if (isExample(line)) return "example";
  return "meaning";
}
