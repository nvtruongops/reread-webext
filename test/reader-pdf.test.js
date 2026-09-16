import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PdfViewerController } from "../src/reader/controllers/pdf-viewer.js";

describe("Reader PDF Viewer Controller (Phase 4)", () => {
  it("initializes and clamps page bounds accurately", () => {
    const viewer = new PdfViewerController();
    viewer.loadDocument({
      docId: "pdf-doc-1",
      title: "Research Paper",
      pageCount: 10,
      initialPage: 3,
    });

    assert.equal(viewer.docId, "pdf-doc-1");
    assert.equal(viewer.title, "Research Paper");
    assert.equal(viewer.pageCount, 10);
    assert.equal(viewer.currentPage, 3);
  });

  it("navigates through pages and triggers position save callbacks", () => {
    /** @type {any} */
    let savedPosition = null;
    /** @type {any} */
    let pageChangeReport = null;

    const viewer = new PdfViewerController({
      /**
       * @param {number} current
       * @param {number} total
       */
      onPageChange: (current, total) => {
        pageChangeReport = { current, total };
      },
      /**
       * @param {any} pos
       */
      onPositionSave: (pos) => {
        savedPosition = pos;
      },
    });

    viewer.loadDocument({
      docId: "pdf-doc-2",
      title: "Sample PDF",
      pageCount: 5,
      initialPage: 1,
    });

    viewer.nextPage();
    assert.equal(viewer.currentPage, 2);
    assert.deepEqual(pageChangeReport, { current: 2, total: 5 });
    assert.ok(savedPosition);
    assert.equal(savedPosition.page, 2);
    assert.equal(savedPosition.percent, 40); // 2 / 5 = 40%

    viewer.goToPage(5);
    assert.equal(viewer.currentPage, 5);
    assert.equal(savedPosition.percent, 100);

    // Should not exceed maximum page
    viewer.nextPage();
    assert.equal(viewer.currentPage, 5);

    viewer.prevPage();
    assert.equal(viewer.currentPage, 4);
    assert.equal(savedPosition.percent, 80);
  });

  it("caches and retrieves page text content cleanly", () => {
    const viewer = new PdfViewerController();
    viewer.loadDocument({
      docId: "pdf-doc-3",
      title: "Article PDF",
      pageCount: 2,
    });

    viewer.setPageContent(1, ["Paragraph 1 of page 1", "Paragraph 2 of page 1"]);
    viewer.setPageContent(2, ["Paragraph 1 of page 2"]);

    assert.deepEqual(viewer.pageTextCache.get(1), [
      "Paragraph 1 of page 1",
      "Paragraph 2 of page 1",
    ]);
    assert.deepEqual(viewer.pageTextCache.get(2), ["Paragraph 1 of page 2"]);
  });
});
