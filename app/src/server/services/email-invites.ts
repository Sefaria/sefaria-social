// Inviting by email (spec 059). Only when an email provider key is set; otherwise every address is "unavailable" and nothing
// is looked up. An address with a Sefaria account gets the same in-app invitation as a handle; any other gets one email with
// the room's link. Either way the answer is "invited" (the caller never learns who has an account), once a day per room and
// address, and only the address's SHA-256 is kept. Importing this module installs it in the invitations service.
import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { roomInvites } from "../db/schema";
import { log } from "../log/logger";
import { invitePerson, setEmailInviter, type EmailInviter } from "./invites";
import { emailConfigured, sendInviteEmail } from "./mailer";
import { lookupConfigured, sefariaUserByEmail } from "./sefaria-lookup";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export const inviteByEmail: EmailInviter = async (db, input) => {
  if (!emailConfigured()) return "unavailable";
  const hash = sha256(input.email);
  const [recent] = await db
    .select({ id: roomInvites.id })
    .from(roomInvites)
    .where(
      and(
        eq(roomInvites.roomId, input.roomId),
        eq(roomInvites.emailSha256, hash),
        gt(roomInvites.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(1);
  if (recent) return "invited";
  let account: number | null = null;
  try {
    if (lookupConfigured()) account = await sefariaUserByEmail(input.email);
  } catch (e) {
    log.warn("invite.lookup_failed", { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
    return "failed";
  }
  if (account !== null && account !== input.inviter.userId) {
    await db.transaction(async (tx) => {
      await invitePerson(tx, {
        roomId: input.roomId,
        inviter: input.inviter,
        inviterProfileId: input.inviterProfileId,
        invitee: account!,
      });
      await tx.insert(roomInvites).values({ roomId: input.roomId, inviterUserId: input.inviter.userId, emailSha256: hash });
    });
    return "invited";
  }
  if (account === input.inviter.userId) return "invited";
  try {
    await sendInviteEmail({
      to: input.email,
      inviterName: input.inviterName,
      roomTitle: input.roomTitle,
      roomId: input.roomId,
      lang: input.lang,
    });
  } catch (e) {
    log.warn("invite.email_failed", { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
    return "failed";
  }
  await db.insert(roomInvites).values({ roomId: input.roomId, inviterUserId: input.inviter.userId, emailSha256: hash });
  return "invited";
};

setEmailInviter(inviteByEmail);
