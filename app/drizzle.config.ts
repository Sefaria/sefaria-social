// drizzle-kit: `npm run db:generate` turns changes in the schema into a new SQL migration. It needs no database.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/src/server/db/schema.ts",
  out: "./app/src/server/db/migrations",
});
