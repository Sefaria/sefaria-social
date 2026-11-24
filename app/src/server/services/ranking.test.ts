// Spec 031 AC-004: the For you scoring on its own — X's weighted sum, out-of-network scaling, decay with a second wind, affinity
// and author diversity. Loaded through import.meta.glob, so on a base without the module the first assertion fails.
// @feature FEED-072 For you: the timeline ranked like X's
import { describe, expect, it } from "vitest";
import type * as RankingModule from "./ranking";

const modules = import.meta.glob<typeof RankingModule>("./ranking.ts");
async function load(): Promise<typeof RankingModule> {
  expect(modules["./ranking.ts"], "services/ranking.ts exists").toBeDefined();
  return modules["./ranking.ts"]!();
}

const NOW = new Date("2026-11-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const zero = { fav: 0, repost: 0, quote: 0, reply: 0, replyEngagedByAuthor: 0, negativeFeedback: 0, report: 0 };
function cand(over: Partial<RankingModule.Candidate> & { postId: string }): RankingModule.Candidate {
  return {
    authorProfileId: over.postId,
    createdAt: hoursAgo(1),
    boostedAt: null,
    counts: { ...zero },
    audience: 10,
    inNetwork: true,
    viaNetworkRepost: false,
    affinity: 0,
    ...over,
  };
}

describe("For you scoring", () => {
  // @ac 031/AC-004
  it("uses X's published weights, with a quote between a repost and a reply", async () => {
    const { WEIGHTS, OUT_OF_NETWORK_SCALE } = await load();
    expect(WEIGHTS).toMatchObject({
      fav: 0.5,
      repost: 1,
      reply: 13.5,
      replyEngagedByAuthor: 75,
      negativeFeedback: -74,
      report: -369,
    });
    expect(WEIGHTS.quote).toBeGreaterThan(WEIGHTS.repost);
    expect(WEIGHTS.quote).toBeLessThan(WEIGHTS.reply);
    expect(OUT_OF_NETWORK_SCALE).toBe(0.75);
  });

  // @ac 031/AC-004
  it("ranks one reply above several likes, and the author answering above both", async () => {
    const { rank } = await load();
    const order = rank(
      [
        cand({ postId: "likes", counts: { ...zero, fav: 4 } }),
        cand({ postId: "reply", counts: { ...zero, reply: 1 } }),
        cand({ postId: "answered", counts: { ...zero, reply: 1, replyEngagedByAuthor: 1 } }),
        cand({ postId: "quiet" }),
      ],
      NOW,
    ).map((s) => s.postId);
    expect(order).toEqual(["answered", "reply", "likes", "quiet"]);
  });

  // @ac 031/AC-004
  it("scales an out-of-network post by 0.75 unless the network reposted it", async () => {
    const { rank } = await load();
    const [a, b, c] = ["in", "out", "via"].map((postId) =>
      cand({ postId, inNetwork: postId === "in", viaNetworkRepost: postId === "via" }),
    );
    const s = Object.fromEntries(rank([a!, b!, c!], NOW).map((x) => [x.postId, x]));
    expect(s.out!.parts.network).toBe(0.75);
    expect(s.via!.parts.network).toBe(1);
    expect(s.out!.score / s.in!.score).toBeCloseTo(0.75, 5);
  });

  // @ac 031/AC-004
  it("halves a score every 24 hours from the latest boost, and the viewer's affinity lifts an author", async () => {
    const { rank } = await load();
    const s = Object.fromEntries(
      rank(
        [
          cand({ postId: "fresh", createdAt: hoursAgo(0) }),
          cand({ postId: "day", createdAt: hoursAgo(24) }),
          cand({ postId: "boosted", createdAt: hoursAgo(48), boostedAt: hoursAgo(0) }),
          cand({ postId: "liked-author", createdAt: hoursAgo(24), affinity: 6 }),
        ],
        NOW,
      ).map((x) => [x.postId, x]),
    );
    expect(s.day!.parts.decay).toBeCloseTo(0.5, 5);
    expect(s.boosted!.parts.decay).toBeCloseTo(1, 5);
    expect(s["liked-author"]!.score).toBeGreaterThan(s.day!.score);
  });

  // @ac 031/AC-004
  it("spreads authors out: each further post by one author × 0.5, down to × 0.25", async () => {
    const { rank } = await load();
    const posts = [1, 2, 3, 4].map((i) => cand({ postId: `a${i}`, authorProfileId: "A", counts: { ...zero, reply: 2 } }));
    const ranked = rank([...posts, cand({ postId: "b", authorProfileId: "B", counts: { ...zero, reply: 1 } })], NOW);
    expect(ranked.map((s) => s.postId)[1]).toBe("b");
    expect(ranked.filter((s) => s.authorProfileId === "A").map((s) => s.parts.diversity)).toEqual([1, 0.5, 0.25, 0.25]);
  });
});
