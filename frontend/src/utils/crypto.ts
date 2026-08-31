/**
 * Client-side credential encryption utility using Web Crypto API (AES-GCM 256-bit).
 * Encrypts sensitive API Keys in localStorage so that keys are stored encrypted at rest.
 */

const SALT = new Uint8Array([107, 110, 111, 77, 97, 112, 45, 108, 108, 109, 45, 115, 101, 99, 114, 101, 116]); // 'knoMap-llm-secret'
const PREFIX = 'enc:v1:';

async function getDerivedKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const rawKeyMaterial = `knomap-key-${typeof window !== 'undefined' && window.location ? (window.location.host || 'desktop') : 'desktop'}`;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(rawKeyMaterial),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext string with AES-GCM 256-bit.
 * Returns a prefixed base64 string: 'enc:v1:<base64(iv + ciphertext)>'
 */
export async function encryptSecret(plainText: string): Promise<string> {
  if (!plainText || !plainText.trim()) return '';
  try {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      return plainText;
    }

    const key = await getDerivedKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encoded = enc.encode(plainText);

    const cipherBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      encoded
    );

    const cipherArray = new Uint8Array(cipherBuffer);
    const combined = new Uint8Array(iv.length + cipherArray.length);
    combined.set(iv, 0);
    combined.set(cipherArray, iv.length);

    let binary = '';
    const len = combined.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(combined[i]);
    }

    return PREFIX + btoa(binary);
  } catch (err) {
    console.warn('[Crypto] Encryption error, fallback to raw value:', err);
    return plainText;
  }
}

/**
 * Decrypts an encrypted string if prefixed with 'enc:v1:', or returns as-is if legacy plaintext.
 */
export async function decryptSecret(cipherText: string): Promise<string> {
  if (!cipherText || !cipherText.trim()) return '';
  if (!cipherText.startsWith(PREFIX)) return cipherText; // Plaintext legacy format

  try {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
      return cipherText;
    }

    const b64 = cipherText.slice(PREFIX.length);
    const binary = atob(b64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    if (combined.length <= 12) return '';

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const key = await getDerivedKey();
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      data
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch (err) {
    console.warn('[Crypto] Decryption error, returning empty string:', err);
    return '';
  }
}
