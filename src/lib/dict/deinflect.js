/**
 * The endings of English words: which base forms to try when a dictionary
 * has not heard of the word that was selected, and - the same table read
 * the other way - which forms a saved word may take on a page (D208).
 *
 * Neither direction decides anything on its own. Looking up, the rules only
 * ask a dictionary a second question when the first one came back empty. For
 * the underline they only propose forms, and `forms.js` keeps the ones an
 * installed dictionary vouches for. Nothing here touches what gets saved or
 * the key a phrase is stored under: `read` is stored as `read`, and whether
 * its underline reaches `reading` is the dictionary's word and a switch
 * that is off by default - the README's "matching is literal" stays true
 * until somebody turns it on.
 *
 * Being wrong is cheap in one direction only, and that shapes everything here:
 * a form that does not exist simply misses (`bus` suggesting `bu` finds
 * nothing, `walk` proposing `walkes` is in no dictionary), while a form we
 * fail to suggest is a word the reader was told nothing about. So the rules
 * over-generate on purpose and the dictionary does the deciding.
 *
 * What is deliberately absent: irregular verbs. `went` is not `go` by any rule,
 * and the table that would say so is somebody else's data - which the .syn file
 * of a real dictionary already carries, entry by entry, in the dictionary's own
 * words.
 */

/**
 * The one language whose endings this table knows. Everything else asks for
 * what was selected and takes what it gets - a wrong guess in a language we
 * do not know would find a real entry for a word nobody selected, or
 * underline one nobody saved.
 */
export const RULED_LANGUAGE = "en";

/** Below this, taking a suffix off produces noise rather than a word. */
const MIN_LENGTH = 2;

/** How many forms one word may suggest. Far above what the rules produce. */
const MAX_FORMS = 12;

/**
 * What an ending does to a word, because the two halves of the extension
 * want different subsets: a look-up tries every ending (a dictionary asked
 * about `quickly` may only know `quick`), while the question "is this word
 * a form of that one" (`forms.js`) is asked of the endings a noun or a verb
 * takes - plural, past, `-ing`, possessive - and never of a comparative or
 * an adverb, which are words of their own as often as not (`lover`,
 * `hardly`).
 *
 * @typedef {"ending" | "grade" | "adverb"} RuleKind
 */

/** @type {readonly RuleKind[]} */
const EVERY_KIND = Object.freeze(["ending", "grade", "adverb"]);

/**
 * Suffix in, replacement out, most specific first - the order decides which
 * form is tried first, and `flies` should reach `fly` before it reaches `flie`.
 *
 * @type {readonly { suffix: string, replacement: string, kind: RuleKind }[]}
 */
const RULES = Object.freeze([
  { suffix: "'s", replacement: "", kind: "ending" },
  { suffix: String.fromCodePoint(0x2019) + "s", replacement: "", kind: "ending" },
  { suffix: "iest", replacement: "y", kind: "grade" },
  { suffix: "ies", replacement: "y", kind: "ending" },
  { suffix: "ied", replacement: "y", kind: "ending" },
  { suffix: "ier", replacement: "y", kind: "grade" },
  { suffix: "ves", replacement: "f", kind: "ending" },
  { suffix: "ves", replacement: "fe", kind: "ending" },
  { suffix: "es", replacement: "", kind: "ending" },
  { suffix: "s", replacement: "", kind: "ending" },
  { suffix: "ed", replacement: "", kind: "ending" },
  { suffix: "ed", replacement: "e", kind: "ending" },
  { suffix: "ing", replacement: "", kind: "ending" },
  { suffix: "ing", replacement: "e", kind: "ending" },
  { suffix: "est", replacement: "", kind: "grade" },
  { suffix: "est", replacement: "e", kind: "grade" },
  { suffix: "er", replacement: "", kind: "grade" },
  { suffix: "er", replacement: "e", kind: "grade" },
  { suffix: "ly", replacement: "", kind: "adverb" },
]);

/** `stopped` loses `ed` and is left with a doubled consonant that was never in `stop`. */
const DOUBLED = /([bcdfghjklmnpqrstvwxz])\1$/u;

/**
 * @param {string} word already normalized: trimmed, folded, no edge punctuation
 * @param {readonly RuleKind[]} [kinds] which endings to undo - every kind
 *   for a look-up, the noun's and the verb's alone when asking whose form a
 *   word is (`forms.js`)
 * @returns {string[]} forms worth asking a dictionary about, best first, never
 *   including the word itself
 */
export function baseForms(word, kinds = EVERY_KIND) {
  if (word.length < MIN_LENGTH) return [];

  /** @type {Set<string>} */
  const forms = new Set();

  /** @param {string} form */
  const offer = (form) => {
    if (form.length >= MIN_LENGTH && form !== word) forms.add(form);
  };

  for (const { suffix, replacement, kind } of RULES) {
    if (!kinds.includes(kind) || !word.endsWith(suffix)) continue;
    const stem = word.slice(0, word.length - suffix.length) + replacement;
    offer(stem);

    // `running` and `stopped` shed one letter more than the suffix. Only after
    // a verb ending, because `pass` and `bell` end in a double of their own.
    if (replacement === "" && (suffix === "ed" || suffix === "ing") && DOUBLED.test(stem)) {
      offer(stem.slice(0, -1));
    }
  }

  return [...forms].slice(0, MAX_FORMS);
}

/**
 * A saved word shorter than this takes no forms of its own: two letters and
 * an ending are a different word more often than a form of this one - `he`
 * would reach `her` and `heed`, `be` would reach `bed` - and the dictionary
 * that is asked next knows every one of those as a word in its own right.
 */
const MIN_BASE = 3;

/**
 * Which last letters double before `-ed` and `-ing` (`stop`, `plan`,
 * `begin`): a consonant after a vowel, and never `w`, `x` or `y`, which
 * English does not double.
 */
const DOUBLES = /[aeiou][bdgklmnprstvz]$/u;

/** Plurals after these take `-es`: `boxes`, `watches`, `buses`. */
const SIBILANT = /(?:s|x|z|ch|sh)$/u;

/**
 * The forms a word may take, the table above read backwards: `use` gives
 * `uses`, `used`, `using` and its grades `user`, `usest` - every form the
 * rules would strip back to the word, whether or not it exists. Over-generated
 * on purpose, like `baseForms`: `study` proposes `studys` next to `studies`,
 * and the dictionary that is asked next simply does not have it. Grades come
 * apart from the endings because `forms.js` trusts them less: an ending's
 * form the dictionary has as a word of its own may still be a form
 * (`reading`), a grade's is another word as often as not (`lover`, `reader`).
 * The possessive is not proposed at all: a page's `dog's` is the tokens `dog`
 * and `s`, and the saved `dog` already finds the first of them.
 *
 * @param {string} word normalized, a single word
 * @returns {{ endings: string[], grades: string[] }} never including the word itself
 */
export function inflectedForms(word) {
  if (word.length < MIN_BASE) return { endings: [], grades: [] };

  /** @type {Set<string>} */
  const endings = new Set();
  /** @type {Set<string>} */
  const grades = new Set();
  const last = word.slice(-1);
  const stem = word.slice(0, -1);

  if (SIBILANT.test(word)) endings.add(`${word}es`);
  else endings.add(`${word}s`);
  if (last === "o") endings.add(`${word}es`);

  if (last === "e") {
    // `use` -> `used`, `using`; `see` -> `seeing`, `dye` -> `dyeing`.
    endings.add(`${word}d`);
    endings.add(`${stem}ing`);
    endings.add(`${word}ing`);
    grades.add(`${word}r`);
    grades.add(`${word}st`);
  } else {
    endings.add(`${word}ed`);
    endings.add(`${word}ing`);
    grades.add(`${word}er`);
    grades.add(`${word}est`);
  }

  if (/[^aeiou]y$/u.test(word)) {
    endings.add(`${stem}ies`);
    endings.add(`${stem}ied`);
    grades.add(`${stem}ier`);
    grades.add(`${stem}iest`);
  }

  if (last === "f") endings.add(`${stem}ves`);
  if (word.endsWith("fe")) endings.add(`${word.slice(0, -2)}ves`);

  if (DOUBLES.test(word)) {
    endings.add(`${word}${last}ed`);
    endings.add(`${word}${last}ing`);
    grades.add(`${word}${last}er`);
    grades.add(`${word}${last}est`);
  }

  endings.delete(word);
  grades.delete(word);
  return { endings: [...endings], grades: [...grades] };
}
