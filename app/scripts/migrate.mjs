// Applies the committed SQL migrations to DATABASE_URL without tsx (spec 021): the container's migrate command, run before
// each deploy (a Helm pre-upgrade Job; docs/runbooks/deploy.md). Same migrator and folder as `npm run db:migrate`.
//
//   docker run --rm -e DATABASE_URL=… <image> node app/scripts/migrate.mjs
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("x DATABASE_URL is not set. Fix: pass the database's connection string (a Secret in the cluster).");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../src/server/db/migrations", import.meta.url)) });
  console.log("migrate: migrations applied");
} finally {
  await pool.end();
}
