import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { openings } from "./openings.js";

/**
 * One checkbox, every bubble (D131).
 *
 * "Hide bubble actions by default" (D81) is a sentence about the bubble, not
 * about one of its variants - but it only ever reached the openings that
 * remembered to pass it, and the bubble over an underline did not: it folded
 * itself by variant, so for a year the setting had no effect on half the
 * bubbles somebody sees (Michał's report, 2026-08-22).
 *
 * That is a bug no unit test could have caught by asking a function a
 * question, because the bug was a call site saying nothing. So this test reads
 * the call sites: every opening either carries the setting, or is the one
 * variant with nothing to fold away.
 */

const ROOT = new URL("../src/content/", import.meta.url);

describe("where the bubble's actions start", () => {
  it("hands the setting to every opening that has a row to fold", async () => {
    const source = await readFile(new URL("reading.js", ROOT), "utf8");
    const calls = openings(source);
    // Four: recall, the translating fresh selection, and the trim's two -
    // without a vocabulary (D120) and with one (D158, the quiet pair).
    assert.equal(calls.length, 4, "the reading side opens the bubble somewhere new");

    for (const call of calls) {
      // The trimmed bubbles (D120, D158) are the standing exception: no
      // gloss to stand in front of the row, and in the quiet pair's bubble
      // Save is the point - a Save may never hide (D131), and a row folded
      // away would leave the trimmed bubble empty.
      if (call.includes('variant: "quiet"')) continue;
      assert.match(
        call,
        /folded: hideActions/,
        "a bubble opens without asking the quiet-bubble setting",
      );
    }
  });

  it("leaves the decision to the caller, with no variant overruling it", async () => {
    const source = await readFile(new URL("tooltip.js", ROOT), "utf8");
    const toggle = /bubble\.classList\.toggle\("revealed",([^)]*)\)/.exec(source);
    assert.ok(toggle !== null, "the bubble stopped setting its own revealed class");
    // The regression this guards: a variant deciding here is a rule quietly
    // outvoting the reader's own.
    assert.doesNotMatch(String(toggle[1]), /variant/, "a variant decides the fold again");
    assert.match(String(toggle[1]), /folded/, "the caller's answer is no longer what decides");
  });
});

describe("where the bubble's second layer starts", () => {
  it("hands the setting to the fresh selection, and to nothing else", async () => {
    const source = await readFile(new URL("reading.js", ROOT), "utf8");
    const calls = openings(source);
    const fresh = calls.filter((call) => call.includes('variant: "save"'));
    assert.equal(fresh.length, 1, "the translating fresh selection opens somewhere new");
    // The one opening the switch is about (D186): the sentence and the
    // entries ride the same answer as the gloss, so opening the layer with
    // the bubble costs nothing but height.
    assert.match(fresh[0] ?? "", /expanded: showMore/, "the fresh selection opens without asking the open-layer setting");
    for (const call of calls) {
      if (call === fresh[0]) continue;
      // Deliberately (Michał's call, 2026-09-07): the recall bubble's body
      // is the reader's own meaning and its layer is an engine ride away
      // (D27); the quiet bubbles' layer is always out (`layerStart`).
      assert.doesNotMatch(call, /expanded/, "an opening the switch is not about carries it");
    }
  });

  it("starts the layer by the caller's word, with the quiet bubble always out", async () => {
    const source = await readFile(new URL("tooltip.js", ROOT), "utf8");
    assert.match(
      source,
      /unfolded = layerStart\(\{ variant, expanded \}\)/,
      "the bubble stopped asking `layerStart` where its layer starts",
    );
  });
});
