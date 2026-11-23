// QA seed and reset (spec 082; plan 5.5). One file per scenario under e2e/qa/seeds/; seeding twice creates nothing the second
// time (every row has a stable key and is inserted with "on conflict do nothing"); reset empties every table the schema has,
// read from Postgres itself, so a new table is covered without editing this file. Test and QA databases only.
import { z } from "zod";
import type { Pool } from "pg";
import type { Db } from "./client";
import { roomMembers, rooms, userDisplay } from "./schema";

export const Seed = z.strictObject({
  displays: z.array(z.strictObject({ userId: z.int().positive(), name: z.string() })).default([]),
  rooms: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string().min(1),
        ownerUserId: z.int().positive(),
        members: z.array(z.int().positive()).default([]),
      }),
    )
    .default([]),
});
export type Seed = z.output<typeof Seed>;

/** Insert a scenario's rows; rows that exist already are left alone. */
export async function seedScenario(db: Db, raw: unknown): Promise<void> {
  const seed = Seed.parse(raw);
  await db.transaction(async (tx) => {
    if (seed.displays.length) await tx.insert(userDisplay).values(seed.displays).onConflictDoNothing();
    if (seed.rooms.length) {
      await tx
        .insert(rooms)
        .values(seed.rooms.map(({ id, title, ownerUserId }) => ({ id, title, ownerUserId })))
        .onConflictDoNothing();
      const members = seed.rooms.flatMap((r) => [
        { roomId: r.id, userId: r.ownerUserId, role: "owner" },
        ...r.members.map((userId) => ({ roomId: r.id, userId, role: "member" })),
      ]);
      await tx.insert(roomMembers).values(members).onConflictDoNothing();
    }
  });
}

/** Every base table of the public schema, as Postgres lists them (migration bookkeeping lives in its own schema). */
export async function schemaTables(pool: Pool): Promise<string[]> {
  const r = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  return r.rows.map((x) => x.table_name);
}

/** Rows per table, for every table of the schema. */
export async function rowCounts(pool: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await schemaTables(pool)) {
    const r = await pool.query<{ n: number }>(`select count(*)::int as n from "${t.replace(/"/g, '""')}"`);
    out[t] = r.rows[0]!.n;
  }
  return out;
}

/** Empty every table of the schema; refuses a database whose name does not contain "test". */
export async function resetAll(pool: Pool): Promise<Record<string, number>> {
  const name = (await pool.query<{ db: string }>("select current_database() as db")).rows[0]!.db;
  if (!/test/i.test(name))
    throw new Error(`Refusing to reset "${name}": QA reset only touches a database whose name contains "test".`);
  const tables = await schemaTables(pool);
  if (tables.length)
    await pool.query(`truncate ${tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ")} restart identity cascade`);
  return rowCounts(pool);
}
