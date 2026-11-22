// Apply the committed SQL migrations (tests, `npm run db:migrate`, deploys). Drizzle records applied files in
// drizzle.__drizzle_migrations, outside the public schema, so it is not part of the user-data walk.
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
