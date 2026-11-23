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
});

export const RoomStatus = z.object({
  live: z.boolean(),
  ref: z.string().nullable(),
  heRef: z.string().nullable(),
  title: z.string().nullable(),
  participants: z.int().nonnegative(),
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
    }),
  ),
  scheduled: z.array(
    z.object({ id: z.uuid(), title: z.string(), ref: z.string().nullable(), roomId: z.uuid().nullable(), scheduledAt: Iso }),
  ),
  recent: z.array(z.object({ id: z.uuid(), title: z.string(), updatedAt: Iso })),
});

// ── Posts, replies, reactions (specs 023, 024) ────────────────────────────────────────────────────────────────────────────
export const Author = z.object({ id: z.uuid(), kind: z.enum(["person", "institution"]), name: z.string() });

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
});

export const Reply = z.object({ id: z.uuid(), body: z.string(), author: Author, createdAt: Iso, canDelete: z.boolean() });

export const Timeline = z.object({ posts: z.array(Post), nextCursor: z.string().nullable() });

export const PostWithReplies = z.object({ post: Post, replies: z.array(Reply) });

export const PostInput = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  ref: z.string().trim().max(200).optional(),
  asProfileId: z.uuid().optional(),
});

export const ReplyInput = z.strictObject({ body: z.string().trim().min(1).max(1000) });

export const ReactionState = z.object({ reacted: z.boolean(), reactionCount: z.int().nonnegative() });

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
});

export const FollowState = z.object({ following: z.boolean(), followers: z.int().nonnegative() });

const ProfileParams = z.object({ profileId: z.uuid() });
const ProfilesQuery = z.strictObject({ suggested: z.literal("1") });

// ── Notifications (spec 026) ──────────────────────────────────────────────────────────────────────────────────────────────
export const Notification = z.object({
  id: z.uuid(),
  kind: z.enum(["follow", "reply", "reaction", "post"]),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  post: z.object({ id: z.uuid(), snippet: z.string() }).nullable(),
  createdAt: Iso,
  read: z.boolean(),
});

export const NotificationList = z.object({ notifications: z.array(Notification), unread: z.int().nonnegative() });
export const UnreadCount = z.object({ unread: z.int().nonnegative() });

export const Me = z.object({ userId: z.int().positive(), name: z.string() });

export const RoomList = z.object({ rooms: z.array(Room) });

export const RoomInput = z.strictObject({ title: z.string().trim().min(1).max(120) });

const RoomParams = z.object({ roomId: z.uuid() });

export const UserDeletedEvent = z.looseObject({
  event: z.string().min(1).max(100),
  id: z.string().min(1).max(200),
  occurred_at: z.string().max(40),
  user_id: z.int().positive().optional(),
});

export const WebhookAck = z.object({ status: z.enum(["processed", "duplicate", "ignored"]) });

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

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
  summary: "Posts, newest first, 20 a page: the profiles the viewer follows and their own (tab=following), or everyone's.",
  tags: ["posts"],
  query: TimelineQuery,
  responses: { 200: { description: "A page of posts and the cursor of the next one (null on the last).", schema: Timeline } },
});

export const createPost = defineEndpoint({
  operationId: "createPost",
  method: "POST",
  path: "/api/v1/posts",
  summary: "Post a Torah thought, optionally anchored to a source, as the viewer or an institution they administer.",
  tags: ["posts"],
  body: PostInput,
  errors: [403],
  responses: { 201: { description: "The post, as the timeline shows it.", schema: Post } },
});

export const getPost = defineEndpoint({
  operationId: "getPost",
  method: "GET",
  path: "/api/v1/posts/{postId}",
  summary: "One post with its replies, oldest reply first.",
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
  summary: "Change the viewer's name or bio.",
  tags: ["profiles"],
  body: ProfileInput,
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

/** Every endpoint, in document order. The route-enumeration test checks this list against the served route tree. */
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
  getFeed,
  getTimeline,
  createPost,
  getPost,
  deletePost,
  createReply,
  deleteReply,
  addReaction,
  removeReaction,
  getMyProfile,
  updateMyProfile,
  listProfiles,
  getProfile,
  followProfile,
  unfollowProfile,
  listNotifications,
  readNotifications,
  userDeleted,
] as const;
