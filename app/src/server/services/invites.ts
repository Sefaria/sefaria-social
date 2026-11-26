// Room invitations (spec 058; spec 059 for email). A member sends up to 20 entries; each gets its own answer, in order. Rooms
// stay link-open (decision 0008): an invitation tells someone and takes them to the room, it does not admit them. A person is
// told at most once a day per room, and an inviter may send at most INVITES_PER_HOUR, counted in Postgres so every server
// replica counts the same.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getDb, type Db } from "../db/client";
import { profiles, roomInvites, roomMembers } from "../db/schema";
import { ApiError } from "../http/errors";
import { canonicalHandle, handleProblem } from "./handles";
import { notify } from "./notifications";
import { ensurePersonProfile } from "./person-profile";
import { membership } from "./rooms";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MAX_ENTRIES = 20;
export const MAX_ENTRY_LENGTH = 320;
export const INVITES_PER_HOUR = 50;
const REPEAT_HOURS = 24;

export type InviteStatus =
  | "invited"
  | "member"
  | "self"
  | "not_found"
  | "invalid"
  /** Spec 059: email invitations are not available on this server. */
  | "unavailable"
  /** Spec 059: the lookup or the email provider failed for this entry. */
  | "failed";

export interface InviteResult {
  to: string;
  status: InviteStatus;
}

export type Entry = { kind: "handle"; handle: string } | { kind: "email"; email: string } | { kind: "invalid" };

/** Is this an email address? One "@" with text on both sides, a dot after it, no spaces; the length is capped first. */
function isEmail(s: string): boolean {
  if (s.length > MAX_ENTRY_LENGTH) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@") || /\s/.test(s)) return false;
  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/** What an entry of the bar is: "@ben" or "ben" is a handle, "ben@example.org" an email, anything else invalid. */
export function classifyEntry(raw: string): Entry {
  const text = raw.slice(0, MAX_ENTRY_LENGTH).normalize("NFKC").trim();
  if (isEmail(text)) return { kind: "email", email: text.toLowerCase() };
  const handle = canonicalHandle(text);
  if (handleProblem(handle) === "invalid") return { kind: "invalid" };
  return { kind: "handle", handle };
}

/** How many invitations the inviter sent in the last hour. */
async function sentLastHour(db: Db | Tx, inviter: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roomInvites)
    .where(and(eq(roomInvites.inviterUserId, inviter), gt(roomInvites.createdAt, sql`now() - interval '1 hour'`)));
  return row?.n ?? 0;
}

const recently = sql`now() - ${sql.raw(`interval '${REPEAT_HOURS} hours'`)}`;

/** Invite a person (by user id) to the room: a room_invite notification, once a day per room and person. */
export async function invitePerson(
  tx: Tx,
  input: { roomId: string; inviter: Identity; inviterProfileId: string; invitee: number },
): Promise<void> {
  const [recent] = await tx
    .select({ id: roomInvites.id })
    .from(roomInvites)
    .where(
      and(
        eq(roomInvites.roomId, input.roomId),
        eq(roomInvites.inviteeUserId, input.invitee),
        gt(roomInvites.createdAt, recently),
      ),
    )
    .limit(1);
  await tx
    .insert(roomInvites)
    .values({ roomId: input.roomId, inviterUserId: input.inviter.userId, inviteeUserId: input.invitee });
  if (recent) return;
  await notify(tx, {
    recipients: [input.invitee],
    kind: "room_invite",
    actorProfileId: input.inviterProfileId,
    roomId: input.roomId,
    actorUserId: input.inviter.userId,
  });
}

/** Handles an email entry (spec 059); set by the email invitations module so this one does not depend on it. */
export type EmailInviter = (
  tx: Tx,
  input: { roomId: string; roomTitle: string; inviter: Identity; inviterProfileId: string; inviterName: string; email: string },
) => Promise<InviteStatus>;

let emailInviter: EmailInviter = async () => "unavailable";

export function setEmailInviter(fn: EmailInviter): void {
  emailInviter = fn;
}

/** Spec 058 AC-001..003: invite each entry to the room. */
export async function inviteToRoom(
  identity: Identity,
  roomId: string,
  to: readonly string[],
  db: Db = getDb(),
): Promise<InviteResult[]> {
  if (to.length === 0 || to.length > MAX_ENTRIES) throw new ApiError(400, "request.invalid");
  const room = await membership(db, identity, roomId);
  const entries = to.map((raw) => ({ raw, entry: classifyEntry(raw) }));
  const counted = entries.filter((e) => e.entry.kind !== "invalid").length;
  if ((await sentLastHour(db, identity.userId)) + counted > INVITES_PER_HOUR)
    throw new ApiError(429, "invite.rate_limited", { "retry-after": "3600" });

  return db.transaction(async (tx) => {
    const own = await ensurePersonProfile(tx, identity);
    const handles = [...new Set(entries.flatMap((e) => (e.entry.kind === "handle" ? [e.entry.handle] : [])))];
    const byHandle = new Map<string, number | null>();
    if (handles.length) {
      const rows = await tx
        .select({ handle: sql<string>`lower(${profiles.handle})`, userId: profiles.userId })
        .from(profiles)
        .where(inArray(sql`lower(${profiles.handle})`, handles));
      // An institution has no person to tell: it is not found as an invitee.
      for (const r of rows) byHandle.set(r.handle, r.userId);
    }
    const people = [...byHandle.values()].filter((u): u is number => u !== null);
    const members = new Set(
      people.length
        ? (
            await tx
              .select({ userId: roomMembers.userId })
              .from(roomMembers)
              .where(and(eq(roomMembers.roomId, roomId), inArray(roomMembers.userId, people)))
          ).map((r) => r.userId)
        : [],
    );
    const done = new Set<number>();
    const results: InviteResult[] = [];
    for (const { raw, entry } of entries) {
      if (entry.kind === "invalid") {
        results.push({ to: raw, status: "invalid" });
        continue;
      }
      if (entry.kind === "email") {
        const status = await emailInviter(tx, {
          roomId,
          roomTitle: room.title,
          inviter: identity,
          inviterProfileId: own.id,
          inviterName: own.name,
          email: entry.email,
        });
        results.push({ to: raw, status });
        continue;
      }
      const userId = byHandle.get(entry.handle) ?? null;
      if (userId === null) results.push({ to: raw, status: "not_found" });
      else if (userId === identity.userId) results.push({ to: raw, status: "self" });
      else if (members.has(userId)) results.push({ to: raw, status: "member" });
      else {
        if (!done.has(userId)) await invitePerson(tx, { roomId, inviter: identity, inviterProfileId: own.id, invitee: userId });
        done.add(userId);
        results.push({ to: raw, status: "invited" });
      }
    }
    return results;
  });
}
