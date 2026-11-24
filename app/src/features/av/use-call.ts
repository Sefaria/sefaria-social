// React hooks over the call controller (spec 034). The controller lives outside React, one per host; these hooks subscribe.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useHost } from "~/features/host/host-context";
import { useRoomsApi } from "~/features/api/rooms-api";
import { callControllerFor, type CallController } from "./call-controller";
import { INITIAL_CALL, type CallView } from "./machine";
import type { CallParticipant } from "./media";

const noop = () => () => undefined;

/** The host's call controller, or null in standalone mode. */
export function useCallController(): CallController | null {
  const host = useHost();
  return host ? callControllerFor(host) : null;
}

/** The call's view, re-rendering on every change. */
export function useCallView(controller: CallController | null): CallView {
  return useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.view() ?? INITIAL_CALL,
    () => INITIAL_CALL,
  );
}

/** The participants of the connected call (empty when not connected), re-rendering on every media change. */
export function useParticipants(controller: CallController | null): CallParticipant[] {
  const media = useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.media() ?? null,
    () => null,
  );
  const [, setTick] = useState(0);
  useEffect(() => media?.subscribe(() => setTick((n) => n + 1)), [media]);
  return media?.participants() ?? [];
}

const availability = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * Whether this server offers calls for the room: from the room the caller already has, or asked once per API and room
 * (the follow bar has no room object). Unknown (null) until the answer arrives; false on any error.
 */
export function useCallsAvailable(roomId: string, known?: boolean): boolean | null {
  const api = useRoomsApi();
  const [answer, setAnswer] = useState<boolean | null>(known ?? null);
  useEffect(() => {
    if (known !== undefined) {
      setAnswer(known);
      return;
    }
    if (!api) return;
    let cache = availability.get(api);
    if (!cache) availability.set(api, (cache = new Map()));
    let p = cache.get(roomId);
    if (!p) {
      p = api.getRoom(roomId).then(
        (r) => (r.kind === "member" ? (r.room.calls?.available ?? false) : false),
        () => false,
      );
      cache.set(roomId, p);
    }
    let live = true;
    void p.then((v) => live && setAnswer(v));
    return () => {
      live = false;
    };
  }, [api, roomId, known]);
  return answer;
}
