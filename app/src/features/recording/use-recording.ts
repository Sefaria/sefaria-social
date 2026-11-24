// React hooks over the recording controller and the room's recording state (spec 041 AC-006).
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { useHost } from "~/features/host/host-context";
import { useRoomsApi } from "~/features/api/rooms-api";
import type { CallController } from "~/features/av/call-controller";
import { recordingControllerFor, type RecordingController, type RecordingView } from "./recording-controller";

const IDLE: RecordingView = { kind: "idle" };
const noop = () => () => undefined;

/** The host's recording controller, or null in standalone mode. */
export function useRecordingController(): RecordingController | null {
  const host = useHost();
  return host ? recordingControllerFor(host) : null;
}

export function useRecordingView(controller: RecordingController | null): RecordingView {
  return useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.view() ?? IDLE,
    () => IDLE,
  );
}

/** This browser is recording (or finishing) a room: the given one, or any when none is given. */
export function recordingHere(view: RecordingView, roomId?: string): boolean {
  return (view.kind === "recording" || view.kind === "stopping") && (roomId === undefined || view.roomId === roomId);
}

const RecordingFlag = z.object({ recording: z.literal(true) });
/** The room read's and status's `recording` field: present and true only while a recording runs. */
export const isRecordingFlag = (data: unknown): boolean => RecordingFlag.safeParse(data).success;

/**
 * Whether the connected call is being recorded: the media server's room metadata, or this browser's own recording. Re-renders
 * on every change of either.
 */
export function useCallRecording(call: CallController | null): boolean {
  const recording = useRecordingController();
  const view = useRecordingView(recording);
  const media = useSyncExternalStore(
    call ? (cb) => call.subscribe(cb) : noop,
    () => call?.media() ?? null,
    () => null,
  );
  const remote = useSyncExternalStore(
    media ? (cb) => media.subscribe(cb) : noop,
    () => media?.recording() ?? false,
    () => false,
  );
  return remote || recordingHere(view);
}

/** Whether a room is being recorded, asked once from its status (the pre-join step has no room object). */
export function useRoomRecording(roomId: string | null): boolean {
  const api = useRoomsApi();
  const [answer, setAnswer] = useState(false);
  useEffect(() => {
    setAnswer(false);
    if (!api?.getStatus || !roomId) return;
    let live = true;
    api.getStatus(roomId).then(
      (s) => live && setAnswer(isRecordingFlag(s)),
      () => live && setAnswer(false),
    );
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return answer;
}
