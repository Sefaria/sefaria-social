// The endpoint wrapper's rules added for Claude assets: a binary answer may carry only listed security and caching headers
// (spec 061), and only an endpoint on MCP_ENDPOINTS may accept MCP tokens (spec 064 AC-005).
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { bind, defineEndpoint } from "./endpoint";

describe("endpoint wrapper", () => {
  // @feature SHIUR-010 Claude asset content served sandboxed from its own origin
  it("lets a binary answer set its security and caching headers, and nothing else", async () => {
    const spec = defineEndpoint({
      operationId: "binaryHeadersTest",
      method: "GET",
      path: "/api/v1/claude-assets/content/{versionId}",
      summary: "test",
      tags: ["test"],
      access: "public",
      params: z.object({ versionId: z.string() }),
      responses: { 200: { description: "bytes", binary: true } },
    });
    const handler = bind(spec, async () => ({
      status: 200 as const,
      body: new TextEncoder().encode("<html></html>"),
      contentType: "text/html; charset=utf-8",
      headers: {
        "content-security-policy": "sandbox allow-scripts",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "public, max-age=300",
        ...({ "set-cookie": "a=b", "access-control-allow-origin": "*" } as Record<string, string>),
      },
    }));
    const res = await handler({ request: new Request("http://social.test/x"), params: { versionId: "v" } });
    expect([
      res.headers.get("content-security-policy"),
      res.headers.get("x-content-type-options"),
      res.headers.get("referrer-policy"),
      res.headers.get("cache-control"),
      res.headers.get("set-cookie"),
      res.headers.get("access-control-allow-origin"),
    ]).toEqual(["sandbox allow-scripts", "nosniff", "no-referrer", "public, max-age=300", null, null]);
  });

  // @feature IDENT-107 Tokens issued through the MCP write Claude assets and nothing else
  // @ac 064/AC-005
  it("refuses to declare an endpoint that takes MCP tokens unless it is on MCP_ENDPOINTS", () => {
    const declare = (path: `/api/${string}`, method: "POST" | "GET") => () =>
      defineEndpoint({ operationId: "mcpTest", method, path, summary: "t", tags: ["t"], mcp: true, responses: {} });
    expect(declare("/api/v1/posts", "POST")).toThrow(/is not on MCP_ENDPOINTS \(app\/src\/server\/http\/mcp-routes\.ts\)/);
    expect(declare("/api/v1/claude-assets", "GET")).toThrow(/MCP_ENDPOINTS/);
    expect(declare("/api/v1/claude-assets", "POST")).not.toThrow();
  });
});
