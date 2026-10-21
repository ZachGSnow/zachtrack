// Cloudflare Access JWT verification for the sync endpoint.
//
// Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header of every
// request it lets through. Cloudflare's guidance is to verify that token in
// the origin rather than trust the header's presence: a request that reaches
// the Function by a hostname Access does not cover (`<project>.pages.dev`, a
// per-deployment alias) arrives with whatever headers the caller chose to
// send. So the signature is checked against the team's published keys, and
// the issuer, expiry, audience and email claims are checked too.

export interface AccessConfig {
  /** Zero Trust team domain, e.g. `your-team.cloudflareaccess.com`. */
  teamDomain: string;
  /** The Access application's AUD tag. Checked when set. */
  aud?: string;
  /** The only email allowed through. */
  ownerEmail: string;
}

export interface AccessDeps {
  /** Fetches the team's JWKS. Injected by tests. */
  fetchKeys?: (teamDomain: string) => Promise<JsonWebKeySet>;
  /** Current time in ms. Injected by tests. */
  now?: () => number;
}

export interface JsonWebKeySet {
  keys: Array<JsonWebKey & { kid?: string }>;
}

export type AccessResult = { ok: true; email: string } | { ok: false; reason: string };

/** Failure reasons that mean the server couldn't check the token, not that the token is bad. */
export const UNAVAILABLE_REASONS = new Set(['keys unavailable']);

const KEY_CACHE_MS = 60 * 60 * 1000;
const KEY_REFRESH_MIN_MS = 5 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const keyCache = new Map<string, { fetchedAt: number; keys: JsonWebKeySet }>();

/** Clears the module-level key cache. For tests. */
export function clearAccessKeyCache(): void {
  keyCache.clear();
}

export function normalizeTeamDomain(teamDomain: string): string {
  return teamDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
}

async function defaultFetchKeys(teamDomain: string): Promise<JsonWebKeySet> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs request failed (${res.status})`);
  return (await res.json()) as JsonWebKeySet;
}

async function getKeys(teamDomain: string, deps: AccessDeps, forceRefresh: boolean): Promise<JsonWebKeySet> {
  const now = (deps.now ?? Date.now)();
  const cached = keyCache.get(teamDomain);
  if (cached) {
    const age = now - cached.fetchedAt;
    // A forced refresh (unknown kid) is allowed at most once per
    // KEY_REFRESH_MIN_MS, so tokens with made-up kids can't make every
    // request fetch the certs again.
    if (age < (forceRefresh ? KEY_REFRESH_MIN_MS : KEY_CACHE_MS)) return cached.keys;
  }
  const keys = await (deps.fetchKeys ?? defaultFetchKeys)(teamDomain);
  keyCache.set(teamDomain, { fetchedAt: now, keys });
  return keys;
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as T;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

/** Verifies an Access JWT and returns the owner's email when every check passes. */
export async function verifyAccessJwt(token: string | null, config: AccessConfig, deps: AccessDeps = {}): Promise<AccessResult> {
  if (!token) return { ok: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeJson<JwtHeader>(parts[0]);
    payload = decodeJson<JwtPayload>(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported alg' };
  if (!header.kid) return { ok: false, reason: 'missing kid' };

  const teamDomain = normalizeTeamDomain(config.teamDomain);
  let jwk: (JsonWebKey & { kid?: string }) | undefined;
  try {
    jwk = (await getKeys(teamDomain, deps, false)).keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      // Access rotates its signing keys; refetch (rate-limited) before giving up.
      jwk = (await getKeys(teamDomain, deps, true)).keys.find((k) => k.kid === header.kid);
    }
  } catch {
    return { ok: false, reason: 'keys unavailable' };
  }
  if (!jwk) return { ok: false, reason: 'unknown kid' };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), signed);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad signature' };

  const nowS = Math.floor((deps.now ?? Date.now)() / 1000);
  if (payload.iss !== `https://${teamDomain}`) return { ok: false, reason: 'wrong issuer' };
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_S > nowS) return { ok: false, reason: 'not yet valid' };
  if (config.aud) {
    const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!auds.includes(config.aud)) return { ok: false, reason: 'wrong audience' };
  }
  if (!payload.email || payload.email.toLowerCase() !== config.ownerEmail.trim().toLowerCase()) {
    return { ok: false, reason: 'not the owner' };
  }
  return { ok: true, email: payload.email };
}
