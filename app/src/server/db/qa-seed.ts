// QA seed and reset (spec 082; plan 5.5). One file per scenario under e2e/qa/seeds/; seeding twice creates nothing the second
// time (every row has a stable key and is inserted with "on conflict do nothing"); reset empties every table the schema has,
// read from Postgres itself, so a new table is covered without editing this file. Test and QA databases only.
import { z } from "zod";
import type { Pool } from "pg";
import type { Db } from "./client";
import { sql } from "drizzle-orm";
import {
  follows,
  notifications,
  posts,
  profileAdmins,
  profiles,
  reactions,
  replies,
  roomMembers,
  rooms,
  userDisplay,
} from "./schema";

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
  // The social graph and posts (specs 023-025, 028). Times are given as minutes before seeding, so a fresh seed looks recent.
  profiles: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(["person", "institution"]),
        userId: z.int().positive().optional(),
        name: z.string().min(1),
        bio: z.string().default(""),
        admins: z.array(z.int().positive()).default([]),
      }),
    )
    .default([]),
  follows: z.array(z.strictObject({ userId: z.int().positive(), profileId: z.uuid() })).default([]),
  posts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        authorProfileId: z.uuid(),
        createdByUserId: z.int().positive(),
        body: z.string().min(1),
        ref: z.string().optional(),
        minutesAgo: z.int().nonnegative(),
      }),
    )
    .default([]),
  replies: z
    .array(
      z.strictObject({
        id: z.uuid(),
        postId: z.uuid(),
        authorProfileId: z.uuid(),
        createdByUserId: z.int().positive(),
        body: z.string().min(1),
        minutesAgo: z.int().nonnegative(),
      }),
    )
    .default([]),
  reactions: z.array(z.strictObject({ postId: z.uuid(), userId: z.int().positive() })).default([]),
  notifications: z
    .array(
      z.strictObject({
        id: z.uuid(),
        recipientUserId: z.int().positive(),
        kind: z.enum(["follow", "reply", "reaction", "post"]),
        actorProfileId: z.uuid(),
        postId: z.uuid().optional(),
        minutesAgo: z.int().nonnegative(),
        read: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type Seed = z.output<typeof Seed>;

const ago = (minutes: number) => sql`now() - make_interval(mins => ${minutes})`;

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
    if (seed.profiles.length) {
      await tx
        .insert(profiles)
        .values(seed.profiles.map(({ id, kind, userId, name, bio }) => ({ id, kind, userId: userId ?? null, name, bio })))
        .onConflictDoNothing();
      const admins = seed.profiles.flatMap((p) => p.admins.map((userId) => ({ profileId: p.id, userId })));
      if (admins.length) await tx.insert(profileAdmins).values(admins).onConflictDoNothing();
    }
    if (seed.follows.length)
      await tx
        .insert(follows)
        .values(seed.follows.map((f) => ({ followerUserId: f.userId, profileId: f.profileId })))
        .onConflictDoNothing();
    for (const p of seed.posts)
      await tx
        .insert(posts)
        .values({
          id: p.id,
          authorProfileId: p.authorProfileId,
          createdByUserId: p.createdByUserId,
          body: p.body,
          ref: p.ref ?? null,
          createdAt: ago(p.minutesAgo),
        })
        .onConflictDoNothing();
    for (const r of seed.replies)
      await tx
        .insert(replies)
        .values({
          id: r.id,
          postId: r.postId,
          authorProfileId: r.authorProfileId,
          createdByUserId: r.createdByUserId,
          body: r.body,
          createdAt: ago(r.minutesAgo),
        })
        .onConflictDoNothing();
    if (seed.reactions.length) await tx.insert(reactions).values(seed.reactions).onConflictDoNothing();
    for (const n of seed.notifications)
      await tx
        .insert(notifications)
        .values({
          id: n.id,
          recipientUserId: n.recipientUserId,
          kind: n.kind,
          actorProfileId: n.actorProfileId,
          postId: n.postId ?? null,
          createdAt: ago(n.minutesAgo),
          readAt: n.read ? ago(Math.max(0, n.minutesAgo - 1)) : null,
        })
        .onConflictDoNothing();
  });
}

/**
 * Spec 028 AC-002: a real account joins a seeded community — it follows every institution in the scenario and administers the
 * first one, so it sees a full timeline and can post as the institution.
 */
export async function joinScenario(db: Db, raw: unknown, userId: number): Promise<void> {
  const seed = Seed.parse(raw);
  const institutions = seed.profiles.filter((p) => p.kind === "institution");
  await db.transaction(async (tx) => {
    if (institutions.length)
      await tx
        .insert(follows)
        .values(institutions.map((p) => ({ followerUserId: userId, profileId: p.id })))
        .onConflictDoNothing();
    if (institutions[0]) await tx.insert(profileAdmins).values({ profileId: institutions[0].id, userId }).onConflictDoNothing();
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
