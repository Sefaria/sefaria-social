import { CallButton } from "~/features/av/CallButton";
import { HostLink } from "~/features/host/HostLink";
import { PresenceList } from "~/features/presence/PresenceList";
import { useStrings } from "~/features/shell/use-strings";
import { useRoomController, useRoomSession, useSessionState } from "./use-room-session";

/**
 * Shown in the persistent mount while the reader is in a room's context (specs 013, 014): whom the viewer follows, or that
 * they are on their own (Follow again) or leading; Lead; Minimise; the way back to the lobby; and who is here, with Follow
 * buttons. Rendered beside the reader, never over it.
 */
export function FollowBar({ roomId }: { roomId: string }) {
  const t = useStrings();
  const { controller, view } = useRoomController();
  const state = useSessionState(useRoomSession(roomId));
  const nameOf = (id: string | null) => state?.participants.find((p) => p.id === id)?.name || t.someone;
  const status = state?.status ?? null;
  const inContext = (view.kind === "expanded" || view.kind === "detached") && view.context.id === roomId;
  return (
    <div data-social-persistent="room" data-follow-status={status ?? undefined} data-session-view={view.kind}>
      <p data-follow-line="">
        {status === "live" && (
          <>
            {t.statusFollowing} <bdi dir="auto">{nameOf(state!.following)}</bdi>
          </>
        )}
        {status === "paused" && t.statusOnYourOwn}
        {status === "leading" && t.statusLeading}
        {status === "no-leader" && t.statusNoLeader}
        {status === "leader-away" && t.statusLeaderAway}
        {(status === "connecting" || status === "reconnecting") && t.reconnecting}
        {status === null && t.inRoom}
      </p>
      {status === "paused" && (
        <button type="button" data-action="follow-again" onClick={() => controller?.followAgain()}>
          {t.followAgain}
        </button>
      )}
      {state && status !== "leading" && inContext && (
        <button type="button" data-action="lead" onClick={() => controller?.lead()}>
          {t.lead}
        </button>
      )}
      {inContext && (
        <button type="button" data-action="minimise" onClick={() => controller?.minimise()}>
          {t.minimise}
        </button>
      )}
      <HostLink to={`/social/r/${roomId}`}>{t.backToRoom}</HostLink>
      <CallButton roomId={roomId} />
      <PresenceList roomId={roomId} onFollow={(id) => controller?.follow(id)} />
    </div>
  );
}

/** Shown in the persistent mount on any page while the viewer has a live room they are not in the context of (R12). */
export function MiniView({ roomIds }: { roomIds: string[] }) {
  const t = useStrings();
  const { controller } = useRoomController();
  return (
    <div data-social-persistent="mini">
      {roomIds.map((roomId) => (
        <section key={roomId} data-mini-room={roomId} aria-label={t.inRoom}>
          <span>{t.inRoom}</span> <HostLink to={`/social/r/${roomId}`}>{t.backToRoom}</HostLink>{" "}
          <button type="button" data-action="enlarge" onClick={() => void controller?.enlarge(roomId)}>
            {t.enlarge}
          </button>
          <button type="button" data-action="leave" onClick={() => controller?.leave(roomId)}>
            {t.leave}
          </button>
        </section>
      ))}
    </div>
  );
}
