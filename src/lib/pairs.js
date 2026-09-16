/**
 * One rule about language pairs that three surfaces share (D166): the
 * settings page's pair select, the popup's, and the pair a freshly imported
 * dictionary adopts when none is chosen.
 *
 * A pair's target language decides one thing only - the shelf: which
 * vocabulary a phrase is filed on, what the export is named, which
 * underlines a page wears. Looking up ignores it: the dictionaries answer by
 * the language of their headwords alone, so a book explaining English in
 * English already answers under en -> pl (G3's rule, deliberately). A pair a
 * monolingual book offers is therefore nothing but a second shelf for a
 * language that has one - two vocabularies for English, "Polish -> Polish"
 * for a Pole (Michał's doubt, 2026-09-01) - except for one reader: the one
 * whose only book for a language is monolingual. Without a pair there is no
 * shelf at all (D120), so for them the monolingual pair is the last resort,
 * and it stays.
 */

/**
 * The pairs to offer, with a monolingual pair kept only where no bilingual
 * pair reads the same language. Order is kept; a caller that adds the
 * configured pair back does so after this, so a shelf somebody is standing
 * on never disappears from under them.
 *
 * @template {{ from: string, to: string }} R
 * @param {readonly R[]} rows
 * @returns {R[]}
 */
export function monolingualLastResort(rows) {
  const bilingual = new Set(rows.filter((row) => row.from !== row.to).map((row) => row.from));
  return rows.filter((row) => row.from !== row.to || !bilingual.has(row.from));
}
