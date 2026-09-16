import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mergeSyncCollections,
  toReappsNote,
} from "../src/lib/sync/client.js";

describe("Reapps Sync Client (Phase 5)", () => {
  it("merges local and remote items using Last-Write-Wins timestamps", () => {
    const local = [
      { id: "item-1", updatedAt: 100, data: { text: "old version" } },
      { id: "item-2", updatedAt: 200, data: { text: "local only" } },
    ];

    const remote = [
      { id: "item-1", updatedAt: 150, data: { text: "newer remote version" } }, // newer
      { id: "item-3", updatedAt: 300, data: { text: "remote only" } },
    ];

    const merged = mergeSyncCollections(local, remote);
    assert.equal(merged.length, 3);

    const item1 = merged.find((i) => i.id === "item-1");
    assert.equal(item1?.data.text, "newer remote version");

    const item2 = merged.find((i) => i.id === "item-2");
    assert.equal(item2?.data.text, "local only");

    const item3 = merged.find((i) => i.id === "item-3");
    assert.equal(item3?.data.text, "remote only");
  });

  it("formats items into valid Reapps Note schema", () => {
    const note = toReappsNote({
      id: "note-abc",
      title: "Vocabulary: lesen",
      content: "Meaning: to read\nExample: Ich lese gern.",
      tags: ["reread", "german", "verbs"],
      updatedAt: 1773660000000,
    });

    assert.equal(note.id, "note-abc");
    assert.equal(note.type, "note");
    assert.equal(note.schemaVersion, 1);
    assert.equal(note.title, "Vocabulary: lesen");
    assert.deepEqual(note.tags, ["reread", "german", "verbs"]);
    assert.equal(note.meta.source, "reread-webext");
  });
});
