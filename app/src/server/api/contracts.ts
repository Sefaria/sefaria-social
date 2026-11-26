// The API's contracts: every endpoint the server serves, with its zod schemas (plan section 6.2). Route files bind these to
// handlers; the OpenAPI document (packages/api-client/openapi.json) and the generated client are produced from this list.
// Adding an endpoint: declare it here, add it to ENDPOINTS, bind it in its route file, then `npm run api:generate`.
import { z } from "zod";
import { defineEndpoint } from "../http/endpoint";

export const Health = z.object({
  status: z.enum(["ok", "unavailable"]),
  database: z.enum(["ok", "unavailable"]),
});

export const Room = z.object({
  id: z.uuid(),
  title: z.string(),
  ownerUserId: z.int().positive(),
  role: z.enum(["owner", "member"]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Whether this server offers calls (spec 033): LiveKit configured and CALLS_ENABLED=true. */
  calls: z.object({ available: z.boolean() }),
  /** Present, and true, only while the room is being recorded (spec 041); absent otherwise. */
  recording: z.literal(true).optional(),
  /** The room's live broadcast (spec 043), so its host can end it after a reload; absent when none is live. */
  broadcast: z.object({ id: z.uuid(), link: z.string().max(200) }).optional(),
});

/** A LiveKit token for one room's call (spec 033). The token is a bearer credential: keep it in memory only. */
export const CallToken = z.object({
  url: z.url(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
});

/** A room's call as LiveKit last reported it (spec 038). Optional in responses so older clients and fixtures still parse. */
export const CallStatus = z.object({ live: z.boolean(), participants: z.int().nonnegative() });

export const RoomStatus = z.object({
  live: z.boolean(),
  ref: z.string().nullable(),
  heRef: z.string().nullable(),
  title: z.string().nullable(),
  participants: z.int().nonnegative(),
  call: CallStatus.optional(),
  /** Present, and true, only while the room is being recorded (spec 041); absent otherwise. */
  recording: z.literal(true).optional(),
});

const Iso = z.iso.datetime({ offset: true });

export const Feed = z.object({
  live: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      ref: z.string().nullable(),
      heRef: z.string().nullable(),
      sourceTitle: z.string().nullable(),
      participants: z.int().positive(),
      call: CallStatus.optional(),
    }),
  ),
  scheduled: z.array(
    z.object({ id: z.uuid(), title: z.string(), ref: z.string().nullable(), roomId: z.uuid().nullable(), scheduledAt: Iso }),
  ),
  recent: z.array(z.object({ id: z.uuid(), title: z.string(), updatedAt: Iso, call: CallStatus.optional() })),
});

// ── Posts, replies, reactions (specs 023, 024) ────────────────────────────────────────────────────────────────────────────
export const Author = z.object({
  id: z.uuid(),
  kind: z.enum(["person", "institution"]),
  name: z.string(),
  /** Spec 057: the @handle (without the "@"). */
  handle: z.string(),
});

/** The post a quote quotes (spec 030); body, ref, author and createdAt are null when it was deleted. */
export const QuotedPost = z.object({
  id: z.uuid(),
  body: z.string().nullable(),
  ref: z.string().nullable(),
  author: Author.nullable(),
  createdAt: Iso.nullable(),
});

/** What a post may embed as a card (spec 055): a room, a broadcast or a recording, by id. */
export const EmbedKind = z.enum(["room", "broadcast", "recording"]);
export const PostEmbedInput = z.strictObject({ kind: EmbedKind, id: z.uuid() });

/** A post's card (spec 055): the target's title and its leader's name, both null when the target no longer exists. */
export const PostEmbed = z.object({
  kind: EmbedKind,
  id: z.uuid(),
  title: z.string().nullable(),
  leader: z.string().nullable(),
});

export const Post = z.object({
  id: z.uuid(),
  body: z.string(),
  ref: z.string().nullable(),
  author: Author,
  createdAt: Iso,
  replyCount: z.int().nonnegative(),
  reactionCount: z.int().nonnegative(),
  reacted: z.boolean(),
  canDelete: z.boolean(),
  repostCount: z.int().nonnegative(),
  quoteCount: z.int().nonnegative(),
  reposted: z.boolean(),
  quoted: QuotedPost.nullable(),
  repostedBy: Author.nullable(),
  /** Present only when the post embeds a room, broadcast or recording (spec 055). */
  embed: PostEmbed.optional(),
});

export const Reply = z.object({ id: z.uuid(), body: z.string(), author: Author, createdAt: Iso, canDelete: z.boolean() });

export const Timeline = z.object({ posts: z.array(Post), nextCursor: z.string().nullable() });

export const PostWithReplies = z.object({ post: Post, replies: z.array(Reply) });

export const PostInput = z
  .strictObject({
    /** May be empty only when the post embeds a card (spec 055). */
    body: z.string().trim().max(2000),
    ref: z.string().trim().max(200).optional(),
    asProfileId: z.uuid().optional(),
    /** Quote this post (spec 030). */
    quotedPostId: z.uuid().optional(),
    /** Show this room, broadcast or recording as a card (spec 055); the server checks that it exists. */
    embed: PostEmbedInput.optional(),
  })
  .refine((p) => p.body.length > 0 || p.embed !== undefined, { message: "A post needs text or a card.", path: ["body"] });

export const ReplyInput = z.strictObject({ body: z.string().trim().min(1).max(1000) });

export const ReactionState = z.object({ reacted: z.boolean(), reactionCount: z.int().nonnegative() });

export const RepostState = z.object({ reposted: z.boolean(), repostCount: z.int().nonnegative() });

const TimelineQuery = z.strictObject({
  tab: z.enum(["following", "everyone"]).default("following"),
  before: z.string().min(1).max(200).optional(),
});

const PostParams = z.object({ postId: z.uuid() });
const ReplyParams = z.object({ replyId: z.uuid() });

// ── Profiles and follows (spec 025) ───────────────────────────────────────────────────────────────────────────────────────
export const Profile = z.object({
  id: z.uuid(),
  kind: z.enum(["person", "institution"]),
  name: z.string(),
  /** Spec 057: the @handle (without the "@"), unique ignoring case. */
  handle: z.string(),
  bio: z.string(),
  followers: z.int().nonnegative(),
  following: z.int().nonnegative(),
  viewerFollows: z.boolean(),
  isOwn: z.boolean(),
  canManage: z.boolean(),
});

export const MyProfile = Profile.extend({ administers: z.array(z.object({ id: z.uuid(), name: z.string() })) });

export const ProfileWithPosts = z.object({ profile: Profile, posts: z.array(Post) });

export const ProfileList = z.object({ profiles: z.array(Profile) });

export const ProfileInput = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(300).optional(),
  /** Spec 057: checked on the server after canonical form (400 profile.handle_invalid, 409 profile.handle_taken). */
  handle: z.string().max(64).optional(),
});

export const FollowState = z.object({ following: z.boolean(), followers: z.int().nonnegative() });

const ProfileParams = z.object({ profileId: z.uuid() });
const ProfilesQuery = z.strictObject({ suggested: z.literal("1") });

// ── Notifications (spec 026) ──────────────────────────────────────────────────────────────────────────────────────────────
export const Notification = z.object({
  id: z.uuid(),
  kind: z.enum(["follow", "reply", "reaction", "post", "room_invite"]),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  post: z.object({ id: z.uuid(), snippet: z.string() }).nullable(),
  /** Spec 058: the room a room_invite is to. */
  room: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  createdAt: Iso,
  read: z.boolean(),
});

export const NotificationList = z.object({ notifications: z.array(Notification), unread: z.int().nonnegative() });
export const UnreadCount = z.object({ unread: z.int().nonnegative() });

export const Me = z.object({ userId: z.int().positive(), name: z.string() });

export const RoomList = z.object({ rooms: z.array(Room) });

export const RoomInput = z.strictObject({ title: z.string().trim().min(1).max(120) });

const RoomParams = z.object({ roomId: z.uuid() });

/** A relay ticket for an ordinary room (spec 048): a bearer credential for 10 minutes; keep it in memory. */
export const RoomTicket = z.object({
  ticket: z.string().min(1),
  role: z.enum(["owner", "member"]),
  relayRoom: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});

// ── Session recordings (spec 041) ─────────────────────────────────────────────────────────────────────────────────────────
export const Recording = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  title: z.string().nullable(),
  status: z.enum(["recording", "ready", "failed"]),
  /** The media's content type, as the recorder declared it when it started. */
  mime: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.int().nonnegative().nullable(),
  mediaBytes: z.int().nonnegative(),
  stateMessages: z.int().nonnegative(),
  owner: z.object({ userId: z.int().positive(), name: z.string().nullable() }),
  canDelete: z.boolean(),
});

export const RecordingList = z.object({ recordings: z.array(Recording) });

/** The media type the recorder produces, for example "video/webm;codecs=vp8,opus". */
const RecordingMime = z
  .string()
  .max(100)
  .regex(/^(video|audio)\/[a-z0-9.+-]+(;[ a-z0-9=,.+"-]*)?$/i);

export const RecordingStartInput = z.strictObject({
  mime: RecordingMime.optional(),
  /** Spec 054 (D10): the transcript's language, chosen by the leader; English (Hebrew words in Hebrew letters) by default. */
  transcriptLanguage: z.enum(["en", "he", "yi", "fr"]).optional(),
});

/** One message of the reader's state stream (packages/session StreamMessage); the server checks it with the session schema. */
const StreamMessageOut = z.looseObject({
  type: z.enum(["keyframe", "change"]),
  seq: z.int().nonnegative(),
  t: z.number().nonnegative(),
});

/** The reader's `Recording` v1 document: parses with packages/session's recording schema. */
export const RecordingState = z.object({
  v: z.literal(1),
  startedAt: z.string(),
  duration: z.number().nonnegative(),
  client: z.string(),
  messages: z.array(StreamMessageOut),
});

export const RecordingStateInput = z.strictObject({ messages: z.array(z.unknown()).min(1).max(2000) });

export const RecordingStateAck = z.object({ stored: z.int().positive() });

/** At most two hours. */
export const RecordingFinishInput = z.strictObject({
  durationMs: z
    .int()
    .nonnegative()
    .max(2 * 60 * 60 * 1000),
});

const RecordingParams = z.object({ recordingId: z.uuid() });

/**
 * A ready recording as anyone with its link sees it (spec 051 AC-004; docs/plans/shiur.md D2): no room, no user ids, nothing only
 * a member sees.
 */
export const Asset = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  status: z.literal("ready"),
  mime: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  durationMs: z.int().nonnegative().nullable(),
  leader: z.object({ name: z.string().nullable() }),
});

const AssetParams = z.object({ assetId: z.uuid() });

const ManifestFile = z.object({ key: z.string(), type: z.string(), bytes: z.int().nonnegative(), sha256: z.string() });
/** A processed recording's manifest (spec 052): its files, length, whether it has video, and its chapters. */
export const AssetManifest = z.object({
  v: z.literal(1),
  id: z.uuid(),
  title: z.string().nullable(),
  leader: z.object({ name: z.string().nullable() }),
  durationMs: z.int().nonnegative(),
  hasVideo: z.boolean(),
  files: z.object({ media: ManifestFile, audio: ManifestFile.nullable(), timeline: ManifestFile }),
  chapters: z.array(z.object({ t: z.int().nonnegative(), ref: z.string(), heRef: z.string().nullable() })),
  transcript: z.object({ status: z.string() }).loose(),
  processedAt: z.iso.datetime({ offset: true }),
});
const RecordingChunkParams = z.object({ recordingId: z.uuid(), seq: z.string().regex(/^(0|[1-9][0-9]{0,5})$/) });

// ── Broadcasts (spec 043) ─────────────────────────────────────────────────────────────────────────────────────────────────
export const Broadcast = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  title: z.string(),
  hostName: z.string().nullable(),
  status: z.enum(["live", "ended"]),
  startedAt: z.iso.datetime({ offset: true }),
  /** The page a viewer opens: /social/b/<id>. */
  link: z.string().regex(/^\/social\/b\/[0-9a-f-]{36}$/),
});

/** A relay ticket for the broadcast's room (`relayRoom`, b_<id>): a bearer credential for 10 minutes; keep it in memory. */
export const BroadcastTicket = z.object({
  ticket: z.string().min(1),
  role: z.enum(["host", "viewer"]),
  relayRoom: z.string().regex(/^b_[0-9a-f-]{36}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

const BroadcastParams = z.object({ broadcastId: z.uuid() });

export const UserDeletedEvent = z.looseObject({
  event: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
  occurred_at: z.string().max(40),
  user_id: z.int().positive().optional(),
});

export const WebhookAck = z.object({ status: z.enum(["processed", "duplicate", "ignored"]) });

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export const getAsset = defineEndpoint({
  operationId: "getAsset",
  method: "GET",
  path: "/api/v1/assets/{assetId}",
  summary:
    "A ready recording, for anyone who has its link, signed in or not (spec 051): title, the leader's name, length. 404 while it records, when it failed, or for an unknown id.",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404],
  responses: { 200: { description: "The asset.", schema: Asset } },
});

export const getAssetState = defineEndpoint({
  operationId: "getAssetState",
  method: "GET",
  path: "/api/v1/assets/{assetId}/state",
  summary: "A ready recording's reader timeline as a Recording v1 document, for anyone with its link (spec 051).",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404],
  responses: { 200: { description: "The reader timeline.", schema: RecordingState } },
});

export const getAssetMedia = defineEndpoint({
  operationId: "getAssetMedia",
  method: "GET",
  path: "/api/v1/assets/{assetId}/media",
  summary:
    "A ready recording's media, for anyone with its link (spec 051). Once processed (spec 052) it answers byte ranges (206); before, the raw recording whole.",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404, 416],
  responses: {
    200: { description: "The media file.", binary: true },
    206: { description: "A byte range of the processed media file.", binary: true },
  },
});

/** A shiur's transcript (spec 054): its words with their times in ms. */
export const AssetTranscript = z.object({
  v: z.literal(1),
  language: z.enum(["en", "he", "yi", "fr"]),
  text: z.string(),
  words: z.array(z.object({ w: z.string(), s: z.int().nonnegative(), e: z.int().nonnegative() })),
});

export const getAssetTranscript = defineEndpoint({
  operationId: "getAssetTranscript",
  method: "GET",
  path: "/api/v1/assets/{assetId}/transcript",
  summary:
    "A ready recording's transcript with word times, for anyone with its link (spec 054). 404 recording.no_transcript until it is ready.",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404],
  responses: { 200: { description: "The transcript.", schema: AssetTranscript } },
});

export const getAssetAudio = defineEndpoint({
  operationId: "getAssetAudio",
  method: "GET",
  path: "/api/v1/assets/{assetId}/audio",
  summary:
    "A processed recording's audio (AAC in MP4), for anyone with its link: what a transcript is made from (spec 054). Byte ranges answer 206.",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404, 416],
  responses: {
    200: { description: "The audio file.", binary: true },
    206: { description: "A byte range of the audio file.", binary: true },
  },
});

export const getAssetManifest = defineEndpoint({
  operationId: "getAssetManifest",
  method: "GET",
  path: "/api/v1/assets/{assetId}/manifest",
  summary:
    "A ready recording's manifest once it is processed (spec 052): files, length, video or not, chapters. 404 recording.not_processed until then.",
  tags: ["assets"],
  access: "public",
  params: AssetParams,
  errors: [404],
  responses: { 200: { description: "The manifest.", schema: AssetManifest } },
});

export const getHealth = defineEndpoint({
  operationId: "getHealth",
  method: "GET",
  path: "/api/v1/health",
  summary: "Database health, for load balancers. Public.",
  tags: ["ops"],
  access: "public",
  responses: {
    200: { description: "The database answers.", schema: Health },
    503: { description: "The database does not answer within 2 seconds.", schema: Health },
  },
});

export const getMe = defineEndpoint({
  operationId: "getMe",
  method: "GET",
  path: "/api/v1/me",
  summary: "Who the token says the caller is. Proves a session is authenticated (spec 082).",
  tags: ["identity"],
  responses: { 200: { description: "The caller.", schema: Me } },
});

export const listRooms = defineEndpoint({
  operationId: "listRooms",
  method: "GET",
  path: "/api/v1/rooms",
  summary: "Rooms the caller is a member of, newest first.",
  tags: ["rooms"],
  responses: { 200: { description: "The caller's rooms.", schema: RoomList } },
});

export const createRoom = defineEndpoint({
  operationId: "createRoom",
  method: "POST",
  path: "/api/v1/rooms",
  summary: "Create a room owned by the caller.",
  tags: ["rooms"],
  body: RoomInput,
  responses: { 201: { description: "The new room; the caller is its owner.", schema: Room } },
});

export const getRoom = defineEndpoint({
  operationId: "getRoom",
  method: "GET",
  path: "/api/v1/rooms/{roomId}",
  summary: "A room the caller is a member of.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room.", schema: Room } },
});

export const renameRoom = defineEndpoint({
  operationId: "renameRoom",
  method: "PATCH",
  path: "/api/v1/rooms/{roomId}",
  summary: "Rename a room. Owner only.",
  tags: ["rooms"],
  params: RoomParams,
  body: RoomInput,
  errors: [403, 404],
  responses: { 200: { description: "The renamed room.", schema: Room } },
});

export const deleteRoom = defineEndpoint({
  operationId: "deleteRoom",
  method: "DELETE",
  path: "/api/v1/rooms/{roomId}",
  summary: "Delete a room and its memberships. Owner only.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [403, 404],
  responses: { 204: { description: "Deleted." } },
});

export const joinRoom = defineEndpoint({
  operationId: "joinRoom",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/members",
  summary: "Join a room. The room id is the invitation: any signed-in user who has it may join. Idempotent.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room, with the caller's role.", schema: Room } },
});

export const leaveRoom = defineEndpoint({
  operationId: "leaveRoom",
  method: "DELETE",
  path: "/api/v1/rooms/{roomId}/members/me",
  summary: "Leave a room. The owner cannot leave (delete the room instead).",
  tags: ["rooms"],
  params: RoomParams,
  errors: [403, 404],
  responses: { 204: { description: "Left." } },
});

export const getRoomStatus = defineEndpoint({
  operationId: "getRoomStatus",
  method: "GET",
  path: "/api/v1/rooms/{roomId}/status",
  summary:
    "What a room is learning now and how many are in it, from the relay. Members only. Not live when the relay is unreachable.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room's live status.", schema: RoomStatus } },
});

export const getRoomTicket = defineEndpoint({
  operationId: "getRoomTicket",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/ticket",
  summary:
    "A 10-minute relay ticket for the room, naming the caller and their role: owner for the room's owner (who leads), member for anyone else in it. Members only; 503 room.relay_unavailable without a relay secret.",
  tags: ["rooms"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The ticket and the relay room it opens.", schema: RoomTicket } },
});

export const getCallToken = defineEndpoint({
  operationId: "getCallToken",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/call/token",
  summary:
    "A 10-minute LiveKit token to join the room's call: identity u:<user id>, this room only, publish microphone, camera and screen share. Members only.",
  tags: ["rooms", "calls"],
  params: RoomParams,
  errors: [404, 429, 503],
  responses: { 200: { description: "The LiveKit URL and a token for this room's call.", schema: CallToken } },
});

const Participant = z.string().max(100);

export const muteCallParticipant = defineEndpoint({
  operationId: "muteCallParticipant",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/call/mute",
  summary: "The room's owner mutes a participant's microphone, camera or screen share in the call (spec 039).",
  tags: ["rooms", "calls"],
  params: RoomParams,
  body: z.strictObject({ participant: Participant, source: z.enum(["microphone", "camera", "screen_share"]) }),
  errors: [403, 404, 503],
  responses: { 204: { description: "Muted." } },
});

export const removeCallParticipant = defineEndpoint({
  operationId: "removeCallParticipant",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/call/remove",
  summary:
    "The room's owner removes a participant from the call (spec 039). They stay a member; their call tokens are refused for 15 minutes.",
  tags: ["rooms", "calls"],
  params: RoomParams,
  body: z.strictObject({ participant: Participant }),
  errors: [403, 404, 503],
  responses: { 204: { description: "Removed from the call." } },
});

export const listRecordings = defineEndpoint({
  operationId: "listRecordings",
  method: "GET",
  path: "/api/v1/rooms/{roomId}/recordings",
  summary: "The room's session recordings, newest first (spec 041). Members only.",
  tags: ["rooms", "recordings"],
  params: RoomParams,
  errors: [404],
  responses: { 200: { description: "The room's recordings.", schema: RecordingList } },
});

export const startRecording = defineEndpoint({
  operationId: "startRecording",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/recordings",
  summary:
    "Start recording the room's session (spec 041). The room's owner only; one at a time (409 recording.already_running); 503 recording.unavailable when recordings are off.",
  tags: ["rooms", "recordings"],
  params: RoomParams,
  body: RecordingStartInput,
  errors: [403, 404, 409],
  responses: { 201: { description: "The new recording, status recording.", schema: Recording } },
});

export const getRecording = defineEndpoint({
  operationId: "getRecording",
  method: "GET",
  path: "/api/v1/recordings/{recordingId}",
  summary: "A recording's metadata. Members of its room only.",
  tags: ["recordings"],
  params: RecordingParams,
  errors: [404],
  responses: { 200: { description: "The recording.", schema: Recording } },
});

export const deleteRecording = defineEndpoint({
  operationId: "deleteRecording",
  method: "DELETE",
  path: "/api/v1/recordings/{recordingId}",
  summary: "Delete a recording and everything stored for it. Its recorder or the room's owner only.",
  tags: ["recordings"],
  params: RecordingParams,
  errors: [403, 404],
  responses: { 204: { description: "Deleted." } },
});

export const finishRecording = defineEndpoint({
  operationId: "finishRecording",
  method: "POST",
  path: "/api/v1/recordings/{recordingId}/finish",
  summary: "The recorder finishes the recording: ready, with the duration it measured.",
  tags: ["recordings"],
  params: RecordingParams,
  body: RecordingFinishInput,
  errors: [403, 404, 409],
  responses: { 200: { description: "The finished recording.", schema: Recording } },
});

export const getRecordingState = defineEndpoint({
  operationId: "getRecordingState",
  method: "GET",
  path: "/api/v1/recordings/{recordingId}/state",
  summary: "The recording's reader state track as a Recording v1 document (packages/session). Members of its room only.",
  tags: ["recordings"],
  params: RecordingParams,
  errors: [404],
  responses: { 200: { description: "The state track.", schema: RecordingState } },
});

export const appendRecordingState = defineEndpoint({
  operationId: "appendRecordingState",
  method: "POST",
  path: "/api/v1/recordings/{recordingId}/state",
  summary:
    "The recorder appends a batch of state messages (at most 256 KiB). Each must match the session schema and continue the stored seqs (409 recording.out_of_order).",
  tags: ["recordings"],
  params: RecordingParams,
  body: RecordingStateInput,
  maxBodyBytes: 256 * 1024,
  errors: [403, 404, 409],
  responses: { 200: { description: "Stored.", schema: RecordingStateAck } },
});

export const getRecordingMedia = defineEndpoint({
  operationId: "getRecordingMedia",
  method: "GET",
  path: "/api/v1/recordings/{recordingId}/media",
  summary:
    "The recording's media, members of its room only: once processed (spec 052) the seekable file by byte range (206); before, every chunk in order.",
  tags: ["recordings"],
  params: RecordingParams,
  errors: [404, 416],
  responses: {
    200: { description: "The media file.", binary: true },
    206: { description: "A byte range of the processed media file.", binary: true },
  },
});

export const putRecordingMedia = defineEndpoint({
  operationId: "putRecordingMedia",
  method: "PUT",
  path: "/api/v1/recordings/{recordingId}/media/{seq}",
  summary:
    "The recorder uploads media chunk seq (0, 1, 2, … in order; at most 4 MiB, 700 MiB in all). Refused after the recording finished (409 recording.not_recording).",
  tags: ["recordings"],
  params: RecordingChunkParams,
  binaryBody: { maxBytes: 4 * 1024 * 1024 },
  errors: [403, 404, 409],
  responses: { 204: { description: "Stored." } },
});

export const startBroadcast = defineEndpoint({
  operationId: "startBroadcast",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/broadcasts",
  summary:
    "Start broadcasting the room's reader and call, view only, to anyone signed in with the link (spec 043). The room's owner only; one live at a time (409 broadcast.already_live).",
  tags: ["rooms", "broadcasts"],
  params: RoomParams,
  errors: [403, 404, 409],
  responses: { 201: { description: "The new broadcast with its link.", schema: Broadcast } },
});

export const getBroadcast = defineEndpoint({
  operationId: "getBroadcast",
  method: "GET",
  path: "/api/v1/broadcasts/{broadcastId}",
  summary: "A broadcast: title, host, status and link. Anyone signed in who has the id.",
  tags: ["broadcasts"],
  params: BroadcastParams,
  errors: [404],
  responses: { 200: { description: "The broadcast.", schema: Broadcast } },
});

export const endBroadcast = defineEndpoint({
  operationId: "endBroadcast",
  method: "POST",
  path: "/api/v1/broadcasts/{broadcastId}/end",
  summary: "The host ends the broadcast.",
  tags: ["broadcasts"],
  params: BroadcastParams,
  errors: [403, 404],
  responses: { 200: { description: "The ended broadcast.", schema: Broadcast } },
});

export const getBroadcastTicket = defineEndpoint({
  operationId: "getBroadcastTicket",
  method: "POST",
  path: "/api/v1/broadcasts/{broadcastId}/ticket",
  summary:
    "A 10-minute relay ticket for the broadcast's room, naming the caller and their role (host for its host, viewer for anyone else). 404 when ended; 503 broadcast.unavailable without a relay secret.",
  tags: ["broadcasts"],
  params: BroadcastParams,
  errors: [404],
  responses: { 200: { description: "The ticket and the relay room it opens.", schema: BroadcastTicket } },
});

export const getBroadcastCallToken = defineEndpoint({
  operationId: "getBroadcastCallToken",
  method: "POST",
  path: "/api/v1/broadcasts/{broadcastId}/call/token",
  summary:
    "A 10-minute LiveKit token for the broadcast's call (bcast_<id>): the host publishes as a call owner; a viewer only subscribes, hidden, without publishing media or data.",
  tags: ["broadcasts", "calls"],
  params: BroadcastParams,
  errors: [404, 429],
  responses: { 200: { description: "The LiveKit URL and a token for the broadcast's call.", schema: CallToken } },
});

export const getFeed = defineEndpoint({
  operationId: "getFeed",
  method: "GET",
  path: "/api/v1/feed",
  summary:
    "The viewer's feed: their live rooms (with what is being learned and how many are in each), upcoming shiurim they may attend, and their other rooms. At most 20 per section.",
  tags: ["feed"],
  responses: { 200: { description: "The feed.", schema: Feed } },
});

export const getTimeline = defineEndpoint({
  operationId: "getTimeline",
  method: "GET",
  path: "/api/v1/timeline",
  summary:
    "20 posts a page. tab=following: the viewer's and the profiles they follow, posts and reposts, newest first. tab=everyone (For you): every recent post, ranked for the viewer.",
  tags: ["posts"],
  query: TimelineQuery,
  responses: { 200: { description: "A page of posts and the cursor of the next one (null on the last).", schema: Timeline } },
});

export const createPost = defineEndpoint({
  operationId: "createPost",
  method: "POST",
  path: "/api/v1/posts",
  summary:
    "Post a Torah thought, optionally anchored to a source or quoting another post, as the viewer or an institution they administer.",
  tags: ["posts"],
  body: PostInput,
  errors: [403, 404],
  responses: { 201: { description: "The post, as the timeline shows it.", schema: Post } },
});

export const getPost = defineEndpoint({
  operationId: "getPost",
  method: "GET",
  path: "/api/v1/posts/{postId}",
  summary:
    "One post with its replies: the author's first, then from profiles the viewer follows, then the rest; oldest first in each.",
  tags: ["posts"],
  params: PostParams,
  errors: [404],
  responses: { 200: { description: "The post and its replies.", schema: PostWithReplies } },
});

export const deletePost = defineEndpoint({
  operationId: "deletePost",
  method: "DELETE",
  path: "/api/v1/posts/{postId}",
  summary: "Delete a post (its author, or an administrator of its institution).",
  tags: ["posts"],
  params: PostParams,
  errors: [403, 404],
  responses: { 204: { description: "Deleted." } },
});

export const createReply = defineEndpoint({
  operationId: "createReply",
  method: "POST",
  path: "/api/v1/posts/{postId}/replies",
  summary: "Reply to a post.",
  tags: ["posts"],
  params: PostParams,
  body: ReplyInput,
  errors: [404],
  responses: { 201: { description: "The reply.", schema: Reply } },
});

export const deleteReply = defineEndpoint({
  operationId: "deleteReply",
  method: "DELETE",
  path: "/api/v1/replies/{replyId}",
  summary: "Delete one's own reply.",
  tags: ["posts"],
  params: ReplyParams,
  errors: [403, 404],
  responses: { 204: { description: "Deleted." } },
});

export const addReaction = defineEndpoint({
  operationId: "addReaction",
  method: "PUT",
  path: "/api/v1/posts/{postId}/reaction",
  summary: "Say Yasher koach to a post (idempotent).",
  tags: ["posts"],
  params: PostParams,
  errors: [404],
  responses: { 200: { description: "The viewer's reaction state and the post's count.", schema: ReactionState } },
});

export const removeReaction = defineEndpoint({
  operationId: "removeReaction",
  method: "DELETE",
  path: "/api/v1/posts/{postId}/reaction",
  summary: "Take back one's Yasher koach.",
  tags: ["posts"],
  params: PostParams,
  errors: [404],
  responses: { 200: { description: "The viewer's reaction state and the post's count.", schema: ReactionState } },
});

export const addRepost = defineEndpoint({
  operationId: "addRepost",
  method: "PUT",
  path: "/api/v1/posts/{postId}/repost",
  summary: "Repost a post to the viewer's followers (idempotent).",
  tags: ["posts"],
  params: PostParams,
  errors: [404],
  responses: { 200: { description: "The viewer's repost state and the post's count.", schema: RepostState } },
});

export const removeRepost = defineEndpoint({
  operationId: "removeRepost",
  method: "DELETE",
  path: "/api/v1/posts/{postId}/repost",
  summary: "Undo one's repost.",
  tags: ["posts"],
  params: PostParams,
  errors: [404],
  responses: { 200: { description: "The viewer's repost state and the post's count.", schema: RepostState } },
});

export const getMyProfile = defineEndpoint({
  operationId: "getMyProfile",
  method: "GET",
  path: "/api/v1/profiles/me",
  summary: "The viewer's own profile (created on first use) and the institutions they administer.",
  tags: ["profiles"],
  responses: { 200: { description: "The viewer's profile.", schema: MyProfile } },
});

export const updateMyProfile = defineEndpoint({
  operationId: "updateMyProfile",
  method: "PATCH",
  path: "/api/v1/profiles/me",
  summary: "Change the viewer's name, bio or @handle.",
  tags: ["profiles"],
  body: ProfileInput,
  errors: [400, 409],
  responses: { 200: { description: "The viewer's profile.", schema: MyProfile } },
});

export const listProfiles = defineEndpoint({
  operationId: "listProfiles",
  method: "GET",
  path: "/api/v1/profiles",
  summary: "Whom to follow: up to 6 profiles the viewer does not follow yet, institutions first.",
  tags: ["profiles"],
  query: ProfilesQuery,
  responses: { 200: { description: "Suggested profiles.", schema: ProfileList } },
});

export const getProfile = defineEndpoint({
  operationId: "getProfile",
  method: "GET",
  path: "/api/v1/profiles/{profileId}",
  summary: "A person's or an institution's profile and its latest posts.",
  tags: ["profiles"],
  params: ProfileParams,
  errors: [404],
  responses: { 200: { description: "The profile and its posts.", schema: ProfileWithPosts } },
});

const HandleParams = z.object({ handle: z.string().min(1).max(64) });

export const getProfileByHandle = defineEndpoint({
  operationId: "getProfileByHandle",
  method: "GET",
  path: "/api/v1/profiles/by-handle/{handle}",
  summary: "The profile with this @handle (any case, with or without the @) (spec 057).",
  tags: ["profiles"],
  params: HandleParams,
  errors: [404],
  responses: { 200: { description: "The profile.", schema: Profile } },
});

export const followProfile = defineEndpoint({
  operationId: "followProfile",
  method: "PUT",
  path: "/api/v1/profiles/{profileId}/follow",
  summary: "Follow a profile (idempotent).",
  tags: ["profiles"],
  params: ProfileParams,
  errors: [404],
  responses: { 200: { description: "The viewer follows it; its follower count.", schema: FollowState } },
});

export const unfollowProfile = defineEndpoint({
  operationId: "unfollowProfile",
  method: "DELETE",
  path: "/api/v1/profiles/{profileId}/follow",
  summary: "Stop following a profile.",
  tags: ["profiles"],
  params: ProfileParams,
  errors: [404],
  responses: { 200: { description: "The viewer no longer follows it; its follower count.", schema: FollowState } },
});

export const listNotifications = defineEndpoint({
  operationId: "listNotifications",
  method: "GET",
  path: "/api/v1/notifications",
  summary: "The viewer's latest 50 notifications, newest first, and how many are unread.",
  tags: ["notifications"],
  responses: { 200: { description: "Notifications.", schema: NotificationList } },
});

export const readNotifications = defineEndpoint({
  operationId: "readNotifications",
  method: "POST",
  path: "/api/v1/notifications/read",
  summary: "Mark all of the viewer's notifications read.",
  tags: ["notifications"],
  responses: { 200: { description: "Nothing left unread.", schema: UnreadCount } },
});

export const userDeleted = defineEndpoint({
  operationId: "userDeletedWebhook",
  method: "POST",
  path: "/api/v1/internal/user-deleted",
  summary: "Django's account-deletion webhook. Authenticated by X-Sefaria-Signature (HMAC-SHA256 of the raw body).",
  tags: ["internal"],
  access: "sefaria-webhook",
  body: UserDeletedEvent,
  responses: { 200: { description: "Processed, already processed, or an event type social ignores.", schema: WebhookAck } },
});

/** The fields of LiveKit's webhook event social reads (spec 038); everything else is ignored. */
export const LivekitEventBody = z.looseObject({
  event: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
  room: z
    .looseObject({
      name: z.string().max(300).optional(),
      numParticipants: z.coerce.number().int().optional(),
    })
    .optional(),
});

export const livekitWebhook = defineEndpoint({
  operationId: "livekitWebhook",
  method: "POST",
  path: "/api/v1/internal/livekit/webhook",
  summary:
    "LiveKit's webhook (spec 038): joins, leaves and finished rooms keep each room's call status. Authenticated by a LiveKit-signed Authorization header over the raw body.",
  tags: ["internal"],
  access: "livekit-webhook",
  body: LivekitEventBody,
  responses: { 200: { description: "Processed, already processed, or an event or room social ignores.", schema: WebhookAck } },
});

/** Every endpoint, in document order. The route-enumeration test checks this list against the served route tree. */
// ── Live cards (spec 056) ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The relay's report of one relay room (a room's id, or `b_<broadcast id>`): the leader's ref and how many are connected. */
export const LiveReport = z.strictObject({
  room: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  at: z.int().positive(),
  ref: z.string().max(300).nullable(),
  heRef: z.string().max(300).nullable(),
  title: z.string().max(300).nullable(),
  participants: z.int().nonnegative().max(100_000),
});

export const LiveStatus = z.object({
  id: z.uuid(),
  kind: z.enum(["room", "broadcast", "recording"]),
  /** True only for a report under 3 minutes old with people connected (and, for a broadcast, while it is live). */
  live: z.boolean(),
  ref: z.string().nullable(),
  heRef: z.string().nullable(),
  /** How many were connected at the last report (0 when not live). */
  here: z.int().nonnegative(),
  /** When the relay last reported; null when it never has. */
  updatedAt: Iso.nullable(),
});

export const MAX_LIVE_IDS = 50;
const LiveQuery = z.strictObject({
  ids: z
    .string()
    .max(MAX_LIVE_IDS * 37)
    .transform((v) => v.split(","))
    .pipe(z.array(z.uuid()).min(1).max(MAX_LIVE_IDS)),
});

export const relayLiveReport = defineEndpoint({
  operationId: "relayLiveReport",
  method: "POST",
  path: "/api/v1/internal/relay/live",
  summary:
    "The relay's report of a room's live state (spec 056): the leader's ref and how many are connected. Signed by the relay over the raw body; refused when older than 5 minutes.",
  tags: ["internal"],
  access: "relay-report",
  body: LiveReport,
  responses: { 204: { description: "Kept, or ignored (an older report, or a room that does not exist)." } },
});

export const getLiveStatus = defineEndpoint({
  operationId: "getLiveStatus",
  method: "GET",
  path: "/api/v1/live",
  summary:
    "The live state of up to 50 rooms, broadcasts or recordings, answered only for those a post embeds (others are left out). Public. Carries an ETag; If-None-Match with it answers 304.",
  tags: ["posts"],
  access: "public",
  query: LiveQuery,
  responses: {
    200: { description: "One entry per posted id asked for.", schema: z.array(LiveStatus) },
    304: { description: "Unchanged since the ETag given in If-None-Match." },
  },
});

// ── Room invitations and people search (spec 058) ───────────────────────────────────────────────────────────────────────
export const RoomInviteInput = z.strictObject({
  /** "@handle", "handle" or an email address (spec 059), up to 20. */
  to: z.array(z.string().min(1).max(320)).min(1).max(20),
  /** Spec 059: the language of an invitation email (the inviter's interface); English when absent. */
  lang: z.enum(["en", "he"]).optional(),
});

export const RoomInviteResults = z.object({
  results: z.array(
    z.object({
      to: z.string(),
      status: z.enum(["invited", "member", "self", "not_found", "invalid", "unavailable", "failed"]),
    }),
  ),
});

export const inviteToRoom = defineEndpoint({
  operationId: "inviteToRoom",
  method: "POST",
  path: "/api/v1/rooms/{roomId}/invites",
  summary:
    "Invite people to a room by @handle or email (members only): one answer per entry; a person is told once a day per room; 50 an hour per inviter.",
  tags: ["rooms"],
  params: z.object({ roomId: z.uuid() }),
  body: RoomInviteInput,
  errors: [400, 404, 429],
  responses: { 200: { description: "What happened to each entry, in order.", schema: RoomInviteResults } },
});

export const Person = z.object({
  id: z.uuid(),
  handle: z.string(),
  name: z.string(),
  kind: z.literal("person"),
});

export const searchPeople = defineEndpoint({
  operationId: "searchPeople",
  method: "GET",
  path: "/api/v1/people",
  summary: "Up to 8 people whose @handle starts with q (a leading @ ignored) or whose name contains it, handles first.",
  tags: ["profiles"],
  query: z.object({ q: z.string().min(1).max(30) }),
  errors: [429],
  responses: { 200: { description: "Matching people, public fields only.", schema: z.object({ people: z.array(Person) }) } },
});

export const ENDPOINTS = [
  getHealth,
  getMe,
  listRooms,
  createRoom,
  getRoom,
  renameRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  getRoomStatus,
  getRoomTicket,
  getCallToken,
  muteCallParticipant,
  removeCallParticipant,
  listRecordings,
  startRecording,
  getRecording,
  deleteRecording,
  finishRecording,
  getRecordingState,
  getAsset,
  getAssetState,
  getAssetMedia,
  getAssetManifest,
  getAssetTranscript,
  getAssetAudio,
  appendRecordingState,
  getRecordingMedia,
  putRecordingMedia,
  startBroadcast,
  getBroadcast,
  endBroadcast,
  getBroadcastTicket,
  getBroadcastCallToken,
  getFeed,
  getTimeline,
  createPost,
  getPost,
  deletePost,
  createReply,
  deleteReply,
  addReaction,
  removeReaction,
  addRepost,
  removeRepost,
  getMyProfile,
  updateMyProfile,
  listProfiles,
  getProfile,
  getProfileByHandle,
  inviteToRoom,
  searchPeople,
  followProfile,
  unfollowProfile,
  listNotifications,
  readNotifications,
  userDeleted,
  livekitWebhook,
  relayLiveReport,
  getLiveStatus,
] as const;
