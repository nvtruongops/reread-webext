import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  canSpeak,
  canSpeakLang,
  chosenVoice,
  offlineAvailable,
  offlineLanguages,
  offlineVoice,
  primaryLanguage,
  setSpeechOff,
  speak,
  speechSupported,
  stop,
  voiceLanguage,
  voicesFor,
} from "../src/lib/tts.js";

/**
 * A voice as the pure half sees one - the three fields `VoiceLike` names, and
 * the engine's two flags where a test is about them.
 *
 * @param {string} name
 * @param {string} lang
 * @param {string} [voiceURI]
 * @param {{ localService?: boolean, default?: boolean }} [flags]
 */
function voice(name, lang, voiceURI = name, flags = {}) {
  return { name, lang, voiceURI, ...flags };
}

/** A network voice the browser adds beside the system's (D155). */
const REMOTE = { localService: false };

describe("primaryLanguage", () => {
  it("answers the part before any region, lowercased", () => {
    assert.equal(primaryLanguage("en"), "en");
    assert.equal(primaryLanguage("en-US"), "en");
    assert.equal(primaryLanguage("EN-us"), "en");
  });

  it("reads Android's underscore spelling as the same language", () => {
    // The system's engines name voices en_US where the web writes en-US, and
    // a filter that missed them would offer no voices exactly where choosing
    // one matters most.
    assert.equal(primaryLanguage("en_US"), "en");
    assert.equal(primaryLanguage("pl_PL"), "pl");
  });

  it("answers nothing for an empty tag", () => {
    assert.equal(primaryLanguage(""), "");
  });
});

describe("voicesFor", () => {
  const device = [
    voice("Zosia", "pl-PL"),
    voice("Brian", "en_GB"),
    voice("Alice", "en-US"),
    voice("Karl", "de-DE"),
    voice("Emma", "en-US"),
  ];

  it("offers every regional variant of the language being read", () => {
    assert.deepEqual(
      voicesFor(device, "en")
        .map((one) => one.name)
        .sort(),
      ["Alice", "Brian", "Emma"],
    );
  });

  it("sorts by tag and then by name, so the order holds between opens", () => {
    const sorted = voicesFor(
      [voice("Alice", "en-US"), voice("Colin", "en-GB"), voice("Brian", "en-GB")],
      "en",
    ).map((one) => one.name);
    // The en-GB pair stands together and alphabetically, ahead of en-US.
    assert.deepEqual(sorted, ["Brian", "Colin", "Alice"]);
  });

  it("answers none for a language with no voice, and for no language at all", () => {
    assert.deepEqual(voicesFor(device, "uk"), []);
    assert.deepEqual(voicesFor(device, ""), []);
  });

  it("leaves the list it was given as it was", () => {
    const given = [voice("B", "en"), voice("A", "en")];
    voicesFor(given, "en");
    assert.deepEqual(
      given.map((one) => one.name),
      ["B", "A"],
    );
  });

  it("keeps the browser's network voices out (D155)", () => {
    // Chrome lists Google's voices next to the system's; each would send the
    // text to Google to be spoken. The settings page promises nothing is sent
    // anywhere, so they are never on offer.
    const chrome = [
      voice("Google US English", "en-US", "urn:google", REMOTE),
      voice("Alice", "en-US"),
      voice("Google polski", "pl-PL", "urn:google-pl", REMOTE),
    ];
    assert.deepEqual(
      voicesFor(chrome, "en").map((one) => one.name),
      ["Alice"],
    );
    assert.deepEqual(voicesFor(chrome, "pl"), []);
  });

  it("lists a voice once, the genuine entry over a shield's decoy", () => {
    // Brave's fingerprinting shield adds a clone of the engine's default
    // voice under a made-up name, URI untouched (brave-core's
    // speech_synthesis.cc). Picked by URI it sorted first and won - and
    // Chromium, matching by name, found no "Hubert" and let macOS read an
    // English word in the system's Polish (Michał's report, 2026-09-01).
    const brave = [
      voice("Samantha (Enhanced)", "en-US", "Samantha (Enhanced)", { default: true }),
      voice("Albert", "en-US", "Albert"),
      voice("Zosia", "pl-PL", "Zosia"),
      voice("Hubert", "en-US", "Samantha (Enhanced)"),
    ];
    assert.deepEqual(
      voicesFor(brave, "en").map((one) => one.name),
      ["Albert", "Samantha (Enhanced)"],
    );
    assert.equal(offlineVoice(brave, "en", "Samantha (Enhanced)")?.name, "Samantha (Enhanced)");
    // With no default flagged among the language's voices (the system voice
    // is Polish), the name that is its own URI still tells the real one.
    const polishSystem = [
      voice("Zosia", "pl-PL", "Zosia", { default: true }),
      voice("Samantha", "en-US", "Samantha"),
      voice("Alva", "en-US", "Samantha"),
    ];
    assert.deepEqual(
      voicesFor(polishSystem, "en").map((one) => one.name),
      ["Samantha"],
    );
    assert.equal(offlineVoice(polishSystem, "en", undefined)?.name, "Samantha");
  });
});

describe("offlineAvailable", () => {
  it("is true where an offline voice reads the language", () => {
    assert.equal(offlineAvailable([voice("Alice", "en-US")], "en"), true);
  });

  it("is false where only the browser's network voices read it", () => {
    const chrome = [voice("Google polski", "pl-PL", "urn:google", REMOTE), voice("Alice", "en-US")];
    assert.equal(offlineAvailable(chrome, "pl"), false);
    assert.equal(offlineAvailable(chrome, "uk"), false);
  });

  it("is true where the device lists no voices at all (Android's clause)", () => {
    // Android's engines have been known to list nothing while speaking all
    // the same, from the system's own voices; a refusal there would mute
    // every phone.
    assert.equal(offlineAvailable([], "pl"), true);
  });

  it("with no language named, asks for any offline voice", () => {
    assert.equal(offlineAvailable([voice("Alice", "en-US")], ""), true);
    assert.equal(offlineAvailable([voice("Google US English", "en-US", "urn:g", REMOTE)], ""), false);
  });
});

describe("offlineVoice", () => {
  const device = [
    voice("Google US English", "en-US", "urn:google", { ...REMOTE, default: true }),
    voice("Brian", "en-GB", "urn:brian"),
    voice("Alice", "en-US", "urn:alice", { default: true }),
    voice("Zosia", "pl-PL", "urn:zosia"),
  ];

  it("gives the stored choice while the device still has it offline", () => {
    assert.equal(offlineVoice(device, "en", "urn:brian")?.name, "Brian");
  });

  it("moves a choice of a network voice to the device's offline default", () => {
    // A choice stored before network voices were kept out must neither mute
    // the button nor send anything anywhere.
    assert.equal(offlineVoice(device, "en", "urn:google")?.name, "Alice");
  });

  it("gives the device's default among the language's offline voices, else the first", () => {
    assert.equal(offlineVoice(device, "en", undefined)?.name, "Alice");
    assert.equal(offlineVoice(device, "pl", "urn:gone")?.name, "Zosia");
  });

  it("gives an offline voice of any language when none is named", () => {
    assert.equal(offlineVoice(device, "", undefined)?.name, "Alice");
  });

  it("answers null where nothing offline reads the language, and where nothing is listed", () => {
    assert.equal(offlineVoice(device, "uk", undefined), null);
    assert.equal(offlineVoice([], "en", "urn:alice"), null);
  });
});

describe("offlineLanguages", () => {
  it("names each language of the offline voices once, and none of the network ones", () => {
    const device = [
      voice("Alice", "en-US"),
      voice("Brian", "en_GB"),
      voice("Zosia", "pl-PL"),
      voice("Google Deutsch", "de-DE", "urn:google", REMOTE),
    ];
    assert.deepEqual(offlineLanguages(device).sort(), ["en", "pl"]);
    assert.deepEqual(offlineLanguages([]), []);
  });
});

describe("voiceLanguage", () => {
  const offered = ["de", "en", "pl"];

  it("follows the pick made on the page while it is on offer", () => {
    assert.equal(voiceLanguage(offered, { picked: "de", source: "en", browser: "pl" }), "de");
    // A pick the device no longer offers (a language pack removed) is no pick.
    assert.equal(voiceLanguage(offered, { picked: "uk", source: "en", browser: "pl" }), "en");
  });

  it("stands on the pair's source language while a pair is chosen", () => {
    assert.equal(voiceLanguage(offered, { picked: null, source: "de", browser: "pl" }), "de");
  });

  it("without a pair takes the browser's language, else English, else the first on offer", () => {
    // Michał's rule (2026-08-29): a fresh install reads in its own language
    // until it says otherwise, and English is the language most devices have
    // a voice for.
    assert.equal(voiceLanguage(offered, { picked: null, source: null, browser: "pl" }), "pl");
    assert.equal(voiceLanguage(offered, { picked: null, source: null, browser: "fr" }), "en");
    assert.equal(voiceLanguage(["de", "pl"], { picked: null, source: null, browser: "fr" }), "de");
    assert.equal(voiceLanguage([], { picked: null, source: null, browser: "en" }), null);
  });
});

describe("speak", () => {
  /**
   * A stand-in engine: the voices it lists, and what it was told to say.
   * Like the real one, it may start empty and deliver the list with a
   * `voiceschanged` a moment later - `arriving` is what that event brings
   * (the event fires either way, as it does on a device that never lists
   * anything).
   *
   * @param {ReturnType<typeof voice>[]} voices
   * @param {ReturnType<typeof voice>[]} [arriving]
   * @returns {{ voice: { name: string } | null }[]}
   */
  function engine(voices, arriving) {
    /** @type {{ voice: { name: string } | null }[]} */
    const spoken = [];
    globalThis.speechSynthesis = /** @type {any} */ ({
      getVoices: () => voices,
      speak: (/** @type {{ voice: { name: string } | null }} */ utterance) => spoken.push(utterance),
      cancel: () => {},
      addEventListener: (/** @type {string} */ _type, /** @type {() => void} */ handler) => {
        queueMicrotask(() => {
          if (arriving !== undefined) voices = arriving;
          handler();
        });
      },
      removeEventListener: () => {},
    });
    globalThis.SpeechSynthesisUtterance = /** @type {any} */ (
      class {
        /** @param {string} text */
        constructor(text) {
          this.text = text;
          this.voice = null;
        }
        addEventListener() {}
      }
    );
    return spoken;
  }

  afterEach(() => {
    // The stand-in never ends an utterance, so the module still holds the one
    // it spoke: stood down here, while the stand-in is there to take the
    // cancel, or the next test's engine without one would be asked for it.
    stop();
    setSpeechOff(false);
    globalThis.speechSynthesis = /** @type {any} */ (undefined);
    globalThis.SpeechSynthesisUtterance = /** @type {any} */ (undefined);
  });

  it("gives the utterance an offline voice of its language, never a network one", async () => {
    const spoken = engine([
      voice("Google US English", "en-US", "urn:google", { ...REMOTE, default: true }),
      voice("Alice", "en-US", "urn:alice"),
    ]);
    assert.equal(canSpeakLang("en"), true);
    assert.equal(await speak("hello", "en", undefined), true);
    assert.equal(spoken[0]?.voice?.name, "Alice");
  });

  it("refuses where the device has voices but none reads the language offline", async () => {
    const spoken = engine([voice("Google polski", "pl-PL", "urn:google", REMOTE)]);
    assert.equal(canSpeakLang("pl"), false);
    assert.equal(await speak("cześć", "pl", "urn:google"), false);
    assert.equal(spoken.length, 0);
  });

  it("still speaks on a device that lists no voices at all, leaving the pick to the engine", async () => {
    const spoken = engine([]);
    assert.equal(canSpeakLang("pl"), true);
    assert.equal(await speak("cześć", "pl", undefined), true);
    assert.equal(spoken[0]?.voice, null);
  });

  it("waits out the empty list a fresh page answers, so the system default never wins", async () => {
    // Michał's report from nytimes.com: a fresh page's first `getVoices()` is
    // empty (the real list arrives with `voiceschanged`), the utterance went
    // out with no voice object, and the engine's own default - the system's
    // Polish voice - read an English word. Waited out, the language's own
    // voice wins over the default flag on the wrong language.
    const spoken = engine(
      [],
      [
        voice("Zosia", "pl-PL", "urn:zosia", { default: true }),
        voice("Alice", "en-US", "urn:alice"),
      ],
    );
    assert.equal(await speak("hello", "en", undefined), true);
    assert.equal(spoken[0]?.voice?.name, "Alice");
  });

  it("hands the engine the real voice, never a shield's decoy of it", async () => {
    // The list as Brave shows it to a site: the real default voice and its
    // clone under a made-up name that sorts first. The stored choice is the
    // default voice's URI, which both carry.
    const spoken = engine([
      voice("Samantha (Enhanced)", "en-US", "Samantha (Enhanced)", { default: true }),
      voice("Hubert", "en-US", "Samantha (Enhanced)"),
    ]);
    assert.equal(await speak("hello", "en", "Samantha (Enhanced)"), true);
    assert.equal(spoken[0]?.voice?.name, "Samantha (Enhanced)");
  });
});

describe("chosenVoice", () => {
  const device = [voice("Alice", "en-US", "urn:alice"), voice("Zosia", "pl-PL", "urn:zosia")];

  it("finds the stored choice by its exact URI", () => {
    assert.equal(chosenVoice(device, "urn:zosia")?.name, "Zosia");
  });

  it("answers null when nothing was chosen", () => {
    assert.equal(chosenVoice(device, undefined), null);
    assert.equal(chosenVoice(device, ""), null);
  });

  it("answers null for a voice this device no longer has", () => {
    // A stale choice - an uninstalled voice, a profile from another machine -
    // must fall back to the engine's default, never mute the button.
    assert.equal(chosenVoice(device, "urn:gone"), null);
    assert.equal(chosenVoice([], "urn:alice"), null);
  });
});

describe("canSpeak", () => {
  afterEach(() => {
    setSpeechOff(false);
    globalThis.speechSynthesis = /** @type {any} */ (undefined);
  });

  it("is false under node, where the speaking half stays quiet", () => {
    assert.equal(speechSupported(), false);
    assert.equal(canSpeak(), false);
  });

  it("follows the reading-aloud switch where the engine exists (D148)", () => {
    // Enough of an engine for the question: the module only asks whether it
    // is there, and a switch landing while nothing speaks cancels nothing.
    globalThis.speechSynthesis = /** @type {any} */ ({});
    assert.equal(canSpeak(), true);

    setSpeechOff(true);
    assert.equal(canSpeak(), false);
    // The bare API question does not move with the switch: the listeners
    // that watch the engine's voice list keep watching.
    assert.equal(speechSupported(), true);

    setSpeechOff(false);
    assert.equal(canSpeak(), true);
  });
});
