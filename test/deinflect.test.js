import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseForms, inflectedForms } from "../src/lib/dict/deinflect.js";

/**
 * @param {string} word
 * @param {string} form
 */
function offers(word, form) {
  assert.ok(baseForms(word).includes(form), `${word} should offer ${form}, got ${baseForms(word).join(", ")}`);
}

describe("baseForms", () => {
  it("undoes a plural", () => {
    offers("cats", "cat");
    offers("boxes", "box");
    offers("flies", "fly");
    offers("knives", "knife");
    offers("wolves", "wolf");
  });

  it("undoes a past tense and an -ing", () => {
    offers("walked", "walk");
    offers("moved", "move");
    offers("tried", "try");
    offers("walking", "walk");
    offers("making", "make");
  });

  it("undoes the letter a verb doubles before its ending", () => {
    offers("stopped", "stop");
    offers("running", "run");
    // And still offers the plain strip, because `calling` is `call`.
    offers("calling", "call");
  });

  it("undoes comparatives and an adverb", () => {
    offers("larger", "large");
    offers("happier", "happy");
    offers("happiest", "happy");
    offers("quickly", "quick");
  });

  it("undoes a possessive, with either apostrophe", () => {
    offers("dog's", "dog");
    offers(`dog${String.fromCodePoint(0x2019)}s`, "dog");
  });

  it("never offers the word it was given", () => {
    for (const word of ["bank", "watch", "cats", "running"]) {
      assert.ok(!baseForms(word).includes(word));
    }
  });

  it("says nothing about a word too short to have an ending", () => {
    assert.deepEqual(baseForms("a"), []);
    assert.deepEqual(baseForms(""), []);
  });

  it("offers no form shorter than two letters", () => {
    for (const form of baseForms("as")) assert.ok(form.length >= 2);
  });

  /**
   * Over-generating is the cheap direction: a form that is not a word finds
   * nothing in the dictionary, while a form we never think of is a word the
   * reader is told nothing about. `bus` suggesting `bu` costs one point read.
   */
  it("guesses wrong rather than not at all", () => {
    offers("bus", "bu");
  });

  it("has nothing to say about an irregular verb, which is the .syn file's job", () => {
    assert.ok(!baseForms("went").includes("go"));
  });
});

/**
 * The table read backwards (D208): which forms a saved word may take on a
 * page. Over-generated like `baseForms`, because the dictionary decides
 * (`forms.js`); what the test holds is that every real form is among the
 * proposals, that the possessive and the word itself are not, and that a
 * word too short to have forms of its own proposes none.
 */
describe("inflectedForms", () => {
  /**
   * @param {string} word
   * @param {string} form
   */
  function proposes(word, form) {
    const { endings, grades } = inflectedForms(word);
    assert.ok(
      endings.includes(form) || grades.includes(form),
      `${word} should propose ${form}, got ${[...endings, ...grades].join(", ")}`,
    );
  }

  it("proposes plurals and the verb's endings", () => {
    proposes("cat", "cats");
    proposes("box", "boxes");
    proposes("watch", "watches");
    proposes("potato", "potatoes");
    proposes("photo", "photos");
    proposes("walk", "walked");
    proposes("walk", "walking");
  });

  it("proposes the spelling changes the endings bring", () => {
    proposes("fly", "flies");
    proposes("try", "tried");
    proposes("play", "played");
    proposes("knife", "knives");
    proposes("wolf", "wolves");
    proposes("move", "moved");
    proposes("move", "moving");
    proposes("see", "seeing");
    proposes("stop", "stopped");
    proposes("run", "running");
    proposes("plan", "planning");
  });

  it("proposes grades apart from the endings", () => {
    const { endings, grades } = inflectedForms("big");
    assert.ok(grades.includes("bigger") && grades.includes("biggest"));
    assert.ok(!endings.includes("bigger"));
    assert.ok(inflectedForms("happy").grades.includes("happier"));
    assert.ok(inflectedForms("nice").grades.includes("nicer"));
    assert.ok(inflectedForms("large").grades.includes("largest"));
  });

  it("does not propose the possessive - the page's dog's is the tokens dog and s", () => {
    const { endings, grades } = inflectedForms("dog");
    assert.ok(![...endings, ...grades].some((form) => form.includes("'")));
  });

  it("never proposes the word itself", () => {
    for (const word of ["read", "cats", "running"]) {
      const { endings, grades } = inflectedForms(word);
      assert.ok(![...endings, ...grades].includes(word));
    }
  });

  it("proposes nothing for a word too short to have forms of its own", () => {
    // `he` would reach `her` and `heed`, `be` would reach `bed` - and the
    // dictionary knows every one of those as a word in its own right.
    assert.deepEqual(inflectedForms("he"), { endings: [], grades: [] });
    assert.deepEqual(inflectedForms("be"), { endings: [], grades: [] });
    assert.deepEqual(inflectedForms(""), { endings: [], grades: [] });
  });
});

describe("baseForms by kind", () => {
  it("undoes only the noun's and the verb's endings when asked to", () => {
    // The quiet test in `forms.js` asks whose form a word is: `lover` may
    // strip to `love` for a look-up, never for that question.
    assert.ok(baseForms("lover").includes("love"));
    assert.ok(!baseForms("lover", ["ending"]).includes("love"));
    assert.ok(baseForms("hardly").includes("hard"));
    assert.ok(!baseForms("hardly", ["ending"]).includes("hard"));
    assert.ok(baseForms("reading", ["ending"]).includes("read"));
    assert.ok(baseForms("used", ["ending"]).includes("use"));
    assert.ok(baseForms("used", ["ending"]).includes("us"));
    assert.ok(baseForms("stopped", ["ending"]).includes("stop"));
  });

  it("tries every ending for a look-up, as it always did", () => {
    assert.deepEqual(baseForms("lover"), baseForms("lover", ["ending", "grade", "adverb"]));
  });
});
