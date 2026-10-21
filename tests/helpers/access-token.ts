// Builds RS256 tokens shaped like the ones Cloudflare Access issues (header
// `alg`/`kid`, claims `iss`/`aud`/`email`/`exp`/`iat`/`nbf`), signed with a
// throwaway key pair, plus the JWKS the team certs endpoint would return.

import type { JsonWebKeySet } from '../../server/access';

export const TEAM_DOMAIN = 'test-team.cloudflareaccess.com';
export const AUD = 'test-aud-tag';
export const OWNER = 'owner@example.com';

const enc = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encBytes = (b: ArrayBuffer) => enc(String.fromCharCode(...new Uint8Array(b)));

export interface Signer {
  jwks: JsonWebKeySet;
  sign(claims: Record<string, unknown>, opts?: { kid?: string; alg?: string }): Promise<string>;
}

export async function createSigner(kid = 'key-1'): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    jwks: { keys: [{ kty: pub.kty, n: pub.n, e: pub.e, alg: 'RS256', kid, use: 'sig' }] },
    async sign(claims, opts = {}) {
      const header = enc(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? kid, typ: 'JWT' }));
      const payload = enc(JSON.stringify(claims));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
      return `${header}.${payload}.${encBytes(sig)}`;
    },
  };
}

export function ownerClaims(nowMs: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(nowMs / 1000);
  return {
    aud: [AUD],
    email: OWNER,
    exp: now + 3600,
    iat: now,
    nbf: now,
    iss: `https://${TEAM_DOMAIN}`,
    type: 'app',
    sub: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

/** A token with a valid-looking payload and no real signature, like a forged header. */
export function forgedToken(claims: Record<string, unknown>, kid = 'key-1'): string {
  return `${enc(JSON.stringify({ alg: 'RS256', kid }))}.${enc(JSON.stringify(claims))}.${enc('not-a-signature')}`;
}
