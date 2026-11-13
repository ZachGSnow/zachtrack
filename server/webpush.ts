// Web Push from a Worker (ARCHITECTURE.md 3.73), with WebCrypto only: the
// message encryption of RFC 8291 (aes128gcm) and the VAPID signature of
// RFC 8292. Written here rather than taken from a library, which would need a
// licence check of everything it brings in (and the common one needs Node's
// crypto). Tested against RFC 8291's own example in tests/webpush.test.ts.

const enc = new TextEncoder();

export function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** A P-256 key as JWK from its uncompressed public point (0x04 || x || y) and, for a private key, d. */
function p256Jwk(publicRaw: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error('Expected an uncompressed P-256 public key');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64urlEncode(publicRaw.slice(1, 33)),
    y: base64urlEncode(publicRaw.slice(33, 65)),
    ...(d ? { d: base64urlEncode(d) } : {}),
    ext: true,
  };
}

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushTarget {
  endpoint: string;
  /** base64url, the browser's P-256 public key. */
  p256dh: string;
  /** base64url, 16 bytes. */
  auth: string;
}

/** Fixed inputs, for the RFC's test vector only; normally both are random. */
export interface EncryptOptions {
  salt?: Uint8Array<ArrayBuffer>;
  serverKeys?: { publicRaw: Uint8Array<ArrayBuffer>; privateD: Uint8Array<ArrayBuffer> };
}

/** Encrypts a push message body for one subscription (RFC 8291, a single record of up to 4096 bytes). */
export async function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, plaintext: Uint8Array<ArrayBuffer>, options: EncryptOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64urlDecode(target.p256dh);
  const authSecret = base64urlDecode(target.auth);
  if (plaintext.length > 3993) throw new Error('A push message is limited to 3993 bytes');

  // This message's own key pair: its public half goes in the header.
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array<ArrayBuffer>;
  if (options.serverKeys) {
    asPublic = options.serverKeys.publicRaw;
    asPrivate = await crypto.subtle.importKey('jwk', p256Jwk(asPublic, options.serverKeys.privateD), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // `public` is the standard name; the Workers type definitions spell it `$public`.
  const ecdhParams = { name: 'ECDH', public: uaKey };
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams as never, asPrivate, 256));

  // Combine the shared secret with the subscription's auth secret.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));

  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The last (and only) record ends with the 0x02 delimiter.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** The app's VAPID key pair (RFC 8292), base64url: the public key uncompressed, the private key its 32-byte d. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** Who runs the server: a mailto: or https: address; push services may use it if something goes wrong. */
  subject: string;
}

/** The Authorization header value for a push to `endpoint`, valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now: number = Date.now()): Promise<string> {
  const header = base64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64urlEncode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signingKey = await crypto.subtle.importKey('jwk', p256Jwk(base64urlDecode(keys.publicKey), base64urlDecode(keys.privateKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto's ECDSA signature is r || s, which is what a JWT's ES256 wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64urlEncode(signature)}, k=${keys.publicKey}`;
}

/**
 * Push services the app sends to. A subscription naming any other host is
 * refused, so the server never posts to an address a request made up.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

/** Why a subscription can't be used, or null when it can. */
export function invalidTarget(target: Partial<PushTarget>): string | null {
  if (typeof target.endpoint !== 'string' || target.endpoint.length > 1000) return 'endpoint';
  let url: URL;
  try {
    url = new URL(target.endpoint);
  } catch {
    return 'endpoint';
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return 'endpoint host';
  if (typeof target.p256dh !== 'string' || !/^[A-Za-z0-9_-]{86,88}$/.test(target.p256dh)) return 'p256dh';
  if (typeof target.auth !== 'string' || !/^[A-Za-z0-9_-]{21,24}$/.test(target.auth)) return 'auth';
  return null;
}

export type SendOutcome = 'sent' | 'gone' | 'failed';

/**
 * Sends one notification. 'gone' (404 or 410) means the browser dropped the
 * subscription and it should be deleted; 'failed' is worth trying again later.
 */
export async function sendPush(target: PushTarget, payload: unknown, keys: VapidKeys, fetcher: typeof fetch = fetch): Promise<SendOutcome> {
  const body = await encryptPayload(target, new Uint8Array(enc.encode(JSON.stringify(payload))));
  const response = await fetcher(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Kept for a day while the phone is off; a summary older than that isn't worth showing.
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  });
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}
