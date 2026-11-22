import { createRouter } from "@tanstack/react-router";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { SocialNotFound } from "~/features/shell/SocialNotFound";
import { parseSearch, stringifySearch } from "~/lib/search-serializer";
import { createHostHistory } from "./host-history";
import { surfaceRouteTree } from "./route-tree";

/**
 * The surface's router (routing rule R4): the host-bridged history, the reader's search serializer (R7) and social's own
 * not-found page. No basepath: the tree's paths are /social/… already (docs/decisions/0003-two-builds.md). No scroll
 * restoration: it would write window.history.scrollRestoration, which belongs to the reader (R1).
 */
export function createSurfaceRouter(host: SurfaceHost) {
  return createRouter({
    routeTree: surfaceRouteTree,
    history: createHostHistory(host),
    context: { mode: "surface", host },
    parseSearch,
    stringifySearch,
    defaultNotFoundComponent: SocialNotFound,
    scrollRestoration: false,
  });
}

export type SurfaceRouter = ReturnType<typeof createSurfaceRouter>;
