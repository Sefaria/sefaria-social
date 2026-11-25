// Ending a session for everyone (spec 050 AC-002, AC-007; docs/plans/shiur.md D8, D15): the room's owner presses Close room,
// End broadcast or Finish and save. A recording of the room is finished (saved) first and a live broadcast from it is ended;
// then the relay ends the session, which takes everyone, the owner included, out of the room and its call.
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { broadcastControllerFor } from "~/features/broadcast/broadcast-controller";
import { recordingControllerFor } from "~/features/recording/recording-controller";
import { roomControllerFor } from "~/features/session/controller";

export async function closeSession(host: SurfaceHost, roomId: string): Promise<void> {
  const recording = recordingControllerFor(host);
  const rec = recording.view();
  if (rec.kind === "recording" && rec.roomId === roomId) await recording.stop();
  const broadcasts = broadcastControllerFor(host);
  const live = broadcasts.hostView();
  if (live.kind === "live" && live.roomId === roomId) await broadcasts.end();
  roomControllerFor(host).close(roomId);
}
