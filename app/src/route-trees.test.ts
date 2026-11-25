// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3200/social/settings?tab=notifications" }
// The two thin route trees (docs/decisions/0003-two-builds.md): the Start app's generated file-route tree and the surface's
// code-based tree. An entry-level test (directly in app/src) because it imports both, which no layer may do.
import { createMemoryHistory, createRouter, type AnyRoute } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "./routeTree.gen";
import { getRouter } from "./router";

const surfaceTrees = import.meta.glob<typeof import("./surface/route-tree")>("./surface/route-tree.tsx");

/** Every route of a tree, built into a router (route objects get their full paths when a router is built). */
function routesOf(tree: AnyRoute): AnyRoute[] {
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return Object.values(router.routesById as Record<string, AnyRoute>).filter((r) => !r.isRoot);
}
const pathOf = (r: AnyRoute) => (r.fullPath as string).replace(/(.)\/$/, "$1");
/** Server API routes (`/api/v1/*`, served by the social server, never by the reader) are not pages; R2 is about pages. */
const isApi = (r: AnyRoute) => pathOf(r).startsWith("/api/");
/** Every page route's full path. */
function fullPaths(tree: AnyRoute): string[] {
  return routesOf(tree)
    .filter((r) => !isApi(r))
    .map(pathOf)
    .sort();
}

describe("route trees", () => {
  // @feature OPS-005 Postgres schema, migrations and a public health check
  // @ac 005/AC-003
  it("the Start tree's only other routes are server-only API routes under /api/v1/, among them the health endpoint", () => {
    const api = routesOf(routeTree).filter(isApi);
    expect(api.map(pathOf)).toContain("/api/v1/health");
    // a handler and no component: the reader never renders them, and the surface tree has none (R2)
    expect(api.filter((r) => !pathOf(r).startsWith("/api/v1/") || r.options.component || !r.options.server)).toEqual([]);
  });

  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-008
  it("both trees define exactly the R6 pages plus social's not-found, all under /social (R2)", async () => {
    const mod = await surfaceTrees["./surface/route-tree.tsx"]?.();
    expect(mod, "app/src/surface/route-tree.tsx exists").toBeDefined();
    const expected = [
      "/social",
      "/social/$",
      "/social/b/$broadcastId",
      "/social/notifications",
      "/social/p/$postId",
      "/social/r/$roomId",
      "/social/rec/$recordingId",
      "/social/rooms",
      "/social/s/$shiurId",
      "/social/settings",
      "/social/u/$profileId",
    ];
    expect(fullPaths(routeTree)).toEqual(expected);
    expect(fullPaths(mod!.surfaceRouteTree)).toEqual(expected);
    expect(expected.every((p) => p === "/social" || p.startsWith("/social/"))).toBe(true);
  });

  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-009
  it("the Start app's router runs the same routes under the browser's own history at /social (R5)", async () => {
    const router = getRouter();
    await router.load();
    expect(router.state.matches.map((m) => m.routeId)).toEqual(["__root__", "/social/settings"]);
    expect(router.state.location.search).toEqual({ tab: "notifications" });
    expect(router.buildLocation({ to: "/social/settings", search: { tab: "profile" } }).href).toBe(
      "/social/settings?tab=profile",
    );
  });
});
