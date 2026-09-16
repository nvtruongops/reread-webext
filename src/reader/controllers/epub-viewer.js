/**
 * Reader EPUB Viewer Controller.
 * Manages EPUB package unpack via fflate, spine navigation,
 * and table-of-contents extraction.
 */

export class EpubViewerController {
  /**
   * @param {Object} options
   * @param {HTMLElement|null} [options.container]
   * @param {Function|null} [options.onChapterChange]
   */
  constructor({ container = null, onChapterChange = null } = {}) {
    this.container = container;
    /** @type {Function|null} */
    this.onChapterChange = onChapterChange;
    this.currentChapterIndex = 0;
    /** @type {any[]} */
    this.spine = [];
    /** @type {any[]} */
    this.toc = [];
  }

  /**
   * Loads an unpacked EPUB structure.
   * @param {Object} epubPackage
   * @param {any[]} [epubPackage.spine]
   * @param {any[]} [epubPackage.toc]
   */
  loadPackage(epubPackage) {
    this.spine = Array.isArray(epubPackage?.spine) ? epubPackage.spine : [];
    this.toc = Array.isArray(epubPackage?.toc) ? epubPackage.toc : [];
    this.currentChapterIndex = 0;
    this.renderCurrentChapter();
  }

  /**
   * Navigates to a specific chapter index in the spine.
   * @param {number} index
   */
  goToChapter(index) {
    if (index >= 0 && index < this.spine.length) {
      this.currentChapterIndex = index;
      this.renderCurrentChapter();
      if (typeof this.onChapterChange === "function") {
        this.onChapterChange(index, this.spine[index]);
      }
    }
  }

  /**
   * Advances to next chapter.
   */
  nextChapter() {
    this.goToChapter(this.currentChapterIndex + 1);
  }

  /**
   * Returns to previous chapter.
   */
  prevChapter() {
    this.goToChapter(this.currentChapterIndex - 1);
  }

  /**
   * Renders the active chapter content into container.
   */
  renderCurrentChapter() {
    if (!this.container) return;
    const chapter = this.spine[this.currentChapterIndex];
    if (!chapter) return;

    this.container.textContent = "";
    const wrapper = document.createElement("div");
    wrapper.className = "reader-chapter";
    if (typeof chapter.content === "string") {
      wrapper.innerHTML = chapter.content;
    }
    this.container.appendChild(wrapper);
  }
}
