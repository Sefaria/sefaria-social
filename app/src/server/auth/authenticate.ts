// The `user` access check run by the endpoint wrapper for every protected route: a Bearer token, verified, whose user has
// no tombstone (a deleted account's token stays cryptographically valid until it expires; plan section 6.3).
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { deletedUsers } from "../db/schema";
import { ApiError } from "../http/errors";
import type { Identity } from "./identity";
import { verifyToken } from "./verify";

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export async function authenticate(request: Request): Promise<Identity> {
  const header = request.headers.get("authorization");
  if (header === null || header.trim() === "") throw new ApiError(401, "auth.missing_token");
  const match = BEARER.exec(header.trim());
  if (!match) throw new ApiError(401, "auth.invalid_token");
  const identity = await verifyToken(match[1]!);
  const tombstone = await getDb()
    .select({ userId: deletedUsers.userId })
    .from(deletedUsers)
    .where(eq(deletedUsers.userId, identity.userId))
    .limit(1);
  if (tombstone.length > 0) throw new ApiError(401, "auth.user_deleted");
  return identity;
}
