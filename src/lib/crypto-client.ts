/**
 * Client-side RSA encryption utility.
 *
 * Fetches the server's RSA public key and uses the Web Crypto API
 * to encrypt sensitive data (passwords) before transmission.
 * This prevents plaintext passwords from being intercepted via packet sniffing.
 */

let _cachedPublicKey: CryptoKey | null = null;
let _cachedPublicKeyPEM: string | null = null;

/**
 * Fetch the RSA public key from the server and import it for use with Web Crypto API.
 * Caches the key for reuse.
 */
async function getPublicKey(): Promise<CryptoKey> {
  if (_cachedPublicKey) return _cachedPublicKey;

  const res = await fetch('/api/auth/public-key');
  if (!res.ok) {
    throw new Error('Failed to fetch public key');
  }
  const data = await res.json();
  const pem = data.publicKey as string;

  // Cache the PEM for comparison (in case server restarts and key changes)
  if (_cachedPublicKeyPEM === pem && _cachedPublicKey) {
    return _cachedPublicKey;
  }

  // Parse the PEM to get the raw key data
  const pemBody = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const binaryStr = atob(pemBody);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Import the key using Web Crypto API
  const key = await crypto.subtle.importKey(
    'spki',
    bytes.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  _cachedPublicKey = key;
  _cachedPublicKeyPEM = pem;
  return key;
}

/**
 * Encrypt a plaintext string using the server's RSA public key.
 * Returns a base64-encoded encrypted string.
 *
 * Note: RSA-OAEP with 2048-bit key can encrypt up to ~190 bytes.
 * Passwords are typically well within this limit (max 128 chars).
 */
export async function rsaEncrypt(plaintext: string): Promise<string> {
  const publicKey = await getPublicKey();

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    data
  );

  // Convert to base64
  const bytes = new Uint8Array(encrypted);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Clear the cached public key (e.g., when encryption fails due to key rotation)
 */
export function clearCachedPublicKey(): void {
  _cachedPublicKey = null;
  _cachedPublicKeyPEM = null;
}
