// ============================================================
// cryptoUtils.js - Web Crypto API (PBKDF2 + AES-GCM) Helpers
// ============================================================

/**
 * Derives a 256-bit CryptoKey using PBKDF2 from a 4-digit PIN and user email.
 * @param {string} pin - User's 4-digit PIN (e.g., "1234")
 * @param {string} email - User's Google Account Email (used as salt)
 * @returns {Promise<{ key: CryptoKey, keyHex: string }>} Derived key and hex representation
 */
export async function deriveKeyFromPin(pin, email) {
  const cleanPin = (pin || "1234").trim();
  const cleanSalt = (email || "virtue_default_salt").toLowerCase().trim();

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(cleanPin),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"]
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(cleanSalt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  // Export raw bytes as Hex string for inclusion in URL fragment hash
  const rawBits = await crypto.subtle.exportKey("raw", derivedKey);
  const keyHex = Array.from(new Uint8Array(rawBits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return { key: derivedKey, keyHex };
}

/**
 * Imports a raw 64-character Hex string into a usable CryptoKey.
 * @param {string} hexKey - 64-char hex string from URL fragment
 * @returns {Promise<CryptoKey>}
 */
export async function importKeyFromHex(hexKey) {
  const bytes = new Uint8Array(
    hexKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
  );

  return crypto.subtle.importKey(
    "raw",
    bytes.buffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a JS Object using AES-GCM.
 * @param {Object|Array} data - Data to encrypt
 * @param {CryptoKey} key - AES-GCM CryptoKey
 * @returns {Promise<{ ciphertext: string, iv: string }>} Base64-encoded encrypted payload and IV
 */
export async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit initialization vector
  const encodedData = encoder.encode(JSON.stringify(data));

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedData
  );

  return {
    ciphertext: bufferToBase64(encryptedBuffer),
    iv: bufferToBase64(iv.buffer)
  };
}

/**
 * Decrypts an AES-GCM payload back into a JS Object.
 * @param {string} ciphertextBase64 - Base64 encoded ciphertext
 * @param {string} ivBase64 - Base64 encoded initialization vector
 * @param {CryptoKey} key - AES-GCM CryptoKey
 * @returns {Promise<Object|Array>} Decrypted JSON object
 */
export async function decryptData(ciphertextBase64, ivBase64, key) {
  const ciphertext = base64ToBuffer(ciphertextBase64);
  const iv = base64ToBuffer(ivBase64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decryptedBuffer));
}

// Helpers for ArrayBuffer <-> Base64 conversion
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}