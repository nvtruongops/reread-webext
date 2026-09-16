/**
 * Spanish (es) morphological deinflection rules.
 * Handles verb conjugations (-ar, -er, -ir) and plural endings.
 */

/** @type {readonly { suffix: string, replacement: string }[]} */
export const SPANISH_RULES = Object.freeze([
  { suffix: "áramos", replacement: "ar" },
  { suffix: "iéramos", replacement: "er" },
  { suffix: "aremos", replacement: "ar" },
  { suffix: "eremos", replacement: "er" },
  { suffix: "iremos", replacement: "ir" },
  { suffix: "arían", replacement: "ar" },
  { suffix: "erían", replacement: "er" },
  { suffix: "irían", replacement: "ir" },
  { suffix: "arías", replacement: "ar" },
  { suffix: "erías", replacement: "er" },
  { suffix: "irías", replacement: "ir" },
  { suffix: "aron", replacement: "ar" },   // hablaron -> hablar
  { suffix: "ieron", replacement: "er" },  // comieron -> comer
  { suffix: "ando", replacement: "ar" },   // hablando -> hablar
  { suffix: "iendo", replacement: "ir" },  // viviendo -> vivir
  { suffix: "ado", replacement: "ar" },    // hablado -> hablar
  { suffix: "ido", replacement: "er" },    // comido -> comer
  { suffix: "aba", replacement: "ar" },    // hablaba -> hablar
  { suffix: "abas", replacement: "ar" },
  { suffix: "ábamos", replacement: "ar" },
  { suffix: "aban", replacement: "ar" },
  { suffix: "ían", replacement: "er" },
  { suffix: "ías", replacement: "er" },
  { suffix: "ía", replacement: "er" },
  { suffix: "es", replacement: "" },       // casas -> casa
  { suffix: "s", replacement: "" },        // libros -> libro
]);
