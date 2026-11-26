// Which Sefaria account has this email address (spec 059)? Social never sees addresses otherwise (the sign-in token carries
// none). A server-to-server POST to Sefaria, its body signed like Sefaria's own webhooks (HMAC-SHA256 over the raw body,
// X-Sefaria-Signature), with a 10-second limit. The address is never logged.
import { getConfig } from "../config";
import { SIGNATURE_HEADER, sign } from "../webhooks/signature";

export const LOOKUP_TIMEOUT_MS = 10_000;

/** Is the lookup configured? Without it every invited address is emailed. */
export function lookupConfigured(): boolean {
  const { SEFARIA_LOOKUP_URL, SEFARIA_LOOKUP_SECRET } = getConfig();
  return Boolean(SEFARIA_LOOKUP_URL && SEFARIA_LOOKUP_SECRET);
}

/** The Sefaria user id with this address, or null when there is none (404). Throws when Sefaria cannot be asked. */
export async function sefariaUserByEmail(email: string): Promise<number | null> {
  const { SEFARIA_LOOKUP_URL: url, SEFARIA_LOOKUP_SECRET: secret } = getConfig();
  if (!url || !secret) return null;
  const body = JSON.stringify({ email });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(secret, body) },
    body,
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`sefaria lookup answered ${res.status}`);
  const json = (await res.json().catch(() => null)) as { user_id?: unknown } | null;
  const id = json?.user_id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("sefaria lookup gave no user id");
  return id;
}
