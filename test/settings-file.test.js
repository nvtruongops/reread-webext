import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULTS, withDefaults } from "../src/lib/config.js";
import { SETTINGS_ENTRY, fromSettingsFile, toSettingsFile } from "../src/lib/store/settings-file.js";

/**
 * The settings inside the backup of everything (D213): written as they
 * stand, read back as a patch that moves only what the file holds, every
 * value through the gate every stored value passes.
 */

describe("toSettingsFile and fromSettingsFile", () => {
  it("survive a roundtrip: every key comes back as the patch that restores it", () => {
    const config = withDefaults({
      ...DEFAULTS,
      sourceLang: "en",
      targetLang: "pl",
      reader: { ...DEFAULTS.reader, theme: "sepia", fontSize: 21 },
      disabledHosts: ["example.com"],
      ttsVoices: { en: "com.apple.voice.Daniel" },
      ttsRate: 120,
      customCss: ".bubble { color: red }",
      saveSentence: true,
    });
    const text = toSettingsFile(config);
    assert.match(text, /"format": "reread-settings"/);
    assert.deepEqual(fromSettingsFile(text), config);
    assert.equal(SETTINGS_ENTRY, "settings.json");
  });

  it("moves only the keys the file holds - an older file restores what it knew", () => {
    const patch = fromSettingsFile(JSON.stringify({ format: "reread-settings", version: 1, settings: { ttsRate: 150, reader: { theme: "dark" } } }));
    assert.deepEqual(patch, { ttsRate: 150, reader: { theme: "dark" } });
  });

  it("heals every value the way the settings page would, and drops what it does not know", () => {
    const patch = fromSettingsFile(
      JSON.stringify({
        format: "reread-settings",
        settings: {
          ttsRate: 9000,
          reader: { theme: "neon", fontSize: 21, width: 3 },
          customCss: 7,
          translationOff: "yes",
          platform: "android",
          nonsense: true,
        },
      }),
    );
    assert.deepEqual(patch, {
      ttsRate: 200,
      reader: { theme: "auto", fontSize: 21 },
      customCss: "",
      translationOff: false,
    });
  });

  it("carries the pair only whole", () => {
    assert.deepEqual(fromSettingsFile(JSON.stringify({ format: "reread-settings", settings: { sourceLang: "en" } })), {});
    assert.deepEqual(fromSettingsFile(JSON.stringify({ format: "reread-settings", settings: { sourceLang: "en", targetLang: "pl" } })), {
      sourceLang: "en",
      targetLang: "pl",
    });
  });

  it("is null for a text that is not this file", () => {
    for (const text of ["not json", "[]", JSON.stringify({ format: "reread-articles", settings: {} }), JSON.stringify({ format: "reread-settings" })]) {
      assert.equal(fromSettingsFile(text), null, text);
    }
  });
});
