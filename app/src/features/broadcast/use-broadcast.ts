// React hooks over the broadcast controller (spec 043). The controller lives outside React, one per host; these subscribe.
import { useSyncExternalStore } from "react";
import { useHost } from "~/features/host/host-context";
import { broadcastControllerFor, type BroadcastController, type HostView, type WatchView } from "./broadcast-controller";

const noop = () => () => undefined;
const IDLE = { kind: "idle" } as const;

/** The host's broadcast controller, or null in standalone mode. */
export function useBroadcastController(): BroadcastController | null {
  const host = useHost();
  return host ? broadcastControllerFor(host) : null;
}

export function useHostView(controller: BroadcastController | null): HostView {
  return useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.hostView() ?? IDLE,
    () => IDLE,
  );
}

export function useWatchView(controller: BroadcastController | null): WatchView {
  return useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.watchView() ?? IDLE,
    () => IDLE,
  );
}
