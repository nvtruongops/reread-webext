import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANKI_CONNECT_DEFAULT_URL,
  buildAnkiNotePayload,
  invokeAnkiConnect,
} from "../src/lib/anki-connect.js";

describe("AnkiConnect Bridge (Phase 3)", () => {
  it("builds correct JSON-RPC addNote payload", () => {
    const payload = buildAnkiNotePayload({
      phrase: "schreiben",
      meaning: "to write",
      context: "Ich möchte ein Buch schreiben.",
      deckName: "German Vocabulary",
      tags: ["reread", "german"],
    });

    assert.equal(payload.action, "addNote");
    assert.equal(payload.version, 6);
    assert.equal(payload.params.note.deckName, "German Vocabulary");
    assert.equal(payload.params.note.fields.Front, "schreiben");
    assert.ok(payload.params.note.fields.Back.includes("to write"));
    assert.ok(payload.params.note.fields.Back.includes("Ich möchte ein Buch schreiben."));
    assert.deepEqual(payload.params.note.tags, ["reread", "german"]);
  });

  it("handles transport calls cleanly with mock transport", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    /**
     * @param {string} url
     * @param {any} options
     */
    const mockTransport = async (url, options) => {
      capturedUrl = url;
      capturedBody = options.body;
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: 14897235, error: null };
        },
      };
    };

    const res = await invokeAnkiConnect({
      action: "addNote",
      params: { note: { deckName: "Default" } },
      transport: mockTransport,
    });

    assert.equal(res.ok, true);
    assert.equal(res.result, 14897235);
    assert.equal(capturedUrl, ANKI_CONNECT_DEFAULT_URL);
    assert.ok(capturedBody.includes('"addNote"'));
  });

  it("returns error when transport fails or Anki returns error", async () => {
    const mockFailTransport = async () => {
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: null, error: "deck was not found: NonExistentDeck" };
        },
      };
    };

    const res = await invokeAnkiConnect({
      action: "addNote",
      transport: mockFailTransport,
    });

    assert.equal(res.ok, false);
    assert.equal(res.error, "deck was not found: NonExistentDeck");
  });
});
