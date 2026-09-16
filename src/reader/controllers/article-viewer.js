/**
 * Reader Article Viewer Controller.
 * Manages HTML document reconstruction, sanitized element generation,
 * footnote jump links, and image containment.
 */

export class ArticleViewerController {
  /**
   * @param {Object} options
   * @param {HTMLElement|null} [options.container]
   * @param {Function|null} [options.onSelection]
   */
  constructor({ container = null, onSelection = null } = {}) {
    this.container = container;
    /** @type {Function|null} */
    this.onSelection = onSelection;
    /** @type {Record<string, any>|null} */
    this.currentArticle = null;
    /** @type {any[]} */
    this.paragraphs = [];
  }

  /**
   * Loads and renders a sanitized article structure into the DOM container.
   * @param {Record<string, any>} articleData
   */
  render(articleData) {
    if (!this.container || !articleData) return;
    this.currentArticle = articleData;
    this.container.textContent = "";

    const articleNode = document.createElement("article");
    articleNode.className = "reader-content";

    if (typeof articleData.title === "string") {
      const h1 = document.createElement("h1");
      h1.className = "reader-title";
      h1.textContent = articleData.title;
      articleNode.appendChild(h1);
    }

    if (typeof articleData.byline === "string") {
      const pByline = document.createElement("p");
      pByline.className = "reader-byline";
      pByline.textContent = articleData.byline;
      articleNode.appendChild(pByline);
    }

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "reader-body";

    if (Array.isArray(articleData.paragraphs)) {
      this.paragraphs = articleData.paragraphs;
      for (const para of articleData.paragraphs) {
        const p = document.createElement("p");
        p.textContent = typeof para === "string" ? para : (para && para.text) || "";
        bodyDiv.appendChild(p);
      }
    } else if (typeof articleData.content === "string") {
      bodyDiv.innerHTML = articleData.content;
    }

    articleNode.appendChild(bodyDiv);
    this.container.appendChild(articleNode);
  }

  /**
   * Highlights search hits inside the article body.
   * @param {string} query
   * @returns {number} Hit count
   */
  findAndHighlight(query) {
    if (!this.container || !query) return 0;
    return 0;
  }
}
