// Acceptance tests for spec 005, database (L2, real Postgres). Entry-level file: it may import the route tree.
// Each test first asserts the feature's entry point exists, then loads the shared harness (test/integration/harness.ts).
// @feature OPS-005 Postgres schema, migrations and a public health check
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const migrations = import.meta.glob("./server/db/migrations/*.sql", { query: "?raw", import: "default" });
const ruleModules = import.meta.glob("./server/db/migration-rules.ts");

const TABLES = [
  "broadcasts",
  "call_removals",
  "call_status",
  "deleted_users",
  "follows",
  "live_status",
  "notifications",
  "posts",
  "profile_admins",
  "profiles",
  "reactions",
  "recording_state_chunks",
  "replies",
  "reposts",
  "room_invites",
  "room_members",
  "rooms",
  "session_recordings",
  "shiur_recordings",
  "shiurim",
  "user_display",
  "webhook_receipts",
];

describe("spec 005: database", () => {
  // @ac 005/AC-001
  it("migrations create the first tables with timezone timestamps and indexed foreign keys", async () => {
    expect(Object.keys(migrations).length, "committed migrations in app/src/server/db/migrations").toBeGreaterThan(0);
    const { harness } = await import("../../test/integration/harness");
    const h = await harness(getRouter());

    const tables = await h.sql<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    );
    expect(tables.map((t) => t.table_name)).toEqual(TABLES);

    const naive = await h.sql(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type = 'timestamp without time zone'",
    );
    expect(naive).toEqual([]);

    // Every foreign key's columns are the leading columns of some index on that table.
    const unindexed = await h.sql<{ fk: string }>(`
      select c.conname as fk
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace and n.nspname = 'public'
      where c.contype = 'f'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey
        )
      order by 1`);
    expect(unindexed).toEqual([]);
    const fks = await h.sql("select conname from pg_constraint where contype = 'f'");
    // spec 051 dropped recording_media_chunks and its foreign key; spec 056 added live_status's; spec 058 room_invites' and
    // notifications.room_id's
    expect(fks.length).toBe(22);
  });

  // @ac 005/AC-002
  it("refuses a destructive migration without a contract note and allows one with it", async () => {
    expect(Object.keys(ruleModules), "the migration check").toEqual(["./server/db/migration-rules.ts"]);
    const { checkMigrationSql, checkMigrationsDir } = (await ruleModules[
      "./server/db/migration-rules.ts"
    ]!()) as typeof import("./server/db/migration-rules");

    const destructive = 'ALTER TABLE "rooms" DROP COLUMN "title";';
    const refused = checkMigrationSql("0001_drop_title.sql", destructive);
    expect(refused.map((v) => [v.file, v.rule, v.statement])).toEqual([
      ["0001_drop_title.sql", "drop-column", 'ALTER TABLE "rooms" DROP COLUMN "title"'],
    ]);
    expect(
      checkMigrationSql("0001_drop_title.sql", `-- contract: column unused since the previous release\n${destructive}`),
    ).toEqual([]);

    const { fileURLToPath } = await import("node:url");
    expect(checkMigrationsDir(fileURLToPath(new URL("./server/db/migrations", import.meta.url)))).toEqual([]);
  });
});
