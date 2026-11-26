// Acceptance tests for spec 059 (inviting by email), L2: real Postgres through the route tree, a fake Sefaria lookup and a fake
// Resend on local ports, each answering as the real one documents. Deliveries run after the answer; the tests wait for them with
// settleDeliveries. Each test first asserts the delivery step exists, so on a base without it the test fails there.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getRouter } from "~/router";

const invitesModule = import.meta.glob<{ settleDeliveries?: () => Promise<void> }>("./server/services/invites.ts");
const settle = async () => {
  const mod = await invitesModule["./server/services/invites.ts"]?.();
  expect(mod?.settleDeliveries, "deliveries after the answer").toBeTypeOf("function");
  await mod!.settleDeliveries!();
};

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());
type H = Awaited<ReturnType<typeof load>>;
type Results = { results: { to: string; status: string }[] };
type Notification = { kind: string; room: { id: string } | null };

let nextUser = 959_000 + Math.floor(Math.random() * 1000) * 20;
const fresh = () => `t${randomBytes(4).toString("hex")}`;
const LOOKUP_SECRET = "test-lookup-secret";

const bodyOf = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });

/** Sefaria's lookup (checks the signature like Django does) and Resend's POST /emails. */
async function fakes(accounts: Record<string, number>, opts: { failEmailTo?: string; slowMs?: number } = {}) {
  const lookups: { email: string; signed: boolean }[] = [];
  const emails: { from: string; to: string[]; subject: string; text: string; html: string }[] = [];
  const server = createServer((req, res) => {
    void bodyOf(req).then(async (raw) => {
      if (req.url === "/api/social/user-lookup") {
        const sig = `sha256=${createHmac("sha256", LOOKUP_SECRET).update(raw).digest("hex")}`;
        const signed = req.headers["x-sefaria-signature"] === sig;
        const email = (JSON.parse(raw) as { email: string }).email;
        lookups.push({ email, signed });
        if (!signed) return res.writeHead(401).end();
        const id = accounts[email];
        if (id === undefined) return res.writeHead(404, { "content-type": "application/json" }).end("{}");
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ user_id: id }));
      }
      if (req.url === "/emails" && req.method === "POST") {
        if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
        const mail = JSON.parse(raw) as (typeof emails)[number];
        if (req.headers.authorization !== "Bearer test-resend-key") return res.writeHead(401).end();
        if (opts.failEmailTo && mail.to.includes(opts.failEmailTo)) return res.writeHead(500).end();
        emails.push(mail);
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "email-1" }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, lookups, emails, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(
  opts: { email?: boolean; lookup?: boolean; accounts?: Record<string, number>; failEmailTo?: string; slowMs?: number } = {},
) {
  const h = await load();
  const f = await fakes(opts.accounts ?? {}, { failEmailTo: opts.failEmailTo, slowMs: opts.slowMs });
  const env: Record<string, string> = {
    ROOM_LINK_ORIGIN: "https://www.sefaria.test",
    ...(opts.email !== false ? { RESEND_API_KEY: "test-resend-key", RESEND_API_URL: f.origin } : {}),
    ...(opts.lookup !== false
      ? { SEFARIA_LOOKUP_URL: `${f.origin}/api/social/user-lookup`, SEFARIA_LOOKUP_SECRET: LOOKUP_SECRET }
      : {}),
  };
  Object.assign(process.env, env);
  const { resetConfig } = await import("~/server/config");
  resetConfig();
  cleanup = async () => {
    for (const k of Object.keys(env)) delete process.env[k];
    resetConfig();
    await f.close();
  };
  const rachelId = nextUser++;
  const rachel = await h.token(rachelId, { name: "Rachel <b>Cohen</b>" });
  const room = (await h.call("POST", "/api/v1/rooms", { token: rachel, body: { title: `Daf "Yomi" & more ${fresh()}` } }))
    .json as {
    id: string;
    title: string;
  };
  const invite = async (to: string[], lang?: "en" | "he") =>
    (await h.call("POST", `/api/v1/rooms/${room.id}/invites`, { token: rachel, body: { to, ...(lang ? { lang } : {}) } }))
      .json as Results;
  const otherRoom = (
    (await h.call("POST", "/api/v1/rooms", { token: rachel, body: { title: `Second room ${fresh()}` } })).json as { id: string }
  ).id;
  const inviteTo = async (roomId: string, to: string[]) =>
    (await h.call("POST", `/api/v1/rooms/${roomId}/invites`, { token: rachel, body: { to } })).json as Results;
  return { h, f, rachel, rachelId, room, otherRoom, invite, inviteTo };
}

const activity = async (h: H, token: string) =>
  ((await h.call("GET", "/api/v1/notifications", { token })).json as { notifications: Notification[] }).notifications;

describe("spec 059: inviting by email", () => {
  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-001
  it("tells an active Sefaria account found by its address in Social, after the answer, and sends no email", async () => {
    const benId = nextUser++;
    const w = fresh();
    const { h, f, room, invite } = await setup({ accounts: { [`ben_${w}@example.org`]: benId } });
    const ben = await h.token(benId, { name: "Ben" });
    const res = await invite([`Ben_${w}@Example.org`]);
    expect(res.results).toEqual([{ to: `Ben_${w}@Example.org`, status: "invited" }]);
    await settle();
    expect(f.lookups).toEqual([{ email: `ben_${w}@example.org`, signed: true }]);
    expect(f.emails).toEqual([]);
    expect((await activity(h, ben)).filter((n) => n.kind === "room_invite").map((n) => n.room?.id)).toEqual([room.id]);
  });

  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-002
  it("emails an address without an account once a day whatever the room, naming the inviter, the room and its link, escaped", async () => {
    const w = fresh();
    const { f, room, otherRoom, invite, inviteTo } = await setup();
    const to = `new_${w}@example.org`;
    expect((await invite([to])).results).toEqual([{ to, status: "invited" }]);
    expect((await invite([to, to])).results.map((r) => r.status)).toEqual(["invited", "invited"]);
    expect((await inviteTo(otherRoom, [to])).results.map((r) => r.status)).toEqual(["invited"]);
    await settle();
    expect(f.emails).toHaveLength(1);
    const mail = f.emails[0]!;
    expect(mail.to).toEqual([to]);
    expect(mail.subject).toContain("invited you to learn in");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain(`https://www.sefaria.test/social/r/${room.id}`);
    expect(mail.html).toContain("Rachel &lt;b&gt;Cohen&lt;/b&gt;");
    expect(mail.html).toContain("&quot;Yomi&quot; &amp; more");
    expect(mail.html).not.toContain("<b>");
    // In Hebrew when the inviter's interface is Hebrew.
    await invite([`he_${w}@example.org`], "he");
    await settle();
    expect(f.emails[1]!.subject).toMatch(/מזמין/);
    expect(f.emails[1]!.html).toMatch(/^<div dir="rtl">/);
  });

  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-003
  it("answers invited at once whether or not the address has an account, keeps only keyed hashes, and removes old rows", async () => {
    const w = fresh();
    const known = `known_${w}@example.org`;
    const unknown = `unknown_${w}@example.org`;
    const { h, room, invite } = await setup({ accounts: { [known]: nextUser++ }, slowMs: 1500 });
    const started = Date.now();
    expect((await invite([known, unknown])).results.map((r) => r.status)).toEqual(["invited", "invited"]);
    expect(Date.now() - started, "the answer does not wait for the slow provider").toBeLessThan(1000);
    await settle();
    const rows = await h.sql<Record<string, unknown>>("select * from room_invites where room_id = $1", [room.id]);
    expect(JSON.stringify(rows)).not.toContain("example.org");
    const plain = [known, unknown].map((e) => createHash("sha256").update(e).digest("hex"));
    const kept = rows.flatMap((r) => (r.email_sha256 ? [String(r.email_sha256)] : []));
    expect(kept).toHaveLength(2);
    for (const k of kept) expect(plain, "not a plain hash anyone could compute").not.toContain(k);
    await h.sql("update room_invites set created_at = now() - interval '3 days' where room_id = $1", [room.id]);
    await invite([`later_${w}@example.org`]);
    await settle();
    expect(
      (await h.sql("select 1 from room_invites where room_id = $1 and created_at < now() - interval '2 days'", [room.id])).length,
    ).toBe(0);
  });

  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-004
  it("answers unavailable without an email provider key, looks nothing up, and handles still work", async () => {
    const { h, f, invite } = await setup({ email: false, accounts: { "a@example.org": 1 } });
    expect(Object.keys(invitesModule)).toHaveLength(1);
    const benId = nextUser++;
    const ben = await h.token(benId, { name: "Ben" });
    const w = fresh();
    await h.call("PATCH", "/api/v1/profiles/me", { token: ben, body: { handle: `ben_${w}` } });
    expect((await invite(["a@example.org", `@ben_${w}`])).results.map((r) => r.status)).toEqual(["unavailable", "invited"]);
    await settle();
    expect(f.lookups).toEqual([]);
    expect(f.emails).toEqual([]);
  });

  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-005
  it("logs a provider failure without telling the inviter, and requests sent together cannot pass the hourly limit", async () => {
    const w = fresh();
    const bad = `bad_${w}@example.org`;
    const { h, f, rachelId, room, invite } = await setup({ lookup: false, failEmailTo: bad });
    const res = await invite([bad, `good_${w}@example.org`]);
    expect(res.results.map((r) => r.status)).toEqual(["invited", "invited"]);
    await settle();
    expect(f.emails.map((m) => m.to[0])).toEqual([`good_${w}@example.org`]);
    expect(f.lookups, "no lookup when it is not configured").toEqual([]);
    // 10 requests of 10 addresses at the same moment: at most 50 an hour get through, the rest are refused.
    const rachel = await h.token(rachelId, { name: "Rachel" });
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, r) =>
        h.call("POST", `/api/v1/rooms/${room.id}/invites`, {
          token: rachel,
          body: { to: Array.from({ length: 10 }, (_, i) => `burst_${w}_${r}_${i}@example.org`) },
        }),
      ),
    );
    const accepted = answers.filter((a) => a.status === 200).length;
    expect(answers.every((a) => a.status === 200 || a.status === 429)).toBe(true);
    expect(accepted * 10 + 2, "at most 50 an hour").toBeLessThanOrEqual(50);
    await settle();
  });
});
