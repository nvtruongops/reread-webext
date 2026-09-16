/**
 * Reader Library Controller.
 * Manages the reading shelf, document list retrieval, full-text search filtering,
 * and ZIP backup export/import coordination.
 */

import {
  ARTICLES_ENTRY,
  archiveAccount,
  articlesEntry,
  fromArchiveText,
} from "../../lib/store/articles-archive.js";

export class LibraryController {
  /**
   * @param {Object} [options]
   * @param {any[]} [options.articles]
   * @param {any[]} [options.books]
   * @param {Function|null} [options.onSelectionChange]
   */
  constructor({ articles = [], books = [], onSelectionChange = null } = {}) {
    /** @type {any[]} */
    this.articles = Array.isArray(articles) ? [...articles] : [];
    /** @type {any[]} */
    this.books = Array.isArray(books) ? [...books] : [];
    /** @type {Function|null} */
    this.onSelectionChange = onSelectionChange;
    /** @type {Set<string>} */
    this.selectedIds = new Set();
  }

  /**
   * Toggles item selection for batch export or deletion.
   * @param {string} id
   */
  toggleSelection(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    if (typeof this.onSelectionChange === "function") {
      this.onSelectionChange(new Set(this.selectedIds));
    }
  }

  /**
   * Clears selection set.
   */
  clearSelection() {
    this.selectedIds.clear();
    if (typeof this.onSelectionChange === "function") {
      this.onSelectionChange(new Set(this.selectedIds));
    }
  }

  /**
   * Filters the library documents based on query string.
   * @param {string} query
   * @returns {{ articles: any[], books: any[] }}
   */
  filter(query = "") {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { articles: [...this.articles], books: [...this.books] };
    }
    const filteredArticles = this.articles.filter((a) =>
      (a.title || "").toLowerCase().includes(q) || (a.byline || "").toLowerCase().includes(q)
    );
    const filteredBooks = this.books.filter((b) =>
      (b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q)
    );
    return { articles: filteredArticles, books: filteredBooks };
  }
}
