// The relay in the Workers runtime (spec 010; L2). Runs in the `relay` Vitest project: workerd through Miniflare, real
// WebSockets, tokens signed by a per-run key and verified against its JWKS. The worker is loaded through import.meta.glob first
// so that, on a base without packages/relay, the first assertion fails (prove-red).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Support from "../test-support/relay";

const workers = import.meta.glob("./worker.ts");
const supports = import.meta.glob<typeof Support>("../test-support/relay.ts");

let support: typeof Support;
let relay: Support.Relay;

beforeAll(async () => {
  const s = await supports["../test-support/relay.ts"]?.();
  if (!s) return; // the base: every test fails on its first assertion
  support = s;
  relay = await support.startRelay();
}, 60_000);

afterAll(async () => {
  await relay?.close();
});

describe("relay", () => {
  // @feature SESS-010 Relay: one Durable Object per room in the Workers runtime
  // @ac 010/AC-001
  it("puts two sockets of one room in one Durable Object, and refuses bad paths, plain requests and foreign Origins", async () => {
    expect(Object.keys(workers), "packages/relay/src/worker.ts exists").toEqual(["./worker.ts"]);
    const { connect, join, lastParticipants } = support;
    const a = await connect(relay.mf, "/r/room-0000001");
    const b = await connect(relay.mf, "/r/room-0000001");
    expect([a.status, b.status]).toEqual([101, 101]);
    a.send(join("4242"));
    b.send(join("5151"));
    await vi.waitFor(() =>
      expect(
        lastParticipants(a)
          ?.map((p) => p.id)
          .sort(),
      ).toEqual(["4242", "5151"]),
    );
    await vi.waitFor(() =>
      expect(
        lastParticipants(b)
          ?.map((p) => p.id)
          .sort(),
      ).toEqual(["4242", "5151"]),
    );

    const badPath = await connect(relay.mf, "/r/x");
    const plain = await relay.mf.dispatchFetch("http://relay.test/r/room-0000001", { headers: { Origin: support.ORIGIN } });
    await plain.arrayBuffer();
    const foreign = await connect(relay.mf, "/r/room-0000001", {
      origin: "https://evil.example",
    });
    const noOrigin = await connect(relay.mf, "/r/room-0000001", { origin: null });
    expect([badPath.status, plain.status, foreign.status, noOrigin.status]).toEqual([404, 426, 403, 403]);
  });
});
