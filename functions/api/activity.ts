import type { AccessDeps } from '../../server/access';
import { jsonResponse, listDevices, refuseUnlessOwner, type DeviceInfo, type Env } from '../../server/endpoint';

// GET /api/activity: the shared sync activity log (what each device changed,
// newest first) and the device list, for the app's Sync page. Rows come from
// the sync endpoint; see d1/migrations/0006_devices_activity.sql.

export interface ActivityEvent {
  id: number;
  deviceId: string;
  at: number;
  /** Records changed per type, e.g. { trackableEntries: 2, deletes: 1 }. */
  counts: Record<string, number>;
  /** Up to 20 names, e.g. "Entry -- Water". */
  details: string[];
  rejectedCount: number;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  devices: DeviceInfo[];
  /** More events are older than the last one here: ask again with before = its `at`. */
  more: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const onRequestGet: PagesFunction<Env> = (context) => handleActivity(context.request, context.env);

export async function handleActivity(request: Request, env: Env, deps: AccessDeps = {}): Promise<Response> {
  const refused = await refuseUnlessOwner(request, env, deps, 'activity');
  if (refused) return refused;

  const url = new URL(request.url);
  const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)) || DEFAULT_LIMIT));
  if (!Number.isFinite(before)) return jsonResponse({ error: 'Invalid before' }, 400);

  try {
    const rows = await env.DB.prepare(
      'SELECT id, deviceId, at, counts, details, rejectedCount FROM syncEvents WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?',
    )
      .bind(before, limit + 1)
      .all<Record<string, unknown>>();
    const results = rows.results ?? [];
    const events: ActivityEvent[] = results.slice(0, limit).map((r) => ({
      id: r.id as number,
      deviceId: r.deviceId as string,
      at: r.at as number,
      counts: JSON.parse((r.counts as string) || '{}'),
      details: r.details ? JSON.parse(r.details as string) : [],
      rejectedCount: (r.rejectedCount as number) ?? 0,
    }));
    const body: ActivityResponse = { events, devices: await listDevices(env.DB), more: results.length > limit };
    return jsonResponse(body);
  } catch (err) {
    console.error('activity: failed', err);
    return jsonResponse({ error: 'Could not read the activity' }, 500);
  }
}
