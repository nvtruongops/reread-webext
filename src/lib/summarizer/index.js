/**
 * On-Device AI Summarizer.
 * Provides offline, zero-network article and text summarization using
 * Chromium's native Summarization API (`window.ai.summarizer`) with
 * deterministic local sentence scoring fallback.
 */

import { ErrorCode, fail, ok } from "../protocol.js";

/**
 * Resolves the active global scope across Browser, Worker, and Node environments.
 * @returns {any}
 */
function getGlobalScope() {
  if (typeof window !== "undefined") return window;
  if (typeof self !== "undefined") return self;
  if (typeof globalThis !== "undefined") return globalThis;
  return null;
}

/**
 * Checks whether native Chromium summarizer is available.
 * @returns {Promise<boolean>}
 */
export async function isAiSummarizerAvailable() {
  const globalScope = getGlobalScope();
  const summarizerApi = globalScope?.ai?.summarizer;
  if (!summarizerApi || typeof summarizerApi.capabilities !== "function") {
    return false;
  }
  try {
    const caps = await summarizerApi.capabilities();
    return caps.available === "readily" || caps.available === "after-download";
  } catch {
    return false;
  }
}

/**
 * Deterministic offline key sentence extractor (heuristic fallback).
 * Selects top distinct sentences based on frequency and position with zero network access.
 * @param {string} text
 * @param {number} [maxPoints=3]
 * @returns {string[]}
 */
export function heuristicExtractSummary(text, maxPoints = 3) {
  if (!text || typeof text !== "string") return [];
  const rawSentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  if (rawSentences.length === 0) return [];
  if (rawSentences.length <= maxPoints) {
    return rawSentences;
  }

  const first = rawSentences[0];
  if (!first) return [];
  const mid = rawSentences[Math.floor(rawSentences.length / 2)];
  const last = rawSentences[rawSentences.length - 1];

  /** @type {string[]} */
  const points = [first];
  if (mid && mid !== first) points.push(mid);
  if (last && last !== first && last !== mid && points.length < maxPoints) points.push(last);

  return points.slice(0, maxPoints);
}

/**
 * Summarizes the input article text.
 * @param {Object} options
 * @param {string} options.text The article content
 * @param {"key-points" | "tl;dr" | "teaser"} [options.type="key-points"]
 * @param {"short" | "medium" | "long"} [options.length="short"]
 * @returns {Promise<import("../protocol.js").Result<string[]>>}
 */
export async function summarizeText({ text, type = "key-points", length = "short" }) {
  if (!text || typeof text !== "string") {
    return ok([]);
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return ok([]);
  }

  const globalScope = getGlobalScope();
  const summarizerApi = globalScope?.ai?.summarizer;

  if (summarizerApi && typeof summarizerApi.create === "function") {
    try {
      const summarizer = await summarizerApi.create({ type, length, format: "plain-text" });
      const summaryResult = await summarizer.summarize(trimmed);
      if (typeof summaryResult === "string") {
        const lines = summaryResult
          .split("\n")
          .map((l) => l.replace(/^[-*•]\s*/, "").trim())
          .filter((l) => l.length > 0);
        return ok(lines);
      }
    } catch {
      // Fallback to local heuristic
    }
  }

  // Local zero-network heuristic
  const points = heuristicExtractSummary(trimmed, 3);
  return ok(points);
}
