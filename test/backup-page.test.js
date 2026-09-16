import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The backup of everything on the reading list page (D213): the export
 * that writes it, the import that reads it part by part, and the highlights
 * page that no longer keeps a copy of its own. The rules have their tests
 * (`backup-file`, `settings-file`, `vocabulary-file`, `marks-copy`); this
 * reads the call sites they meet at, the way the phrases page's flows are
 * read.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the backup of everything on the reading list page", () => {
  it("is what Export writes outside the selection - every part fresh from its store, the settings as they stand", async () => {
    const script = await source("reader/reader.js");
    const exporting = bodyOf(script, "exportList");
    assert.match(exporting, /if \(picking\) \{\s*await exportSelection\(\);\s*return;\s*\}/, "the selection's file is not the list's own any more");
    assert.match(exporting, /allArticles\(\),\s*allMarks\(\),\s*allPositions\(\),\s*allPhrases\(\),\s*marksDocs\(\(\) => true\),\s*readConfig\(\),/, "a part is not read fresh from its store");
    assert.match(exporting, /backupStream\(\{[\s\S]*highlights: docs\.map\(copyDocOf\),\s*settings: config,/, "the highlights or the settings do not reach the archive");
    assert.match(exporting, /downloadFile\(archive, BACKUP_FILENAME, "application\/zip"\)/, "the backup is not written under its own name");
    // The button is never greyed for the backup: the settings are always there.
    assert.match(bodyOf(script, "renderExportControls"), /exportButton\.disabled = picking && picked\.size === 0;/, "Export is greyed outside the selection");
  });

  it("streams the articles' pictures one article at a time, in the file's order, and writes articles.json after them (D222)", async () => {
    const script = await source("reader/reader.js");
    // Both exports hand the stream the box's word, never the rows.
    for (const name of ["exportList", "exportSelection"]) {
      assert.match(bodyOf(script, name), /backupStream\(\{[\s\S]*?pictures: withPictures,/, `${name} reads the pictures before the stream`);
    }
    assert.equal(script.includes("picturesOf("), false, "the pictures are still read whole before packing");
    // A generator: `bodyOf` looks for a plain function, so the body is cut
    // from the head to the first close at the margin.
    const start = script.indexOf("async function* backupStream(");
    assert.ok(start !== -1, "backupStream is missing");
    const stream = script.slice(start, script.indexOf("\n}\n", start));
    const light = stream.indexOf("yield* backupEntries(input)");
    const order = stream.indexOf("const articles = fileOrder(input.articles);");
    const box = stream.indexOf("if (input.pictures) {");
    const rows = stream.indexOf("pictureEntries(at, await getPictures(article.url))");
    const list = stream.indexOf("yield articlesEntry(articles, input.marks, input.positions, refs);");
    assert.ok(light !== -1 && light < order && order < box && box < rows && rows < list, "the stream is not light parts, then each article's pictures in file order, then articles.json");
    assert.match(stream, /if \(article\.pictures === undefined\) continue;/, "an article whose row promises no pictures is asked for them");
    assert.match(stream, /if \(kept\.refs\.length === 0\) continue;/, "an article with no rows to write gets a field");
  });

  it("reads an archive with a manifest as the backup, refuses a newer one, and still reads the old files", async () => {
    const script = await source("reader/reader.js");
    const dispatch = bodyOf(script, "dispatchImport");
    assert.match(dispatch, /entry\.name === BACKUP_ENTRIES\.manifest\)\) \{[\s\S]*?await offerBackup\(file, bytes, entries\);\s*\} else if \(entries\.some\(\(entry\) => entry\.name === ARTICLES_ENTRY\)\)/, "the manifest is not the word before articles.json");
    const offering = bodyOf(script, "offerBackup");
    assert.match(offering, /if \(manifest !== null && isNewerBackup\(manifest\)\) \{[\s\S]*?transferStatus\(t\("reader_backup_newer", \[manifest\.app\]\), "error"\);\s*return;/, "a newer file is not refused whole");
    for (const part of ["vocabulary", "highlights", "settings", "articles"]) {
      assert.match(offering, new RegExp(`BACKUP_ENTRIES\\.${part}`), `the ${part} entry is not read`);
    }
    // The old highlights .json is a backup with one part now, not a file
    // sent to another page.
    const json = bodyOf(script, "offerImport");
    assert.match(json, /if \(isMarksCopy\(text\)\) \{\s*await offerParts\(file\.name, \{[\s\S]*?highlights: fromMarksCopy\(text\),/, "the old highlights file is not offered as a backup");
    assert.doesNotMatch(script, /reader_import_marks_elsewhere/, "the highlights file is still sent elsewhere");
  });

  it("writes the parts in the order that keeps every promise, the settings only when the box says so", async () => {
    const script = await source("reader/reader.js");
    const running = bodyOf(script, "runBackup");
    const articles = running.indexOf("await importArticles(offered.articles)");
    const phrases = running.indexOf("kind: Message.RESTORE_VOCABULARY");
    const marks = running.indexOf("marksImportPlan(laid.documents");
    const settings = running.indexOf("await writeConfig(offered.settings)");
    assert.ok(articles !== -1 && phrases !== -1 && marks !== -1 && settings !== -1, "a part is not written");
    assert.ok(articles < phrases && phrases < marks && marks < settings, "the parts are not written articles, vocabulary, highlights, settings");
    // The vocabulary goes through the background, which owns every write to it.
    assert.match(running, /webext\(\)\.runtime\.sendMessage\(\{ kind: Message\.RESTORE_VOCABULARY, rows: offered\.phrases \}\)/, "the vocabulary is written from the page");
    assert.match(running, /if \(offered\.settings !== null && importSettings !== null && importSettings\.checked\) \{/, "the settings are restored without the box");
    // The marks are planned after the articles, against the library as it then stands.
    // The book documents are laid against their books' text first (D223,
    // `marks-reanchor.test.js`), then the plan against the library.
    assert.match(running, /await restoreMarks\(\);\s*const \[articles, books, marks\] = await Promise\.all\(\[listArticles\(\), listBooks\(\), allMarks\(\)\]\);[\s\S]*?const plan = marksImportPlan\(laid\.documents, \{ articles, books, marks \}\);/, "the highlights are not laid against the library at the press");
  });

  it("offers a backup in the list's own frame: what the file is, one line per part, the settings' box", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<p id="library-import-summary"><\/p>[\s\S]*?<ul id="library-import-parts" class="import-sample" hidden><\/ul>\s*<ul id="library-import-sample" class="import-sample"><\/ul>\s*<p class="hint transfer-option" id="library-import-settings-row" hidden>\s*<label>\s*<input type="checkbox" id="library-import-settings" checked \/>/, "the frame lacks the parts' lines or the settings' box");
    const script = await source("reader/reader.js");
    const rendering = bodyOf(script, "renderBackupOffer");
    assert.match(rendering, /t\("reader_backup_summary", \[[\s\S]*?new Date\(offer\.manifest\.createdAt\)\.toLocaleDateString\(uiLocale\(\)\),\s*offer\.manifest\.app,/, "the offer does not say when and by which version the file was written");
    assert.match(rendering, /plural\(offer\.articles\.length, "reader_backup_part_articles", \[offer\.newArticles\.toLocaleString\(\)\]\)/, "the offer does not say how many articles are new");
    assert.match(rendering, /plural\(offer\.phrases\.length, "reader_backup_part_phrases", \[pairs\.join\(", "\)\]\)/, "the offer does not name the pairs");
    assert.match(rendering, /importSettingsRow\.hidden = offer\.settings === null;/, "the settings' box stands for a file without settings");
    assert.match(script, /importRun\?\.addEventListener\("click", \(\) => void \(pendingBackup !== null \? runBackup\(\) : runImport\(\)\)\);/, "the Import press does not know which offer stands");
  });

  it("leaves the highlights page with the notes export alone, and one sentence about where the backup is (K7)", async () => {
    const markup = await source("reader/reader.html");
    for (const gone of ['id="marks-copy"', 'id="marks-export-copy"', 'id="marks-import"', 'id="marks-import-file"', 'id="marks-copy-elsewhere"', 'id="marks-all-link"']) {
      assert.doesNotMatch(markup, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${gone} survives on the highlights page`);
    }
    assert.match(markup, /<p class="hint" data-i18n="reader_marks_backup_elsewhere">/, "the sentence about the backup is missing");
    assert.match(markup, /id="marks-export" data-i18n="reader_marks_export_notes"/, "the notes export is gone with the copy");
    const script = await source("reader/reader.js");
    for (const gone of ["exportMarksCopy", "offerMarksImport", "runMarksImport", "pendingMarksImport", "MARKS_COPY_FILENAME", "toMarksCopy("]) {
      assert.equal(script.includes(gone), false, `${gone} survives in the page's script`);
    }
    // The plan and its notes stay: the backup import lays the highlights
    // against the library by the same rule.
    assert.match(script, /marksImportPlan\(laid\.documents/, "the highlights' plan is gone with the copy");
  });
});
