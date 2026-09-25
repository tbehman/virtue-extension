// ============================================================
// cryptoUtils.js - Web Crypto API (PBKDF2 + AES-GCM) Helpers
// ============================================================

function normalizeAuthInputs(pin, email) {
  const cleanPin = String(pin || "1234").trim();
  const cleanEmail = String(email || "virtue_default_salt").toLowerCase().trim();
  return { cleanPin, cleanEmail };
}

export async function deriveKeyFromPin(pin, email) {
  const { cleanPin, cleanEmail } = normalizeAuthInputs(pin, email);

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
      salt: encoder.encode(cleanEmail),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const rawBits = await crypto.subtle.exportKey("raw", derivedKey);
  const keyHex = Array.from(new Uint8Array(rawBits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return { key: derivedKey, keyHex };
}

export async function generatePinVerifier(pin, email) {
  const { cleanPin, cleanEmail } = normalizeAuthInputs(pin, email);
  const encoder = new TextEncoder();
  const data = encoder.encode(`${cleanPin}:${cleanEmail}:virtue_verifier_salt`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPinHash(enteredPin, email, storedVerifier) {
  if (!storedVerifier) return true;
  const generated = await generatePinVerifier(enteredPin, email);
  return generated === storedVerifier;
}

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

export async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
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