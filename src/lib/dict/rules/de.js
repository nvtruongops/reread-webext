/**
 * German (de) morphological deinflection rules.
 * Handles verb tenses (Präteritum, Partizip II) and noun plural/genitive endings.
 */

/** @type {readonly { suffix: string, replacement: string, prefix?: string }[]} */
export const GERMAN_RULES = Object.freeze([
  { suffix: "test", replacement: "en" }, // sagtest -> sagen
  { suffix: "tet", replacement: "en" },  // sagtet -> sagen
  { suffix: "ten", replacement: "en" },  // sagten -> sagen
  { suffix: "te", replacement: "en" },   // sagte -> sagen
  { suffix: "t", replacement: "en", prefix: "ge" }, // gekauft -> kaufen
  { suffix: "en", replacement: "", prefix: "ge" }, // gesehen -> sehen
  { suffix: "en", replacement: "" },     // Frauen -> Frau, gehen -> geh
  { suffix: "er", replacement: "" },     // Kinder -> Kind, Bilder -> Bild
  { suffix: "es", replacement: "" },     // Tages -> Tag
  { suffix: "e", replacement: "" },      // Tage -> Tag, Hunde -> Hund
  { suffix: "s", replacement: "" },      // Autos -> Auto
]);
