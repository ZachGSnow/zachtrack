import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// public/push-sw.js, the part of the service worker that shows daily
// reminders (ARCHITECTURE.md 3.73), run against a stand-in worker scope:
// headless browsers can't show notifications, so the e2e suite can't.

type Handler = (event: Record<string, unknown>) => void;

function load(windows: Array<{ url: string; navigate: (u: string) => Promise<unknown>; focus: () => Promise<unknown> }> = []) {
  const handlers: Record<string, Handler> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://app.example.com' },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
  };
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { fire, shown, opened };
}

describe('the push handler', () => {
  it('shows the message, replacing an earlier reminder', async () => {
    const sw = load();
    await sw.fire('push', { data: { json: () => ({ title: 'ZachTrack', body: '1 habit needs a look today.', url: '/#/' }) } });
    expect(sw.shown).toEqual([{ title: 'ZachTrack', options: { body: '1 habit needs a look today.', icon: '/pwa-192.png', tag: 'zachtrack-reminder', data: { url: '/#/' } } }]);
  });

  it('copes with a push without JSON', async () => {
    const sw = load();
    await sw.fire('push', {
      data: {
        json: () => {
          throw new Error('not JSON');
        },
        text: () => 'plain',
      },
    });
    expect(sw.shown[0]).toMatchObject({ title: 'ZachTrack', options: { body: 'plain' } });
  });

  it('a tap opens the app, or brings an open one to the page', async () => {
    const closed: string[] = [];
    const notification = { data: { url: '/#/' }, close: () => closed.push('x') };
    const sw = load();
    await sw.fire('notificationclick', { notification });
    expect(sw.opened).toEqual(['https://app.example.com/#/']);
    expect(closed).toHaveLength(1);

    const visited: string[] = [];
    let focused = false;
    const open = { url: 'https://app.example.com/#/tasks', navigate: async (u: string) => void visited.push(u), focus: async () => void (focused = true) };
    const again = load([open]);
    await again.fire('notificationclick', { notification });
    expect(visited).toEqual(['https://app.example.com/#/']);
    expect(focused).toBe(true);
    expect(again.opened).toEqual([]);
  });
});
