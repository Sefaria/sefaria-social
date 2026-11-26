// Spec 056 AC-001: the relay's report throttle (pure, with a fake clock) and its signature. Loaded through import.meta.glob so
// that, on a base without it, the first assertion fails.
// @feature API-051 Live status of posted sessions: relay reports and the public read
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Support from "../test-support/relay";
import type * as LiveReport from "./live-report";

const modules = import.meta.glob<typeof LiveReport>("./live-report.ts");
const supports = import.meta.glob<typeof Support>("../test-support/relay.ts");
const at = (ref: string | null, participants = 2) => ({ ref, heRef: ref ? `he:${ref}` : null, title: "Room", participants });

describe("the relay's live reports", () => {
  // @ac 056/AC-001
  it("reports changes at once, holds a change inside 5 seconds to their end, beats once a minute and says when the room empties", async () => {
    expect(Object.keys(modules), "packages/relay/src/live-report.ts exists").toEqual(["./live-report.ts"]);
    const { LiveReporter } = await modules["./live-report.ts"]!();
    const r = new LiveReporter();
    const sent: [number, string | null, number][] = [];
    const run = (t: number, s: ReturnType<typeof at>) => {
      const out = r.observe(s, t);
      if (out) sent.push([t, out.ref, out.participants]);
    };
    run(0, at(null, 0)); // nobody yet: nothing
    run(1_000, at("Genesis 1"));
    run(2_000, at("Genesis 2"));
    for (let t = 3_000; t <= 3_000 + 3_000; t += 1_000) run(t, at("Genesis 3")); // the room's ticks
    run(6_500, at("Genesis 3"));
    for (let t = 7_000; t <= 66_000; t += 1_000) run(t, at("Genesis 3")); // a quiet minute
    run(66_500, at("Genesis 3", 0)); // the last person leaves, inside the 5 seconds of the minute's report
    for (let t = 67_000; t <= 72_000; t += 1_000) run(t, at("Genesis 3", 0));
    for (let t = 73_000; t <= 200_000; t += 1_000) run(t, at("Genesis 3", 0)); // empty: nothing more
    expect(sent).toEqual([
      [1_000, "Genesis 1", 2],
      [6_000, "Genesis 3", 2],
      [66_000, "Genesis 3", 2],
      [71_000, "Genesis 3", 0],
    ]);
    const gaps = sent.slice(1).map(([t], i) => t - sent[i]![0]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5_000);
  });

  // @ac 056/AC-001
  it("signs a report as the server's webhook signature: sha256 and the hex HMAC of the raw body", async () => {
    expect(Object.keys(modules), "packages/relay/src/live-report.ts exists").toEqual(["./live-report.ts"]);
    const { signReport } = await modules["./live-report.ts"]!();
    const raw = JSON.stringify({ room: "r1", at: 1, ref: "Genesis 1", heRef: null, title: null, participants: 1 });
    expect(await signReport("s3cret", raw)).toBe(`sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`);
  });
});

describe("the relay sends its reports to the social server", () => {
  let support: typeof Support;
  let relay: Support.Relay;
  let server: Server;
  const received: { path: string; signature: string | undefined; raw: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        received.push({ path: req.url ?? "", signature: req.headers["x-relay-signature"] as string | undefined, raw });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    support = (await supports["../test-support/relay.ts"]!())!;
    relay = await support.startRelay({ socialServerUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  }, 60_000);

  afterAll(async () => {
    await relay?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  // @ac 056/AC-001
  it("posts the leader's ref, signed with the relay secret, when the leader publishes, and an empty report when they leave", async () => {
    expect(Object.keys(modules), "packages/relay/src/live-report.ts exists").toEqual(["./live-report.ts"]);
    const { connect, join, SECRET } = support;
    const room = "room-live-0001";
    const leader = await connect(relay.mf, `/r/${room}`, {
      protocols: ["sefaria-social.v1", `bearer.${await relay.token({ sub: "4242" })}`],
    });
    leader.send(join("4242"));
    const summary = { ref: "Genesis 1:1", heRef: "בראשית א:א", title: "Daf together" };
    leader.send({
      ch: "state",
      body: {
        type: "keyframe",
        seq: 0,
        t: 0,
        snapshot: { v: 1, url: "/Genesis.1.1", nav: null, slices: { "social.summary": { v: 1, value: summary } } },
      },
    });
    const reports = () => received.filter((r) => r.path === "/api/v1/internal/relay/live");
    const parsed = () => reports().map((r) => JSON.parse(r.raw) as { room: string; ref: string | null; participants: number });
    await vi.waitFor(() => expect(parsed().some((r) => r.ref === "Genesis 1:1")).toBe(true), { timeout: 10_000 });
    const first = reports().find((r) => (JSON.parse(r.raw) as { ref: string | null }).ref === "Genesis 1:1")!;
    expect(first.signature).toBe(`sha256=${createHmac("sha256", SECRET).update(first.raw).digest("hex")}`);
    expect(JSON.parse(first.raw)).toMatchObject({
      room,
      ref: "Genesis 1:1",
      heRef: "בראשית א:א",
      title: "Daf together",
      participants: 1,
    });

    leader.socket!.close();
    await vi.waitFor(() => expect(parsed().at(-1)).toMatchObject({ room, participants: 0 }), { timeout: 10_000 });
  }, 30_000);
});
