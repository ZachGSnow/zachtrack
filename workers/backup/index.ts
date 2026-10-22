// Scheduled Worker: writes a restore-ready SQL backup of the zachtrack D1
// database to a private R2 bucket every night. It has no fetch handler and no
// public URL (workers_dev = false in its wrangler.toml). Old files are removed
// by the bucket's lifecycle rule. See README.md "Backups".

import { dumpDatabaseSql } from '../../server/backup';

export interface BackupEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
  /** Key prefix inside the bucket. Defaults to `zachtrack-db/`. */
  BACKUP_PREFIX?: string;
}

export interface BackupSummary {
  key: string;
  bytes: number;
  rows: Record<string, number>;
}

export async function runBackup(env: BackupEnv, now: Date): Promise<BackupSummary> {
  const { sql, rows, syncSeq } = await dumpDatabaseSql(env.DB, now);
  const key = `${env.BACKUP_PREFIX ?? 'zachtrack-db/'}${now.toISOString().slice(0, 10)}.sql`;
  const body = new TextEncoder().encode(sql);
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: 'application/sql; charset=utf-8' },
    customMetadata: { createdAt: now.toISOString(), syncSeq: String(syncSeq), rows: JSON.stringify(rows) },
  });
  return { key, bytes: body.byteLength, rows };
}

export default {
  async scheduled(controller, env) {
    // Let a failure throw: the cron run is then marked failed in the
    // Worker's dashboard and logs.
    const summary = await runBackup(env, new Date(controller.scheduledTime));
    console.log(`backup: wrote ${summary.key} (${summary.bytes} bytes, rows ${JSON.stringify(summary.rows)})`);
  },
} satisfies ExportedHandler<BackupEnv>;
