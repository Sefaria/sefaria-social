// The SurfaceHost as React context, for features that talk to the reader (links, the viewer, the interface language). In surface
// mode app/src/surface/host-context.tsx provides the reader's host; in standalone mode (the Start app's pages) there is none and
// these hooks fall back to plain links and English. Nothing React crosses the contract: this context lives inside the surface.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";

export const HostContext = createContext<SurfaceHost | null>(null);

/** The host, or null in standalone mode. */
export const useHost = (): SurfaceHost | null => useContext(HostContext);

const noSubscribe = () => () => {};

export type InterfaceLang = SurfaceHost["ui"]["interfaceLang"];

/** The reader's interface language, re-rendering when it changes ("english" in standalone mode). */
export function useInterfaceLang(): InterfaceLang {
  const host = useHost();
  return useSyncExternalStore(
    host ? (cb) => host.ui.subscribe(cb) : noSubscribe,
    () => host?.ui.interfaceLang ?? "english",
    () => "english",
  );
}
