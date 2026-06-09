import { readdirSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { buildConfig } from '../config/index.js';

/**
 * Applies pending *.sql files from db/migrations in lexical order.
 * Tracks applied files in schema_migrations. Idempotent across runs.
 * Each file runs in its own transaction — a failing statement rolls
 * back the file and the schema_migrations insert together.
 */
async function migrate(): Promise<void> {
  const config = buildConfig();
  const sql = postgres(config.db.url, { max: 1 });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const dir = path.resolve(process.cwd(), 'db/migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [applied] = await sql<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename = ${file}
      `;
      if (applied) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      await sql.begin(async (tx) => {
        await tx.file(path.join(dir, file));
        await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
      });
      console.log(`applied ${file}`);
    }

    console.log('migrations done');
  } finally {
    await sql.end();
  }
}

migrate().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
