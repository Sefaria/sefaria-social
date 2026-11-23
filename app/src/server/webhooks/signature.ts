// Django's webhook signature (Sefaria-Project sso/user_deleted_webhook.py): X-Sefaria-Signature: sha256=<lowercase hex of
// HMAC-SHA256(key = secret as UTF-8, message = the raw body bytes)>. Checked over the raw bytes before any parsing, with a
// constant-time comparison.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-sefaria-signature";

export function sign(secret: string, rawBody: string | Uint8Array): string {
  return `sha256=${createHmac("sha256", Buffer.from(secret, "utf8")).update(rawBody).digest("hex")}`;
}

export function verifySignature(secret: string, rawBody: string | Uint8Array, header: string | null): boolean {
  if (header === null) return false;
  const match = /^sha256=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return false;
  const expected = Buffer.from(sign(secret, rawBody).slice("sha256=".length), "hex");
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
