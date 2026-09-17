/**
 * The dictionaries' shelf: what the books said about a phrase, as one fold
 * per book with a row per meaning - the one answer drawn in three homes
 * (Michał's fifth brief, 2026-09-12): the "Add a phrase" panel on the
 * saved-phrases page, where a row's box ticks a meaning into the vocabulary
 * and out of it; the toolbar popup, which only reads and shows the rows
 * without their boxes; and the bubble over a selection, where the rows
 * save at once as they do on the page and the box the bubble scrolls in
 * stands for the fold a long book gets elsewhere.
 *
 * Only the markup is shared. Each home dresses the same class names in its
 * own sheet - `.lookup-*` in assets/page.css for the pages, the bubble's
 * own stylesheet inside its shadow root - because the shelf takes its face
 * and its measures from the context: the reading face on the page, the
 * interface's in the bubble, whose text may not melt into the serif of
 * the article around it. What differs between the homes travels in as
 * `ShelfOptions`: what the phrase means now, whether a row may write,
 * whether a long book folds, and the remembered state of the folds, which
 * the home owns because the home knows when a word changed.
 *
 * Every string goes into the DOM through `textContent`: the lines came
 * out of a file somebody downloaded.
 */

import { t } from "./i18n.js";
import { LINES_OPEN, foldPoint, isSaved, scrollToShow } from "./lookup.js";

/** @typedef {import("./lookup.js").EntryGroup} EntryGroup */

/**
 * @typedef {object} ShelfOptions
 * @property {string[]} meanings what the phrase means now - the rows that
 *   are ticked
 * @property {Map<string, boolean>} folds which folds the reader opened or
 *   closed by hand, by key (`group:<book>`, `more:<book>`, `about:<book>`),
 *   so a redraw finds them as they were left; the home empties it with
 *   every new word
 * @property {boolean} [readOnly] the rows without their boxes, nothing to
 *   press (the popup)
 * @property {boolean} [disabled] the boxes there but out of reach - the
 *   bubble while its edit box is open
 * @property {number | null} [foldAt] how many lines of a book stand open
 *   before the rest fold under "Show all" - `LINES_OPEN` by default; null
 *   folds nothing, for a home whose own box scrolls (the bubble; the popup,
 *   D207)
 * @property {boolean} [oneOpen] the books one open at a time: a book opened
 *   folds the one that was open (the bubble, D214 - its box stands pinned
 *   at the height it had, and a second book opened under a first still
 *   open opened out of sight, under the box's edge)
 * @property {(line: string, at: string) => void} [onPress] a row ticked or
 *   unticked: the line, and the row's mark (`data-line`) for the home to
 *   find the row again after its redraw
 */

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} className
 * @param {string} label
 * @returns {HTMLButtonElement}
 */
export function button(className, label) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
}

/**
 * A fold with its state remembered: open as the reader last left it, or as
 * the default says; every change of the reader's hand is written down for
 * the next redraw.
 *
 * @param {string} className
 * @param {string} key the fold's key in `folds`
 * @param {boolean} openByDefault
 * @param {HTMLElement} summary
 * @param {Map<string, boolean>} folds
 * @returns {HTMLDetailsElement}
 */
export function shelfFold(className, key, openByDefault, summary, folds) {
  const details = document.createElement("details");
  details.className = className;
  details.open = folds.get(key) ?? openByDefault;
  details.append(summary);
  details.addEventListener("toggle", () => {
    folds.set(key, details.open);
  });
  return details;
}

/**
 * A dictionary line as a row: where the shelf writes, a label over the
 * whole row with a native checkbox in it - it draws solidly on e-ink,
 * reads as a checkbox to a screen reader, and takes the space bar and Tab
 * for nothing - ticked while the meaning is kept, and told so by the box's
 * own mark and the weight of the text (the stylesheet, off `data-saved`):
 * a wash alone is one of the 16 greys an e-ink panel rounds back to paper.
 * Where the shelf only reads, the same row without its box: nothing to
 * press, the weight alone saying the meaning is kept.
 *
 * @param {string} line
 * @param {string} at the row's mark, stable across redraws
 * @param {{ saved: boolean, readOnly?: boolean, disabled?: boolean, onPress?: (line: string, at: string) => void }} how
 * @returns {HTMLElement}
 */
export function shelfRow(line, at, { saved, readOnly = false, disabled = false, onPress }) {
  const row = element(readOnly ? "div" : "label", "lookup-line");
  row.dataset["line"] = at;
  row.dataset["saved"] = saved ? "true" : "false";
  if (!readOnly) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "lookup-line-box";
    box.checked = saved;
    box.disabled = disabled;
    box.addEventListener("change", () => onPress?.(line, at));
    row.append(box);
  }
  row.append(element("span", "lookup-line-text", line));
  return row;
}

/**
 * The rest of a long book's lines behind "Show all (N)": the lines in a
 * block that is hidden or shown, and the button after them - always the
 * book's last child but one, so the rows unfold above it and it does not
 * move between the two states. A button over a hidden block rather than a
 * `details`: a summary has to stand first in its fold, and the rows then
 * unfolded under the link. Opened and closed on the spot, without a redraw
 * (a redraw rebuilds the rows under the finger); the state is written down
 * in `folds` for the next redraw. A close from the bottom of a long book
 * brings the book's name back into view when it has scrolled out of it -
 * past the window's top, or under the bar stuck there on the saved phrases
 * (D219): the page's own scroll padding says where the visible page
 * begins, and `scrollIntoView` lands under the same number on the way
 * back - so the reader does not land in another book; an open moves
 * nothing - the rows appear where the button was.
 *
 * @param {HTMLElement} book the fold the lines belong to
 * @param {EntryGroup} group
 * @param {boolean} unfolded whether the block starts shown (a saved line in
 *   it, `foldPoint`)
 * @param {number} at the book's index, for the block's id
 * @param {Map<string, boolean>} folds
 * @returns {{ rest: HTMLElement, toggle: HTMLButtonElement }}
 */
function moreFold(book, group, unfolded, at, folds) {
  const key = `more:${group.dictionary}`;
  const open = folds.get(key) ?? unfolded;
  const rest = element("div", "lookup-more");
  rest.id = `lookup-more-${at}`;
  rest.hidden = !open;
  const toggle = button("lookup-more-toggle", "");
  toggle.setAttribute("aria-controls", rest.id);
  const say = (/** @type {boolean} */ shown) => {
    toggle.textContent = shown ? t("lookup_show_fewer") : t("lookup_show_all", [group.lines.length.toLocaleString()]);
    toggle.setAttribute("aria-expanded", String(shown));
  };
  say(open);
  toggle.addEventListener("click", () => {
    // `hidden` may also be a string in the newest DOM typings.
    const opening = rest.hidden === true;
    rest.hidden = !opening;
    say(opening);
    folds.set(key, opening);
    if (!opening && book.getBoundingClientRect().top < coveredTop()) book.scrollIntoView({ block: "start" });
  });
  return { rest, toggle };
}

/**
 * Where the visible page begins: the root's `scroll-padding-top` where the
 * page has one (the bar stuck over the saved phrases, D219), the window's
 * top edge where it has none (the popup). `auto` reads as no padding.
 */
function coveredTop() {
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
  return Number.isFinite(padding) ? padding : 0;
}

/**
 * Formats dictionary display name, shortening verbose names like
 * "tudien Anh-Việt tổng hợp (en-vi)" to "EN - VI".
 *
 * @param {string} name
 * @returns {string}
 */
export function formatDictName(name) {
  if (/^tudien.*anh-việt/i.test(name)) return "EN - VI";
  return name;
}

/**
 * Common etymology patterns and clauses translated to natural, fluent Vietnamese.
 * @type {Array<[RegExp, string | ((...args: any[]) => string)]>}
 */
const ETYM_RULES = [
  // Specific literary/historical clauses
  [/\boriginally\s+meant\s+[‘']having\s+the\s+power\s+to\s+control\s+destiny['’]/gi, "ban đầu mang nghĩa 'có quyền năng điều khiển số phận'"],
  [/\band\s+was\s+used\s+especially\s+in\s+the\s+Weird\s+Sisters\b/gi, "và đặc biệt xuất hiện trong cụm 'Weird Sisters'"],
  [/\boriginally\s+referring\s+to\s+the\s+Fates\b/gi, "ban đầu dùng để chỉ Ba nữ thần Định Mệnh (Fates)"],
  [/\blater\s+the\s+witches\s+in\s+Shakespeare's\s+Macbeth\b/gi, "sau này là các mụ phù thủy trong vở kịch Macbeth của Shakespeare"],
  [/\bthe\s+latter\s+use\s+gave\s+rise\s+to\s+the\s+sense\s+[‘']unearthly['’]/gi, "cách dùng sau này đã làm biến chuyển sang nét nghĩa 'kỳ lạ, huyền bí'"],
  [/\bgave\s+rise\s+to\s+the\s+sense\b/gi, "đã làm phát sinh nét nghĩa"],
  [/\bgave\s+rise\s+to\b/gi, "đã tạo nên"],

  // Sentence starters / periods
  [/^senses?\s+(\d+)\s+to\s+(\d+)\s*/i, "Đối với nét nghĩa $1 đến $2: "],
  [/^sense\s+\(?(\d+)\)?\s*/i, "Đối với nét nghĩa $1: "],
  [/\bearly\s+(\d+)th\s+cent\.(?:\s*\(in\s+the\s+sense\s+([^)]+)\))?/gi, (_, c, s) => `đầu thế kỷ ${c}${s ? ` (với nghĩa ${s})` : ""}`],
  [/\blate\s+(\d+)th\s+cent\.(?:\s*\(in\s+the\s+sense\s+([^)]+)\))?/gi, (_, c, s) => `cuối thế kỷ ${c}${s ? ` (với nghĩa ${s})` : ""}`],
  [/\bmid\s+(\d+)th\s+cent\.(?:\s*\(in\s+the\s+sense\s+([^)]+)\))?/gi, (_, c, s) => `giữa thế kỷ ${c}${s ? ` (với nghĩa ${s})` : ""}`],
  [/\b(\d+)th\s+cent\./gi, "thế kỷ $1"],
  [/^(\d{4})s:/i, "Thập niên $1:"],

  // Common syntactic structures
  [/\barchaic\s+past\s+participle\s+of\b/gi, "quá khứ phân từ cổ của"],
  [/\bpast\s+participle\s+of\b/gi, "quá khứ phân từ của"],
  [/\bpast\s+of\b/gi, "thì quá khứ của"],
  [/\bshortened\s+form\b/gi, "dạng từ rút gọn"],
  [/\bshortening\s+of\b/gi, "dạng rút gọn của"],
  [/\babbreviation\s+of\b/gi, "từ viết tắt của"],
  [/\babbreviation\b/gi, "từ viết tắt"],
  [/\bdiminutive\s+of\b/gi, "dạng từ giảm nhẹ của"],
  [/\bvariant\s+of\b/gi, "biến thể của"],
  [/\bblend\s+of\b/gi, "từ kết hợp giữa"],
  [/\bderivative\s+of\b/gi, "từ phái sinh của"],
  [/\bbased\s+on\b/gi, "dựa trên"],
  [/\brelated\s+to\b/gi, "có liên hệ với"],
  [/\bcompare\s+with\b/gi, "so sánh với"],
  [/\bnamed\s+after\b/gi, "được đặt tên theo"],
  [/\breinforced\s+by\s+its\s+source\b/gi, "được bổ trợ từ gốc"],
  [/\boriginally\s+meant\b/gi, "ban đầu mang nghĩa"],
  [/\boriginally\s+found\s+in\b/gi, "ban đầu chỉ xuất hiện trong"],
  [/\bprobably\s+from\b/gi, "có thể bắt nguồn từ"],
  [/\bprobably\s+of\b/gi, "có thể thuộc gốc"],
  [/\bof\s+unknown\s+(?:ultimate\s+)?origin\b/gi, "không rõ nguồn gốc"],
  [/\bAn\s+acronym\s+from\b/gi, "Từ viết tắt từ các chữ cái đầu của"],

  // "from the <part of speech>"
  [/\bfrom\s+the\s+verb\b/gi, "từ động từ"],
  [/\bfrom\s+the\s+noun\b/gi, "từ danh từ"],
  [/\bfrom\s+the\s+adjective\b/gi, "từ tính từ"],
  [/\b,\s*or\s+from\b/gi, ", hoặc từ"],
  [/\b,\s*or\b/gi, ", hoặc"],
  [/\bor\s+from\b/gi, "hoặc từ"],
  [/\bor\b/gi, "hoặc"],

  // Languages & origins
  [/\bof\s+West\s+Germanic\s+origin\b/gi, "thuộc gốc Tây Giéc-manh"],
  [/\bof\s+Germanic\s+origin\b/gi, "thuộc gốc Giéc-manh"],
  [/\bof\s+Scandinavian\s+origin\b/gi, "thuộc gốc Bắc Âu"],
  [/\bof\s+African\s+origin\b/gi, "thuộc gốc Châu Phi"],
  [/\bvia\s+medieval\s+Latin\s+from\s+Greek\b/gi, "thông qua tiếng La-tinh trung cổ từ tiếng Hy Lạp"],
  [/\bvia\s+Latin\s+from\s+Greek\b/gi, "thông qua tiếng La-tinh từ tiếng Hy Lạp"],
  [/\bvia\s+Old\s+French\b/gi, "thông qua tiếng Pháp cổ"],
  [/\bvia\s+French\b/gi, "thông qua tiếng Pháp"],
  [/\bvia\s+Latin\b/gi, "thông qua tiếng La-tinh"],

  // "from <Language>"
  [/\bfrom\s+Old\s+French\b/gi, "từ tiếng Pháp cổ"],
  [/\bfrom\s+Old\s+English\b/gi, "từ tiếng Anh cổ"],
  [/\bfrom\s+Old\s+Norse\b/gi, "từ tiếng Bắc Âu cổ"],
  [/\bfrom\s+late\s+Latin\b/gi, "từ tiếng La-tinh hậu kỳ"],
  [/\bfrom\s+medieval\s+Latin\b/gi, "từ tiếng La-tinh trung cổ"],
  [/\bfrom\s+ecclesiastical\s+Latin\b/gi, "từ tiếng La-tinh giáo hội"],
  [/\bfrom\s+Latin\b/gi, "từ tiếng La-tinh"],
  [/\bfrom\s+Greek\b/gi, "từ tiếng Hy Lạp"],
  [/\bfrom\s+French\b/gi, "từ tiếng Pháp"],
  [/\bfrom\s+German\b/gi, "từ tiếng Đức"],
  [/\bfrom\s+Dutch\b/gi, "từ tiếng Hà Lan"],
  [/\bfrom\s+Italian\b/gi, "từ tiếng Ý"],
  [/\bfrom\s+Spanish\b/gi, "từ tiếng Tây Ban Nha"],
  [/\bfrom\s+Celtic\b/gi, "từ tiếng Xen-tơ"],
  [/\bfrom\s+Urdu\b/gi, "từ tiếng Urdu"],
  [/\bfrom\s+Persian\b/gi, "từ tiếng Ba Tư"],
  [/\bfrom\s+Arabic\b/gi, "từ tiếng Ả Rập"],

  // Language names standalone
  [/\blate\s+Middle\s+English\b/gi, "tiếng Anh trung đại muộn"],
  [/\bearly\s+Middle\s+English\b/gi, "tiếng Anh trung đại sớm"],
  [/\bMiddle\s+English\b/gi, "tiếng Anh trung đại"],
  [/\blate\s+Old\s+English\b/gi, "tiếng Anh cổ muộn"],
  [/\bearly\s+Old\s+English\b/gi, "tiếng Anh cổ sớm"],
  [/\bOld\s+English\b/gi, "tiếng Anh cổ"],
  [/\bOld\s+French\b/gi, "tiếng Pháp cổ"],
  [/\bOld\s+Norse\b/gi, "tiếng Bắc Âu cổ"],
  [/\bAnglo-Norman\s+French\b/gi, "tiếng Pháp Anglo-Norman"],
  [/\blate\s+Latin\b/gi, "tiếng La-tinh hậu kỳ"],
  [/\bmedieval\s+Latin\b/gi, "tiếng La-tinh trung cổ"],
  [/\becclesiastical\s+Latin\b/gi, "tiếng La-tinh giáo hội"],
  [/\bLatin\b/gi, "tiếng La-tinh"],
  [/\bGreek\b/gi, "tiếng Hy Lạp"],
  [/\bGermanic\b/gi, "Giéc-manh"],
  [/\bDutch\b/gi, "tiếng Hà Lan"],
  [/\bGerman\b/gi, "tiếng Đức"],
  [/\bFrench\b/gi, "tiếng Pháp"],
  [/\bItalian\b/gi, "tiếng Ý"],
  [/\bSpanish\b/gi, "tiếng Tây Ban Nha"],

  // Parts of speech & words
  [/\bThe\s+adjective\b/gi, "Tính từ này"],
  [/\bThe\s+noun\b/gi, "Danh từ này"],
  [/\bThe\s+verb\b/gi, "Động từ này"],
  [/\bthe\s+verb\b/gi, "động từ"],
  [/\bthe\s+noun\b/gi, "danh từ"],
  [/\bthe\s+adjective\b/gi, "tính từ"],
  [/\(verb\)/gi, "(động từ)"],
  [/\(noun\)/gi, "(danh từ)"],
  [/\(adjective\)/gi, "(tính từ)"],
  [/\(plural\)/gi, "(số nhiều)"],
  [/\bdestiny\b/gi, "số phận, định mệnh"],
  [/\bunearthly\b/gi, "huyền bí, kỳ lạ"],
  [/\bexpressing\s+reversal\b/gi, "biểu thị sự đảo ngược"],
  [/\bexpressing\s+negation\b/gi, "biểu thị sự phủ định"],
  [/\bfrom\b/gi, "từ"],
  [/\balso\s+to\b/gi, "cũng liên quan đến"],
];

/**
 * @param {string} text
 * @returns {string}
 */
export function translateEtymology(text) {
  let res = text.trim();
  if (res.startsWith("•")) res = res.replace(/^[•*—\-–]+\s*/u, "").trim();

  if (/^Old\s+English\b/i.test(res)) {
    res = "Bắt nguồn từ " + res;
  }

  for (const [pattern, repl] of ETYM_RULES) {
    res = res.replace(pattern, /** @type {any} */ (repl));
  }
  return res;
}

/**
 * @param {string} form
 * @param {string} [baseWord]
 * @param {string} [baseMeaning]
 * @param {string[]} [examples]
 * @returns {{ form: string, tag: string, meaning: string, exSrc: string, exTgt: string }}
 */
export function deriveFormDetails(form, baseWord = "", baseMeaning = "", examples = []) {
  const f = form.trim();
  const lower = f.toLowerCase();
  const meaningBase = (baseMeaning || baseWord || f).replace(/^(to\s+|a\s+|an\s+)/i, "").trim();

  let tag = t("lookup_word_forms");
  let meaning = meaningBase;
  let exSrc = `• ${f}`;
  let exTgt = `→ ${meaningBase}`;

  if (lower.startsWith("the ")) {
    tag = "Dạng xác định (the + noun)";
    meaning = `chính ${meaningBase}`;
    exSrc = `• for ${f}`;
    exTgt = `→ vì ${meaningBase}`;
  } else if (
    lower.endsWith("ies") ||
    (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is"))
  ) {
    tag = "Dạng số nhiều (plural)";
    meaning = `các ${meaningBase}`;
    exSrc = `• multiple ${f}`;
    exTgt = `→ nhiều ${meaningBase}`;
  } else if (lower.endsWith("ed")) {
    tag = "Quá khứ / Phân từ (V-ed)";
    meaning = `đã ${meaningBase}`;
    exSrc = `• well ${f}`;
    exTgt = `→ được ${meaningBase} tốt`;
  } else if (lower.endsWith("ing")) {
    tag = "Hiện tại phân từ (V-ing)";
    meaning = `đang ${meaningBase} / việc ${meaningBase}`;
    exSrc = `• when ${f}`;
    exTgt = `→ khi ${meaningBase}`;
  } else if (lower.endsWith("er")) {
    tag = "So sánh hơn (comparative)";
    meaning = `${meaningBase} hơn`;
    exSrc = `• much ${f}`;
    exTgt = `→ ${meaningBase} hơn nhiều`;
  } else if (lower.endsWith("est")) {
    tag = "So sánh nhất (superlative)";
    meaning = `${meaningBase} nhất`;
    exSrc = `• the ${f}`;
    exTgt = `→ ${meaningBase} nhất`;
  }

  for (const ex of examples) {
    if (typeof ex === "string" && ex.toLowerCase().includes(lower)) {
      const parts = ex.split(/[↔→]/);
      const p0 = parts[0];
      const p1 = parts[1];
      if (p0 !== undefined && p1 !== undefined) {
        exSrc = `• ${p0.replace(/^[•*‣\-]+\s*/, "").trim()}`;
        exTgt = `→ ${p1.trim()}`;
        break;
      }
    }
  }

  return { form: f, tag, meaning, exSrc, exTgt };
}

/**
 * @param {string} text
 * @param {{ baseWord?: string, primaryMeaning?: string, entryExamples?: string[] } | null} [context]
 * @returns {HTMLElement}
 */
export function formatAboutRow(text, context = null) {
  const clean = text.replace(/^[•*—\-–]+\s*/u, "").trim();
  const row = element("div", "lookup-about-row");

  if (clean.includes(" — ")) {
    const head = element("div", "lookup-about-head");
    const badge = element("span", "lookup-about-badge", t("lookup_word_forms"));
    head.append(badge);

    const forms = clean.split(" — ").map((s) => s.trim()).filter(Boolean);
    const chipsWrap = element("div", "lookup-about-chips");

    forms.forEach((formStr) => {
      const details = deriveFormDetails(formStr, context?.baseWord, context?.primaryMeaning, context?.entryExamples);
      const chip = button("lookup-about-chip", "");
      chip.type = "button";
      chip.setAttribute("aria-expanded", "false");
      chip.title = `${details.form}: ${details.meaning}`;

      const chipWord = element("span", "lookup-chip-word", details.form);
      const chipPreview = element("span", "lookup-chip-meaning-preview", `(${details.meaning})`);
      chip.append(chipWord, chipPreview);

      const card = element("div", "lookup-about-card");
      card.hidden = true;

      const cardTag = element("span", "lookup-about-card-tag", details.tag);
      const cardMeaningLabel = element("span", "lookup-card-label", t("lookup_meaning_prefix"));
      const cardMeaningVal = element("span", "lookup-card-text", details.meaning);
      const cardExLabel = element("span", "lookup-card-label", t("lookup_example_prefix"));
      const cardExWrap = element("div", "lookup-card-ex-wrap");
      const cardExSrc = element("div", "lookup-card-ex-src", details.exSrc);
      const cardExTgt = element("div", "lookup-card-ex-tgt", details.exTgt);
      cardExWrap.append(cardExSrc, cardExTgt);

      card.append(cardTag, cardMeaningLabel, cardMeaningVal, cardExLabel, cardExWrap);

      chip.addEventListener("click", () => {
        const opening = card.hidden === true;
        card.hidden = !opening;
        chip.setAttribute("aria-expanded", String(opening));
      });

      const itemWrap = element("div", "lookup-about-item");
      itemWrap.append(chip, card);
      chipsWrap.append(itemWrap);
    });

    row.append(head, chipsWrap);
  } else if (/^(?:late\s+|early\s+)?(?:Old\s+English|Old\s+Norse|Middle\s+English|Latin|Greek|French|German|from)\b/i.test(clean)) {
    const details = document.createElement("details");
    details.className = "lookup-etymology-details";
    details.open = false;

    const summary = document.createElement("summary");
    summary.className = "lookup-etymology-summary";
    const badge = element("span", "lookup-about-badge", t("lookup_etymology") || "Nguồn gốc từ");
    const toggleLabel = element("span", "lookup-etymology-toggle-label", t("lookup_etymology_toggle") || "Xem chi tiết nguồn gốc từ");
    summary.append(badge, toggleLabel);

    const body = element("div", "lookup-etymology-body", translateEtymology(clean));
    details.append(summary, body);

    row.append(details);
  } else if (
    /^[a-zA-Z\s'-]+$/.test(clean) &&
    clean.length > 1 &&
    clean.length < 35 &&
    context?.baseWord &&
    clean.toLowerCase() !== context.baseWord.toLowerCase()
  ) {
    const head = element("div", "lookup-about-head");
    const badge = element("span", "lookup-about-badge", t("lookup_similar_words"));
    head.append(badge);

    const details = deriveFormDetails(clean, context.baseWord, context.primaryMeaning, context.entryExamples);
    const chip = button("lookup-about-chip", "");
    chip.type = "button";
    chip.setAttribute("aria-expanded", "false");

    const chipWord = element("span", "lookup-chip-word", details.form);
    const chipPreview = element("span", "lookup-chip-meaning-preview", `(${details.meaning})`);
    chip.append(chipWord, chipPreview);

    const card = element("div", "lookup-about-card");
    card.hidden = true;

    const cardTag = element("span", "lookup-about-card-tag", details.tag);
    const cardMeaningLabel = element("span", "lookup-card-label", t("lookup_meaning_prefix"));
    const cardMeaningVal = element("span", "lookup-card-text", details.meaning);
    const cardExLabel = element("span", "lookup-card-label", t("lookup_example_prefix"));
    const cardExWrap = element("div", "lookup-card-ex-wrap");
    const cardExSrc = element("div", "lookup-card-ex-src", details.exSrc);
    const cardExTgt = element("div", "lookup-card-ex-tgt", details.exTgt);
    cardExWrap.append(cardExSrc, cardExTgt);

    card.append(cardTag, cardMeaningLabel, cardMeaningVal, cardExLabel, cardExWrap);

    chip.addEventListener("click", () => {
      const opening = card.hidden === true;
      card.hidden = !opening;
      chip.setAttribute("aria-expanded", String(opening));
    });

    const itemWrap = element("div", "lookup-about-item");
    itemWrap.append(chip, card);
    row.append(head, itemWrap);
  } else {
    const head = element("div", "lookup-about-head");
    head.append(element("span", "lookup-about-bullet", "•"), element("span", "lookup-about-content", clean));
    row.append(head);
  }
  return row;
}

/**
 * What the book says beside its meanings - the transcriptions and the
 * cross-references, in the order the entry had them - folded under "More
 * about the word" at the end of the book, closed until asked: a reader
 * ticking meanings does not need eight transcriptions between them. One
 * line, one paragraph, plain text. Remembered like the other folds.
 *
 * @param {EntryGroup} group
 * @param {Map<string, boolean>} folds
 * @returns {HTMLDetailsElement}
 */
function aboutFold(group, folds) {
  const about = shelfFold("lookup-about", `about:${group.dictionary}`, false, element("summary", "lookup-about-label", t("lookup_more_about")), folds);
  const seenTexts = new Set();
  let primaryMeaning = "";
  /** @type {string[]} */
  const entryExamples = [];

  for (const entry of group.entries) {
    for (const row of entry.rows) {
      if (row.kind === "pronunciation" || row.kind === "example" || row.kind === "idiom" || row.kind === "meaning") {
        seenTexts.add(row.text.trim());
      }
      if (row.kind === "meaning" && !primaryMeaning) {
        primaryMeaning = row.text.replace(/^\d+\.\s*/, "").split(";")[0]?.trim() ?? "";
      } else if (row.kind === "example") {
        entryExamples.push(row.text);
      }
    }
  }

  const baseWord = group.entries[0]?.headword || "";
  const context = { baseWord, primaryMeaning, entryExamples };

  let count = 0;
  for (const line of group.about) {
    const trimmed = line.trim();
    if (seenTexts.has(trimmed)) continue;
    if (/sachxy\.com|từ điển anh việt/i.test(trimmed)) continue;
    about.append(formatAboutRow(trimmed, context));
    count += 1;
  }
  if (count === 0) {
    about.hidden = true;
    about.style.display = "none";
  }
  return about;
}


/**
 * The box the shelf scrolls in, when it scrolls in one: the nearest
 * ancestor set to scroll on its own - the bubble's box, the popup's answer
 * - and nothing on a page that scrolls as a whole, whose scroll is the
 * reader's own (the "Add a phrase" panel; `moreFold` moves it, and only to
 * bring a name back after a close). A bubble's walk ends at its shadow
 * root: the page under it is never the box.
 *
 * @param {Element} from
 * @returns {Element | null}
 */
function scrollBoxOf(from) {
  for (let node = from.parentElement; node !== null; node = node.parentElement) {
    const overflow = window.getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * A book opened by a press brought into view of the box it scrolls in
 * (D214; the rule is `scrollToShow`): the box's own scroll position moved
 * and nothing else - not `scrollIntoView`, which moves every scrolling
 * ancestor there is, the page under a bubble included. Measured against
 * the box's inner edges, its border left out.
 *
 * @param {HTMLElement} book
 */
function showOpened(book) {
  const box = scrollBoxOf(book);
  if (box === null) return;
  const top = box.getBoundingClientRect().top + box.clientTop;
  const edges = book.getBoundingClientRect();
  box.scrollTop += scrollToShow({ top, bottom: top + box.clientHeight }, { top: edges.top, bottom: edges.bottom });
}

/**
 * The books as folds: the first open, the others closed with the count of
 * their meanings in their name - the height of the answer limited by
 * structure, not by a scrollbar - in the order the answer came in, which is
 * the settings' order of the dictionaries. One open at a time where the
 * home says so (`oneOpen`, D214): the books share a name, and the browser
 * folds the open one as another opens - its own exclusive group, no script
 * between the press and the fold. A book opened by a press is brought into
 * view of the box the shelf scrolls in (`showOpened`) a frame later, once
 * the fold has answered the press: the click comes first, and the fold's
 * opening is what the click does by default. Inside a book, a label stands
 * over the first meaning after it, wherever that meaning lands - open, or
 * behind "Show all" - so a cut inside a section leaves the label with its
 * lines; a label with no meaning after it stands over nothing and is
 * dropped. Past `foldAt` lines the rest fold under "Show all", which opens
 * by itself when a saved meaning would otherwise be out of sight; the
 * transcriptions and cross-references are the book's "More about the
 * word", last.
 *
/**
 * @param {string} text
 * @returns {HTMLElement}
 */
export function formatPronunciationRow(text) {
  if (/^CEFR:/i.test(text)) {
    const row = element("div", "lookup-cefr-wrap");
    const badge = element("span", "lookup-cefr-badge", text.trim());
    row.append(badge);
    return row;
  }
  const row = element("div", "lookup-pronunciation");
  row.append(element("span", "lookup-ipa", text.trim()));
  return row;
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
export function formatExampleRow(text) {
  const row = element("div", "lookup-example");
  const clean = text.replace(/^[‣•*—\-–›»]+\s*/u, "").trim();
  const parts = clean.split("↔");
  if (parts.length === 2) {
    const src = element("span", "lookup-ex-source", parts[0]?.trim() ?? "");
    const arrow = element("span", "lookup-ex-arrow", "→");
    const tgt = element("span", "lookup-ex-target", parts[1]?.trim() ?? "");
    row.append(element("span", "lookup-ex-bullet", "•"), src, arrow, tgt);
  } else {
    row.append(element("span", "lookup-ex-bullet", "•"), element("span", "lookup-ex-source", clean));
  }
  return row;
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
export function formatIdiomRow(text) {
  const row = element("div", "lookup-idiom");
  const clean = text.replace(/^[★*]+\s*/u, "").trim();
  const parts = clean.split("↔");
  const star = element("span", "lookup-idiom-star", "★");
  if (parts.length === 2) {
    const src = element("span", "lookup-idiom-source", parts[0]?.trim() ?? "");
    const arrow = element("span", "lookup-ex-arrow", "→");
    const tgt = element("span", "lookup-idiom-target", parts[1]?.trim() ?? "");
    row.append(star, src, arrow, tgt);
  } else {
    row.append(star, element("span", "lookup-idiom-source", clean));
  }
  return row;
}

/**
 * @param {EntryGroup[]} groups
 * @param {ShelfOptions} options
 * @returns {HTMLElement[]} one fold per book
 */
export function renderShelf(groups, { meanings, folds, readOnly = false, disabled = false, foldAt = LINES_OPEN, oneOpen = false, onPress }) {
  /** @type {HTMLElement[]} */
  const shelf = [];
  for (const [at, group] of groups.entries()) {
    const summary = element("summary", "lookup-group-label");
    summary.append(element("span", "lookup-entry-dict", formatDictName(group.dictionary)));
    summary.append(` (${group.lines.length.toLocaleString()})`);
    const book = shelfFold("lookup-group", `group:${group.dictionary}`, at === 0, summary, folds);
    if (oneOpen) book.name = "lookup-group";
    summary.addEventListener("click", () => {
      requestAnimationFrame(() => {
        if (book.open) showOpened(book);
      });
    });

    // Everything up to the cut goes straight into the book; the rest goes
    // into the block behind "Show all", headwords and lines alike.
    const { shown, unfolded } = foldPoint(group.lines, meanings, foldAt);
    const more = shown < group.lines.length ? moreFold(book, group, unfolded, at, folds) : null;
    let index = 0;

    for (const entry of group.entries) {
      const into = more !== null && index >= shown ? more.rest : book;
      if (entry.headword.length > 0) {
        into.append(element("div", "lookup-entry-headword", entry.headword));
      }
      /** @type {string | null} */
      let label = null;
      let senseExampleCount = 0;
      /** @type {HTMLElement | null} */
      let extraExamplesWrap = null;
      /** @type {HTMLButtonElement | null} */
      let extraExamplesToggle = null;
      /** @type {HTMLElement | null} */
      let extraExamplesHome = null;

      const flushExtraExamples = () => {
        if (extraExamplesWrap !== null && extraExamplesHome !== null && extraExamplesToggle !== null) {
          extraExamplesHome.append(extraExamplesWrap, extraExamplesToggle);
          extraExamplesWrap = null;
          extraExamplesToggle = null;
          extraExamplesHome = null;
        }
        senseExampleCount = 0;
      };

      for (const row of entry.rows) {
        if (row.kind === "heading") {
          label = row.text;
          continue;
        }
        if (row.kind === "pronunciation") {
          const home = more !== null && index >= shown ? more.rest : book;
          home.append(formatPronunciationRow(row.text));
          continue;
        }
        if (row.kind === "example") {
          const home = more !== null && index >= shown ? more.rest : book;
          if (senseExampleCount < 2) {
            home.append(formatExampleRow(row.text));
            senseExampleCount += 1;
          } else {
            if (extraExamplesWrap === null) {
              extraExamplesWrap = element("div", "lookup-extra-examples");
              extraExamplesWrap.hidden = true;
              extraExamplesHome = home;
              const wrap = extraExamplesWrap;
              extraExamplesToggle = button("lookup-examples-toggle", "");
              extraExamplesToggle.type = "button";
              const btn = extraExamplesToggle;
              btn.addEventListener("click", () => {
                const opening = wrap.hidden === true;
                wrap.hidden = !opening;
                const remaining = wrap.childElementCount;
                btn.textContent = opening
                  ? (t("lookup_fewer_examples") || "Thu gọn ví dụ")
                  : (t("lookup_more_examples", [String(remaining)]) || `+${remaining} ví dụ khác`);
              });
            }
            extraExamplesWrap.append(formatExampleRow(row.text));
            const extraCount = extraExamplesWrap.childElementCount;
            if (extraExamplesToggle !== null) {
              extraExamplesToggle.textContent = t("lookup_more_examples", [String(extraCount)]) || `+${extraCount} ví dụ khác`;
            }
          }
          continue;
        }
        if (row.kind === "idiom") {
          flushExtraExamples();
          const home = more !== null && index >= shown ? more.rest : book;
          home.append(formatIdiomRow(row.text));
          continue;
        }
        if (row.kind !== "meaning") continue;
        flushExtraExamples();
        const home = more !== null && index >= shown ? more.rest : book;
        if (label !== null) {
          home.append(element("div", "lookup-entry-heading", label));
          label = null;
        }
        home.append(shelfRow(row.text, `${at}:${index}`, { saved: isSaved(meanings, row.text), readOnly, disabled, onPress }));
        index += 1;
      }
      flushExtraExamples();
    }
    if (more !== null) book.append(more.rest, more.toggle);
    if (group.about.length > 0) book.append(aboutFold(group, folds));
    shelf.push(book);
  }
  return shelf;
}
