/**
 * Obsidian and Reapps Markdown Exporter.
 * Formats articles, highlights, and annotations into clean Markdown files
 * with structured YAML frontmatter.
 */

/**
 * @typedef {Object} ExportMark
 * @property {string} text The highlighted quote
 * @property {string} [color] Highlight color
 * @property {string} [note] User note or comment
 * @property {number} [createdAt] Timestamp
 */

/**
 * @typedef {Object} ExportArticle
 * @property {string} title
 * @property {string} [byline]
 * @property {string} [url]
 * @property {string} [siteName]
 * @property {number} [savedAt]
 * @property {ExportMark[]} [marks]
 */

/**
 * Formats an article and its marks into Obsidian/Reapps Markdown with YAML frontmatter.
 * @param {ExportArticle} article
 * @returns {string}
 */
export function exportArticleToMarkdown(article) {
  const title = (article.title || "Untitled").replace(/"/g, '\\"');
  const byline = (article.byline || "").replace(/"/g, '\\"');
  const url = article.url || "";
  const date = article.savedAt ? new Date(article.savedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const site = (article.siteName || "").replace(/"/g, '\\"');

  const frontmatter = [
    "---",
    `title: "${title}"`,
    byline ? `author: "${byline}"` : null,
    url ? `url: "${url}"` : null,
    site ? `source: "${site}"` : null,
    `date: ${date}`,
    "tags:",
    "  - reread",
    "  - reading-notes",
    "---",
    "",
  ].filter((line) => line !== null).join("\n");

  const sections = [`# ${article.title || "Untitled"}`, ""];

  if (article.byline) {
    sections.push(`*By ${article.byline}*`, "");
  }
  if (article.url) {
    sections.push(`[Original Article](${article.url})`, "");
  }

  const marks = Array.isArray(article.marks) ? article.marks : [];
  if (marks.length > 0) {
    sections.push("## Highlights & Notes", "");
    for (const mark of marks) {
      if (!mark.text) continue;
      sections.push(`> ${mark.text.trim().replace(/\n/g, "\n> ")}`);
      if (mark.note && mark.note.trim()) {
        sections.push("", `**Note:** ${mark.note.trim()}`);
      }
      sections.push("");
    }
  }

  return frontmatter + sections.join("\n").trim() + "\n";
}
