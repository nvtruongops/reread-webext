/**
 * Custom CSS (D176): rules somebody typed into the settings to dress the
 * bubble and the reader page, screened before they dress anything.
 *
 * The one promise this module keeps is PRIVACY.md's: nothing the extension
 * shows loads anything from outside the package. A stylesheet can reach the
 * network on its own - `url()` in a background, an `@import`, a `@font-face`
 * - so a typed one is not applied as typed. The browser's own parser reads it
 * first (a constructed sheet, `replaceSync`), the parsed rules are walked and
 * the whole sheet is refused at the first rule that could load anything, and
 * what gets adopted is the parser's serialization, never the text.
 * Serialization is what makes the screen honest: the parser resolves escapes
 * and case, so `u\72l(` and `URL(` come out as `url(` before the screen looks.
 *
 * The rule half is pure over a structural shape of the CSSOM, so it runs
 * under `node --test`; the compile half needs a browser.
 */

/**
 * A stylesheet rule as the screen sees it - the CSSOM's shape kept
 * structural: what kind of rule it is, how the browser serializes it, and
 * the rules nested in it (an `@media` block's, a nested style rule's).
 *
 * @typedef {{ kind: RuleKind, cssText: string, rules: RuleLike[] }} RuleLike
 */

/**
 * The kinds the screen tells apart. Everything that is not one of the three
 * refused outright is `other` - a style rule, a grouping rule, a keyframes
 * block - and is screened by its text and its nested rules alone.
 *
 * @typedef {"import" | "font-face" | "namespace" | "other"} RuleKind
 */

/**
 * Why a sheet was refused. `network` is a value that names something to
 * load; the three kinds are refused whatever they say; `unparsed` is the
 * engine declining the text altogether (no constructed sheets, or an older
 * engine throwing on `@import` instead of dropping it).
 *
 * @typedef {"network" | "import" | "font-face" | "namespace" | "unparsed"} Refusal
 */

/**
 * The functions that make a value load something: `url()` and its two
 * modern spellings, and the image sets that take addresses by the list. No
 * word boundary in front on purpose - `-webkit-image-set(` has none - and
 * matched on the serialization, where escapes and case are already resolved.
 * A string that merely contains one of them (`content: "url(x)"`) is refused
 * too; that is a false alarm nobody has a real use for.
 */
const LOADS = /(?:url|src|image|image-set)\(/i;

/**
 * @param {RuleLike} rule
 * @returns {Refusal | null}
 */
function refusal(rule) {
  if (rule.kind !== "other") return rule.kind;
  if (LOADS.test(rule.cssText)) return "network";
  for (const nested of rule.rules) {
    const found = refusal(nested);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The screen itself: every rule of the sheet, or none of them.
 *
 * All or nothing rather than dropping the offending rule: a sheet with a hole
 * in it would dress the bubble differently from what somebody typed and say
 * nothing about why, while the settings page can say why instead.
 *
 * @param {RuleLike[]} rules the sheet's top-level rules, as the parser serialized them
 * @returns {{ ok: true, css: string } | { ok: false, reason: Refusal }}
 *   the sheet's text as the parser wrote it back, one rule per line - or the
 *   first reason to refuse the whole of it
 */
export function screenRules(rules) {
  for (const rule of rules) {
    const found = refusal(rule);
    if (found !== null) return { ok: false, reason: found };
  }
  return { ok: true, css: rules.map((rule) => rule.cssText).join("\n") };
}

/**
 * The CSSOM's rules in the screen's shape.
 *
 * @param {CSSRuleList} list
 * @returns {RuleLike[]}
 */
export function describeRules(list) {
  return Array.from(list, (rule) => {
    const nested = /** @type {{ cssRules?: CSSRuleList }} */ (rule).cssRules;
    return {
      kind: kindOf(rule),
      cssText: rule.cssText,
      rules: nested instanceof CSSRuleList ? describeRules(nested) : [],
    };
  });
}

/**
 * @param {CSSRule} rule
 * @returns {RuleKind}
 */
function kindOf(rule) {
  if (rule instanceof CSSImportRule) return "import";
  if (rule instanceof CSSFontFaceRule) return "font-face";
  if (rule instanceof CSSNamespaceRule) return "namespace";
  return "other";
}

/**
 * A rule that stands in front of the text while a document parses it, so that
 * an `@import` in the text is invalid where it stands - imports are only valid
 * before every other rule - and is dropped by the parser without being loaded.
 * A constructed sheet drops imports on its own; a `<style>` element would try
 * to load them, and this is what stops it at the parser (Gecko also refuses
 * every load out of a data document, `nsDataDocumentContentPolicy` - two
 * locks on the one door). Taken back off the parsed rules before the screen
 * sees them.
 */
const LEAD = ":root{}";

/**
 * The text parsed by the browser that will apply it, two ways.
 *
 * A constructed sheet first: it is what the bubble and the reader page adopt,
 * and it drops `@import` on its own. Where there is no constructor - a content
 * script in Firefox runs in a sandbox that is not a window, and the
 * constructor wants a window's document (`StyleSheet::Constructor` throws
 * NotSupportedError) - a `<style>` in a document made by script parses the
 * text instead: no browsing context, so nothing renders and no value is ever
 * loaded, and the lead rule above keeps an import from loading at parse time.
 * That way hands back no sheet to adopt, only the rules for the serialization
 * - which is what the `<style>` fallback in `content/tooltip.js` applies, and
 * the only way that works where the constructor does not.
 *
 * @param {string} text
 * @returns {{ sheet: CSSStyleSheet | null, rules: RuleLike[] } | null} null
 *   when neither way could parse the text
 */
function parse(text) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    return { sheet, rules: describeRules(sheet.cssRules) };
  } catch {
    // No constructor here; the document below is the other way to parse.
  }
  try {
    const inert = document.implementation.createHTMLDocument("");
    const element = inert.createElement("style");
    element.textContent = `${LEAD}\n${text}`;
    inert.head.append(element);
    const sheet = element.sheet;
    if (sheet === null) return null;
    return { sheet: null, rules: describeRules(sheet.cssRules).slice(1) };
  } catch {
    return null;
  }
}

/**
 * The typed text screened, as a sheet the bubble's shadow root and the reader
 * page can adopt where the browser hands one out, and always as the
 * serialization the `<style>` fallback uses where a constructed sheet cannot
 * be had or adopted (`content/tooltip.js`) - or the reason it was refused.
 * Parsed by the engine that will apply it (`parse`), screened, handed back.
 *
 * Nothing is thrown: the settings page turns a refusal into a sentence, the
 * bubble and the reader into the default look.
 *
 * @param {string} text
 * @returns {{ ok: true, sheet: CSSStyleSheet | null, css: string } | { ok: false, reason: Refusal }}
 */
export function compileUserCss(text) {
  const parsed = parse(text);
  if (parsed === null) return { ok: false, reason: "unparsed" };
  const screened = screenRules(parsed.rules);
  if (!screened.ok) return screened;
  return { ok: true, sheet: parsed.sheet, css: screened.css };
}

/**
 * A page's dressing in the reader's own rules (D176): the sheet adopted beside
 * the page's stylesheets - after them, so theirs win on equal specificity -
 * and taken back out for the next text. One per document: the reader page and
 * the popup each keep theirs. A refused text takes the previous sheet away and
 * adds nothing. Through the CSSOM like everything the extension's pages style
 * at runtime: their content security policy allows no inline style, and a
 * constructed sheet is not inline style to it. Never the settings page, which
 * is where a rule is undone.
 *
 * @param {{ adoptedStyleSheets: CSSStyleSheet[] }} target the document to dress
 * @returns {(text: string) => void}
 */
export function dresser(target) {
  /** @type {{ text: string, sheet: CSSStyleSheet | null }} */
  let worn = { text: "", sheet: null };
  return (text) => {
    if (text === worn.text) return;
    const others = target.adoptedStyleSheets.filter((sheet) => sheet !== worn.sheet);
    const compiled = text.length > 0 ? compileUserCss(text) : null;
    const sheet = compiled !== null && compiled.ok ? compiled.sheet : null;
    worn = { text, sheet };
    target.adoptedStyleSheets = sheet !== null ? [...others, sheet] : others;
  };
}
