import { useRef, useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { useHost } from "./host-context";

export type Viewer = ReturnType<SurfaceHost["viewer"]["get"]>;

const noSubscribe = () => () => {};

const sameViewer = (a: Viewer, b: Viewer) =>
  a === b || (!!a && !!b && a.id === b.id && a.name === b.name && a.imageUrl === b.imageUrl);

/**
 * Who is signed in to the reader, re-rendering when it changes (null when signed out, or in standalone mode). The contract does
 * not promise that `viewer.get()` returns the same object twice (the reader builds a new one per call), and useSyncExternalStore
 * re-renders whenever the snapshot changes identity, so the snapshot keeps the previous object while the viewer is the same.
 */
export function useViewer(): Viewer {
  const host = useHost();
  const last = useRef<Viewer>(null);
  return useSyncExternalStore(
    host ? (cb) => host.viewer.subscribe(cb) : noSubscribe,
    () => {
      const next = host?.viewer.get() ?? null;
      if (!sameViewer(next, last.current)) last.current = next;
      return last.current;
    },
    () => null,
  );
}
