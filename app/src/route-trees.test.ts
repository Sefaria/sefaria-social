// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3200/social/settings?tab=notifications" }
// The two thin route trees (docs/decisions/0003-two-builds.md): the Start app's generated file-route tree and the surface's
// code-based tree. An entry-level test (directly in app/src) because it imports both, which no layer may do.
import { createMemoryHistory, createRouter, type AnyRoute } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "./routeTree.gen";
import { getRouter } from "./router";

const surfaceTrees = import.meta.glob<typeof import("./surface/route-tree")>("./surface/route-tree.tsx");

/** Every route's full path, as the router computes it (route objects get their paths when a router is built). */
function fullPaths(tree: AnyRoute): string[] {
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return Object.values(router.routesById as Record<string, AnyRoute>)
    .filter((r) => !r.isRoot)
    .map((r) => (r.fullPath as string).replace(/(.)\/$/, "$1"))
    .sort();
}

describe("route trees", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-008
  it("both trees define exactly the R6 pages plus social's not-found, all under /social (R2)", async () => {
    const mod = await surfaceTrees["./surface/route-tree.tsx"]?.();
    expect(mod, "app/src/surface/route-tree.tsx exists").toBeDefined();
    const expected = ["/social", "/social/$", "/social/r/$roomId", "/social/s/$shiurId", "/social/settings"];
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
