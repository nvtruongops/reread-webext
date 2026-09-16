/**
 * Where the extension sends somebody who wants more dictionaries: the answer
 * on the re/read page that lists the sources we know of, each with its
 * licence. One address, written once - the settings page links it twice and
 * the bubble once (D192) - so that the day the page moves, it moves here.
 *
 * A link the reader follows, never a request the extension makes: nothing
 * here fetches. The page exists in two languages, and a Polish interface is
 * sent to the Polish one; every other interface reads the English page.
 */

/** The English page, and the one every interface but Polish opens. */
const SOURCES_PAGE = "https://reapps.eu/read#faq-dictionary-sources";

/** The Polish page, for a Polish interface. */
const SOURCES_PAGE_PL = "https://reapps.eu/pl/read#faq-dictionary-sources";

/**
 * @param {string} locale the interface language, as `uiLocale` names it
 * @returns {{ href: string, label: string }} the address and the words a link
 *   to it shows - the page's own name, without scheme or anchor, so that the
 *   reader can tell where a press leads before pressing
 */
export function dictionarySourcesLink(locale) {
  const polish = locale.toLowerCase().startsWith("pl");
  return {
    href: polish ? SOURCES_PAGE_PL : SOURCES_PAGE,
    label: polish ? "reapps.eu/pl/read" : "reapps.eu/read",
  };
}
