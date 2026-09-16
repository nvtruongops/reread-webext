import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STYLE, foldControl, foldStart, layerStart } from "../src/content/tooltip.js";

/**
 * The fold in the sentence's corner (D96) is a rule and a stylesheet contract,
 * and both live where no smoke test reliably looks. The rule - when the
 * control exists at all, when it merely holds its column, when it is there to
 * press - is three states that would each fail on a different page: a bubble
 * with no dictionary, a one-line sentence, a long one. The stylesheet's side
 * is quieter still: a clamp missing one of its three declarations does not
 * clamp, it just cuts or overflows, and the control's frame is the one thing
 * telling it apart from the passive triangle under the dictionary list -
 * lose it, and the bubble teaches that triangles are buttons.
 */

/**
 * The text between a rule's opening brace and the first closing one - enough
 * for rules that nest nothing, which all of the measured ones are.
 *
 * @param {string} marker
 * @returns {string}
 */
function blockAfter(marker) {
  const start = STYLE.indexOf(marker);
  assert.notEqual(start, -1, `the stylesheet lost its "${marker}"`);
  const open = STYLE.indexOf("{", start);
  const close = STYLE.indexOf("}", open);
  return STYLE.slice(open + 1, close);
}

describe("the sentence's fold", () => {
  it("stands only over a dictionary, and only to press when the sentence overflows", () => {
    // No entries: nothing below the sentence to make room for.
    assert.equal(foldControl({ entries: false, overflows: false }), "absent");
    assert.equal(foldControl({ entries: false, overflows: true }), "absent");
    // Entries but a sentence already on one line: the column holds its place
    // so the sentence never rewraps, but there is nothing to press.
    assert.equal(foldControl({ entries: true, overflows: false }), "reserved");
    assert.equal(foldControl({ entries: true, overflows: true }), "shown");
  });

  it("opens clamped over a dictionary, whole when the sentence is alone", () => {
    // Michał's ask (2026-09-01): whoever pressed More on a phrase the
    // dictionary knows is usually there for the dictionary, and the sentence
    // taking its height first squeezed the answer to a strip. Only a starting
    // state - the reader's own press outranks it for the phrase's lifetime.
    assert.equal(foldStart({ entries: true }), true);
    assert.equal(foldStart({ entries: false }), false);
  });

  it("clamps with all three declarations a one-line cut needs", () => {
    const clamp = blockAfter('.context[data-folded="true"] .context-text');
    assert.match(clamp, /white-space:\s*nowrap/);
    assert.match(clamp, /overflow:\s*hidden/);
    assert.match(clamp, /text-overflow:\s*ellipsis/);
  });

  it("lets the text column shrink, or the ellipsis never fires", () => {
    // A flex item refuses to go below its content unless told to, and the
    // clamp above only cuts what the column actually constrains.
    assert.match(blockAfter(".context {"), /display:\s*flex/);
    assert.match(blockAfter(".context-text {"), /min-width:\s*0/);
  });

  it("dresses the fold as a control, apart from the passive triangle", () => {
    // The frame is the whole of the distinction on paper: the triangle under
    // the dictionary list is a mark, this is a button, and the border - in
    // the bubble's one line strength - is what says so on an e-ink panel.
    assert.match(blockAfter(".context-toggle {"), /border:\s*1px solid var\(--edge\)/);
  });

  it("turns the chevron when the sentence is clamped", () => {
    const turned = blockAfter('.context[data-folded="true"] .context-toggle svg');
    assert.match(turned, /transform:\s*rotate\(180deg\)/);
  });
});

describe("the second layer's start", () => {
  it("opens with the bubble on the caller's word, and always in the quiet bubble", () => {
    // The settings switch (D186) is the caller's answer for the translating
    // bubble; the quiet bubble has no gloss and no More, so its entries are
    // the answer itself and never wait behind a press (D121).
    assert.equal(layerStart({ variant: "save", expanded: true }), true);
    assert.equal(layerStart({ variant: "save", expanded: false }), false);
    assert.equal(layerStart({ variant: "recall", expanded: false }), false);
    assert.equal(layerStart({ variant: "quiet", expanded: false }), true);
    assert.equal(layerStart({ variant: "launcher", expanded: false }), false);
  });
});
