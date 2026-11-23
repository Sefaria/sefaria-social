import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { SocialNotFound } from "./features/shell/SocialNotFound";
import { parseSearch, stringifySearch } from "./lib/search-serializer";

/**
 * The Start build's router (standalone mode, plan R5): a normal browser history at /social. The surface build creates its own
 * router with the host-bridged history (R4; app/src/surface/router.ts). Both use the reader's search serializer (R7).
 */
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    parseSearch,
    stringifySearch,
    defaultNotFoundComponent: SocialNotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
