import { describe, expect, it } from 'vitest';
import { base64urlDecode, base64urlEncode, encryptPayload, invalidTarget, sendPush, vapidAuthorization } from '../server/webpush';

// RFC 8291 Appendix A: the worked example, whitespace removed. Its keys and
// auth secret are published test values, not secrets.
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg', // gitleaks:allow (RFC 8291's published example, not a secret)
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

const exportRaw = async (key: CryptoKey) => base64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', key)) as ArrayBuffer));

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { pair, keys: { publicKey: await exportRaw(pair.publicKey), privateKey: jwk.d!, subject: 'https://example.test' } };
}

describe('web push encryption (RFC 8291)', () => {
  it("matches the RFC's example byte for byte", async () => {
    const body = await encryptPayload({ p256dh: rfc.uaPublic, auth: rfc.auth }, new Uint8Array(new TextEncoder().encode(rfc.plaintext)), {
      salt: base64urlDecode(rfc.salt),
      serverKeys: { publicRaw: base64urlDecode(rfc.asPublic), privateD: base64urlDecode(rfc.asPrivate) },
    });
    const expected = new Uint8Array([...base64urlDecode(rfc.header), ...base64urlDecode(rfc.ciphertext)]);
    expect(base64urlEncode(body)).toBe(base64urlEncode(expected));
  });

  it('uses a fresh key and salt for every message', async () => {
    const target = { p256dh: rfc.uaPublic, auth: rfc.auth };
    const a = await encryptPayload(target, new Uint8Array(new TextEncoder().encode('hi')));
    const b = await encryptPayload(target, new Uint8Array(new TextEncoder().encode('hi')));
    expect(base64urlEncode(a.slice(0, 86))).not.toBe(base64urlEncode(b.slice(0, 86)));
    expect(a.length).toBe(86 + 2 + 1 + 16);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service, which verifies with the public key', async () => {
    const { pair, keys } = await vapidKeys();
    const now = Date.UTC(2026, 10, 13);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, now);
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://example.test' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, base64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('subscriptions', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: rfc.uaPublic, auth: rfc.auth };

  it('accepts the push services and refuses any other host', () => {
    expect(invalidTarget(good)).toBeNull();
    expect(invalidTarget({ ...good, endpoint: 'https://web.push.apple.com/x' })).toBeNull();
    expect(invalidTarget({ ...good, endpoint: 'https://example.com/push' })).toBe('endpoint host');
    expect(invalidTarget({ ...good, endpoint: 'http://fcm.googleapis.com/x' })).toBe('endpoint host');
    expect(invalidTarget({ ...good, endpoint: 'https://fcm.googleapis.com.evil.test/x' })).toBe('endpoint host');
    expect(invalidTarget({ ...good, p256dh: 'short' })).toBe('p256dh');
    expect(invalidTarget({ ...good, auth: '' })).toBe('auth');
  });

  it('reports a dropped subscription as gone, and other errors as failed', async () => {
    const { keys } = await vapidKeys();
    let seen: RequestInit | undefined;
    const reply = (status: number) => (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(null, { status });
    }) as typeof fetch;
    expect(await sendPush(good, { title: 'x' }, keys, reply(201))).toBe('sent');
    expect(seen?.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' });
    expect(await sendPush(good, { title: 'x' }, keys, reply(410))).toBe('gone');
    expect(await sendPush(good, { title: 'x' }, keys, reply(404))).toBe('gone');
    expect(await sendPush(good, { title: 'x' }, keys, reply(500))).toBe('failed');
  });
});
