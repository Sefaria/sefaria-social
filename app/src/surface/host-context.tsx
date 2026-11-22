import type { ReactNode } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { HostContext } from "~/features/host/host-context";

/** Provides the reader's host to everything the surface renders (features read it with useHost()). */
export function SurfaceHostProvider({ host, children }: { host: SurfaceHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}
