/**
 * The relay's internal routes, for the social server only (plan 4.5, 6.3, 6.4): the status read cards use, and the drop of a
 * deleted user. Both need `Authorization: Bearer <RELAY_INTERNAL_SECRET>`; without the secret configured they refuse everything.
 */
import { z } from "zod";

export const INTERNAL_PREFIX = "/internal/";
export const STATUS_PATH = /^\/internal\/status\/([A-Za-z0-9_-]{8,128})$/;
export const DROP_PATH = "/internal/drop-user";
/** How long a dropped user is refused: longer than a Sefaria token lives (10 min), with room for clock skew and retries. */
export const TOMBSTONE_MS = 30 * 60_000;

/** The slice a publisher adds to its stream so the relay and cards never read reader snapshots (plan 4.5). */
export const SUMMARY_SLICE = "social.summary";

export interface RoomStatus {
  ref: string | null;
  /** The ref in Hebrew, when the publisher knew it (spec 016). */
  heRef: string | null;
  title: string | null;
  participants: number;
}

export const dropUserBody = z.strictObject({
  userId: z.union([z.string().regex(/^[1-9][0-9]{0,18}$/), z.int().positive()]).transform(String),
  rooms: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)).max(1000),
});

const enc = new TextEncoder();

/** Constant-time check of the Authorization header against the configured secret. */
export function authorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("Authorization") ?? "";
  const given = enc.encode(header);
  const expected = enc.encode(`Bearer ${secret}`);
  if (given.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, expected);
}

/** The summary in a stream's snapshot slices, if it is well formed. */
export function summaryOf(
  slices: Record<string, { v: number; value: unknown }> | undefined,
): Pick<RoomStatus, "ref" | "heRef" | "title"> {
  const value = slices?.[SUMMARY_SLICE]?.value as { ref?: unknown; heRef?: unknown; title?: unknown } | undefined;
  const text = (x: unknown) => (typeof x === "string" && x.length > 0 && x.length <= 300 ? x : null);
  return { ref: text(value?.ref), heRef: text(value?.heRef), title: text(value?.title) };
}
