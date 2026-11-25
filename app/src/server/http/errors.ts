// API errors: a status and a stable code the client can switch on. The message is static and never echoes input.
export type ErrorCode =
  | "auth.missing_token"
  | "auth.invalid_token"
  | "auth.user_deleted"
  | "auth.unavailable"
  | "webhook.bad_signature"
  | "webhook.unavailable"
  | "request.invalid"
  | "request.too_large"
  | "request.range_not_satisfiable"
  | "recording.not_processed"
  | "request.rate_limited"
  | "method.not_allowed"
  | "room.not_found"
  | "room.forbidden"
  | "room.owner_cannot_leave"
  | "call.unavailable"
  | "call.removed"
  | "call.participant_not_found"
  | "recording.not_found"
  | "recording.forbidden"
  | "recording.unavailable"
  | "recording.already_running"
  | "recording.not_recording"
  | "recording.out_of_order"
  | "recording.too_large"
  | "broadcast.not_found"
  | "broadcast.forbidden"
  | "broadcast.already_live"
  | "broadcast.unavailable"
  | "room.relay_unavailable"
  | "post.not_found"
  | "post.forbidden"
  | "reply.not_found"
  | "reply.forbidden"
  | "profile.not_found"
  | "follow.self"
  | "internal";

const MESSAGES: Record<ErrorCode, string> = {
  "auth.missing_token": "Sign in to continue.",
  "auth.invalid_token": "The identity token is not valid.",
  "auth.user_deleted": "This account was deleted.",
  "auth.unavailable": "Identity cannot be checked right now.",
  "webhook.bad_signature": "The webhook signature is not valid.",
  "webhook.unavailable": "The webhook receiver is not configured.",
  "request.invalid": "The request does not match the API schema.",
  "request.too_large": "The request body is too large.",
  "request.range_not_satisfiable": "The requested range is outside the file.",
  "recording.not_processed": "The recording is still being processed.",
  "request.rate_limited": "Too many requests; try again shortly.",
  "method.not_allowed": "This method is not allowed on this route.",
  "room.not_found": "Room not found.",
  "room.forbidden": "Only the room's owner can do that.",
  "room.owner_cannot_leave": "The owner cannot leave their own room; delete it instead.",
  "call.unavailable": "Calls are not available right now.",
  "call.removed": "The room's owner removed you from this call. You can join again later.",
  "call.participant_not_found": "That person is not in this call.",
  "recording.not_found": "Recording not found.",
  "recording.forbidden": "Only the recording's owner or the room's owner can do that.",
  "recording.unavailable": "Recording is not available right now.",
  "recording.already_running": "This room is already being recorded.",
  "recording.not_recording": "This recording has finished.",
  "recording.out_of_order": "This upload does not continue the recording.",
  "recording.too_large": "The recording has reached its size limit.",
  "broadcast.not_found": "Broadcast not found.",
  "broadcast.forbidden": "Only the broadcast's host can do that.",
  "broadcast.already_live": "This room is already broadcasting.",
  "broadcast.unavailable": "Broadcasts are not available right now.",
  "room.relay_unavailable": "Following in rooms is not available right now.",
  "post.not_found": "Post not found.",
  "post.forbidden": "Only the post's author can do that.",
  "reply.not_found": "Reply not found.",
  "reply.forbidden": "Only the reply's author can do that.",
  "profile.not_found": "Profile not found.",
  "follow.self": "You cannot follow yourself.",
  internal: "Something went wrong.",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** Response headers for this error, for example `retry-after` on a 429. Never secrets. */
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(MESSAGES[code]);
    this.name = "ApiError";
  }
}

export const errorBody = (code: ErrorCode) => ({ error: { code, message: MESSAGES[code] } });
