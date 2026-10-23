import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// What a database deployed today looks like: d1/schema.sql (the baseline as
// of v1.5.0) followed by every d1/migrations/*.sql in order, the same order
// `wrangler d1 migrations apply` uses.

export const APP_TABLES = ['fasts', 'fieldDefinitions', 'trackableDefinitions', 'trackableEntries', 'settings', 'syncSeq', 'devices', 'syncEvents'] as const;

const MIGRATIONS_DIR = 'd1/migrations';

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Migration file names in the order Wrangler applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function schemaStatements(): string[] {
  return [
    ...statements(readFileSync('d1/schema.sql', 'utf8')),
    ...migrationFiles().flatMap((f) => statements(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))),
  ];
}

/** Drops every app table and builds them again from the baseline plus migrations. */
export async function resetDb(db: D1Database): Promise<void> {
  for (const t of APP_TABLES) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  for (const s of schemaStatements()) await db.prepare(s).run();
}
