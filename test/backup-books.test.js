import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The books in the backup of everything on the reading list page (D218):
 * the box that offers them, the export that streams them after the light
 * parts, the offer that lays them against the list, and the import that
 * writes each the way its own import does. The rules have their tests
 * (`books-file`, `backup-file`, `archive-pack`); this reads the call sites
 * they meet at, the way `backup-page.test.js` reads the backup's.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the books' box under the buttons", () => {
  it("stands after the pictures' box, outside the selection, only while the list holds a book, and counts them with a unit", async () => {
    const page = await source("reader/reader.html");
    assert.match(
      page,
      /id="library-export-pictures-row" hidden>[\s\S]*?<\/p>\s*(?:<!--[\s\S]*?-->\s*)?<p class="hint transfer-option" id="library-export-books-row" hidden>\s*<label>\s*<input type="checkbox" id="library-export-books" \/>\s*<span id="library-export-books-label"><\/span>/,
      "the books' row does not follow the pictures' row in the same dress",
    );
    const script = await source("reader/reader.js");
    const controls = bodyOf(script, "renderExportControls");
    assert.match(controls, /const shelf = booksAccount\(libraryShown\.bookRows\);/, "the box is not counted off the light rows");
    assert.match(controls, /exportBooksRow\.hidden = picking \|\| shelf\.count === 0;/, "the box stands inside the selection or over a list without books");
    assert.match(controls, /plural\(shelf\.count, "reader_export_books", \[megabytes\(shelf\.bytes\)\]\)/, "the label does not count the books with their unit and size");
    assert.match(bodyOf(script, "refreshLibrary"), /bookRows: books/, "the refresh does not keep every book's row for the box");
  });
});

describe("the export with books", () => {
  it("reads the books and packs them as a stream after the light parts, and says how many went in", async () => {
    const script = await source("reader/reader.js");
    const exporting = bodyOf(script, "exportList");
    assert.match(exporting, /readConfig\(\),\s*listBooks\(\),\s*\]\);/, "the books are not read with the other parts");
    assert.match(exporting, /const withBooks = exportBooks !== null && !exportBooksRow\?\.hidden && exportBooks\.checked;/, "the box does not decide");
    assert.match(exporting, /packArchive\(\s*backupStream\(\{[\s\S]*?settings: config,\s*books,\s*\}\),\s*\)/, "the archive is not packed from the stream with the books");
    assert.match(exporting, /\.\.\.\(withBooks \? \[plural\(books\.length, "reader_backup_books"\)\] : \[\]\)/, "the report does not count the books only when they went in");
    // A generator: `bodyOf` looks for a plain function, so the body is cut
    // from the head to the first close at the margin.
    const start = script.indexOf("async function* backupStream(");
    assert.ok(start !== -1, "backupStream is missing");
    const stream = script.slice(start, script.indexOf("\n}\n", start));
    const light = stream.indexOf("yield* backupEntries(input)");
    const list = stream.indexOf("yield articlesEntry(");
    const text = stream.indexOf("allBookSegments(book)");
    const pictures = stream.indexOf("allBookPictures(book)");
    const index = stream.indexOf("name: BOOKS_ENTRY");
    assert.ok(light !== -1 && light < list && list < text && text < pictures && pictures < index, "the stream is not light parts, the reading list, then each book's text and pictures, then the index");
    assert.match(stream, /if \(segments === null\) continue;/, "a book whose text is not all there is written anyway");
    assert.match(stream, /bookPictureEntryName\(at, picture\)/, "a book's pictures are not named under its place in the index");
  });
});

describe("the import with books", () => {
  it("reads the index for the offer, lays the books against the list, and says how many are new", async () => {
    const script = await source("reader/reader.js");
    assert.match(bodyOf(script, "offerBackup"), /const booksText = textOf\(BACKUP_ENTRIES\.books\);[\s\S]*?books: booksText === null \? null : \{ index: fromBooksIndex\(booksText\), bytes, entries \},/, "the index is not read for the offer");
    const parts = bodyOf(script, "offerParts");
    assert.match(parts, /plan: booksImportPlan\(filed, \{ books: shelf \}\),/, "the books are not laid against the list");
    assert.match(parts, /&& settings === null && filed\.length === 0\) \{/, "a file with books alone is refused as empty");
    const rendering = bodyOf(script, "renderBackupOffer");
    assert.match(rendering, /plural\(offer\.books\.rows\.length, "reader_backup_part_books", \[offer\.books\.plan\.toAdd\.length\.toLocaleString\(\)\]\)/, "the offer does not say how many books are new");
    assert.match(rendering, /count: \(offer\.pictures\?\.account\.count \?\? 0\) \+ \(offer\.books\?\.account\.count \?\? 0\)/, "the pictures' line leaves the books' pictures out");
  });

  it("writes the books after the articles and before the highlights, each the way its own import does", async () => {
    const script = await source("reader/reader.js");
    const running = bodyOf(script, "runBackup");
    const articles = running.indexOf("await importArticles(offered.articles)");
    const books = running.indexOf("await importBooks(offered.books.plan.toAdd, offered.books.bytes)");
    const phrases = running.indexOf("kind: Message.RESTORE_VOCABULARY");
    const marks = running.indexOf("marksImportPlan(laid.documents");
    assert.ok(articles !== -1 && books !== -1 && phrases !== -1 && marks !== -1, "a part is not written");
    assert.ok(articles < books && books < phrases && phrases < marks, "the books are not written between the articles and the vocabulary");
    assert.match(running, /plural\(offered\.books\.plan\.skipped, "reader_import_books_skipped"\)/, "the books left alone are not counted");
    const importing = bodyOf(script, "importBooks");
    const text = importing.indexOf("fromBookText(new TextDecoder().decode(text), id)");
    const count = importing.indexOf("segments.length !== book.meta.segmentCount");
    const segment = importing.indexOf("await putBookSegment({ bookId: id, index, ...segment })");
    const picture = importing.indexOf("await putBookPicture(row)");
    const row = importing.indexOf("await putBook(");
    const position = importing.indexOf("await putPosition(book.position)");
    assert.ok(text !== -1 && count !== -1 && segment !== -1 && picture !== -1 && row !== -1 && position !== -1, "a step of a book's write is missing");
    assert.ok(text < count && count < segment && segment < picture && picture < row && row < position, "a book is not written segments, pictures, row, position");
    assert.match(importing, /bookPictureRows\(id, book\.pictures \?\? \[\], \(name\) => read\(name, MAX_DOWNLOAD_BYTES\)\)/, "the pictures are not read under the indexes the segments name");
    assert.match(importing, /read\(book\.text, MAX_BOOK_TEXT_BYTES\)/, "a book's text is inflated without a cap");
    assert.match(importing, /await deleteBook\(id\)\.catch\(\(\) => undefined\);/, "a failed write leaves the book's parts behind");
  });
});

describe("the selection's export (D218)", () => {
  it("writes the ticked documents, articles and books, as the backup's format under its own name, without the vocabulary or the settings", async () => {
    const script = await source("reader/reader.js");
    const exporting = bodyOf(script, "exportSelection");
    assert.match(exporting, /const books = shelf\.filter\(\(book\) => picked\.has\(book\.id\)\);/, "the ticked books are not taken");
    assert.match(exporting, /marksDocs\(\(docId\) => picked\.has\(docId\)\)/, "the highlights are not cut to the selection");
    assert.match(exporting, /backupStream\(\{[\s\S]*?phrases: \[\],[\s\S]*?settings: null,\s*books,\s*selection: true,/, "the selection is not the backup's format without vocabulary and settings");
    assert.match(exporting, /downloadFile\(archive, SELECTION_FILENAME, "application\/zip"\)/, "the file is not written under the selection's name");
    assert.match(exporting, /plural\(articles\.length \+ books\.length, "reader_export_done", \[SELECTION_FILENAME, fileSize\(size\)\]\)/, "the report does not count both kinds");
    assert.doesNotMatch(script, /ARTICLES_FILENAME|ARCHIVE_FILENAME|toArticlesFile\(|articlesToExport/, "the list's own files are still written from the page");
    const controls = bodyOf(script, "renderExportControls");
    assert.match(controls, /exportButton\.disabled = picking && picked\.size === 0;/, "the button does not count every ticked document");
    assert.match(controls, /t\("reader_export_selected", picked\.size\.toLocaleString\(\)\)/, "the button's count leaves the books out");
  });
});
