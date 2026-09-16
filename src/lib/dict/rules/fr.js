/**
 * French (fr) morphological deinflection rules.
 * Handles verb tenses (imparfait, conditionnel, participe passé) and adjective/noun agreements.
 */

/** @type {readonly { suffix: string, replacement: string }[]} */
export const FRENCH_RULES = Object.freeze([
  { suffix: "assions", replacement: "er" },
  { suffix: "assiez", replacement: "er" },
  { suffix: "eraient", replacement: "er" },
  { suffix: "erait", replacement: "er" },
  { suffix: "erions", replacement: "er" },
  { suffix: "eriez", replacement: "er" },
  { suffix: "eront", replacement: "er" },
  { suffix: "erons", replacement: "er" },
  { suffix: "aient", replacement: "er" }, // aimaient -> aimer
  { suffix: "erais", replacement: "er" },
  { suffix: "eras", replacement: "er" },
  { suffix: "erai", replacement: "er" },
  { suffix: "ions", replacement: "er" },  // aimions -> aimer
  { suffix: "iez", replacement: "er" },
  { suffix: "ais", replacement: "er" },
  { suffix: "ait", replacement: "er" },
  { suffix: "ées", replacement: "er" },   // aimées -> aimer
  { suffix: "ée", replacement: "er" },    // aimée -> aimer
  { suffix: "és", replacement: "er" },    // aimés -> aimer
  { suffix: "é", replacement: "er" },     // aimé -> aimer
  { suffix: "issant", replacement: "ir" }, // finissant -> finir
  { suffix: "issent", replacement: "ir" }, // finissent -> finir
  { suffix: "isses", replacement: "ir" },
  { suffix: "isse", replacement: "ir" },
  { suffix: "irent", replacement: "ir" },
  { suffix: "iraient", replacement: "ir" },
  { suffix: "irait", replacement: "ir" },
  { suffix: "iras", replacement: "ir" },
  { suffix: "irai", replacement: "ir" },
  { suffix: "is", replacement: "ir" },
  { suffix: "it", replacement: "ir" },
  { suffix: "es", replacement: "" },      // grandes -> grand
  { suffix: "s", replacement: "" },       // livres -> livre
  { suffix: "e", replacement: "" },       // grande -> grand
]);
