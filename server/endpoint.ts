// What every /api Function shares: the environment, the Access check and JSON
// responses. See functions/api/sync.ts for why the Access JWT is verified here.

import { UNAVAILABLE_REASONS, verifyAccessJwt, type AccessDeps } from './access';

export interface Env {
  DB: D1Database;
  /** The only email allowed to sync. Required: the endpoints refuse every request without it. */
  OWNER_EMAIL?: string;
  /** Zero Trust team domain (`your-team.cloudflareaccess.com`). Required. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's AUD tag. Optional, checked when set. */
  ACCESS_AUD?: string;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    // Health data: never cached by the browser or anything in between.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/**
 * Checks the request's Access token. Returns null when it's the owner, or the
 * response to send instead: 503 when the server isn't configured or can't
 * fetch Access's keys, 403 otherwise. `name` labels the log lines.
 */
export async function refuseUnlessOwner(request: Request, env: Env, deps: AccessDeps, name: string): Promise<Response | null> {
  // Cloudflare Access gates the custom domain before this Function runs, but
  // `<project>.pages.dev` and per-deployment aliases can reach it without
  // Access. So the Access JWT is verified here, and a missing owner or team
  // domain fails closed instead of skipping the check.
  if (!env.OWNER_EMAIL || !env.ACCESS_TEAM_DOMAIN) {
    console.error(`${name}: OWNER_EMAIL and ACCESS_TEAM_DOMAIN must both be set`);
    return jsonResponse({ error: 'Sync is not configured on the server' }, 503);
  }
  const access = await verifyAccessJwt(
    request.headers.get('Cf-Access-Jwt-Assertion'),
    { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL },
    deps,
  );
  if (access.ok) return null;
  if (UNAVAILABLE_REASONS.has(access.reason)) {
    console.error(`${name}: could not check the Access token (${access.reason})`);
    return jsonResponse({ error: 'Sync is temporarily unavailable' }, 503);
  }
  console.warn(`${name}: rejected request (${access.reason})`);
  return jsonResponse({ error: 'Forbidden' }, 403);
}

/** A device as the sync endpoint records it and the app lists it. */
export interface DeviceInfo {
  id: string;
  name: string;
  appVersion?: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export async function listDevices(db: D1Database): Promise<DeviceInfo[]> {
  const rows = await db.prepare('SELECT id, name, appVersion, firstSeenAt, lastSeenAt FROM devices ORDER BY lastSeenAt DESC').all<Record<string, unknown>>();
  return (rows.results ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    appVersion: (r.appVersion as string) ?? undefined,
    firstSeenAt: r.firstSeenAt as number,
    lastSeenAt: r.lastSeenAt as number,
  }));
}
