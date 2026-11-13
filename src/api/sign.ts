/**
 * Request signing for the service's OSS-HMAC-SHA256 scheme, implemented with
 * Web Crypto so it runs in the browser (secure contexts only — `localhost` counts).
 *
 * Canonical request = newline join of:
 *   METHOD, request path (as sent), sorted `key=value` query pairs joined by `&`,
 *   `host:<host>`, and `host` (the only signed header).
 * Signature = hex(HMAC-SHA256(secretKey, canonical)).
 */

const AUTH_SCHEME = 'OSS-HMAC-SHA256';
const encoder = new TextEncoder();

export function canonicalRequest(method: string, url: URL): string {
  const query = Object.fromEntries(url.searchParams.entries());
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${name}=${query[name]}`)
    .join('&');
  return [method.toUpperCase(), url.pathname, canonicalQuery, `host:${url.host}`, 'host'].join('\n');
}

export function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function importSecret(secretKey: string): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Web Crypto is unavailable. Open the app from http://localhost or over HTTPS so requests can be signed.',
    );
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function signCanonical(key: CryptoKey, canonical: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)));
}

export async function authorizationHeader(
  key: CryptoKey,
  accessKeyId: string,
  method: string,
  url: URL,
): Promise<string> {
  const signature = await signCanonical(key, canonicalRequest(method, url));
  return `${AUTH_SCHEME} Credential=${accessKeyId}, SignedHeaders=host, Signature=${signature}`;
}
