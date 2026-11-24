// Unit tests for the in-memory rate limiter (spec 033, AC-006): the window, its end, keys apart, and bounded memory.
// @feature API-046 Call token endpoint for room members
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("rate limiter", () => {
  it("allows the limit within a window, refuses the next, and allows again when the window ends", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: c.now });
    expect([rl.hit("k"), rl.hit("k"), rl.hit("k")].map((r) => r.allowed)).toEqual([true, true, true]);
    c.advance(15_000);
    const refused = rl.hit("k");
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 45 });
    c.advance(44_500);
    expect(rl.hit("k")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    c.advance(500);
    expect(rl.hit("k").allowed).toBe(true);
  });

  it("counts keys apart", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock().now });
    expect([rl.hit("a").allowed, rl.hit("a").allowed, rl.hit("b").allowed]).toEqual([true, false, true]);
  });

  it("holds at most maxKeys windows, dropping expired ones first and then the oldest", () => {
    const c = clock();
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: c.now });
    rl.hit("a");
    rl.hit("b");
    c.advance(1_000); // a and b expired
    rl.hit("c");
    rl.hit("d");
    // c and d are live; a new key evicts the oldest live one (c), so c starts a fresh window
    rl.hit("e");
    expect(rl.hit("c").allowed).toBe(true);
    expect(rl.hit("e").allowed).toBe(false);
  });
});
