// `npm run db:migrate`: apply the committed SQL migrations to DATABASE_URL (local setup and before each deploy).
import { closeDb, getDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";

try {
  await runMigrations(getDb());
  console.log("db:migrate: migrations applied");
} finally {
  await closeDb();
}
