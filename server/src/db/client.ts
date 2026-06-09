import postgres from 'postgres';
import { buildConfig } from '../config/index.js';

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns the shared postgres.js client, lazily initialized on first call.
 * One connection pool per process, sized from config.db.maxConnections.
 * Columns are auto-transformed snake_case ↔ camelCase via postgres.camel,
 * so query results line up with TypeScript naming conventions.
 */
export function getSql(): ReturnType<typeof postgres> {
  if (_sql) return _sql;
  const config = buildConfig();
  _sql = postgres(config.db.url, {
    max: config.db.maxConnections,
    transform: postgres.camel,
  });
  return _sql;
}

/**
 * Closes the shared client and clears the singleton. Called during
 * graceful shutdown from server.ts (SIGTERM/SIGINT per CLAUDE.md §461).
 */
export async function closeSql(): Promise<void> {
  if (!_sql) return;
  await _sql.end();
  _sql = null;
}
