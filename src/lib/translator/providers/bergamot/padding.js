/**
 * Why a lone word travels with a sentence nobody ever sees.
 *
 * Marian decides a batch of texts together, and a batch whose longest row is
 * one word gets a translation to match: `match` comes back as `dopasowa`,
 * `board` as `tablic`, `settlement` as `rozlicznictwo` - words cut mid-piece,
 * or forms nobody would write. Send the same word with a sentence beside it and
 * it comes back whole: `dopasowanie`, `tablica`, `rozliczenie`.
 *
 * Measured on the real en-pl model, twenty phrases, 2026-08-11: every cut-short
 * answer was fixed and no already-correct one changed. The engine's own
 * `max-length-factor` is not the lever - 2.0, 3.0, 4.0 and 6.0 all produce the
 * same cut-short word, and 10.0 refuses to build the model at all.
 *
 * The extension pays for this where it can afford to: a phrase for the bubble
 * costs a few milliseconds, the companion adds about fifteen, and a selection
 * long enough to stand on its own gets none.
 *
 * It rides along with the sentence behind "More" rather than instead of it -
 * the two do different things, and that is measured below.
 */

/**
 * One ordinary sentence per source language, common words, no names. They are
 * never shown and never stored - translated and thrown away - but the engine
 * reads them, so they are sentences rather than filler.
 *
 * Only `en` is here, because only `en` was measured to need it. In pl-en the
 * same experiment changed nothing at all (sixteen lone words, none truncated):
 * the cap that bites is on how much target text a short input may produce, and
 * English words come out shorter than the Polish ones that exposed this. A
 * language missing from this table gets no companion - a sentence in the wrong
 * language would be a worse guess than none.
 *
 * The length is measured, not aesthetic: at 23 characters `watch` still came
 * back as `Zegark`, and past 33 nothing more improved while every extra word
 * cost decoding time.
 *
 * A `Map` rather than an object, because the key is a language out of the
 * settings and `{}.toString` is not a sentence.
 */
const COMPANIONS = new Map([["en", "The old man wrote a short letter."]]);

/**
 * The sentence to add to this batch, or `null` when it would buy nothing.
 *
 * The question is whether any row is short enough to be at risk - not whether
 * some other row is already long. A phrase sent together with the sentence it
 * came from still came back as `Zegark` and `rozliczeć` where the same batch
 * with this companion in it gave `Zegarek` and `rozliczenie` (2 of 12 phrases,
 * measured 2026-08-11; the other ten were identical, and none got worse). Length
 * is evidently not the whole mechanism - the likeliest rest of it is that the
 * shortlist restricting the output vocabulary is chosen per batch, so an
 * ordinary sentence puts ordinary words within reach - but the rule is what was
 * measured, not what explains it.
 *
 * @param {string} from source language of the batch
 * @param {readonly string[]} texts what the caller actually wants translated
 * @returns {string | null}
 */
export function companionFor(from, texts) {
  const companion = COMPANIONS.get(from);
  if (companion === undefined || texts.length === 0) return null;
  if (!texts.some((text) => text.trim().length < companion.length)) return null;
  return companion;
}
