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
  | "method.not_allowed"
  | "room.not_found"
  | "room.forbidden"
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
  "method.not_allowed": "This method is not allowed on this route.",
  "room.not_found": "Room not found.",
  "room.forbidden": "Only the room's owner can do that.",
  internal: "Something went wrong.",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(MESSAGES[code]);
    this.name = "ApiError";
  }
}

export const errorBody = (code: ErrorCode) => ({ error: { code, message: MESSAGES[code] } });
