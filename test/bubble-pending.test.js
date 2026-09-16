import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf, openings } from "./openings.js";

/**
 * The quiet bubble says it is looking (D190).
 *
 * With the model switched off the bubble opened on its two icons and nothing
 * else until the dictionaries answered - by D164's reckoning a quick read,
 * over which a "looking" line would only flash. On an ordinary page the read
 * first wakes the background, and that took seconds on Michał's desk
 * (2026-09-10): a bubble standing empty for that long reads as a bubble that
 * hung. Like `bubble-fold`, this test reads the call sites, because the
 * regression would be a call site saying nothing: an opening that asks
 * without the line, or a landing that leaves it up.
 */

const ROOT = new URL("../src/content/", import.meta.url);

const PENDING = 'tooltip.setContext(t("bubble_looking_up"), "pending")';

/** @returns {Promise<string>} */
async function reading() {
  return readFile(new URL("reading.js", ROOT), "utf8");
}

describe("the quiet bubble while the dictionaries are asked", () => {
  it("opens every quiet bubble through the one asking, with nothing asking past it", async () => {
    const source = await reading();
    const quiet = openings(source).filter((call) => call.includes('variant: "quiet"'));
    // Two: the trim without a vocabulary (D120) and with one (D158).
    assert.equal(quiet.length, 2, "the trim opens the bubble somewhere new");
    for (const call of quiet) {
      const after = source.slice(source.indexOf(call) + call.length);
      const rest = after.slice(0, after.indexOf("return;"));
      assert.match(rest, /askDictionaries\(selection, mine\)/, "a quiet bubble opens without asking through `askDictionaries`");
      assert.doesNotMatch(rest, /lookUpQuiet\(/, "a quiet bubble asks the dictionaries past the pending line");
    }
  });

  it("puts the line up before asking, and takes it down on every answer", async () => {
    const source = await reading();
    const asking = bodyOf(source, "askDictionaries");
    const said = asking.indexOf(PENDING);
    const asked = asking.indexOf("lookUpQuiet(");
    assert.ok(said !== -1, "the asking no longer says it is looking");
    assert.ok(asked !== -1 && said < asked, "the dictionaries are asked before the line says so");

    const landing = bodyOf(source, "landQuietAnswer");
    // The regression: a database that would not open answers null, and the
    // bubble says nothing on it (D164) - "nothing" has to include the pending
    // line, or the bubble waits for an answer that has already come.
    assert.match(
      landing,
      /if \(answer === null\) \{\s*tooltip\.setContext\(null\);/,
      "a null answer leaves the pending line standing",
    );
  });

  it("says so behind More as well", async () => {
    const source = await reading();
    const layer = bodyOf(source, "fillSecondLayer");
    const quiet = layer.slice(layer.indexOf("if (noTranslation) {"));
    const said = quiet.indexOf(PENDING);
    const asked = quiet.indexOf("lookUpQuiet(");
    assert.ok(said !== -1, "the quiet second layer no longer says it is looking");
    assert.ok(asked !== -1 && said < asked, "the quiet second layer asks before saying so");
  });
});
