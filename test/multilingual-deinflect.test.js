import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseForms as baseFormsEn } from "../src/lib/dict/deinflect.js";

/**
 * Prototype implementation of Multilingual Deinflection Rules as proposed in
 * docs/reread_upgrade_proposal.md (Phase 3).
 *
 * Demonstrates how pure rule tables cleanly reduce inflected word forms back
 * to their dictionary/lemma forms without external NLP bloat.
 */

/** @type {Record<string, { suffix: string, replacement: string, prefix?: string }[]>} */
const MULTILINGUAL_RULES = {
  de: [
    { suffix: "ten", replacement: "en" }, // sagten -> sagen
    { suffix: "te", replacement: "en" },  // sagte -> sagen
    { suffix: "en", replacement: "" },    // Frauen -> Frau
    { suffix: "er", replacement: "" },    // Kinder -> Kind
    { suffix: "es", replacement: "" },    // Tages -> Tag
    { suffix: "e", replacement: "" },     // Tage -> Tag
    { suffix: "t", replacement: "en", prefix: "ge" }, // gekauft -> kaufen
  ],
  fr: [
    { suffix: "aient", replacement: "er" }, // aimaient -> aimer
    { suffix: "erait", replacement: "er" }, // aimerait -> aimer
    { suffix: "ions", replacement: "er" },  // aimions -> aimer
    { suffix: "ées", replacement: "er" },   // aimées -> aimer
    { suffix: "ée", replacement: "er" },    // aimée -> aimer
    { suffix: "és", replacement: "er" },    // aimés -> aimer
    { suffix: "é", replacement: "er" },     // aimé -> aimer
    { suffix: "es", replacement: "" },      // grandes -> grand
    { suffix: "s", replacement: "" },       // livres -> livre
  ],
  es: [
    { suffix: "aron", replacement: "ar" },   // hablaron -> hablar
    { suffix: "ieron", replacement: "er" },  // comieron -> comer
    { suffix: "ando", replacement: "ar" },   // hablando -> hablar
    { suffix: "iendo", replacement: "ir" },  // viviendo -> vivir
    { suffix: "es", replacement: "" },       // casas -> casa
    { suffix: "s", replacement: "" },        // libros -> libro
  ],
  pl: [
    { suffix: "ami", replacement: "a" },  // książkami -> książka
    { suffix: "ach", replacement: "a" },  // książkach -> książka
    { suffix: "om", replacement: "a" },   // książkom -> książka
    { suffix: "ów", replacement: "" },    // domów -> dom
    { suffix: "em", replacement: "" },    // domem -> dom
  ],
};

/**
 * @param {string} word
 * @param {string} lang
 * @returns {string[]}
 */
function prototypeDeinflect(word, lang) {
  if (lang === "en") return baseFormsEn(word);
  const rules = MULTILINGUAL_RULES[lang] ?? [];
  const candidates = new Set();
  const lower = word.toLowerCase();

  for (const rule of rules) {
    if (lower.endsWith(rule.suffix)) {
      let stem = lower.slice(0, lower.length - rule.suffix.length);
      if (rule.prefix) {
        if (!stem.startsWith(rule.prefix)) continue;
        stem = stem.slice(rule.prefix.length);
      }
      const candidate = stem + rule.replacement;
      if (candidate.length >= 2 && candidate !== lower) {
        candidates.add(candidate);
      }
    }
  }

  return [...candidates];
}

describe("Multilingual Deinflection Proof of Concept (docs/reread_upgrade_proposal.md)", () => {
  it("preserves existing English deinflection capability", () => {
    const readingForms = prototypeDeinflect("reading", "en");
    assert.ok(readingForms.includes("read"), "reading should reduce to read");

    const stoppedForms = prototypeDeinflect("stopped", "en");
    assert.ok(stoppedForms.includes("stop"), "stopped should reduce to stop");
  });

  it("reduces German verb and noun inflections to base forms", () => {
    const sagtenForms = prototypeDeinflect("sagten", "de");
    assert.ok(sagtenForms.includes("sagen"), "sagten -> sagen");

    const gekauftForms = prototypeDeinflect("gekauft", "de");
    assert.ok(gekauftForms.includes("kaufen"), "gekauft -> kaufen");

    const kinderForms = prototypeDeinflect("Kinder", "de");
    assert.ok(kinderForms.includes("kind"), "Kinder -> Kind");
  });

  it("reduces French verb and adjective inflections to base forms", () => {
    const aimeraitForms = prototypeDeinflect("aimerait", "fr");
    assert.ok(aimeraitForms.includes("aimer"), "aimerait -> aimer");

    const grandesForms = prototypeDeinflect("grandes", "fr");
    assert.ok(grandesForms.includes("grand"), "grandes -> grand");
  });

  it("reduces Spanish verb inflections to base forms", () => {
    const hablaronForms = prototypeDeinflect("hablaron", "es");
    assert.ok(hablaronForms.includes("hablar"), "hablaron -> hablar");

    const viviendoForms = prototypeDeinflect("viviendo", "es");
    assert.ok(viviendoForms.includes("vivir"), "viviendo -> vivir");
  });

  it("reduces Polish noun declensions to base nominative forms", () => {
    const ksiazkamiForms = prototypeDeinflect("książkami", "pl");
    assert.ok(ksiazkamiForms.includes("książka"), "książkami -> książka");

    const domowForms = prototypeDeinflect("domów", "pl");
    assert.ok(domowForms.includes("dom"), "domów -> dom");
  });
});
