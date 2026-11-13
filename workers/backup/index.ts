// Scheduled Worker, every 15 minutes. At 09:00 UTC it writes a restore-ready
// SQL backup of the zachtrack D1 database to a private R2 bucket (old files
// are removed by the bucket's lifecycle rule; README.md "Backups"). Every
// other run sends the daily reminders that are due (ARCHITECTURE.md 3.73),
// so the backup, whose CPU time grows with the data, never shares a run's
// 10 ms with them. It has no fetch handler and no public URL
// (workers_dev = false in its wrangler.toml).

import { dumpDatabaseSql } from '../../server/backup';
import { sendDueReminders } from '../../server/reminders';

export interface BackupEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
  /** Key prefix inside the bucket. Defaults to `zachtrack-db/`. */
  BACKUP_PREFIX?: string;
  /** Reminders: the VAPID public key and contact (vars) and private key (a secret). Without the keys, no reminders go. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

/** The run that makes the backup: 09:00 UTC, as when the Worker ran once a day. */
export function isBackupRun(at: Date): boolean {
  return at.getUTCHours() === 9 && at.getUTCMinutes() < 15;
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
    const at = new Date(controller.scheduledTime);
    if (isBackupRun(at)) {
      const summary = await runBackup(env, at);
      console.log(`backup: wrote ${summary.key} (${summary.bytes} bytes, rows ${JSON.stringify(summary.rows)})`);
      return;
    }
    // A reminder due in the backup's slot goes in the next run, 15 minutes later.
    const run = await sendDueReminders(env, at.getTime());
    if (run.outcomes.length) console.log(`reminders: ${JSON.stringify(run.outcomes.map((o) => o.outcome))}`);
  },
} satisfies ExportedHandler<BackupEnv>;
