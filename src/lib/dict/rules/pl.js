/**
 * Polish (pl) morphological deinflection rules.
 * Handles nominal and adjectival case inflections (deklinacja).
 */

/** @type {readonly { suffix: string, replacement: string }[]} */
export const POLISH_RULES = Object.freeze([
  { suffix: "iom", replacement: "ia" },
  { suffix: "ami", replacement: "a" },   // książkami -> książka
  { suffix: "ach", replacement: "a" },   // książkach -> książka
  { suffix: "om", replacement: "a" },    // książkom -> książka
  { suffix: "owi", replacement: "" },    // psu -> pies, domowi -> dom
  { suffix: "ów", replacement: "" },     // domów -> dom
  { suffix: "em", replacement: "" },     // domem -> dom
  { suffix: "ie", replacement: "" },     // świecie -> świat
  { suffix: "ej", replacement: "a" },    // dobrej -> dobra
  { suffix: "ym", replacement: "y" },    // dobrym -> dobry
  { suffix: "im", replacement: "i" },    // tanim -> tani
  { suffix: "ą", replacement: "a" },     // dobrą -> dobra
  { suffix: "ę", replacement: "a" },     // książkę -> książka
]);
