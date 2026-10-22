// Nightly D1 backup as a restore-ready SQL file (see workers/backup/).
//
// The file replaces the contents of every app table with the rows from the
// backup. It doesn't recreate the schema: restore into a database built from
// d1/schema.sql. Each statement is on one line (newlines inside text become
// `char(10)`), so the file can be applied with
// `wrangler d1 execute <db> --remote --file=<backup>.sql`.
//
// Restored rows get a fresh serverSeq above anything devices have seen, the
// same way the duplicate cleanup worked, so every device pulls the restored
// state on its next sync. Devices then push their own local data as usual,
// and last-write-wins keeps whichever version of a record is newer.

/** Tables in restore order. `syncSeq` is handled separately. */
export const BACKUP_TABLES = ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'settings'] as const;

export interface BackupResult {
  sql: string;
  rows: Record<string, number>;
  syncSeq: number;
}

/** A SQLite literal for a D1 value: NULL, a number, or a quoted string. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot back up non-finite number ${value}`);
    return String(value);
  }
  if (typeof value === 'string') {
    const quoted = `'${value.replace(/'/g, "''")}'`;
    // Keep each statement on one line.
    return quoted.replace(/\r/g, "' || char(13) || '").replace(/\n/g, "' || char(10) || '");
  }
  throw new Error(`Cannot back up a value of type ${typeof value}`);
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Reads every app table and returns the restore SQL. */
export async function dumpDatabaseSql(db: D1Database, now: Date): Promise<BackupResult> {
  const seqRow = await db.prepare('SELECT value FROM syncSeq WHERE id = 1').first<{ value: number }>();
  const syncSeq = seqRow?.value ?? 0;

  const lines = [
    `-- ZachTrack D1 backup, ${now.toISOString()}. Restore into a database built from d1/schema.sql:`,
    '--   wrangler d1 execute <db> --remote --file=<this file>',
    '-- This replaces every row in the app tables.',
    `UPDATE syncSeq SET value = MAX(value, ${syncSeq}) + 1 WHERE id = 1;`,
  ];
  const rows: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const result = await db.prepare(`SELECT * FROM ${ident(table)} ORDER BY rowid`).all<Record<string, unknown>>();
    const records = result.results ?? [];
    rows[table] = records.length;
    lines.push(`DELETE FROM ${ident(table)};`);
    for (const record of records) {
      const columns = Object.keys(record);
      const values = columns.map((c) => (c === 'serverSeq' ? '(SELECT value FROM syncSeq WHERE id = 1)' : sqlLiteral(record[c])));
      lines.push(`INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES (${values.join(', ')});`);
    }
  }

  return { sql: `${lines.join('\n')}\n`, rows, syncSeq };
}
