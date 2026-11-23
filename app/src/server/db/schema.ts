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

// ── Social graph and posts (specs 023–026) ────────────────────────────────────────────────────────────────────────────────
/** A person (one per Sefaria user, created on first use) or an institution (a shul, yeshiva, community; created by staff). */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    kind: text("kind").notNull(),
    userId: userId("user_id").unique(),
    name: text("name").notNull(),
    bio: text("bio").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("profiles_kind_idx").on(t.kind)],
);

/** Who may post as, and is notified for, an institution profile. */
export const profileAdmins = pgTable(
  "profile_admins",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    userId: userId("user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.userId] }), index("profile_admins_user_idx").on(t.userId)],
);

export const follows = pgTable(
  "follows",
  {
    followerUserId: userId("follower_user_id").notNull(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerUserId, t.profileId] }), index("follows_profile_idx").on(t.profileId)],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    authorProfileId: uuid("author_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdByUserId: userId("created_by_user_id").notNull(),
    body: text("body").notNull(),
    /** A source citation ("Genesis 1:3"); never library text. */
    ref: text("ref"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorProfileId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
    index("posts_created_by_idx").on(t.createdByUserId),
  ],
);

export const replies = pgTable(
  "replies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorProfileId: uuid("author_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdByUserId: userId("created_by_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("replies_post_idx").on(t.postId, t.createdAt),
    index("replies_author_idx").on(t.authorProfileId),
    index("replies_created_by_idx").on(t.createdByUserId),
  ],
);

/** One "Yasher koach" per person per post. */
export const reactions = pgTable(
  "reactions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: userId("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] }), index("reactions_user_idx").on(t.userId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    recipientUserId: userId("recipient_user_id").notNull(),
    /** follow | reply | reaction | post */
    kind: text("kind").notNull(),
    actorProfileId: uuid("actor_profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientUserId, t.createdAt),
    index("notifications_actor_idx").on(t.actorProfileId),
    index("notifications_post_idx").on(t.postId),
  ],
);
