import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baseForms, isRuledLanguage, RULED_LANGUAGES } from "../src/lib/dict/deinflect.js";
import { normalizeVietnamese, vietnameseTokens } from "../src/lib/dict/rules/vi.js";

describe("Multilingual Deinflection Engine (Phase 3)", () => {
  it("recognizes supported languages", () => {
    assert.equal(isRuledLanguage("en"), true);
    assert.equal(isRuledLanguage("de"), true);
    assert.equal(isRuledLanguage("fr"), true);
    assert.equal(isRuledLanguage("es"), true);
    assert.equal(isRuledLanguage("pl"), true);
    assert.equal(isRuledLanguage("vi"), true);
    assert.equal(isRuledLanguage("unsupported_lang"), false);
  });

  it("preserves existing English deinflection capability", () => {
    const readingForms = baseForms("reading", "en");
    assert.ok(readingForms.includes("read"), "reading should reduce to read");

    const stoppedForms = baseForms("stopped", "en");
    assert.ok(stoppedForms.includes("stop"), "stopped should reduce to stop");

    // Backwards compatibility with no language parameter
    const legacyReading = baseForms("reading");
    assert.ok(legacyReading.includes("read"));
  });

  it("reduces German verb and noun inflections to base forms", () => {
    const sagtenForms = baseForms("sagten", "de");
    assert.ok(sagtenForms.includes("sagen"), "sagten -> sagen");

    const gekauftForms = baseForms("gekauft", "de");
    assert.ok(gekauftForms.includes("kaufen"), "gekauft -> kaufen");

    const kinderForms = baseForms("Kinder", "de");
    assert.ok(kinderForms.includes("kind"), "Kinder -> Kind");
  });

  it("reduces French verb and adjective inflections to base forms", () => {
    const aimeraitForms = baseForms("aimerait", "fr");
    assert.ok(aimeraitForms.includes("aimer"), "aimerait -> aimer");

    const grandesForms = baseForms("grandes", "fr");
    assert.ok(grandesForms.includes("grand"), "grandes -> grand");
  });

  it("reduces Spanish verb inflections to base forms", () => {
    const hablaronForms = baseForms("hablaron", "es");
    assert.ok(hablaronForms.includes("hablar"), "hablaron -> hablar");

    const viviendoForms = baseForms("viviendo", "es");
    assert.ok(viviendoForms.includes("vivir"), "viviendo -> vivir");
  });

  it("reduces Polish noun declensions to base nominative forms", () => {
    const ksiazkamiForms = baseForms("książkami", "pl");
    assert.ok(ksiazkamiForms.includes("książka"), "książkami -> książka");

    const domowForms = baseForms("domów", "pl");
    assert.ok(domowForms.includes("dom"), "domów -> dom");
  });

  it("handles Vietnamese canonical Unicode normalization and tokenization", () => {
    // Composed vs Decomposed NFC test
    const decomposed = "Ti\u00EA\u0301ng Vi\u00EA\u0323t"; // Tiếng Việt in NFD
    const normalized = normalizeVietnamese(decomposed);
    assert.equal(normalized, "Tiếng Việt");

    const tokens = vietnameseTokens("học sinh giỏi");
    assert.deepEqual(tokens, ["học", "sinh", "giỏi"]);
  });
});
