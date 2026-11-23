import { useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { useHost } from "./host-context";

export type Viewer = ReturnType<SurfaceHost["viewer"]["get"]>;

const noSubscribe = () => () => {};

/** Who is signed in to the reader, re-rendering when it changes (null when signed out, or in standalone mode). */
export function useViewer(): Viewer {
  const host = useHost();
  return useSyncExternalStore(
    host ? (cb) => host.viewer.subscribe(cb) : noSubscribe,
    () => host?.viewer.get() ?? null,
    () => null,
  );
}
