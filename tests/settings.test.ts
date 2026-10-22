import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { db, getSettings, getAllSyncableRecords, updateSettings } from '../src/lib/db';
import { handleSync } from '../functions/api/sync';
import { AUD, OWNER, TEAM_DOMAIN, createSigner, ownerClaims, type Signer } from './helpers/access-token';

// A new device creates default settings on first launch and pushes its whole
// dataset on its first sync. Those defaults must not overwrite the settings
// the other devices already synced (height, goal weight).

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let signer: Signer;
const NOW = Date.UTC(2026, 9, 22, 12);

beforeAll(async () => {
  proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/fixtures/wrangler.test.toml', persist: false });
  const schema = readFileSync('d1/schema.sql', 'utf8').replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const t of ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'settings', 'syncSeq']) {
    await proxy.env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  for (const s of schema) await proxy.env.DB.prepare(s).run();
  signer = await createSigner();
});

afterAll(async () => {
  db.close();
  await proxy?.dispose();
});

async function push(body: unknown) {
  const res = await handleSync(
    new Request('https://app.example.com/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await signer.sign(ownerClaims(NOW)) },
      body: JSON.stringify(body),
    }),
    { DB: proxy.env.DB, OWNER_EMAIL: OWNER, ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD },
    { now: () => NOW, fetchKeys: async () => signer.jwks },
  );
  return (await res.json()) as any;
}

describe('default settings on a new device', () => {
  it('are created as older than anything a real edit writes', async () => {
    await db.settings.clear();
    const fresh = await getSettings();
    expect(fresh.updatedAt).toBe(0);
    const edited = await updateSettings({ heightInches: 70 });
    expect(edited.updatedAt).toBeGreaterThan(0);
  });

  it("don't overwrite synced settings on the new device's first sync", async () => {
    // Another device already synced real settings.
    await push({
      cursor: 0,
      changes: {
        fasts: [],
        fieldDefinitions: [],
        trackableDefinitions: [],
        trackableEntries: [],
        settings: { id: 'app-settings', defaultPresetId: '18:6', notificationsEnabled: true, heightInches: 70, goalWeightLb: 175, weightFieldId: 'f-scale', neckFieldId: 'f-neck', bodyFatSex: 'male', updatedAt: NOW - 86400000 },
      },
      tombstones: [],
    });

    // A brand-new device: empty local database, first launch, first sync.
    await db.settings.clear();
    await getSettings();
    const local = await getAllSyncableRecords();
    const res = await push({ cursor: 0, changes: local, tombstones: [] });

    expect(res.changes.settings).toMatchObject({ heightInches: 70, goalWeightLb: 175, weightFieldId: 'f-scale', neckFieldId: 'f-neck', bodyFatSex: 'male', defaultPresetId: '18:6' });
    const server = await proxy.env.DB.prepare('SELECT heightInches, goalWeightLb, weightFieldId, neckFieldId, bodyFatSex FROM settings').first();
    expect(server).toEqual({ heightInches: 70, goalWeightLb: 175, weightFieldId: 'f-scale', neckFieldId: 'f-neck', bodyFatSex: 'male' });
  });
});
