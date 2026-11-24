import { useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { CallSlot } from "~/features/av/CallSlot";
import { WatchBar } from "~/features/broadcast/WatchBar";
import { HostLink } from "~/features/host/HostLink";
import { ReplaySlot } from "~/features/replay/ReplaySlot";
import { FollowBar, MiniView } from "~/features/session/FollowBar";
import { useLiveRooms, useRoomController } from "~/features/session/use-room-session";
import { useStrings } from "~/features/shell/use-strings";
import { decodeCtx } from "~/lib/ctx";

/**
 * The persistent mount's content (routing rules R11, R12, R18). It is independent of the route:
 *  - in a room's context (`ctx=social.room.<id>`, read from the address alone, R11): the follow bar; the room controller
 *    reconnects to the room from that value on a cold load;
 *  - elsewhere, with a room the viewer entered and has not left: the mini view (Enlarge, Leave);
 *  - otherwise nothing (R18).
 * Shiur contexts show only the way back until shiurim are built.
 * The call (spec 034) renders beside these whenever there is one, whatever the route, so it survives every navigation; a
 * recording's replay (spec 042) shares its floating window, one at a time (features/av/window-owner.ts). While watching a
 * broadcast (spec 043, `ctx=social.watch.<id>`), the viewer's bar.
 */
export function PersistentView({ host }: { host: SurfaceHost }) {
  return (
    <>
      <RoomView host={host} />
      <WatchBar />
      <CallSlot />
      <ReplaySlot />
    </>
  );
}

/** The room part of the persistent mount (above). */
function RoomView({ host }: { host: SurfaceHost }) {
  const raw = useSyncExternalStore(
    (cb) => host.reader.context.subscribe(cb),
    () => host.reader.context.get(),
    () => null,
  );
  const t = useStrings();
  const { controller } = useRoomController(); // creating it starts the ctx watch (R11)
  const live = useLiveRooms(controller);
  const context = decodeCtx(raw); // untrusted: decodeCtx validates the value's grammar
  if (context?.kind === "room") return <FollowBar roomId={context.id} />;
  if (context)
    return (
      <div data-social-persistent={context.kind}>
        <span>{t.inRoom}</span> <HostLink to={`/social/s/${context.id}`}>{t.backToRoom}</HostLink>
      </div>
    );
  if (live.length) return <MiniView roomIds={live} />;
  return null;
}
