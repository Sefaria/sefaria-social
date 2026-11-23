import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** The Start build's router (standalone mode, plan R5). The surface build creates its own, host-bridged router (R4, spike S1). */
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
