import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  base64ToBytes,
  bytesToBase64,
  decryptPayload,
  encryptPayload,
} from "../src/lib/sync/e2ee.js";

describe("Zero-Knowledge E2EE Crypto (Phase 5)", () => {
  it("survives Base64 byte array roundtrip accurately", () => {
    const original = new Uint8Array([0, 1, 255, 128, 64, 32, 16, 8, 4, 2, 1]);
    const b64 = bytesToBase64(original);
    const restored = base64ToBytes(b64);
    assert.deepEqual([...restored], [...original]);
  });

  it("encrypts and decrypts structured JSON data losslessly with WebCrypto AES-GCM", async () => {
    const secretData = {
      phrases: [
        { text: "schreiben", meaning: "to write", count: 4 },
        { text: "lesen", meaning: "to read", count: 7 },
      ],
      positions: {
        "article-123": { page: 5, percent: 50 },
      },
      userNote: "Top secret personal study list",
    };

    const passphrase = "correct-horse-battery-staple-2026";
    const envelope = await encryptPayload(secretData, passphrase);

    assert.equal(envelope.version, 1);
    assert.ok(envelope.salt.length > 0);
    assert.ok(envelope.iv.length > 0);
    assert.ok(envelope.ciphertext.length > 0);
    // Ciphertext must not reveal plain text
    assert.equal(envelope.ciphertext.includes("schreiben"), false);

    const decrypted = await decryptPayload(envelope, passphrase);
    assert.deepEqual(decrypted, secretData);
  });

  it("rejects decryption when an incorrect passphrase is provided", async () => {
    const data = { secret: "confidential" };
    const envelope = await encryptPayload(data, "right-password");

    await assert.rejects(
      async () => {
        await decryptPayload(envelope, "wrong-password");
      },
      (err) => err instanceof Error
    );
  });

  it("detects and rejects ciphertext tampering via AES-GCM authentication tag", async () => {
    const envelope = await encryptPayload({ test: "data" }, "secure-passphrase");

    // Tamper with the ciphertext bytes
    const bytes = base64ToBytes(envelope.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff; // Flip bits
    const tamperedEnvelope = {
      ...envelope,
      ciphertext: bytesToBase64(bytes),
    };

    await assert.rejects(
      async () => {
        await decryptPayload(tamperedEnvelope, "secure-passphrase");
      },
      (err) => err instanceof Error
    );
  });
});
