/**
 * Which of the popup's rows stand, once the settings have been read.
 *
 * Two questions decide it, and both are about what the popup would otherwise
 * promise. A fresh install has no model, so a pair select would offer a
 * translation nothing can deliver (the signpost to the settings stands in its
 * place). Translation switched off (D120) takes the whole translating half of
 * the extension out of reach, so every row that only serves it goes too; the
 * switch itself, ticked, is what says so (D202 - the note that once stood
 * where the pair was repeated the switch, and read as a warning).
 *
 * Pure and separate from the popup's DOM for the reason `choices.js` is: the
 * rule is worth a test, and `node --test` has no popup to open.
 */

/**
 * @typedef {object} PopupRows
 * @property {boolean} site the switch for the site the popup opened over
 * @property {boolean} pair the language pair select
 * @property {boolean} setup the signpost that stands in the pair's place on a
 *   device with no model at all
 * @property {boolean} lookup the look-up field (D197)
 * @property {boolean} vocabulary the door to the saved phrases
 * @property {boolean} readerOnly the reader-only switch
 * @property {boolean} translation the translation-off switch itself
 */

/**
 * @param {{ translationOff: boolean, bubbleOff: boolean, fresh: boolean, pair: boolean }} state
 *   the two settings, whether this device holds no translation model at all,
 *   and whether a language pair is chosen (D162: with one, the quiet
 *   vocabulary works on ordinary pages, and the rows that serve it stand)
 * @returns {PopupRows}
 */
export function popupRows({ translationOff, bubbleOff, fresh, pair }) {
  return {
    site: siteRowStands({ translationOff, bubbleOff }),
    // Under the trim the pair still has a say - which language the
    // dictionaries answer in where a page declares none, and where saved
    // phrases are filed (D158/D165) - and a select that hid while deciding
    // both made the trim read as pairless (Michał, 2026-09-01). So it stands
    // whenever a pair is chosen, models or not; with the model on, a fresh
    // device gets the signpost in its place instead.
    pair: translationOff ? pair : !fresh,
    setup: !translationOff && fresh,
    lookup: lookupRowStands({ pair }),
    // The saved phrases live wherever a pair is chosen - the quiet
    // vocabulary writes them without the engine (D158/D162) - so their door
    // goes only when there is truly nothing behind it.
    vocabulary: !translationOff || pair,
    // The folded-bubble switch (D81) stood here from D128 to D197; it is set
    // once and left, and the popup keeps what is flipped often (Michał's
    // call after the first smoke of the look-up field, 2026-09-11) - the
    // settings page keeps it.
    // Reader-only keeps its say under the trim now (D162): with a pair the
    // ordinary pages read again, and this is the switch that decides. It
    // still goes when every page is a launcher (no pair) or left alone
    // entirely (the no-bubble sub-option).
    readerOnly: !translationOff || (pair && !bubbleOff),
    // Always, and it is the one switch that stays: it is the way back, and a
    // mode with no way out of it in the surface that turned it on would be a
    // trap. The row it sits in is the last before the settings, where the
    // popup keeps what is flipped rarely.
    translation: true,
  };
}

/**
 * Whether the switch for the site the popup opened over may stand at all
 * (D149): with the bubble switched off under the trim every ordinary page is
 * left alone already, so a switch that could only leave it alone too has no
 * other side - the row goes; a site's own entry, if any, stays readable in
 * the settings' list. Its own rule, because the popup needs it before it
 * knows the rest (D194): the row stands from the first paint, and the
 * settings alone decide whether it should.
 *
 * @param {{ translationOff: boolean, bubbleOff: boolean }} settings
 * @returns {boolean}
 */
export function siteRowStands({ translationOff, bubbleOff }) {
  return !(translationOff && bubbleOff);
}

/**
 * Whether the look-up field stands (D197): wherever a pair is chosen, models
 * or not - the field asks the dictionaries in the pair's language and files
 * the phrase under the pair, and neither needs the engine (the trim changes
 * nothing here). Without a pair there is no language to ask in and nowhere
 * to file, and the signpost to the settings already says what to do first.
 * Its own rule for the site row's reason (D194): the settings alone decide
 * it, so the popup settles the row before the models are read and nothing
 * below it moves.
 *
 * @param {{ pair: boolean }} settings whether a language pair is chosen
 * @returns {boolean}
 */
export function lookupRowStands({ pair }) {
  return pair;
}
