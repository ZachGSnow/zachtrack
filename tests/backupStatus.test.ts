import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { handleBackupStatus } from '../functions/api/backup-status';
import type { Env } from '../server/endpoint';
import { clearAccessKeyCache } from '../server/access';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, ownerClaims, type Signer } from './helpers/access-token';

// GET /api/backup-status against a local R2 bucket.

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database; BACKUPS: R2Bucket }>>>;
let proxy: Proxy;
let bucket: R2Bucket;
let signer: Signer;
const NOW = Date.UTC(2026, 10, 8, 12);

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database; BACKUPS: R2Bucket }>({ configPath: 'tests/fixtures/wrangler.test.toml', persist: false });
  bucket = proxy.env.BACKUPS;
  signer = await createSigner();
});

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  clearAccessKeyCache();
  const listed = await bucket.list();
  for (const o of listed.objects) await bucket.delete(o.key);
});

const env = (withBucket = true): Env => ({
  DB: proxy.env.DB,
  OWNER_EMAIL: OWNER,
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ...(withBucket ? { BACKUPS: bucket } : {}),
});
const deps = { now: () => NOW, fetchKeys: async () => signer.jwks };

async function status(withBucket = true, jwt: string | null = null) {
  const token = jwt ?? (await signer.sign(ownerClaims(NOW)));
  const res = await handleBackupStatus(
    new Request('https://app.example.com/api/backup-status', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }),
    env(withBucket),
    deps,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('backup status', () => {
  it('names the newest backup file, its time and size, never its contents', async () => {
    await bucket.put('zachtrack-db/2026-11-06.sql', 'older');
    await new Promise((r) => setTimeout(r, 20));
    await bucket.put('zachtrack-db/2026-11-07.sql', 'newest backup');
    await bucket.put('something-else/2026-11-09.sql', 'not a backup');
    const res = await status();
    expect(res.status).toBe(200);
    const latest = res.body.latest as { key: string; uploaded: number; bytes: number };
    expect(res.body.configured).toBe(true);
    expect(latest.key).toBe('zachtrack-db/2026-11-07.sql');
    expect(latest.bytes).toBe('newest backup'.length);
    expect(typeof latest.uploaded).toBe('number');
    expect(JSON.stringify(res.body)).not.toContain('newest backup');
  });

  it('says configured with no files yet, and not configured without the binding', async () => {
    expect((await status()).body).toEqual({ configured: true });
    expect((await status(false)).body).toEqual({ configured: false });
  });

  it('refuses a request without the owner\'s Access token', async () => {
    const res = await handleBackupStatus(new Request('https://app.example.com/api/backup-status'), env(), deps);
    expect(res.status).toBe(403);
  });
});
