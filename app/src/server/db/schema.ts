// The social database (plan section 6.2). Rules: every foreign key indexed, timestamps with time zone, Sefaria user ids as
// plain integers (no shared tables with Django), refs and stream pointers only, never library text. Every table that holds
// a user id is covered by the deletion in services/users.ts, and the walk-the-schema test fails if one is not.
// Changing this file: run `npm run db:generate` and commit the new migration (expand, deploy, contract; see migration-rules.ts).
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

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
    /** The shiur's owner (spec 063; the column keeps its first name: renaming it is a contract step). */
    teacherUserId: userId("teacher_user_id").notNull(),
    title: text("title").notNull(),
    /** A Sefaria ref, for example "Berakhot 2a". Never the text itself. */
    ref: text("ref"),
    /** "private" | "unlisted" | "public" (spec 063: `unlisted`, anyone with the link, is the default of the API). */
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

/**
 * A room's call as LiveKit last reported it (spec 038): from its webhooks, so cards and the lobby can say "N on a call" without
 * opening a socket. Holds no user ids.
 */
export const callStatus = pgTable("call_status", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  live: boolean("live").notNull().default(false),
  participants: integer("participants").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/**
 * What the relay last reported about a room's or broadcast's session (spec 056): the leader's ref and how many are connected,
 * for posted live cards. One row per relay room (a room's id, or `b_<broadcast id>`), deleted with its room. Holds no user ids.
 */
export const liveStatus = pgTable(
  "live_status",
  {
    relayRoom: text("relay_room").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    ref: text("ref"),
    heRef: text("he_ref"),
    title: text("title"),
    participants: integer("participants").notNull().default(0),
    /** When the relay made the report (its clock, checked to be within 5 minutes of ours). */
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("live_status_room_idx").on(t.roomId)],
);

/** A participant the room's owner removed from its call (spec 039): their call tokens are refused until `until`. */
export const callRemovals = pgTable(
  "call_removals",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: userId("user_id").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index("call_removals_user_id_idx").on(t.userId)],
);

/**
 * A room's session recorded in its owner's browser (spec 041): the reader's state track and the call's mixed media, uploaded in
 * chunks while it runs. Personal data: deleted with its owner's account (owner_user_id) and with its room. At most one per room
 * is `recording` at a time.
 */
export const sessionRecordings = pgTable(
  "session_recordings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    ownerUserId: userId("owner_user_id").notNull(),
    title: text("title"),
    /** "recording" | "ready" | "failed" */
    status: text("status").notNull().default("recording"),
    /** The media's content type, from the first chunk the recorder uploads. */
    mime: text("mime"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastUploadAt: timestamp("last_upload_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    mediaBytes: bigint("media_bytes", { mode: "number" }).notNull().default(0),
    /** Spec 051: media chunks kept in the object store (`recordings/<id>/raw/<seq>`), and the last one's SHA-256 (a retry). */
    mediaChunks: integer("media_chunks").notNull().default(0),
    lastChunkSha256: text("last_chunk_sha256"),
    /**
     * Spec 052: processing after the recording is ready — null while recording, then "queued" | "running" | "done" | "failed".
     * The row is its own job: `processAfter` is when it may run next (a running job's lease, or a retry's backoff).
     */
    processStatus: text("process_status"),
    processAttempts: integer("process_attempts").notNull().default(0),
    processAfter: timestamp("process_after", { withTimezone: true }),
    /**
     * Spec 054: the transcript — null until processing is done, then "queued" | "submitted" | "ready" | "failed" |
     * "unavailable" (no Sofer.ai key). Its own job on the same row (decision 0014): attempts, when it may run next, the
     * provider's id, and the language the leader chose (D10).
     */
    transcriptStatus: text("transcript_status"),
    transcriptLanguage: text("transcript_language").notNull().default("en"),
    transcriptAttempts: integer("transcript_attempts").notNull().default(0),
    transcriptAfter: timestamp("transcript_after", { withTimezone: true }),
    transcriptJobId: text("transcript_job_id"),
    transcriptSubmittedAt: timestamp("transcript_submitted_at", { withTimezone: true }),
    stateMessages: integer("state_messages").notNull().default(0),
    /** Spec 063: the shiur this recording belongs to, if any. */
    shiurId: uuid("shiur_id").references((): AnyPgColumn => shiurim.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("session_recordings_shiur_idx").on(t.shiurId),
    index("session_recordings_room_idx").on(t.roomId, t.createdAt),
    index("session_recordings_owner_user_id_idx").on(t.ownerUserId),
    uniqueIndex("session_recordings_one_running_idx")
      .on(t.roomId)
      .where(sql`${t.status} = 'recording'`),
    check("session_recordings_status_check", sql`${t.status} in ('recording', 'ready', 'failed')`),
    check(
      "session_recordings_process_status_check",
      sql`${t.processStatus} is null or ${t.processStatus} in ('queued', 'running', 'done', 'failed')`,
    ),
    check(
      "session_recordings_transcript_status_check",
      sql`${t.transcriptStatus} is null or ${t.transcriptStatus} in ('queued', 'submitted', 'ready', 'failed', 'unavailable')`,
    ),
    check("session_recordings_transcript_language_check", sql`${t.transcriptLanguage} in ('en', 'he', 'yi', 'fr')`),
    index("session_recordings_transcript_idx")
      .on(t.transcriptAfter)
      .where(sql`${t.transcriptStatus} in ('queued', 'submitted')`),
    index("session_recordings_process_idx")
      .on(t.processAfter)
      .where(sql`${t.processStatus} in ('queued', 'running')`),
  ],
);

/** One batch of state-stream messages (the session's StreamMessage), keyed by its first message's seq. */
export const recordingStateChunks = pgTable(
  "recording_state_chunks",
  {
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => sessionRecordings.id, { onDelete: "cascade" }),
    firstSeq: integer("first_seq").notNull(),
    lastSeq: integer("last_seq").notNull(),
    messages: jsonb("messages").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.firstSeq] })],
);

/**
 * A broadcast (spec 043): a room's owner streams their reader and call to anyone signed in who has the link, view only. At most
 * one per room is `live` at a time. Deleted with its host's account (host_user_id) and with its room.
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    hostUserId: userId("host_user_id").notNull(),
    title: text("title").notNull(),
    /** "live" | "ended" */
    status: text("status").notNull().default("live"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("broadcasts_room_idx").on(t.roomId, t.startedAt),
    index("broadcasts_host_user_id_idx").on(t.hostUserId),
    uniqueIndex("broadcasts_one_live_idx")
      .on(t.roomId)
      .where(sql`${t.status} = 'live'`),
    check("broadcasts_status_check", sql`${t.status} in ('live', 'ended')`),
  ],
);

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
    /** Spec 057: the @handle, unique ignoring case. A trigger (migration 0012) makes the first one from the name; settings change it. */
    handle: text("handle").notNull().default(""),
    /** Spec 062: the blue check, set and removed by staff (`npm run verify-profile`); needed to publish a Claude asset. */
    verified: boolean("verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Who verified it, as staff wrote it on the command line (a name, never a user id). */
    verifiedBy: text("verified_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profiles_kind_idx").on(t.kind),
    // Partial: '' is "not yet given" (the column's default, which the trigger replaces), so the index can exist before the
    // backfill and serve its lookups (migration 0012).
    uniqueIndex("profiles_handle_idx")
      .on(sql`lower(${t.handle})`)
      .where(sql`${t.handle} <> ''`),
  ],
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
    /** A quote (spec 030): the post this one quotes. Kept when the quoted post is deleted (it shows as unavailable). */
    quotedPostId: uuid("quoted_post_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    /** A card under the post: "room" | "broadcast" | "recording" (spec 055) | "asset" (a Claude asset, spec 063). */
    embedKind: text("embed_kind"),
    /** The embedded target's id. No foreign key: a target deleted later shows as unavailable. */
    embedId: uuid("embed_id"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorProfileId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
    index("posts_created_by_idx").on(t.createdByUserId),
    index("posts_quoted_idx").on(t.quotedPostId),
    index("posts_embed_idx")
      .on(t.embedId)
      .where(sql`${t.embedId} is not null`),
    check(
      "posts_embed_check",
      sql`(${t.embedKind} is null and ${t.embedId} is null) or (${t.embedKind} in ('room', 'broadcast', 'recording', 'asset') and ${t.embedId} is not null)`,
    ),
  ],
);

/** A repost (spec 030): a profile shares a post, unchanged, with its followers. One per profile per post. */
export const reposts = pgTable(
  "reposts",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdByUserId: userId("created_by_user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.profileId] }),
    index("reposts_profile_created_idx").on(t.profileId, t.createdAt),
    index("reposts_created_by_idx").on(t.createdByUserId),
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
    /** follow | reply | reaction | post | room_invite (spec 058) */
    kind: text("kind").notNull(),
    actorProfileId: uuid("actor_profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    /** Spec 058: the room a room_invite is to; the invitation goes with the room. */
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientUserId, t.createdAt),
    index("notifications_actor_idx").on(t.actorProfileId),
    index("notifications_post_idx").on(t.postId),
    index("notifications_room_idx").on(t.roomId),
  ],
);

/**
 * Spec 058: one row per invitation to a room, for the once-a-day rule and the hourly limit (in Postgres, so every server
 * replica counts the same). An invitation by email (spec 059) keeps only a keyed hash of the address, never the address, and
 * rows go after two days.
 */
export const roomInvites = pgTable(
  "room_invites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    inviterUserId: userId("inviter_user_id").notNull(),
    inviteeUserId: userId("invitee_user_id"),
    emailSha256: text("email_sha256"),
    createdAt: createdAt(),
  },
  (t) => [
    index("room_invites_inviter_idx").on(t.inviterUserId, t.createdAt),
    index("room_invites_invitee_idx").on(t.roomId, t.inviteeUserId, t.createdAt),
    // Spec 059: an address is emailed at most once a day, whatever the room.
    index("room_invites_email_idx").on(t.emailSha256, t.createdAt),
    // Rows older than the rules' windows are removed.
    index("room_invites_created_idx").on(t.createdAt),
    index("room_invites_invitee_user_idx").on(t.inviteeUserId),
    check(
      "room_invites_target_check",
      sql`(${t.inviteeUserId} is not null and ${t.emailSha256} is null) or (${t.inviteeUserId} is null and ${t.emailSha256} is not null)`,
    ),
  ],
);

// ── Claude assets (specs 060–063) ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * A Claude asset (spec 060): an interactive HTML file made in Claude, kept as immutable versions (files in the object store
 * under `assets/<id>/<sha256>.html`). Personal data: deleted with its owner's account. `hidden` is staff's takedown (spec 062).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ownerUserId: userId("owner_user_id").notNull(),
    /** From the current version's manifest. */
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    lang: text("lang"),
    /** Where it was imported from or made (shown only; never fetched again, never embedded). */
    sourceUrl: text("source_url"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => assetVersions.id, { onDelete: "set null" }),
    publishedVersionId: uuid("published_version_id").references((): AnyPgColumn => assetVersions.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    hidden: boolean("hidden").notNull().default(false),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assets_owner_user_id_idx").on(t.ownerUserId, t.createdAt),
    index("assets_current_version_idx").on(t.currentVersionId),
    index("assets_published_version_idx").on(t.publishedVersionId),
  ],
);

/** One immutable version of a Claude asset: its file's hash, size and object key, and the manifest with Sefaria's expansion. */
export const assetVersions = pgTable(
  "asset_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    assetId: uuid("asset_id")
      .notNull()
      .references((): AnyPgColumn => assets.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    bytes: integer("bytes").notNull(),
    manifest: jsonb("manifest").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("asset_versions_asset_n_idx").on(t.assetId, t.n), index("asset_versions_created_idx").on(t.createdAt)],
);

/**
 * Spec 062: the segments a published asset version covers, one row per segment, for the sidebar's read by section or segment.
 * Written only for the published version; replaced on publish, removed on unpublish. Holds no user id.
 */
export const assetRefs = pgTable(
  "asset_refs",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => assetVersions.id, { onDelete: "cascade" }),
    segmentRef: text("segment_ref").notNull(),
    sectionRef: text("section_ref").notNull(),
    /** The ref as the manifest declared it, normalized by Sefaria. */
    sourceRef: text("source_ref").notNull(),
    label: text("label"),
    /** Text order within the version. */
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.position] }),
    index("asset_refs_version_idx").on(t.versionId),
    index("asset_refs_segment_idx").on(t.segmentRef),
    index("asset_refs_section_idx").on(t.sectionRef),
  ],
);

/** Spec 063: the Claude assets of a shiur, each pinned at the version it was given with; the owner moves a pin. */
export const shiurAssets = pgTable(
  "shiur_assets",
  {
    shiurId: uuid("shiur_id")
      .notNull()
      .references(() => shiurim.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => assetVersions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.shiurId, t.assetId] }),
    index("shiur_assets_asset_idx").on(t.assetId),
    index("shiur_assets_version_idx").on(t.versionId),
  ],
);
