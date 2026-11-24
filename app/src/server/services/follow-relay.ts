// The reader's follow-me relay (spec 032): a post that shares a follow link shows where that session is now. The server
// asks the relay's status read (`GET /status/<sessionId>`, shared secret) rather than the card opening a socket (plan 4.5),
// and keeps each answer a few seconds so a feed full of viewers asks the relay about once per session per interval. Like the
// room relay's client (relay.ts): a timeout, one retry on a network error or a 5xx, and a defined fallback; never inside a
// transaction.
import { z } from "zod";
import { refFromReaderUrl } from "../../lib/follow-link";
import { getConfig } from "../config";
import { log } from "../log/logger";

const TIMEOUT_MS = 2_000;
/** How long one status answer is reused for every viewer. Cards ask every LIVE_POLL_MS (features/post/LiveFollow.tsx). */
export const STATUS_TTL_MS = 5_000;
const MAX_CACHED = 5_000;

export interface FollowStatusDto {
  /** Someone leads the session now. */
  live: boolean;
  /** The leader's tab is hidden for a moment; the session goes on. */
  away: boolean;
  /** Where the leader is ("Exodus 3:2"); null when no one leads or the place is not a text. */
  ref: string | null;
  /** The leader's display name, when they gave one. */
  leader: string | null;
  participants: number;
}

export const ENDED: FollowStatusDto = { live: false, away: false, ref: null, leader: null, participants: 0 };

const RelayAnswer = z.object({
  live: z.boolean(),
  away: z.boolean().default(false),
  url: z.string().max(2000).nullable(),
  leader: z.string().max(80).nullable(),
  participants: z.int().nonnegative(),
});

const cache = new Map<string, { at: number; value: Promise<FollowStatusDto> }>();

/** Forget every cached answer (tests). */
export function resetFollowStatusCache(): void {
  cache.clear();
}

async function ask(sessionId: string): Promise<FollowStatusDto> {
  const { FOLLOW_RELAY_URL: base, FOLLOW_RELAY_SECRET: secret } = getConfig();
  if (!base || !secret) return ENDED; // not configured (local development without a relay): the post shows its source as it was
  const url = new URL(`status/${encodeURIComponent(sessionId)}`, base.endsWith("/") ? base : `${base}/`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
        continue;
      }
      if (!res.ok) {
        log.warn("follow_relay.status_refused", { status: res.status });
        return ENDED;
      }
      const parsed = RelayAnswer.safeParse(await res.json());
      if (!parsed.success) return ENDED;
      const { live, away, url: at, leader, participants } = parsed.data;
      if (!live) return { ...ENDED, participants };
      return { live, away, ref: refFromReaderUrl(at), leader, participants };
    } catch (e) {
      if (attempt === 1) {
        log.warn("follow_relay.status_failed", { error: e instanceof Error ? e.name : "unknown" });
        return ENDED;
      }
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 100));
    }
  }
  return ENDED;
}

/** A follow session's status, shared by every viewer for STATUS_TTL_MS; never throws. */
export function followStatus(sessionId: string, now: () => number = Date.now): Promise<FollowStatusDto> {
  const hit = cache.get(sessionId);
  if (hit && now() - hit.at < STATUS_TTL_MS) return hit.value;
  if (cache.size >= MAX_CACHED) {
    for (const [k, v] of cache) if (now() - v.at >= STATUS_TTL_MS) cache.delete(k);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  const value = ask(sessionId);
  cache.set(sessionId, { at: now(), value });
  return value;
}
