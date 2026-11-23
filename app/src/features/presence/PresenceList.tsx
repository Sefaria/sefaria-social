import type { PresentParticipant, SessionState } from "@sefaria-social/session";
import { useRoomSession, useSessionState } from "~/features/session/use-room-session";
import { useStrings } from "~/features/shell/use-strings";

/**
 * Who is in the room, live (spec 012): each person's name, whether they lead (hold the spotlight), whom they follow, and
 * whether they stepped away. The viewer's own entry says "you". Names may be Hebrew: each carries dir="auto". With
 * `onFollow`, every other person gets a Follow button (spec 014).
 */
export function PresenceList({ roomId, onFollow }: { roomId: string; onFollow?: (participantId: string) => void }) {
  const t = useStrings();
  const session = useRoomSession(roomId);
  const state = useSessionState(session);
  if (!state) return null;
  const nameOf = (id: string | null) => state.participants.find((p) => p.id === id)?.name || t.someone;
  const reconnecting = state.status === "reconnecting" || state.status === "connecting";
  return (
    <section aria-label={t.whoIsHere} data-social-presence={roomId} data-session-status={state.status}>
      <h2>{t.whoIsHere}</h2>
      {reconnecting && <p role="status">{t.reconnecting}</p>}
      <ul>
        {state.participants.map((p) => (
          <Entry key={p.id} p={p} state={state} nameOf={nameOf} onFollow={onFollow} />
        ))}
      </ul>
    </section>
  );
}

function Entry({
  p,
  state,
  nameOf,
  onFollow,
}: {
  p: PresentParticipant;
  state: SessionState;
  nameOf: (id: string | null) => string;
  onFollow?: (participantId: string) => void;
}) {
  const t = useStrings();
  const self = p.id === state.self.id;
  const leading = state.room.spotlight === p.id;
  return (
    <li data-participant={p.id} data-self={self || undefined} data-leading={leading || undefined} data-away={p.away || undefined}>
      <bdi dir="auto" data-name="">
        {p.name || t.someone}
      </bdi>
      {self && <span data-you=""> ({t.you})</span>}
      {leading && <span data-role="leading"> · {t.leading}</span>}
      {p.following && (
        <span data-following={p.following}>
          {" "}
          · {t.following} <bdi dir="auto">{nameOf(p.following)}</bdi>
        </span>
      )}
      {p.away && <span data-role="away"> · {t.away}</span>}
      {!self && onFollow && (
        <button type="button" data-action="follow" onClick={() => onFollow(p.id)} aria-pressed={state.following === p.id}>
          {t.follow}
        </button>
      )}
    </li>
  );
}
