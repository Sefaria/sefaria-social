// Calls from the server to the relay's internal routes (plan 4.5, 6.3, 6.4; spec 011). Every call has a timeout, retries once
// on a network error or a 5xx with a short jittered pause, and has a defined fallback; none ever runs inside a transaction.
import { z } from "zod";
import { getConfig } from "../config";
import { log } from "../log/logger";

const TIMEOUT_MS = 2_000;

export interface RoomStatusDto {
  live: boolean;
  ref: string | null;
  title: string | null;
  participants: number;
}

export const OFFLINE_STATUS: RoomStatusDto = { live: false, ref: null, title: null, participants: 0 };

const RelayStatus = z.object({
  ref: z.string().max(300).nullable(),
  title: z.string().max(300).nullable(),
  participants: z.int().nonnegative(),
});

class Transient extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const { RELAY_INTERNAL_URL: base, RELAY_INTERNAL_SECRET: secret } = getConfig();
  if (!base || !secret) return null; // not configured: callers fall back
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status >= 500) throw new Transient(String(res.status));
      return res;
    } catch (e) {
      if (attempt === 1) throw e;
      if (!(e instanceof Transient) && !(e instanceof TypeError) && !(e instanceof DOMException)) throw e;
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
    }
  }
  return null;
}

/** A room's status for cards and the lobby, or the offline fallback when the relay is not configured or not answering. */
export async function relayStatus(roomId: string): Promise<RoomStatusDto> {
  try {
    const res = await call(`internal/status/${encodeURIComponent(roomId)}`);
    if (!res || !res.ok) return OFFLINE_STATUS;
    const parsed = RelayStatus.safeParse(await res.json());
    if (!parsed.success) return OFFLINE_STATUS;
    return { live: parsed.data.participants > 0, ...parsed.data };
  } catch (e) {
    log.warn("relay.status_failed", { error: e instanceof Error ? e.name : "unknown" });
    return OFFLINE_STATUS;
  }
}
