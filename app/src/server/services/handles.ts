// Profile handles (spec 057): an @handle per profile, unique ignoring case, chosen by the person in settings. A new profile's
// first handle is made from its name by the database (migration 0012: a trigger, so profiles made outside Social get one too).
// What someone types is put in canonical form before it is checked (NFKC, lower case, a leading "@" dropped), and its length is
// capped before any pattern runs. The unique index on lower(handle) has the last word on clashes.
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { profiles } from "../db/schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
/** More than this is never read: no pattern runs on unbounded input. */
const READ_MAX = 64;
const PATTERN = /^[a-z][a-z0-9_]{2,29}$/;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "help",
  "me",
  "null",
  "root",
  "sefaria",
  "settings",
  "social",
  "staff",
  "support",
  "system",
  "undefined",
]);

/** The canonical form of what someone typed: NFKC, trimmed, lower case, without a leading "@". */
export function canonicalHandle(input: string): string {
  return input.slice(0, READ_MAX).normalize("NFKC").trim().toLowerCase().replace(/^@/, "");
}

export type HandleProblem = "invalid" | "reserved";

/** Why a canonical handle cannot be used, or null when it can. */
export function handleProblem(handle: string): HandleProblem | null {
  if (!PATTERN.test(handle)) return "invalid";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/** The profile with this handle (any case), or null. */
export async function profileIdByHandle(db: Executor, handle: string): Promise<string | null> {
  const canonical = canonicalHandle(handle);
  if (handleProblem(canonical) === "invalid") return null;
  const [row] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.handle}) = ${canonical}`);
  return row?.id ?? null;
}
