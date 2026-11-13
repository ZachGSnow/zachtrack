import type { AccessDeps } from '../../server/access';
import { jsonResponse, refuseUnlessOwner, type Env } from '../../server/endpoint';
import { isValidTimeZone, vapidKeysFrom, type PushSubscriptionRow } from '../../server/reminders';
import { invalidTarget, sendPush } from '../../server/webpush';

// Daily reminders (ARCHITECTURE.md 3.73), one device at a time:
//   GET  /api/push  -> { publicKey }: the key a browser subscribes with, or null when reminders aren't set up
//   POST /api/push  { action: 'get' | 'save' | 'delete' | 'test', endpoint, ... }
// Everything about a subscription goes in the body, never the URL: the push
// address works as a key to this device's notifications.

export const onRequestGet: PagesFunction<Env> = (context) => handlePush(context.request, context.env);
export const onRequestPost: PagesFunction<Env> = (context) => handlePush(context.request, context.env);

interface SaveBody {
  action: 'save';
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceId?: string;
  timeZone: string;
  remindAt: string;
  include: { habits: boolean; tasks: boolean; dates: boolean };
  named: boolean;
}

/** What Settings shows for this device. */
export interface ReminderSettings {
  remindAt: string;
  include: { habits: boolean; tasks: boolean; dates: boolean };
  named: boolean;
  lastSentOn: string | null;
}

const toSettings = (row: PushSubscriptionRow): ReminderSettings => ({
  remindAt: row.remindAt,
  include: { habits: !!row.includeHabits, tasks: !!row.includeTasks, dates: !!row.includeDates },
  named: !!row.namedText,
  lastSentOn: row.lastSentOn,
});

export async function handlePush(request: Request, env: Env, deps: AccessDeps & { now?: () => number; fetcher?: typeof fetch } = {}): Promise<Response> {
  const refused = await refuseUnlessOwner(request, env, deps, 'push');
  if (refused) return refused;
  const keys = vapidKeysFrom(env);
  if (request.method === 'GET') return jsonResponse({ publicKey: keys?.publicKey ?? null });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return jsonResponse({ error: 'Invalid endpoint' }, 400);
  const now = deps.now?.() ?? Date.now();

  try {
    const row = (await env.DB.prepare('SELECT * FROM pushSubscriptions WHERE endpoint = ?').bind(endpoint).first()) as PushSubscriptionRow | null;
    switch (body.action) {
      case 'get':
        return jsonResponse({ settings: row ? toSettings(row) : null });
      case 'delete':
        await env.DB.prepare('DELETE FROM pushSubscriptions WHERE endpoint = ?').bind(endpoint).run();
        return jsonResponse({ settings: null });
      case 'save': {
        if (!keys) return jsonResponse({ error: 'Reminders are not set up on the server' }, 503);
        const save = body as unknown as SaveBody;
        const bad =
          invalidTarget({ endpoint, p256dh: save.keys?.p256dh, auth: save.keys?.auth }) ??
          (!isValidTimeZone(save.timeZone) ? 'timeZone' : null) ??
          (typeof save.remindAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(save.remindAt) ? 'remindAt' : null) ??
          (save.deviceId != null && (typeof save.deviceId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(save.deviceId)) ? 'deviceId' : null);
        if (bad) return jsonResponse({ error: `Invalid ${bad}` }, 400);
        const flag = (v: unknown, fallback: boolean) => ((typeof v === 'boolean' ? v : fallback) ? 1 : 0);
        await env.DB.prepare(
          `INSERT INTO pushSubscriptions (endpoint, deviceId, p256dh, auth, timeZone, remindAt, includeHabits, includeTasks, includeDates, namedText, lastSentOn, failures, createdAt, updatedAt)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, 0, ?11, ?11)
           ON CONFLICT(endpoint) DO UPDATE SET deviceId=excluded.deviceId, p256dh=excluded.p256dh, auth=excluded.auth, timeZone=excluded.timeZone,
             remindAt=excluded.remindAt, includeHabits=excluded.includeHabits, includeTasks=excluded.includeTasks, includeDates=excluded.includeDates,
             namedText=excluded.namedText, failures=0, updatedAt=excluded.updatedAt`,
        )
          .bind(
            endpoint,
            save.deviceId ?? null,
            save.keys.p256dh,
            save.keys.auth,
            save.timeZone,
            save.remindAt,
            flag(save.include?.habits, true),
            flag(save.include?.tasks, true),
            flag(save.include?.dates, true),
            flag(save.named, false),
            now,
          )
          .run();
        const saved = (await env.DB.prepare('SELECT * FROM pushSubscriptions WHERE endpoint = ?').bind(endpoint).first()) as PushSubscriptionRow;
        return jsonResponse({ settings: toSettings(saved) });
      }
      case 'test': {
        if (!keys) return jsonResponse({ error: 'Reminders are not set up on the server' }, 503);
        if (!row) return jsonResponse({ error: 'Turn reminders on first' }, 404);
        const outcome = await sendPush(row, { title: 'ZachTrack', body: 'Reminders are on. This is how they will look.', url: '/#/' }, keys, deps.fetcher);
        if (outcome === 'gone') await env.DB.prepare('DELETE FROM pushSubscriptions WHERE endpoint = ?').bind(endpoint).run();
        return jsonResponse({ outcome });
      }
      default:
        return jsonResponse({ error: 'Invalid action' }, 400);
    }
  } catch (err) {
    console.error('push: failed', err);
    return jsonResponse({ error: 'Could not update reminders' }, 500);
  }
}
