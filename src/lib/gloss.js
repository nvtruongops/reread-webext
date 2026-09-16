/**
 * The gloss: what the bubble shows about a phrase, and what gets saved.
 *
 * The rules here need no bubble to hold them, so they live where
 * `node --test` can reach them - the same reason `store/phrase.js` is kept apart
 * from the database it writes to.
 */

import { normalize } from "./normalize.js";

/**
 * One line per meaning. A word has more than one, and separating them by
 * anything narrower than a line makes them read as one long sentence.
 */
export const MEANING_SEPARATOR = "\n";

/**
 * What the bubble is showing, as the list of meanings that gets stored.
 *
 * A line out of a dictionary comes through here too, and one of those can be
 * several lines: a book that writes a meaning per paragraph arrives as one sense
 * with the breaks still in it. Splitting is what keeps two meanings two meanings
 * all the way into the vocabulary - the store collapses whitespace, so a sense
 * kept whole would become one meaning with its lines glued together by spaces.
 *
 * @param {string} text
 * @returns {string[]} one meaning per line, blank ones dropped
 */
export function toMeanings(text) {
  return text
    .split(MEANING_SEPARATOR)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The lines of a dictionary entry as a reader can choose between them: one row
 * per meaning, whatever the book packed into one field.
 *
 * The unit of choice is the line and not the entry, and the entry that settled
 * it is WikDict's `nominate` - six pronunciations, `verb`, an English
 * definition and `nominować`, all one sense with the breaks still in it.
 * Pressed whole it made a four-line gloss with a transcription in it, which is
 * everything a flashcard should not be, and left the reader editing afterwards
 * anyway. Split, the line they wanted is one press.
 *
 * No rule about which line is a meaning, and there will not be one: telling a
 * translation from a part of speech needs a list of parts of speech per
 * language, and the reader's eyes do it for nothing.
 *
 * @param {string[]} senses as the dictionary stored them
 * @returns {string[]} one meaning each, in the order the entry had them
 */
export function choosableLines(senses) {
  return senses.flatMap(toMeanings);
}

/**
 * Dictionary entries as the bubble takes them: the label's two halves, and the
 * lines under them.
 *
 * The label is where two things get decided, and both need to know what was
 * selected - which is why they are decided here and not in the bubble. The
 * dictionary's name only earns its half when there is more than one book to
 * tell apart, and the headword only when it is not the word the reader
 * selected: a definition of `watch` under a selection of `watches` has to say
 * so, while one under `watch` would just be repeating the page back (D23).
 * They stay halves all the way into the bubble, because they dress
 * differently there (see `Block` in `content/tooltip.js`).
 *
 * The lines are the entry's meanings one to a row, which is the same thing the
 * reader has always seen and now also the thing they can press. Nothing about
 * the entry moves or disappears; what changes is where one row ends.
 *
 * @param {import("./protocol.js").DictEntry[]} entries
 * @param {string} normalized what the reader selected, as its key
 * @returns {Array<{ headword: string, dictionary: string, lines: string[] }>}
 */
export function entryBlocks(entries, normalized) {
  const books = new Set(entries.map((entry) => entry.dictionary)).size;

  return entries.map((entry) => ({
    headword:
      entry.headword.length > 0 && normalize(entry.headword) !== normalized ? entry.headword : "",
    dictionary: books > 1 && entry.dictionary.length > 0 ? entry.dictionary : "",
    lines: choosableLines(entry.senses),
  }));
}

/**
 * What the gloss becomes when a reader presses a line of a dictionary entry.
 *
 * The line **joins** what is already there, and pressing it again takes it back
 * out. G1 had this the other way - a choice replacing the gloss - and Michał
 * reversed it on the first day of using it, which is the right call: a word has
 * several meanings, `translations` has been a list since the first day for that
 * exact reason (D21), and until now the only way to put a second one in it was
 * to type it. What D21 refuses is a machine quietly adding a variant at every
 * encounter, and a press is nobody's idea of quiet.
 *
 * The order is the order of pressing, after whatever the engine said. Somebody
 * who does not want the engine's guess on the card deletes that one line in the
 * edit box, which is a thing that already exists.
 *
 * Removing the last meaning gives back an empty string. That is not a gloss and
 * the bubble declines it: a phrase with nothing to mean has nothing to save.
 *
 * @param {string} shown the gloss the bubble has right now
 * @param {string} sense the line that was pressed
 * @returns {string}
 */
export function afterChoosing(shown, sense) {
  const meanings = toMeanings(shown);
  const without = meanings.filter((meaning) => meaning !== sense);
  const next = without.length === meanings.length ? [...meanings, sense] : without;
  return next.join(MEANING_SEPARATOR);
}

/**
 * What the quiet bubble says when the dictionaries said nothing (D164): one
 * sentence, by the cause - or none while there are entries to show. The
 * missing dictionary comes first: it is the one state that outlasts this
 * phrase, and a reader told to select whole words would only meet it on the
 * next try. A selection the matcher could never find again (a fragment of a
 * word, a paragraph and a half) is told what to select, because that is also
 * why it has no pencil; whole words that no book knows are told so, with the
 * pencil standing beside the sentence as the way to type a meaning.
 *
 * @param {{ entries: number, dictionaries: number, findable: boolean }} of
 *   how many entries came back, how many dictionaries were asked, and whether
 *   the phrase could ever be found on a page again
 * @returns {"no-dictionary" | "whole-words" | "not-in-dictionary" | null}
 */
export function quietNote({ entries, dictionaries, findable }) {
  if (entries > 0) return null;
  if (dictionaries === 0) return "no-dictionary";
  if (!findable) return "whole-words";
  return "not-in-dictionary";
}

/**
 * The longest selection the hint below is about: a word or two (Michał's
 * measure, 2026-09-11). The engine translates the phrase alone, without its
 * sentence, and that is where it guesses worst; past two words a selection is
 * a phrase the engine handles and no dictionary is expected to hold.
 */
export const HINT_MAX_WORDS = 2;

/**
 * Whether the bubble over a translated word or two should say that the
 * dictionaries could have done better, and how (D192): the engine's answer
 * to a word on its own is often cut short or made up (the settings page has
 * said so since D186), and the dictionary that would answer instead is
 * either not installed for the language or installed and silent - two
 * different remedies, told apart by the count the translation carries.
 *
 * Said nothing over an answer that came without a count (a lookup that gave
 * no answer at all, or a background older than the field): by D164's rule a
 * fault never reads as a missing dictionary. Nothing over a longer phrase
 * (`HINT_MAX_WORDS`), over a fragment of a word (the gesture is the problem
 * there, not the dictionaries - `quietNote` says so in the quiet bubble), and
 * nothing while there are entries: the dictionaries have answered.
 *
 * @param {{ words: number, entries: number, dictionaries: number | undefined, findable: boolean }} of
 *   how many words the phrase has, how many entries came back, how many
 *   dictionaries were asked (undefined for no answer), and whether the phrase
 *   could ever be found on a page again
 * @returns {"no-dictionary" | "not-in-dictionary" | null}
 */
export function dictionaryHint({ words, entries, dictionaries, findable }) {
  if (dictionaries === undefined) return null;
  if (words < 1 || words > HINT_MAX_WORDS) return null;
  const note = quietNote({ entries, dictionaries, findable });
  return note === "whole-words" ? null : note;
}

/**
 * A sentence cut around one of its words, so the bubble can make that word
 * a press (D192: "add one in the settings", where "settings" opens them).
 * The word arrives as the sentence's own placeholder, substituted verbatim,
 * so it is found where the catalogue put it - first occurrence, which is
 * the only one in every catalogue. A word that is not in the sentence (a
 * catalogue that dropped the placeholder, an empty word) cuts nothing: the
 * sentence then reads whole, with nothing to press, rather than not at all.
 *
 * @param {string} sentence
 * @param {string} word
 * @returns {{ before: string, word: string, after: string } | null}
 */
export function linkedWord(sentence, word) {
  if (word.length === 0) return null;
  const at = sentence.indexOf(word);
  if (at === -1) return null;
  return { before: sentence.slice(0, at), word, after: sentence.slice(at + word.length) };
}

/**
 * Whether a dictionary of another language than the pair's knew the phrase
 * (D167's two signals, the rule itself since D193): entries came back from
 * a lookup made in `reading` - the page's declared language, asked second
 * (D191), so it answered only where the pair's dictionaries did not - and
 * `reading` is not the pair's source. One signal alone cries wolf: a page
 * mis-tagged, an English quote on a Polish page. Both together say the
 * phrase is in the page's language, which outranks the page's `lang`
 * attribute and the engine's guess alike: a Polish dictionary recognising a
 * Polish word says what language it is better than either. The known
 * miss: a word two languages share ("hotel") on a page in the other one,
 * with no dictionary for the pair's language to answer first.
 *
 * @param {{ entries: number, reading: string, pairFrom: string }} of how many
 *   entries the lookup returned, the primary subtag it answered in and the
 *   pair's source subtag
 * @returns {boolean}
 */
export function answeredElsewhere({ entries, reading, pairFrom }) {
  return entries > 0 && reading.length > 0 && pairFrom.length > 0 && reading !== pairFrom;
}

/**
 * Whether the quiet bubble should say where Save would file this phrase
 * (D167, Michał's rule): only where two signals agree that the page is not
 * in the pair's language - the page declares another one, AND a dictionary
 * of that language knew the word (entries came back from a lookup made in
 * it). One signal alone would cry wolf: a page mis-tagged, an English quote
 * on a Polish page - there the pair's shelf may be exactly the right one.
 * And only where Save stands at all (a findable phrase).
 *
 * @param {{ entries: number, findable: boolean, reading: string, pairFrom: string }} of
 *   how many entries the page-language lookup returned, whether Save is
 *   offered, the primary subtag being read and the pair's source subtag
 * @returns {boolean}
 */
export function filingWarning({ entries, findable, reading, pairFrom }) {
  return findable && answeredElsewhere({ entries, reading, pairFrom });
}

/**
 * What a press of Save does while the gloss is empty (D175): with dictionary
 * lines standing there to be pressed, it says so - one sentence in the
 * bubble's note line, the place where the quiet bubble already speaks (D164,
 * D167) - and otherwise it is the button that stays out of reach, as before.
 *
 * The sentence exists because a dimmed button explained nothing: a reader who
 * expected Save to keep the word with every entry pressed it, saw nothing
 * happen, and took some time to find that a line is the thing to press
 * (mobileread report, 2026-09-03). It is said only on the press, never up
 * front - a bubble that instructed every time would cost everybody a line for
 * one reader's first day - and it is not said over an open edit box: whoever
 * is typing knows what Save is waiting for. With no lines to press there is
 * nothing to point at, and the note line is already saying why (D164).
 *
 * @param {{ meanings: number, lines: number, editing: boolean }} of
 *   how many meanings the gloss has, how many dictionary lines can be pressed,
 *   and whether the edit box is open
 * @returns {"save" | "prompt" | "nothing"}
 */
export function savePress({ meanings, lines, editing }) {
  if (meanings > 0) return "save";
  if (editing || lines === 0) return "nothing";
  return "prompt";
}
