// Acceptance tests for spec 028 (demo content), L2 on real Postgres. The scenario file and the seed module load through
// import.meta.glob, so on a base without them the first assertion fails.
// @feature OPS-093 Demo content: a seeded community for the first visit
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import type * as SeedModule from "~/server/db/qa-seed";

const seedModules = import.meta.glob<typeof SeedModule>("./server/db/qa-seed.ts");
const seedFiles = import.meta.glob<unknown>("../../e2e/qa/seeds/*.json", { import: "default" });
const DEMO = "../../e2e/qa/seeds/demo.json";
const load = async () => (await import("../../test/integration/harness")).harness(getRouter());

async function demo() {
  expect(seedFiles[DEMO], "e2e/qa/seeds/demo.json exists").toBeDefined();
  const mod = await seedModules["./server/db/qa-seed.ts"]!();
  expect(mod.joinScenario, "qa-seed exports joinScenario").toBeTypeOf("function");
  return { mod, seed: await seedFiles[DEMO]!() };
}

describe("spec 028: demo content", () => {
  // @ac 028/AC-001
  it("seeds institutions, people, posts with sources, replies, reactions and follows, and nothing more the second time", async () => {
    const { mod, seed } = await demo();
    const h = await load();
    const { getDb } = await import("~/server/db/client");
    await mod.seedScenario(getDb(), seed);
    const once = await mod.rowCounts(h.pool);
    await mod.seedScenario(getDb(), seed);
    expect(await mod.rowCounts(h.pool)).toEqual(once);
    const [kinds] = await h.sql<{ institutions: number; people: number }>(
      "select count(*) filter (where kind = 'institution')::int as institutions, count(*) filter (where kind = 'person')::int as people from profiles",
    );
    expect(kinds!.institutions).toBeGreaterThanOrEqual(3);
    expect(kinds!.people).toBeGreaterThanOrEqual(4);
    const [p] = await h.sql<{ posts: number; anchored: number }>(
      "select count(*)::int as posts, count(ref)::int as anchored from posts",
    );
    expect(p!.posts).toBeGreaterThanOrEqual(12);
    expect(p!.anchored).toBeGreaterThanOrEqual(10);
    expect(once.replies).toBeGreaterThan(0);
    expect(once.reactions).toBeGreaterThan(0);
    expect(once.follows).toBeGreaterThan(0);
    expect(once.profile_admins).toBeGreaterThanOrEqual(3);
    // A persona who follows the institutions sees a full Following tab.
    const viewer = 910005;
    const token = await h.token(viewer, { name: "David Cohen" });
    const timeline = (await h.call("GET", "/api/v1/timeline?tab=following", { token })).json as { posts: unknown[] };
    expect(timeline.posts.length).toBeGreaterThanOrEqual(10);
  });

  // @ac 028/AC-002
  it("for a real account: it follows every demo institution and runs the first", async () => {
    const { mod, seed } = await demo();
    const h = await load();
    const { getDb } = await import("~/server/db/client");
    await mod.seedScenario(getDb(), seed);
    await mod.joinScenario(getDb(), seed, 4242);
    await mod.joinScenario(getDb(), seed, 4242);
    const [counts] = await h.sql<{ followed: number; institutions: number }>(
      "select (select count(*)::int from follows f join profiles p on p.id = f.profile_id where f.follower_user_id = 4242 and p.kind = 'institution') as followed, (select count(*)::int from profiles where kind = 'institution') as institutions",
    );
    expect(counts!.followed).toBe(counts!.institutions);
    expect(await h.sql("select count(*)::int as n from profile_admins where user_id = 4242")).toEqual([{ n: 1 }]);
    const me = (await h.call("GET", "/api/v1/profiles/me", { token: await h.token(4242, { name: "Real Reader" }) })).json as {
      administers: { name: string }[];
    };
    expect(me.administers).toHaveLength(1);
  });
});
