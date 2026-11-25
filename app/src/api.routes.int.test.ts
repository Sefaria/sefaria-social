// Acceptance test for spec 006 AC-004: protect by default, checked by enumerating every route the server serves.
// @feature API-006 API routes are protected by default
import { describe, expect, it } from "vitest";
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { getRouter } from "~/router";

const KNOWN_API_ROUTES = ["/api/v1/health", "/api/v1/internal/user-deleted", "/api/v1/rooms", "/api/v1/rooms/$roomId"];

const routesUnderApi = () =>
  Object.values(getRouter().routesById as unknown as Record<string, { fullPath?: string }>)
    .map((r) => r.fullPath)
    .filter((p): p is string => typeof p === "string" && p.startsWith("/api/"));

describe("spec 006: protect by default", () => {
  // @ac 006/AC-004
  it("refuses unauthenticated calls to every served API route except the public list", async () => {
    // Guard against an empty enumeration passing: the routes this milestone ships must be among those found.
    expect(routesUnderApi()).toEqual(expect.arrayContaining(KNOWN_API_ROUTES));
    const { harness, protectionReport } = await import("../../test/integration/harness");
    const { PUBLIC_ENDPOINTS } = await import("./server/http/public-routes");
    await harness(getRouter());
    const report = await protectionReport(getRouter(), PUBLIC_ENDPOINTS);
    expect(report.violations).toEqual([]);
    expect(report.routes).toEqual([...routesUnderApi()].sort());
    // Every declared method and the fall-through for undeclared ones were exercised.
    expect(report.calls).toContain("GET /api/v1/health -> 200");
    expect(report.calls).toContain("PUT /api/v1/health -> 401");
    expect(report.calls).toContain("DELETE /api/v1/rooms/$roomId -> 401");
    expect(report.calls).toContain("POST /api/v1/internal/user-deleted -> 401");
    expect(report.calls).toContain("PUT /api/v1/rooms -> 401");
    // The public list is short on purpose; each entry has its reason in public-routes.ts (a ready shiur asset: spec 051, D2).
    expect([...PUBLIC_ENDPOINTS]).toEqual([
      "GET /api/v1/health",
      "GET /api/v1/assets/{assetId}",
      "GET /api/v1/assets/{assetId}/state",
      "GET /api/v1/assets/{assetId}/media",
    ]);
  });

  it("every served handler is bound to a declared endpoint, and every endpoint is served", async () => {
    expect(routesUnderApi()).toEqual(expect.arrayContaining(KNOWN_API_ROUTES));
    const { handlersOf } = await import("../../test/integration/harness");
    const { ENDPOINTS } = await import("./server/api/contracts");
    const served: string[] = [];
    for (const route of Object.values(getRouter().routesById as unknown as Record<string, { fullPath?: string }>)) {
      if (!route.fullPath?.startsWith("/api/")) continue;
      for (const [method, handler] of Object.entries(handlersOf(route))) {
        if (method === "ANY") continue;
        const endpoint = (handler as { endpoint?: { method: string; path: string } }).endpoint;
        expect(endpoint, `${method} ${route.fullPath} must be created with bind()`).toBeDefined();
        expect(endpoint!.path.replace(/\{(\w+)\}/g, "$$$1")).toBe(route.fullPath);
        served.push(`${endpoint!.method} ${endpoint!.path}`);
      }
    }
    expect(served.sort()).toEqual(ENDPOINTS.map((e) => `${e.method} ${e.path}`).sort());
  });

  it("the enumeration reports a route that answers without credentials (negative test)", async () => {
    expect(routesUnderApi()).toEqual(expect.arrayContaining(KNOWN_API_ROUTES));
    const { protectionReport } = await import("../../test/integration/harness");
    const root = createRootRoute();
    const leak = createRoute({
      getParentRoute: () => root,
      path: "/api/v1/leak",
      server: { handlers: { GET: () => new Response("{}", { status: 200 }) } },
    } as never);
    const page = createRoute({ getParentRoute: () => root, path: "/api/v1/page", component: () => null });
    const router = createRouter({ routeTree: root.addChildren([leak, page]) });
    const report = await protectionReport(router, new Set());
    expect(report.violations).toEqual([
      "GET /api/v1/leak answered 200 without credentials (expected 401)",
      "/api/v1/page is under /api/ but has no server handlers",
    ]);
  });
});
