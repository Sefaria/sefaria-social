// Room invitations (specs 058 and 059). A member sends up to 20 entries, @handles or email addresses; each gets its own answer,
// in order. Rooms stay link-open (decision 0008): an invitation tells someone and takes them to the room, it does not admit them.
//
// Limits, all in Postgres so every server replica counts the same, and all checked and recorded under one lock per inviter, so
// requests sent at the same moment cannot each see room under a limit:
// - INVITES_PER_HOUR invitations an hour per inviter, and EMAIL_INVITES_PER_DAY by email a day;
// - a person is told once a day per room; an address is emailed once a day, whatever the room or the inviter.
//
// Email (spec 059): the answer for an address is "invited" at once, whether or not it has a Sefaria account, and nothing about
// the address reaches the answer. Looking it up on Sefaria and then telling the account in Social, or emailing the address,
// happens after the answer, so neither its time nor its failure tells the inviter who has an account. Only a keyed hash of the
// address is kept, and rows go after two days.
import { createHmac } from "node:crypto";
import { and, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { Identity } from "../auth/identity";
import { getConfig } from "../config";
import { getDb, type Db } from "../db/client";
import { profiles, roomInvites, roomMembers } from "../db/schema";
import { ApiError } from "../http/errors";
import { log } from "../log/logger";
import { canonicalHandle, handleProblem } from "./handles";
import { emailConfigured, sendInviteEmail } from "./mailer";
import { notify } from "./notifications";
import { ensurePersonProfile } from "./person-profile";
import { membership } from "./rooms";
import { lookupConfigured, sefariaUserByEmail } from "./sefaria-lookup";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MAX_ENTRIES = 20;
export const MAX_ENTRY_LENGTH = 320;
export const INVITES_PER_HOUR = 50;
export const EMAIL_INVITES_PER_DAY = 100;
const KEEP = sql`now() - interval '2 days'`;
const DAY = sql`now() - interval '24 hours'`;
const HOUR = sql`now() - interval '1 hour'`;

export type InviteStatus =
  | "invited"
  | "member"
  | "self"
  | "not_found"
  | "invalid"
  /** Spec 059: email invitations are not available on this server. */
  | "unavailable"
  /** Kept for older clients; no answer gives it now (a failure after the answer is logged). */
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

/**
 * The address's keyed hash: HMAC-SHA256 under a key only this server has (derived from the email provider's key, which exists
 * whenever email invitations do), so a list of addresses cannot be matched against the table. Rows live two days, so a key
 * change only restarts the once-a-day rule.
 */
export function emailKey(email: string): string {
  const key = `social.invite-email:${getConfig().RESEND_API_KEY ?? ""}`;
  return createHmac("sha256", key).update(email, "utf8").digest("hex");
}

async function count(tx: Tx | Db, where: SQL | undefined): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(roomInvites)
    .where(where);
  return row?.n ?? 0;
}

/** Tell a person (by user id) about the room: a room_invite notification, once a day per room and person. */
async function tellPerson(
  tx: Tx,
  input: { roomId: string; inviter: Identity; inviterProfileId: string; invitee: number; record: boolean },
): Promise<void> {
  const told = await count(
    tx,
    and(eq(roomInvites.roomId, input.roomId), eq(roomInvites.inviteeUserId, input.invitee), gt(roomInvites.createdAt, DAY)),
  );
  if (input.record || !told)
    await tx
      .insert(roomInvites)
      .values({ roomId: input.roomId, inviterUserId: input.inviter.userId, inviteeUserId: input.invitee });
  if (told) return;
  await notify(tx, {
    recipients: [input.invitee],
    kind: "room_invite",
    actorProfileId: input.inviterProfileId,
    roomId: input.roomId,
    actorUserId: input.inviter.userId,
  });
}

interface Delivery {
  email: string;
  roomId: string;
  roomTitle: string;
  inviter: Identity;
  inviterProfileId: string;
  inviterName: string;
  lang: "en" | "he";
}

/** After the answer: tell the address's Sefaria account in Social, or email the address. Failures are logged, never answered. */
export async function deliver(db: Db, d: Delivery): Promise<"told" | "emailed" | "skipped" | "failed"> {
  try {
    const account = lookupConfigured() ? await sefariaUserByEmail(d.email) : null;
    if (account !== null) {
      if (account === d.inviter.userId) return "skipped";
      const [member] = await db
        .select({ userId: roomMembers.userId })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, d.roomId), eq(roomMembers.userId, account)));
      if (member) return "skipped";
      await db.transaction((tx) =>
        tellPerson(tx, {
          roomId: d.roomId,
          inviter: d.inviter,
          inviterProfileId: d.inviterProfileId,
          invitee: account,
          record: false,
        }),
      );
      return "told";
    }
    await sendInviteEmail({ to: d.email, inviterName: d.inviterName, roomTitle: d.roomTitle, roomId: d.roomId, lang: d.lang });
    return "emailed";
  } catch (e) {
    log.warn("invite.delivery_failed", { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
    return "failed";
  }
}

/** Deliveries started by answers already sent; tests wait for them. */
const pending = new Set<Promise<unknown>>();
export async function settleDeliveries(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

/** Specs 058 and 059: invite each entry to the room. */
export async function inviteToRoom(
  identity: Identity,
  roomId: string,
  to: readonly string[],
  db: Db = getDb(),
  lang: "en" | "he" = "en",
): Promise<InviteResult[]> {
  if (to.length === 0 || to.length > MAX_ENTRIES) throw new ApiError(400, "request.invalid");
  const room = await membership(db, identity, roomId);
  const entries = to.map((raw) => ({ raw, entry: classifyEntry(raw) }));
  const emailOn = emailConfigured();
  const results: InviteResult[] = entries.map(({ raw }) => ({ to: raw, status: "invalid" }));
  const deliveries: Delivery[] = [];

  await db.transaction(async (tx) => {
    // One inviter's requests run one at a time from here: the counts below and the rows written are seen together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`social.invites:${identity.userId}`}))`);
    await tx.delete(roomInvites).where(lt(roomInvites.createdAt, KEEP));
    const handleCount = entries.filter((e) => e.entry.kind === "handle").length;
    const emailCount = emailOn ? new Set(entries.flatMap((e) => (e.entry.kind === "email" ? [e.entry.email] : []))).size : 0;
    const lastHour = await count(tx, and(eq(roomInvites.inviterUserId, identity.userId), gt(roomInvites.createdAt, HOUR)));
    const emailsToday = emailCount
      ? await count(
          tx,
          and(
            eq(roomInvites.inviterUserId, identity.userId),
            sql`${roomInvites.emailSha256} is not null`,
            gt(roomInvites.createdAt, DAY),
          ),
        )
      : 0;
    if (lastHour + handleCount + emailCount > INVITES_PER_HOUR || emailsToday + emailCount > EMAIL_INVITES_PER_DAY)
      throw new ApiError(429, "invite.rate_limited", { "retry-after": "3600" });

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
    const told = new Set<number>();
    const reserved = new Set<string>();
    for (const [i, { entry }] of entries.entries()) {
      const answer = (status: InviteStatus) => (results[i]!.status = status);
      if (entry.kind === "invalid") continue;
      if (entry.kind === "email") {
        if (!emailOn) {
          answer("unavailable");
          continue;
        }
        answer("invited");
        if (reserved.has(entry.email)) continue;
        reserved.add(entry.email);
        // Once a day per address, whoever invites it: reserved now, under a lock on the address, delivered after the answer.
        const key = emailKey(entry.email);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`social.invite-email:${key}`}))`);
        const recent = await count(tx, and(eq(roomInvites.emailSha256, key), gt(roomInvites.createdAt, DAY)));
        if (recent) continue;
        await tx.insert(roomInvites).values({ roomId, inviterUserId: identity.userId, emailSha256: key });
        deliveries.push({
          email: entry.email,
          roomId,
          roomTitle: room.title,
          inviter: identity,
          inviterProfileId: own.id,
          inviterName: own.name,
          lang,
        });
        continue;
      }
      const userId = byHandle.get(entry.handle) ?? null;
      if (userId === null) answer("not_found");
      else if (userId === identity.userId) answer("self");
      else if (members.has(userId)) answer("member");
      else {
        if (!told.has(userId))
          await tellPerson(tx, { roomId, inviter: identity, inviterProfileId: own.id, invitee: userId, record: true });
        told.add(userId);
        answer("invited");
      }
    }
  });

  for (const d of deliveries) {
    const p: Promise<unknown> = deliver(db, d).finally(() => pending.delete(p));
    pending.add(p);
  }
  return results;
}
