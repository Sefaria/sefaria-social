// The room invitation email (spec 059), sent through Resend's API (POST /emails, 10-second limit). Every value from a person
// (their name, the room's title) is escaped in the HTML and plain in the text part. The address is never logged.
import { getConfig } from "../config";

export const SEND_TIMEOUT_MS = 10_000;

export function emailConfigured(): boolean {
  return Boolean(getConfig().RESEND_API_KEY);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Names and titles go into a subject line: no line breaks, a sane length. */
const oneLine = (s: string, max: number) =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);

export interface InviteEmail {
  to: string;
  inviterName: string;
  roomTitle: string;
  roomId: string;
  lang: "en" | "he";
}

export function inviteEmail(input: InviteEmail): { subject: string; text: string; html: string; link: string } {
  const { ROOM_LINK_ORIGIN } = getConfig();
  const link = `${ROOM_LINK_ORIGIN.replace(/\/+$/, "")}/social/r/${encodeURIComponent(input.roomId)}`;
  const who = oneLine(input.inviterName, 80) || (input.lang === "he" ? "מישהו" : "Someone");
  const room = oneLine(input.roomTitle, 120);
  if (input.lang === "he") {
    const subject = `${who} מזמין/ה אותך ללמוד ב־${room} בספריא`;
    const lines = [
      `${who} מזמין/ה אותך ללמוד יחד בחדר "${room}" בספריא.`,
      `להצטרפות: ${link}`,
      "קיבלת את ההודעה כי מישהו הזמין את הכתובת הזאת. לא נוצר בשבילך חשבון.",
    ];
    return {
      subject,
      text: lines.join("\n\n"),
      html: `<div dir="rtl"><p>${escapeHtml(lines[0]!)}</p><p><a href="${escapeHtml(link)}">להצטרפות לחדר</a></p><p>${escapeHtml(lines[2]!)}</p></div>`,
      link,
    };
  }
  const subject = `${who} invited you to learn in ${room} on Sefaria`;
  const lines = [
    `${who} invited you to learn together in the room "${room}" on Sefaria.`,
    `Join: ${link}`,
    "You got this email because someone invited this address. No account was made for you.",
  ];
  return {
    subject,
    text: lines.join("\n\n"),
    html: `<p>${escapeHtml(lines[0]!)}</p><p><a href="${escapeHtml(link)}">Join the room</a></p><p>${escapeHtml(lines[2]!)}</p>`,
    link,
  };
}

/** Send the invitation; throws when Resend refuses or does not answer in time. */
export async function sendInviteEmail(input: InviteEmail): Promise<void> {
  const { RESEND_API_KEY: key, RESEND_API_URL: base, INVITE_EMAIL_FROM: from } = getConfig();
  if (!key) throw new Error("email is not configured");
  const mail = inviteEmail(input);
  const res = await fetch(`${base.replace(/\/+$/, "")}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`email provider answered ${res.status}`);
}
