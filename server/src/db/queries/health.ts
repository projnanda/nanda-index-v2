import { getSql } from '../client.js';

/**
 * Executes `SELECT 1` to verify the Postgres connection is reachable.
 * Throws a postgres error if the connection fails.
 *
 * Called only from the `/health` route — never on the read path.
 */
export async function pingDb(): Promise<void> {
  const sql = getSql();
  await sql`SELECT 1`;
}
