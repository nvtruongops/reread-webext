/**
 * Zero-Knowledge End-to-End Encryption (E2EE) Module.
 * Implements client-side AES-GCM-256 with PBKDF2 key derivation using the native WebCrypto API.
 * Ensures zero-server-knowledge storage compatible with fundacja-reborn/reapps sync protocols.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;

/**
 * Resolves standard WebCrypto API in Browser or Node.
 * @returns {SubtleCrypto}
 */
function getSubtleCrypto() {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("WebCrypto SubtleCrypto is not available in this environment");
}

/**
 * Converts Uint8Array to standard Base64 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user passphrase and salt via PBKDF2.
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @param {number} [iterations=PBKDF2_ITERATIONS]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const subtle = getSubtleCrypto();
  const encoder = new TextEncoder();
  const baseKey = await subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: /** @type {any} */ (salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * @typedef {Object} EncryptedEnvelope
 * @property {number} version
 * @property {string} salt Base64 encoded salt
 * @property {string} iv Base64 encoded IV
 * @property {string} ciphertext Base64 encoded ciphertext
 */

/**
 * Encrypts an arbitrary object or string payload using AES-GCM-256.
 * @param {any} data
 * @param {string} passphrase
 * @returns {Promise<EncryptedEnvelope>}
 */
export async function encryptPayload(data, passphrase) {
  if (!passphrase || typeof passphrase !== "string") {
    throw new Error("Passphrase is required for encryption");
  }

  const subtle = getSubtleCrypto();
  const salt = new Uint8Array(SALT_BYTE_LENGTH);
  crypto.getRandomValues(salt);

  const iv = new Uint8Array(IV_BYTE_LENGTH);
  crypto.getRandomValues(iv);

  const key = await deriveKey(passphrase, salt);
  const serialized = typeof data === "string" ? data : JSON.stringify(data);
  const encoded = new TextEncoder().encode(serialized);

  const ciphertextBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: /** @type {any} */ (iv) },
    key,
    encoded
  );

  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
}

/**
 * Decrypts an EncryptedEnvelope and deserializes the original content.
 * @param {EncryptedEnvelope} envelope
 * @param {string} passphrase
 * @returns {Promise<any>}
 */
export async function decryptPayload(envelope, passphrase) {
  if (!envelope || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
    throw new Error("Invalid encrypted envelope structure");
  }
  if (!passphrase || typeof passphrase !== "string") {
    throw new Error("Passphrase is required for decryption");
  }

  const subtle = getSubtleCrypto();
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const key = await deriveKey(passphrase, salt);

  const decryptedBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv: /** @type {any} */ (iv) },
    key,
    /** @type {any} */ (ciphertext)
  );

  const decodedString = new TextDecoder().decode(decryptedBuffer);
  try {
    return JSON.parse(decodedString);
  } catch {
    return decodedString;
  }
}
