/**
 * Reader PDF Viewer Controller.
 * Coordinates offline PDF document page rendering, text extraction,
 * reading position persistence, and integration with the translation bubble.
 */

export class PdfViewerController {
  /**
   * @param {Object} options
   * @param {HTMLElement|null} [options.container]
   * @param {Function|null} [options.onPageChange]
   * @param {Function|null} [options.onPositionSave]
   */
  constructor({ container = null, onPageChange = null, onPositionSave = null } = {}) {
    this.container = container;
    /** @type {Function|null} */
    this.onPageChange = onPageChange;
    /** @type {Function|null} */
    this.onPositionSave = onPositionSave;

    this.docId = "";
    this.title = "";
    this.pageCount = 0;
    this.currentPage = 1;
    /** @type {Map<number, string[]>} */
    this.pageTextCache = new Map();
  }

  /**
   * Loads a PDF document metadata into the viewer.
   * @param {Object} meta
   * @param {string} meta.docId
   * @param {string} meta.title
   * @param {number} meta.pageCount
   * @param {number} [meta.initialPage=1]
   */
  loadDocument({ docId, title, pageCount, initialPage = 1 }) {
    this.docId = docId;
    this.title = title;
    this.pageCount = Math.max(0, pageCount);
    this.currentPage = Math.max(1, Math.min(initialPage, this.pageCount || 1));
    this.pageTextCache.clear();
  }

  /**
   * Stores extracted paragraphs for a specific page.
   * @param {number} page
   * @param {string[]} paragraphs
   */
  setPageContent(page, paragraphs) {
    if (page >= 1 && page <= this.pageCount) {
      this.pageTextCache.set(page, Array.isArray(paragraphs) ? paragraphs : []);
      if (page === this.currentPage) {
        this.renderCurrentPage();
      }
    }
  }

  /**
   * Navigates to a target page number.
   * @param {number} page
   */
  goToPage(page) {
    if (page >= 1 && page <= this.pageCount && page !== this.currentPage) {
      this.currentPage = page;
      this.renderCurrentPage();

      if (typeof this.onPageChange === "function") {
        this.onPageChange(this.currentPage, this.pageCount);
      }
      if (typeof this.onPositionSave === "function") {
        this.onPositionSave({
          docId: this.docId,
          page: this.currentPage,
          percent: this.pageCount > 0 ? Math.round((this.currentPage / this.pageCount) * 100) : 0,
          updatedAt: Date.now(),
        });
      }
    }
  }

  /**
   * Advances to next page.
   */
  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  /**
   * Goes back to previous page.
   */
  prevPage() {
    this.goToPage(this.currentPage - 1);
  }

  /**
   * Renders the current page paragraphs and page indicator into the DOM container.
   */
  renderCurrentPage() {
    if (!this.container) return;
    this.container.textContent = "";

    const pageWrapper = document.createElement("div");
    pageWrapper.className = "pdf-page-container";
    pageWrapper.dataset.page = String(this.currentPage);

    const pageHeader = document.createElement("div");
    pageHeader.className = "pdf-page-header";
    pageHeader.textContent = `Page ${this.currentPage} / ${this.pageCount}`;
    pageWrapper.appendChild(pageHeader);

    const textContent = this.pageTextCache.get(this.currentPage) || [];
    const bodyDiv = document.createElement("div");
    bodyDiv.className = "pdf-text-layer";

    for (const para of textContent) {
      const p = document.createElement("p");
      p.className = "pdf-paragraph";
      p.textContent = para;
      bodyDiv.appendChild(p);
    }

    pageWrapper.appendChild(bodyDiv);
    this.container.appendChild(pageWrapper);
  }
}
