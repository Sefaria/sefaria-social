// The Postgres pool and the Drizzle handle, created on first use from DATABASE_URL (never at import).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getConfig } from "../config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Db | undefined;

/** Connect and statement limits: a query never holds a request for long, and a dead database fails fast. */
const POOL_OPTIONS = { max: 10, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000, statement_timeout: 5_000 };

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: getConfig().DATABASE_URL, ...POOL_OPTIONS });
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema });
  return db;
}

/** Close the pool (scripts and tests). The next getDb() opens a new one. */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  db = undefined;
  await p?.end();
}
