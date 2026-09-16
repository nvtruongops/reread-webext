/**
 * Reader Appearance Controller.
 * Manages typography, themes (light, dark, sepia), line width, margins,
 * and high-contrast / e-ink rendering modes.
 */

import { applyReading } from "../../lib/appearance.js";
import { isFont, isTheme, readConfig, writeConfig } from "../../lib/config.js";

export class AppearanceController {
  /**
   * @param {Object} [options]
   * @param {HTMLElement} [options.root]
   * @param {Function|null} [options.onAppearanceChange]
   */
  constructor({ root = document.documentElement, onAppearanceChange = null } = {}) {
    this.root = root;
    /** @type {Function|null} */
    this.onAppearanceChange = onAppearanceChange;
    this.bionicEnabled = false;
  }

  /**
   * Applies the current reader appearance configuration to the DOM.
   * @param {Record<string, any>} [config]
   */
  apply(config = {}) {
    if (this.root) {
      if (typeof config.theme === "string" && isTheme(config.theme)) {
        this.root.dataset.scheme = config.theme;
      }
      if (typeof config.font === "string" && isFont(config.font)) {
        this.root.style.setProperty("--font-family", config.font);
      }
      if (typeof config.size === "number") {
        this.root.style.setProperty("--font-size", `${config.size}px`);
      }
      if (typeof config.lineHeight === "number") {
        this.root.style.setProperty("--line-height", `${config.lineHeight}`);
      }
      if (typeof config.measure === "number") {
        this.root.style.setProperty("--measure", `${config.measure}ch`);
      }
      this.root.dataset.bionic = this.bionicEnabled ? "true" : "false";
    }
    if (typeof this.onAppearanceChange === "function") {
      this.onAppearanceChange(config);
    }
  }

  /**
   * Toggle Bionic Reading mode.
   * @param {boolean} [enable]
   */
  setBionic(enable) {
    this.bionicEnabled = typeof enable === "boolean" ? enable : !this.bionicEnabled;
    if (this.root) {
      this.root.dataset.bionic = this.bionicEnabled ? "true" : "false";
    }
    return this.bionicEnabled;
  }
}
