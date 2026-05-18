"use client";

/** Client-side AES-GCM encryption with a PBKDF2-derived key from a passphrase.
 *  Nothing here ever talks to the network — pure WebCrypto. */

const KDF_ITERS = 100_000;

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const ab = new ArrayBuffer(bin.length);
  const out = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

export function randomSaltB64(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return b64(buf);
}

function randomIvB64(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return b64(buf);
}

export async function deriveKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(saltB64), iterations: KDF_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJson(
  data: unknown,
  key: CryptoKey,
): Promise<{ ciphertext: string; iv: string }> {
  const ivB64 = randomIvB64();
  const buf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: unb64(ivB64) },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return { ciphertext: b64(buf), iv: ivB64 };
}

export async function decryptJson<T>(
  ciphertext: string,
  ivB64: string,
  key: CryptoKey,
): Promise<T> {
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) },
    key,
    unb64(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}
