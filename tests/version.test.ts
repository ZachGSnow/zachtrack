import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { compareVersions, newestVersion } from '../src/lib/utils/version';
import { db, getDevice, guessDeviceName } from '../src/lib/db';

afterAll(() => db.close());

describe('versions', () => {
  it('compares by number, not as text', () => {
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.10.0')).toBe(0);
    expect(compareVersions('2.0', '1.99.9')).toBeGreaterThan(0);
  });

  it('finds the newest, ignoring devices with no version', () => {
    expect(newestVersion(['1.9.0', undefined, '1.10.0', '1.2.3'])).toBe('1.10.0');
    expect(newestVersion([undefined])).toBeUndefined();
  });
});

describe('this device', () => {
  it('starts with a name from its browser', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    expect(guessDeviceName(android)).toBe('Android phone');
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toBe('Windows PC');
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(guessDeviceName('')).toBe('This device');
  });

  it('keeps the same id and name once made', async () => {
    const first = await getDevice();
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getDevice()).toEqual(first);
  });
});
