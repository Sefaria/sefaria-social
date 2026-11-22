// The social database (plan section 6.2). Rules: every foreign key indexed, timestamps with time zone, Sefaria user ids as
// plain integers (no shared tables with Django), refs and stream pointers only, never library text. Every table that holds
// a user id is covered by the deletion in services/users.ts, and the walk-the-schema test fails if one is not.
// Changing this file: run `npm run db:generate` and commit the new migration (expand, deploy, contract; see migration-rules.ts).
import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const userId = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: userId("owner_user_id").notNull(),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rooms_owner_user_id_idx").on(t.ownerUserId)],
);

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: userId("user_id").notNull(),
    /** "owner" | "member" */
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index("room_members_user_id_idx").on(t.userId)],
);

export const shiurim = pgTable(
  "shiurim",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    teacherUserId: userId("teacher_user_id").notNull(),
    title: text("title").notNull(),
    /** A Sefaria ref, for example "Berakhot 2a". Never the text itself. */
    ref: text("ref"),
    /** "private" | "public"; private by default. */
    visibility: text("visibility").notNull().default("private"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("shiurim_room_id_idx").on(t.roomId), index("shiurim_teacher_user_id_idx").on(t.teacherUserId)],
);

/** A recording is a reading history: personal data, private by default, deletable by its owner (plan 6.3). */
export const shiurRecordings = pgTable(
  "shiur_recordings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    shiurId: uuid("shiur_id")
      .notNull()
      .references(() => shiurim.id, { onDelete: "cascade" }),
    ownerUserId: userId("owner_user_id").notNull(),
    /** Pointer to the stored state stream (object storage key); the stream itself is not in Postgres. */
    storageKey: text("storage_key").notNull(),
    durationMs: integer("duration_ms"),
    visibility: text("visibility").notNull().default("private"),
    createdAt: createdAt(),
  },
  (t) => [index("shiur_recordings_shiur_id_idx").on(t.shiurId), index("shiur_recordings_owner_user_id_idx").on(t.ownerUserId)],
);

/** Display cache refreshed from token claims (`name`, `picture`). */
export const userDisplay = pgTable("user_display", {
  userId: userId("user_id").primaryKey(),
  name: text("name").notNull(),
  img: text("img"),
  updatedAt: updatedAt(),
});

/** Tombstones: the only place a deleted user's id may remain (it refuses their still-valid tokens). */
export const deletedUsers = pgTable("deleted_users", {
  userId: userId("user_id").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  eventId: text("event_id"),
});

/** Webhook idempotency: one row per event id received. Holds no personal data. */
export const webhookReceipts = pgTable("webhook_receipts", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
