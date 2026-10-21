import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAccessKeyCache, verifyAccessJwt, type AccessConfig } from '../server/access';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, forgedToken, ownerClaims, type Signer } from './helpers/access-token';

const NOW = Date.UTC(2026, 9, 21, 12);
const config: AccessConfig = { teamDomain: TEAM_DOMAIN, aud: AUD, ownerEmail: OWNER };

let signer: Signer;
let other: Signer;
let fetches: string[];

beforeAll(async () => {
  signer = await createSigner('key-1');
  other = await createSigner('key-1');
});

beforeEach(() => {
  clearAccessKeyCache();
  fetches = [];
});

const deps = () => ({
  now: () => NOW,
  fetchKeys: async (domain: string) => {
    fetches.push(domain);
    return signer.jwks;
  },
});

describe('verifyAccessJwt', () => {
  it('accepts a token signed by the team key for the owner', async () => {
    const token = await signer.sign(ownerClaims(NOW));
    expect(await verifyAccessJwt(token, config, deps())).toEqual({ ok: true, email: OWNER });
    expect(fetches).toEqual([TEAM_DOMAIN]);
  });

  it('accepts an aud given as a plain string, and any email case', async () => {
    const token = await signer.sign(ownerClaims(NOW, { aud: AUD, email: OWNER.toUpperCase() }));
    expect((await verifyAccessJwt(token, config, deps())).ok).toBe(true);
  });

  it('rejects a forged token with a valid-looking payload (the old decode-only check accepted this)', async () => {
    expect(await verifyAccessJwt(forgedToken(ownerClaims(NOW)), config, deps())).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('rejects a token signed by a different key with the same kid', async () => {
    const token = await other.sign(ownerClaims(NOW));
    expect((await verifyAccessJwt(token, config, deps())).ok).toBe(false);
  });

  it('rejects alg none', async () => {
    const token = await signer.sign(ownerClaims(NOW), { alg: 'none' });
    expect(await verifyAccessJwt(token, config, deps())).toEqual({ ok: false, reason: 'unsupported alg' });
  });

  it('rejects a missing token and garbage', async () => {
    expect((await verifyAccessJwt(null, config, deps())).ok).toBe(false);
    expect((await verifyAccessJwt('abc', config, deps())).ok).toBe(false);
    expect((await verifyAccessJwt('a.b.c', config, deps())).ok).toBe(false);
  });

  it.each([
    ['wrong issuer', { iss: 'https://someone-else.cloudflareaccess.com' }],
    ['expired', { exp: Math.floor(NOW / 1000) - 3600 }],
    ['not yet valid', { nbf: Math.floor(NOW / 1000) + 3600 }],
    ['wrong audience', { aud: ['another-app'] }],
    ['not the owner', { email: 'someone@example.com' }],
  ])('rejects a validly signed token that is %s', async (reason, overrides) => {
    const token = await signer.sign(ownerClaims(NOW, overrides));
    expect(await verifyAccessJwt(token, config, deps())).toEqual({ ok: false, reason });
  });

  it('skips the audience check only when no AUD is configured', async () => {
    const token = await signer.sign(ownerClaims(NOW, { aud: ['another-app'] }));
    expect((await verifyAccessJwt(token, { ...config, aud: undefined }, deps())).ok).toBe(true);
  });

  it('caches keys for repeat requests', async () => {
    const token = await signer.sign(ownerClaims(NOW));
    await verifyAccessJwt(token, config, deps());
    await verifyAccessJwt(token, config, deps());
    expect(fetches).toHaveLength(1);
  });

  it('refetches for an unknown kid at most once per 5 minutes', async () => {
    let now = NOW;
    let jwks = signer.jwks;
    const timed = {
      now: () => now,
      fetchKeys: async (domain: string) => {
        fetches.push(domain);
        return jwks;
      },
    };
    await verifyAccessJwt(await signer.sign(ownerClaims(NOW)), config, timed);
    expect(fetches).toHaveLength(1);

    // A flood of made-up kids right after a fetch causes no extra fetches.
    for (let i = 0; i < 20; i++) {
      const fake = await signer.sign(ownerClaims(NOW), { kid: `made-up-${i}` });
      expect(await verifyAccessJwt(fake, config, timed)).toEqual({ ok: false, reason: 'unknown kid' });
    }
    expect(fetches).toHaveLength(1);

    // Key rotation: once 5 minutes have passed, an unknown kid triggers one refetch and the new key works.
    const rotatedSigner = await createSigner('key-2');
    jwks = { keys: [...signer.jwks.keys, ...rotatedSigner.jwks.keys] };
    now = NOW + 5 * 60 * 1000 + 1;
    const rotated = await rotatedSigner.sign(ownerClaims(now));
    expect((await verifyAccessJwt(rotated, config, timed)).ok).toBe(true);
    expect(fetches).toHaveLength(2);
  });

  it('reports keys unavailable when the certs fetch fails, instead of throwing', async () => {
    const token = await signer.sign(ownerClaims(NOW));
    const failing = {
      now: () => NOW,
      fetchKeys: async () => {
        throw new Error('network down');
      },
    };
    expect(await verifyAccessJwt(token, config, failing)).toEqual({ ok: false, reason: 'keys unavailable' });
  });

  it('accepts a team domain written as a URL', async () => {
    const token = await signer.sign(ownerClaims(NOW));
    expect((await verifyAccessJwt(token, { ...config, teamDomain: `https://${TEAM_DOMAIN}/` }, deps())).ok).toBe(true);
  });
});
