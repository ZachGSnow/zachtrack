# D1 migrations

Every schema change after v1.5.0 goes here as a numbered SQL file
(`0001_short_name.sql`, `0002_...`), never as an edit to `../schema.sql`.

- `../schema.sql` is the baseline: the schema as of v1.5.0. A new database
  gets it once, then every migration.
- `npx wrangler d1 migrations apply zachtrack-db --remote` applies the ones
  a database hasn't had yet and records them in its `d1_migrations` table.
  `npm run deploy` runs it before deploying the app, so a release can't go
  out ahead of its columns.
- Keep migrations additive (`ALTER TABLE ... ADD COLUMN`, new tables and
  indexes). Devices still on the previous version keep syncing against the
  new schema until they update.
- The tests build their databases from the baseline plus every migration
  (`tests/helpers/d1.ts`), so a new file is covered by the existing sync and
  backup tests.
- A migration that adds a synced column also needs the column in the sync
  upsert and row mapping (`functions/api/sync.ts`) and in `src/lib/validate.ts`.
