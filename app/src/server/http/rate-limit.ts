// A fixed-window rate limit in memory (spec 033: call tokens). It guards against a runaway client, not a determined attacker
// with many accounts. It is per process: with more than one server replica each replica counts on its own, so the effective
// limit is the limit times the replica count. Move it to Postgres or Redis before the server scales out.
// Memory is bounded: at most `maxKeys` windows are held, and expired windows are swept when the map is full.

export interface RateLimitResult {
  allowed: boolean;
  /** Whole seconds until the window ends (at least 1); meaningful when not allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
  /** Forget every window (tests). */
  reset(): void;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000, now = Date.now }: RateLimitOptions): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  function sweep(t: number) {
    for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
    // Still full: drop the oldest windows (Map keeps insertion order), so a flood of new keys cannot grow memory.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        if (w) windows.delete(key);
        if (windows.size >= maxKeys) sweep(t);
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
      return { allowed: w.count <= limit, retryAfterSeconds };
    },
    reset() {
      windows.clear();
    },
  };
}
