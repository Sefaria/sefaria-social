// Acceptance tests for spec 005: health and request logging (L2, real Postgres), through the served route tree.
// @feature OPS-005 Postgres schema, migrations and a public health check
// @feature OPS-015 Structured request logs with a correlation id
import { describe, expect, it } from "vitest";
import { getRouter } from "~/router";

/** The server handler TanStack Start would run for this method and path, if the route tree serves one. */
function served(method: string, path: string): unknown {
  const [, , route] = getRouter().getMatchedRoutes(path);
  const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } } | undefined)?.options?.server
    ?.handlers;
  return handlers?.[method];
}

const load = async () => (await import("../../test/integration/harness")).harness(getRouter());

describe("spec 005: health", () => {
  // @ac 005/AC-003
  it("answers 200 without a token when the database answers", async () => {
    expect(served("GET", "/api/v1/health"), "GET /api/v1/health is served").toBeTypeOf("function");
    const h = await load();
    const res = await h.call("GET", "/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: "ok", database: "ok" });
  });

  // @ac 005/AC-004
  it("answers 503 within about 2 seconds when the database does not answer", async () => {
    expect(served("GET", "/api/v1/health"), "GET /api/v1/health is served").toBeTypeOf("function");
    const h = await load();
    const { closeDb } = await import("./server/db/client");
    const { resetConfig } = await import("./server/config");
    await closeDb();
    // A port nobody listens on: the connection is refused (or never completes), like a database that is down.
    process.env.DATABASE_URL = "postgres://127.0.0.1:1/sefaria_social_test";
    resetConfig();
    const started = Date.now();
    const res = await h.call("GET", "/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ status: "unavailable", database: "unavailable" });
    expect(Date.now() - started).toBeLessThan(3_000);
    await closeDb();
  });
});

describe("spec 005: request logging", () => {
  // @ac 005/AC-005
  it("writes one JSON line per request with static fields and no headers, body or token", async () => {
    expect(served("POST", "/api/v1/rooms"), "POST /api/v1/rooms is served").toBeTypeOf("function");
    const h = await load();
    const token = await h.token(4242);
    const res = await h.call("POST", "/api/v1/rooms", {
      token,
      body: { title: "Body text that must not be logged" },
      headers: { "x-correlation-id": "corr-abcdef12", "x-custom-header": "header-value-not-logged" },
    });
    expect(res.status).toBe(201);
    const lines = h.logs.filter((l) => JSON.parse(l).msg === "request.completed");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(Object.keys(entry).sort()).toEqual([
      "correlation_id",
      "duration_ms",
      "level",
      "method",
      "msg",
      "route",
      "status",
      "time",
    ]);
    expect(entry).toMatchObject({
      msg: "request.completed",
      method: "POST",
      route: "/api/v1/rooms",
      status: 201,
      correlation_id: "corr-abcdef12",
    });
    expect(entry.duration_ms).toBeTypeOf("number");
    const all = h.logs.join("\n");
    expect(all).not.toContain(token);
    expect(all).not.toContain("Body text that must not be logged");
    expect(all).not.toContain("header-value-not-logged");
  });

  // @ac 005/AC-006
  it("echoes a valid correlation id and replaces an invalid one", async () => {
    expect(served("GET", "/api/v1/health"), "GET /api/v1/health is served").toBeTypeOf("function");
    const h = await load();
    const ok = await h.call("GET", "/api/v1/health", { headers: { "x-correlation-id": "surface-1234.abcd" } });
    expect(ok.headers.get("x-correlation-id")).toBe("surface-1234.abcd");
    const bad = await h.call("GET", "/api/v1/health", { headers: { "x-correlation-id": "bad id with spaces" } });
    const generated = bad.headers.get("x-correlation-id");
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    const ids = h.logs
      .map((l) => JSON.parse(l))
      .filter((e) => e.msg === "request.completed")
      .map((e) => e.correlation_id);
    expect(ids).toEqual(["surface-1234.abcd", generated]);
  });
});
