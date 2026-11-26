// Acceptance tests for spec 064 (a token issued through the MCP saves Claude assets and nothing else), L2: real Postgres
// through the route tree. A marked token is one Django issues when asked with an `mcp` token: the usual claims plus
// `via: "mcp"`. AC-002 walks every endpoint that needs a user, the way protect-by-default walks every route.
// @feature IDENT-107 Tokens issued through the MCP write Claude assets and nothing else
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouter } from "~/router";
import type * as FakeSefariaModule from "../../test/integration/fake-sefaria";

// Loaded through import.meta.glob: on a base without it, each test fails on its first assertion (prove-red).
const fakeModules = import.meta.glob<typeof FakeSefariaModule>("../../test/integration/fake-sefaria.ts");
type FakeSefaria = FakeSefariaModule.FakeSefaria;
const mcpRoutes = import.meta.glob<typeof import("./server/http/mcp-routes")>("./server/http/mcp-routes.ts");
let assetHtml: typeof FakeSefariaModule.assetHtml;

const SAVE = "/api/v1/claude-assets";
const U = 966001;
const SAMPLE = "00000000-0000-4000-8000-000000000000";

let sefaria: FakeSefaria;
beforeAll(async () => {
  const m = await fakeModules["../../test/integration/fake-sefaria.ts"]?.();
  if (!m) return; // the base: every test fails on its first assertion
  assetHtml = m.assetHtml;
  sefaria = await m.startFakeSefaria();
});
afterAll(async () => {
  await sefaria?.close();
});

async function load() {
  process.env.ASSET_STORE_DIR = mkdtempSync(path.join(tmpdir(), "social-mcp-"));
  process.env.SEFARIA_API_ORIGIN = sefaria?.origin ?? "http://127.0.0.1:9";
  const h = await (await import("../../test/integration/harness")).harness(getRouter());
  const mcp = await h.token(U, { name: "Via Claude", via: "mcp" });
  return { h, mcp };
}

const code = (r: { status: number; json: unknown }) =>
  `${r.status} ${(r.json as { error?: { code: string } } | null)?.error?.code ?? ""}`.trim();

describe("spec 064: MCP tokens", () => {
  // @ac 064/AC-001
  it("saves and imports with a marked token as its user", async () => {
    expect(Object.keys(mcpRoutes), "the reviewed list of MCP endpoints").toEqual(["./server/http/mcp-routes.ts"]);
    const { MCP_ENDPOINTS } = await mcpRoutes["./server/http/mcp-routes.ts"]!();
    expect([...MCP_ENDPOINTS]).toEqual(["POST /api/v1/claude-assets", "POST /api/v1/claude-assets/import"]);
    const { h, mcp } = await load();
    const saved = await h.call("POST", SAVE, { token: mcp, body: { html: assetHtml(["Genesis 1:1-5"]) } });
    expect(saved.status).toBe(201);
    expect(await h.sql("select owner_user_id from assets")).toEqual([{ owner_user_id: String(U) }]);
    const imported = await h.call("POST", `${SAVE}/import`, { token: mcp, body: { url: "https://claude.ai/x" } });
    expect([imported.status, (imported.json as { problems: { code: string }[] }).problems[0]!.code]).toEqual([
      422,
      "import.claude_link",
    ]);
  });

  // @ac 064/AC-002
  it("refuses a marked token on every other endpoint that needs a user, before doing anything", async () => {
    const { h, mcp } = await load();
    const { ENDPOINTS } = await import("./server/api/contracts");
    const plain = await h.token(U, { name: "Plain" });
    expect((await h.call("GET", "/api/v1/profiles/me", { token: plain })).status).toBe(200);
    expect(code(await h.call("GET", "/api/v1/profiles/me", { token: mcp }))).toBe("403 auth.mcp_not_allowed");
    const before = await h.sql("select count(*)::int as n from posts");
    const named = [
      code(await h.call("GET", "/api/v1/profiles/me", { token: mcp })),
      code(await h.call("POST", "/api/v1/posts", { token: mcp, body: { body: "hello" } })),
      code(await h.call("GET", SAVE, { token: mcp })),
      code(await h.call("DELETE", `${SAVE}/${SAMPLE}`, { token: mcp })),
    ];
    expect(named).toEqual(Array(4).fill("403 auth.mcp_not_allowed"));
    expect(await h.sql("select count(*)::int as n from posts")).toEqual(before);

    const accepted: string[] = [];
    for (const e of ENDPOINTS.filter((x) => x.access === "user")) {
      const p = e.path.replace(/\{[A-Za-z]+\}/g, SAMPLE);
      const r = await h.call(e.method, p, { token: mcp });
      if (code(r) !== "403 auth.mcp_not_allowed") accepted.push(`${e.method} ${e.path}`);
    }
    expect(accepted).toEqual(["POST /api/v1/claude-assets", "POST /api/v1/claude-assets/import"]);
  });

  // @ac 064/AC-003
  it("refuses a token whose via is anything else as invalid", async () => {
    const { h } = await load();
    const other = await h.token(U, { name: "Other", via: "other" });
    expect(code(await h.call("GET", "/api/v1/profiles/me", { token: other }))).toBe("401 auth.invalid_token");
    expect(code(await h.call("POST", SAVE, { token: other, body: { html: assetHtml(["Genesis 1:1"]) } }))).toBe(
      "401 auth.invalid_token",
    );
  });
});
