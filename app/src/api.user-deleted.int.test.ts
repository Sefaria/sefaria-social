// Acceptance tests for spec 008: Django's signed user-deleted webhook (L2, real Postgres), through the served route tree,
// with the walk-the-schema check that no table keeps the deleted user's id.
// @feature IDENT-008 Account deletion in Sefaria removes the user's social data
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const WEBHOOK = "/api/v1/internal/user-deleted";
const A = 900000001;
const B = 900000002;
const C = 900000003;
const event = (id: string, userId: number, type = "user.deleted") =>
  JSON.stringify({ event: type, id, occurred_at: "2026-11-23T01:02:03Z", user_id: userId });

async function setup() {
  const { harness } = await import("../../test/integration/harness");
  const walk = await import("../../test/integration/schema-walk");
  const h = await harness(getRouter());
  const seeded = await walk.seedEveryTable(h.sql, A, B, C);
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(
        (await walk.publicTables(h.sql)).map(async (t) => [t, await h.sql(`select * from "${t}" order by 1, 2`)]),
      ),
    );
  return { h, walk, seeded, snapshot };
}

describe("spec 008: user-deleted webhook", () => {
  // @ac 008/AC-001
  it("refuses a webhook without a valid signature and changes nothing", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h, snapshot } = await setup();
    const { sign } = await import("./server/webhooks/signature");
    const before = await snapshot();
    const body = event("evt-unsigned", A);
    const attempts = [
      await h.webhook(body, null),
      await h.webhook(body, sign("another-secret", body)),
      await h.webhook(body, sign("integration-test-webhook-secret", event("evt-other", A))),
    ];
    expect(attempts.map((r) => `${r.status} ${(r.json as { error: { code: string } }).error.code}`)).toEqual(
      Array(3).fill("401 webhook.bad_signature"),
    );
    expect(await snapshot()).toBe(before);
    // Django's published vector verifies with this implementation.
    const vector = '{"event":"user.deleted","id":"x","occurred_at":"2026-11-23T01:02:03Z","user_id":42}';
    expect(sign("secret", vector)).toBe("sha256=5a26b7ac2ff4e75aeec9a4dfa56aab52601ce60bb5435b0b44ac82515678a165");
  });

  // @ac 008/AC-002
  it("deletes the user's rows from every table, keeps only the tombstone, and leaves other users alone", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h, walk, seeded } = await setup();
    expect(await walk.uncoveredTables(h.sql, seeded), "every table is seeded").toEqual([]);
    const seededForA = [
      "follows.follower_user_id: 1",
      "notifications.recipient_user_id: 1",
      "posts.created_by_user_id: 1",
      "profile_admins.user_id: 1",
      "profiles.user_id: 1",
      "reactions.user_id: 1",
      "replies.created_by_user_id: 1",
      "room_members.user_id: 2",
      "rooms.owner_user_id: 1",
      "shiur_recordings.owner_user_id: 2",
      "shiurim.teacher_user_id: 1",
      "user_display.user_id: 1",
    ];
    expect(await walk.userValues(h.sql, A)).toEqual(seededForA);
    expect(await walk.userValues(h.sql, B)).toEqual(seededForA);

    const res = await h.webhook(event("evt-delete-a", A), undefined);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "processed" });

    expect(await walk.userValues(h.sql, A)).toEqual(["deleted_users.user_id: 1"]);
    expect(await h.sql("select event_id from deleted_users where user_id = $1", [A])).toEqual([{ event_id: "evt-delete-a" }]);
    expect(await h.sql("select event_type from webhook_receipts where event_id = 'evt-delete-a'")).toEqual([
      { event_type: "user.deleted" },
    ]);
    // B keeps their own rows; only the links to A's room and A's shiur (and B's follow of, and reaction on, A's profile and
    // post) went with A's data.
    expect(await walk.userValues(h.sql, B)).toEqual([
      "notifications.recipient_user_id: 1",
      "posts.created_by_user_id: 1",
      "profile_admins.user_id: 1",
      "profiles.user_id: 1",
      "replies.created_by_user_id: 1",
      "room_members.user_id: 1",
      "rooms.owner_user_id: 1",
      "shiur_recordings.owner_user_id: 1",
      "shiurim.teacher_user_id: 1",
      "user_display.user_id: 1",
    ]);
  });

  // @ac 008/AC-003
  it("answers a redelivered event with duplicate and changes nothing", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h, snapshot } = await setup();
    const body = event("evt-twice", A);
    expect((await h.webhook(body)).json).toEqual({ status: "processed" });
    const after = await snapshot();
    // A user row recreated between deliveries must survive the redelivery: the id, not the user, is the replay guard.
    const res = await h.webhook(body);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "duplicate" });
    expect(await snapshot()).toBe(after);
  });

  // @ac 008/AC-004
  it("refuses a deleted user's still-valid token", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h } = await setup();
    const token = await h.token(A);
    expect((await h.call("GET", "/api/v1/rooms", { token })).status).toBe(200);
    await h.webhook(event("evt-tomb", A));
    const res = await h.call("POST", "/api/v1/rooms", { token, body: { title: "Back from the dead" } });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: { code: "auth.user_deleted" } });
    expect(await h.sql("select count(*)::int as n from rooms where owner_user_id = $1", [A])).toEqual([{ n: 0 }]);
  });

  // @ac 008/AC-005
  it("lets staff purge a user whose webhook was lost", async () => {
    const script = fileURLToPath(new URL("../scripts/purge-user.ts", import.meta.url));
    expect(existsSync(script), "app/scripts/purge-user.ts").toBe(true);
    const { h, walk } = await setup();
    const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
    const run = spawnSync(tsx, [script, String(A)], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, LOG_LEVEL: "error" },
      timeout: 15_000,
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      'purge-user: removed rows per table: {"room_members":2,"shiur_recordings":2,"shiurim":1,"rooms":1,"user_display":1,"notifications":1,"reactions":1,"follows":1,"replies":1,"posts":1,"profile_admins":1,"profiles":1}',
    );
    expect(await walk.userValues(h.sql, A)).toEqual(["deleted_users.user_id: 1"]);
    const refused = spawnSync(tsx, [script, "not-a-number"], { encoding: "utf8", timeout: 15_000 });
    expect(refused.status).toBe(2);
  });

  // @ac 008/AC-006
  it("acknowledges and ignores a signed event of another type", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h, walk } = await setup();
    const before = await walk.userValues(h.sql, A);
    const res = await h.webhook(event("evt-renamed", A, "user.renamed"));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ignored" });
    expect(await walk.userValues(h.sql, A)).toEqual(before);
    expect(await h.sql("select event_type from webhook_receipts where event_id = 'evt-renamed'")).toEqual([
      { event_type: "user.renamed" },
    ]);
  });

  it("the walk finds a user id in any column, and the coverage check finds an unseeded table (negative test)", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h, walk, seeded } = await setup();
    await h.sql("create table zz_probe (anything bigint, payload jsonb)");
    try {
      await h.sql(`insert into zz_probe values (null, '{"who": ${A}}')`);
      expect(await walk.uncoveredTables(h.sql, seeded)).toEqual(["zz_probe"]);
      await h.webhook(event("evt-probe", A));
      expect(await walk.userValues(h.sql, A)).toEqual(["deleted_users.user_id: 1", "zz_probe.payload: 1"]);
    } finally {
      await h.sql("drop table zz_probe");
    }
  });

  it("refuses a signed user.deleted event without a user id, or whose event-id header disagrees", async () => {
    expect(served("POST", WEBHOOK), `POST ${WEBHOOK} is served`).toBeTypeOf("function");
    const { h } = await setup();
    const noUser = JSON.stringify({ event: "user.deleted", id: "evt-nouser", occurred_at: "2026-11-23T01:02:03Z" });
    expect((await h.webhook(noUser)).status).toBe(400);
    const { sign } = await import("./server/webhooks/signature");
    const body = event("evt-header", A);
    const mismatched = await h.call("POST", WEBHOOK, {
      rawBody: body,
      headers: { "x-sefaria-signature": sign("integration-test-webhook-secret", body), "x-sefaria-event-id": "evt-other" },
    });
    expect(mismatched.status).toBe(400);
    expect(await h.sql("select count(*)::int as n from webhook_receipts where event_id in ('evt-nouser', 'evt-header')")).toEqual(
      [{ n: 0 }],
    );
  });
});
