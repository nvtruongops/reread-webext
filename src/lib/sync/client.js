/**
 * Reapps Zero-Knowledge Sync Client.
 * Manages client-side sync state, timestamp-based last-write-wins conflict resolution,
 * and data mapping compatible with fundacja-reborn/reapps note models.
 */

/**
 * @typedef {Object} SyncItem
 * @property {string} id Unique item identifier
 * @property {number} updatedAt Last modified Unix timestamp
 * @property {boolean} [deleted] Deletion tombstone marker
 * @property {Record<string, any>} data Item payload
 */

/**
 * Merges local and remote collections of SyncItems using Last-Write-Wins (LWW).
 * @param {SyncItem[]} localItems
 * @param {SyncItem[]} remoteItems
 * @returns {SyncItem[]}
 */
export function mergeSyncCollections(localItems = [], remoteItems = []) {
  /** @type {Map<string, SyncItem>} */
  const merged = new Map();

  for (const item of localItems) {
    if (item && item.id) {
      merged.set(item.id, item);
    }
  }

  for (const remote of remoteItems) {
    if (!remote || !remote.id) continue;
    const local = merged.get(remote.id);
    if (!local || (remote.updatedAt ?? 0) >= (local.updatedAt ?? 0)) {
      merged.set(remote.id, remote);
    }
  }

  return [...merged.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Formats a saved phrase or mark into a Reapps compatible Note object.
 * @param {Object} options
 * @param {string} options.id
 * @param {string} options.title
 * @param {string} options.content
 * @param {string[]} [options.tags]
 * @param {number} [options.updatedAt]
 * @returns {Record<string, any>}
 */
export function toReappsNote({ id, title, content, tags = ["reread"], updatedAt = Date.now() }) {
  return {
    id,
    type: "note",
    schemaVersion: 1,
    title: title.trim(),
    content: content.trim(),
    tags: Array.isArray(tags) ? tags : ["reread"],
    createdAt: updatedAt,
    updatedAt,
    meta: {
      source: "reread-webext",
    },
  };
}
