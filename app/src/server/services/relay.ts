// Calls from the server to the relay's internal routes (plan 4.5, 6.3, 6.4; spec 011). Every call has a timeout, retries once
// on a network error or a 5xx with a short jittered pause, and has a defined fallback; none ever runs inside a transaction.
import { z } from "zod";
import { getConfig } from "../config";
import { log } from "../log/logger";

const TIMEOUT_MS = 2_000;

export interface RoomStatusDto {
  live: boolean;
  ref: string | null;
  /** The ref in Hebrew from the publisher's summary (spec 016); null when unknown or from a relay that predates it. */
  heRef: string | null;
  title: string | null;
  participants: number;
}

export const OFFLINE_STATUS: RoomStatusDto = { live: false, ref: null, heRef: null, title: null, participants: 0 };

const RelayStatus = z.object({
  ref: z.string().max(300).nullable(),
  heRef: z.string().max(300).nullable().default(null),
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

/**
 * Tell the relay a user's account was deleted (plan 6.3): it closes their sockets in these rooms and refuses them everywhere
 * until their tokens have expired. Never throws; a failure is logged and the caller's deletion stands.
 */
export async function dropUserFromRelay(userId: number, rooms: string[]): Promise<boolean> {
  try {
    const res = await call("internal/drop-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, rooms }),
    });
    if (res === null) return false; // no relay configured (local development)
    if (!res.ok) {
      log.error("relay.drop_failed", { status: res.status });
      return false;
    }
    return true;
  } catch (e) {
    log.error("relay.drop_failed", { error: e instanceof Error ? e.name : "unknown" });
    return false;
  }
}
