// People search (spec 058 AC-004): for the invite bar's suggestions. Person profiles whose handle starts with the text (a
// leading "@" ignored) or whose name contains it; handles first. Only public fields are answered: id, handle, name, kind.
import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { profiles } from "../db/schema";
import { ApiError } from "../http/errors";
import { createRateLimiter } from "../http/rate-limit";

export const PEOPLE_LIMIT = 8;
export const QUERY_MAX = 30;
/** Suggestions are asked as someone types; this is far above typing, and keeps a script from listing everyone fast. */
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export interface PersonDto {
  id: string;
  handle: string;
  name: string;
  kind: "person";
}

/** `%`, `_` and `\` taken literally in a LIKE pattern. */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchPeople(identity: Identity, q: string, db: Db = getDb()): Promise<PersonDto[]> {
  const limit = limiter.hit(`people:${identity.userId}`);
  if (!limit.allowed) throw new ApiError(429, "request.rate_limited", { "retry-after": String(limit.retryAfterSeconds) });
  const text = q.slice(0, QUERY_MAX).normalize("NFKC").trim();
  const handlePart = text.toLowerCase().replace(/^@/, "");
  const namePart = text.replace(/^@/, "");
  if (!handlePart && !namePart) return [];
  const startsHandle = sql`lower(${profiles.handle}) like ${`${literal(handlePart)}%`}`;
  const rows = await db
    .select({ id: profiles.id, handle: profiles.handle, name: profiles.name })
    .from(profiles)
    .where(and(eq(profiles.kind, "person"), or(startsHandle, ilike(profiles.name, `%${literal(namePart)}%`))))
    .orderBy(sql`case when ${startsHandle} then 0 else 1 end`, profiles.handle)
    .limit(PEOPLE_LIMIT);
  return rows.map((r) => ({ id: r.id, handle: r.handle, name: r.name, kind: "person" as const }));
}
