/**
 * The catalogues, held to each other and to the code.
 *
 * Localization fails quietly: `getMessage` answers a missing key with an empty
 * string, a placeholder that one language forgot simply vanishes from the
 * sentence, and English left behind in a page's markup keeps rendering until
 * somebody switches their browser's language. None of that is visible in a
 * smoke test run in one language - so all of it is checked here, statically,
 * against the same files the build copies into the package.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCALES = ["de", "en", "es", "fr", "pl", "uk", "vi"];
const PLURAL_CATEGORIES = ["one", "few", "many", "other"];

/** @typedef {{ message: string, placeholders?: Record<string, { content: string }> }} Entry */

/** @type {Map<string, Record<string, Entry>>} */
const catalogues = new Map(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(join(ROOT, "src", "_locales", locale, "messages.json"), "utf8")),
  ]),
);

const english = /** @type {Record<string, Entry>} */ (catalogues.get("en"));

/**
 * @param {string} dir
 * @param {string[]} suffixes
 * @returns {string[]} file paths under `dir` ending in any of the suffixes
 */
function filesUnder(dir, suffixes) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) found.push(path);
  }
  return found;
}

/** Every key the code asks for by name, and every plural family it counts over. */
function usedKeys() {
  /** @type {Set<string>} */
  const literal = new Set();
  /** @type {Set<string>} */
  const pluralBases = new Set();

  for (const path of filesUnder(join(ROOT, "src"), [".js"])) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bt\("([a-z0-9_]+)"/g)) literal.add(String(match[1]));
    for (const match of source.matchAll(/\bplural\(\s*[^,]+,\s*"([a-z0-9_]+)"/g)) {
      pluralBases.add(String(match[1]));
    }
  }
  for (const path of filesUnder(join(ROOT, "src"), [".html"])) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"/g)) {
      literal.add(String(match[1]));
    }
  }
  const manifest = readFileSync(join(ROOT, "src", "manifest.json"), "utf8");
  for (const match of manifest.matchAll(/__MSG_([a-z0-9_]+)__/g)) literal.add(String(match[1]));

  return { literal, pluralBases };
}

const used = usedKeys();

/**
 * A catalogue key folded to what the code asks for: plural variants collapse
 * onto their family, everything else stands for itself.
 *
 * @param {string} key
 * @returns {string}
 */
function baseOf(key) {
  const match = /^(.+)_(one|few|many|other)$/.exec(key);
  if (match !== null && used.pluralBases.has(String(match[1]))) return String(match[1]);
  return key;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalized(text) {
  return text.replace(/\s+/g, " ").trim();
}

describe("the locale catalogues", () => {
  it("ship exactly the promised languages, each naming itself", () => {
    // Dot-entries are never locales - they are the desk's own dirt (a
    // Finder's .DS_Store, a tool's working directory) and must not fail the
    // promise about languages. Anything else unexpected still does.
    const shipped = readdirSync(join(ROOT, "src", "_locales"))
      .filter((entry) => !entry.startsWith("."))
      .sort();
    assert.deepEqual(shipped, LOCALES);
    for (const locale of LOCALES) {
      assert.equal(catalogues.get(locale)?.["locale_code"]?.message, locale);
    }
  });

  it("say something under every key", () => {
    for (const [locale, catalogue] of catalogues) {
      for (const [key, entry] of Object.entries(catalogue)) {
        assert.ok(entry.message.length > 0, `${locale}/${key} is empty`);
      }
    }
  });

  it("keep the description inside the Chrome Web Store's limit, in every language", () => {
    // The manifest description is two things at once: the line under the name
    // in about:addons, and the Chrome Web Store's "short description", which
    // the dashboard caps at 132 characters. A catalogue that goes over is a
    // listing that will not save - discovered in the store's own form, on the
    // day the package is submitted, in whichever language happens to be long.
    for (const [locale, catalogue] of catalogues) {
      const description = catalogue["extension_description"]?.message ?? "";
      assert.ok(
        description.length <= 132,
        `${locale}: the description is ${description.length} characters, over the store's 132`,
      );
    }
  });

  it("agree with English about which keys exist", () => {
    const wanted = new Set(Object.keys(english).map(baseOf));
    for (const [locale, catalogue] of catalogues) {
      const bases = new Set(Object.keys(catalogue).map(baseOf));
      assert.deepEqual(
        [...bases].sort(),
        [...wanted].sort(),
        `${locale} does not cover the same messages as en`,
      );
    }
  });

  it("only use plural categories their language counts with", () => {
    for (const [locale, catalogue] of catalogues) {
      const counted = /** @type {string[]} */ (
        new Intl.PluralRules(locale).resolvedOptions().pluralCategories
      );
      for (const base of used.pluralBases) {
        assert.ok(
          catalogue[`${base}_other`] !== undefined,
          `${locale}/${base}_other is the fallback form and must exist`,
        );
        for (const category of PLURAL_CATEGORIES) {
          const key = `${base}_${category}`;
          if (catalogue[key] === undefined) continue;
          assert.ok(
            counted.includes(category) || category === "other",
            `${locale}/${key} names a category ${locale} never selects`,
          );
        }
      }
    }
  });

  it("declare the placeholders English declares, and use every one", () => {
    for (const [locale, catalogue] of catalogues) {
      for (const [key, entry] of Object.entries(catalogue)) {
        // Plural variants may not exist in en (en has no _few); their contract
        // is the family's, so they are compared against the en _other form.
        const reference =
          english[key] ?? english[`${baseOf(key)}_other`] ?? english[baseOf(key)];
        assert.ok(reference !== undefined, `${locale}/${key} has no English counterpart`);

        const declared = Object.keys(entry.placeholders ?? {}).map((name) => name.toLowerCase());
        const wanted = Object.keys(reference.placeholders ?? {}).map((name) => name.toLowerCase());
        assert.deepEqual(
          declared.sort(),
          wanted.sort(),
          `${locale}/${key} declares different placeholders than en`,
        );

        for (const [name, { content }] of Object.entries(entry.placeholders ?? {})) {
          assert.match(content, /^\$[1-9]$/, `${locale}/${key} placeholder ${name}`);
          const mentioned = new RegExp(`\\$${name}\\$`, "i").test(entry.message);
          assert.ok(mentioned, `${locale}/${key} never says $${name.toUpperCase()}$`);
        }
      }
    }
  });

  it("tell the error codes apart in every language", () => {
    for (const [locale, catalogue] of catalogues) {
      const sentences = Object.entries(catalogue)
        .filter(([key]) => key.startsWith("error_"))
        .map(([, entry]) => entry.message);
      assert.equal(
        new Set(sentences).size,
        sentences.length,
        `${locale} says the same thing about two different errors`,
      );
    }
  });

  it("cover every key the code, the pages and the manifest ask for", () => {
    for (const key of used.literal) {
      assert.ok(english[key] !== undefined, `en is missing "${key}"`);
    }
    for (const base of used.pluralBases) {
      assert.ok(english[`${base}_other`] !== undefined, `en is missing "${base}_other"`);
    }
  });

  it("carry no key nobody asks for", () => {
    for (const key of Object.keys(english)) {
      if (key === "locale_code") continue;
      const asked = used.literal.has(key) || used.pluralBases.has(baseOf(key));
      assert.ok(asked, `en carries "${key}" but nothing asks for it`);
    }
  });

  it("never smuggle an em-dash in", () => {
    const emDash = new RegExp("[" + String.fromCodePoint(0x2014) + "]");
    for (const [locale, catalogue] of catalogues) {
      for (const [key, entry] of Object.entries(catalogue)) {
        assert.ok(!emDash.test(entry.message), `${locale}/${key} contains an em-dash`);
      }
    }
  });
});

describe("the English written in the pages", () => {
  const pages = filesUnder(join(ROOT, "src"), [".html"]);

  it("matches the en catalogue wherever it is marked as translatable", () => {
    for (const path of pages) {
      const source = readFileSync(path, "utf8");

      // Text: from the tag that carries data-i18n to the next "<", which must
      // be the closing tag - a marked element holds text only, because the
      // swap goes through textContent and would silently eat child elements.
      for (const match of source.matchAll(/<[a-z][^>]*\sdata-i18n="([a-z0-9_]+)"[^>]*>([^<]*)</g)) {
        const [, key, fallback] = match;
        const entry = english[String(key)];
        assert.ok(entry !== undefined, `${path} names missing key ${key}`);
        assert.equal(
          normalized(String(fallback)),
          normalized(entry.message),
          `${path}: fallback for ${key} drifted from the en catalogue`,
        );
      }

      // Attributes: the plain attribute next to each data-i18n-* marker is the
      // fallback and has to say what the catalogue says.
      for (const tag of source.matchAll(/<[a-z][^>]*>/g)) {
        /** @type {Map<string, string>} */
        const attributes = new Map();
        for (const pair of String(tag[0]).matchAll(/([a-z][-a-z0-9]*)="([^"]*)"/g)) {
          attributes.set(String(pair[1]), String(pair[2]));
        }
        for (const attribute of ["title", "placeholder", "aria-label"]) {
          const key = attributes.get(`data-i18n-${attribute}`);
          if (key === undefined) continue;
          const entry = english[key];
          assert.ok(entry !== undefined, `${path} names missing key ${key}`);
          assert.equal(
            normalized(attributes.get(attribute) ?? ""),
            normalized(entry.message),
            `${path}: ${attribute} fallback for ${key} drifted from the en catalogue`,
          );
        }
      }
    }
  });

  it("marks no element that carries child elements", () => {
    for (const path of pages) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/<[a-z][^>]*\sdata-i18n="([a-z0-9_]+)"[^>]*>([^<]*)</g)) {
        const at = (match.index ?? 0) + String(match[0]).length - 1;
        assert.equal(
          source[at],
          "<",
          `${path}: element for ${match[1]} must hold text only`,
        );
        // The "<" reached must close an element, not open a child inside one.
        assert.equal(source[at + 1], "/", `${path}: element for ${match[1]} holds markup`);
      }
    }
  });
});
