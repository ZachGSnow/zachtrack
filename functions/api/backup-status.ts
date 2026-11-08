import type { AccessDeps } from '../../server/access';
import { jsonResponse, refuseUnlessOwner, type Env } from '../../server/endpoint';

// GET /api/backup-status: when the nightly backup Worker (workers/backup/)
// last wrote a file to the R2 bucket, for the "Your data" card on Today
// (ARCHITECTURE.md 3.52). Needs the bucket bound to the Pages project as
// BACKUPS (wrangler.toml.example); without the binding it says so, and the
// app leaves the line out. Only the newest file's name, date and size leave
// the server, never its contents.

/** The prefix the backup Worker writes under (workers/backup/index.ts). */
const PREFIX = 'zachtrack-db/';

export interface BackupStatus {
  configured: boolean;
  /** The newest backup file, when there is one. */
  latest?: { key: string; uploaded: number; bytes: number };
}

export const onRequestGet: PagesFunction<Env> = (context) => handleBackupStatus(context.request, context.env);

export async function handleBackupStatus(request: Request, env: Env, deps: AccessDeps = {}): Promise<Response> {
  const refused = await refuseUnlessOwner(request, env, deps, 'backup-status');
  if (refused) return refused;
  if (!env.BACKUPS) return jsonResponse({ configured: false } satisfies BackupStatus);
  try {
    let newest: R2Object | undefined;
    let cursor: string | undefined;
    // A lifecycle rule keeps about 30 files, so this is one page in practice.
    do {
      const page = await env.BACKUPS.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const o of page.objects) if (!newest || o.uploaded > newest.uploaded) newest = o;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    const body: BackupStatus = newest
      ? { configured: true, latest: { key: newest.key, uploaded: newest.uploaded.getTime(), bytes: newest.size } }
      : { configured: true };
    return jsonResponse(body);
  } catch (err) {
    console.error('backup-status: failed', err);
    return jsonResponse({ error: 'Could not read the backup status' }, 500);
  }
}
