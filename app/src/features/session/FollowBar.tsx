import { useEffect, useState, type ReactNode } from "react";
import type { SessionState } from "@sefaria-social/session";
import { CallButton } from "~/features/av/CallButton";
import { RecordToggle } from "~/features/recording/RecordButton";
import { useBroadcastController, useHostView } from "~/features/broadcast/use-broadcast";
import { useHost } from "~/features/host/host-context";
import { closeSession } from "~/features/room/close";
import { sessionKindOf } from "./session-kind";
import { useChromeInsets } from "~/features/av/insets";
import { useRoomsApi } from "~/features/api/rooms-api";
import { HostLink } from "~/features/host/HostLink";
import { PresenceList } from "~/features/presence/PresenceList";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { useRoomController, useRoomSession, useSessionState } from "./use-room-session";
import styles from "./room-window.module.css";

/**
 * The room window (spec 045), shown in the persistent mount while the reader is in a room's context (specs 013, 014): a card at
 * the bottom inline-start corner — clear of the reader's own controls at the other corner — with the room's title and a live dot,
 * whom the viewer follows or that they are on their own (Follow again) or leading, Join call, the room's page, Minimise, and who
 * is here with Follow buttons. It folds into a pill and remembers that for the browser session.
 *
 * Spec 048: the room's owner is its one leader, so there is no Lead button. Clicking a person follows them; clicking the one you
 * follow, or the leader, returns you to the leader. A leader who follows someone takes their followers along and gets Lead again.
 */
export function FollowBar({ roomId }: { roomId: string }) {
  const t = useStrings();
  const { controller, view } = useRoomController();
  const state = useSessionState(useRoomSession(roomId));
  const title = useRoomTitle(roomId);
  const [collapsed, setCollapsed] = useCollapsed();
  const nameOf = (id: string | null) => state?.participants.find((p) => p.id === id)?.name || t.someone;
  const status = state?.status ?? null;
  const inContext = (view.kind === "expanded" || view.kind === "detached") && view.context.id === roomId;
  const line =
    status === "live" ? (
      <>
        {t.statusFollowing} <bdi dir="auto">{nameOf(state!.following)}</bdi>
      </>
    ) : status === "paused" ? (
      t.statusOnYourOwn
    ) : status === "leading" ? (
      t.statusLeading
    ) : status === "no-leader" ? (
      t.statusNoLeader
    ) : status === "leader-away" ? (
      t.statusLeaderAway
    ) : status === "connecting" || status === "reconnecting" ? (
      t.reconnecting
    ) : (
      t.inRoom
    );
  const tone = status === "connecting" || status === "reconnecting" ? "waiting" : status === "paused" ? "own" : "live";
  const here = state?.participants.length ?? 0;
  const holdsSpotlight = !!state && state.room.spotlight === state.self.id;
  const owner = !!state && isOwner(state);
  const ending = useEnding(roomId);

  return (
    <Window
      label={t.roomWindow(title ?? t.untitledRoom)}
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      pill={
        <>
          <Dot tone={tone} />
          <span className={styles.pillTitle}>
            <bdi dir="auto">{title ?? t.untitledRoom}</bdi>
          </span>
          <span className={styles.pillStatus}>{line}</span>
        </>
      }
      attrs={{ "data-social-persistent": "room", "data-follow-status": status ?? undefined, "data-session-view": view.kind }}
    >
      <header className={styles.header}>
        <Dot tone={tone} />
        <h2 className={styles.title}>
          <bdi dir="auto">{title ?? t.untitledRoom}</bdi>
        </h2>
        {here > 0 && <span className={styles.count}>{t.hereCount(here)}</span>}
      </header>
      <p data-follow-line="" className={styles.line}>
        {line}
      </p>
      <div className={styles.actions}>
        {status === "paused" && (
          <button
            type="button"
            className={`${kit.button} ${kit.primary} ${kit.small}`}
            data-action="follow-again"
            onClick={() => controller?.followAgain()}
          >
            {t.followAgain}
          </button>
        )}
        {holdsSpotlight && state.chosen !== null && (
          <button
            type="button"
            className={`${kit.button} ${kit.primary} ${kit.small}`}
            data-action="lead-again"
            onClick={() => controller?.follow(null)}
          >
            {t.leadAgain}
          </button>
        )}
        <CallButton roomId={roomId} />
        {/* Spec 050 AC-001: the room's owner, while leading, records from here. */}
        {status === "leading" && state?.self && isOwner(state) && <RecordToggle roomId={roomId} />}
      </div>
      <div className={styles.people}>
        <PresenceList roomId={roomId} onFollow={(id) => controller?.pick(id)} />
      </div>
      <footer className={styles.footer}>
        <HostLink to={`/social/r/${roomId}`} className={kit.link}>
          {t.backToRoom}
        </HostLink>
        {/* Spec 050 AC-002, AC-003, AC-007: the owner ends the session for everyone; anyone else leaves it. */}
        {state && inContext && owner && <EndSession roomId={roomId} label={ending} />}
        {state && inContext && !owner && (
          <button
            type="button"
            className={`${kit.button} ${kit.ghost} ${kit.small}`}
            data-action="leave-session"
            onClick={() => controller?.leave(roomId)}
          >
            {t.leave}
          </button>
        )}
        {inContext && (
          <button
            type="button"
            className={`${kit.button} ${kit.ghost} ${kit.small}`}
            data-action="minimise"
            onClick={() => controller?.minimise()}
          >
            {t.minimise}
          </button>
        )}
      </footer>
    </Window>
  );
}

/** The owner's word for ending (spec 050 AC-007): by the kind chosen at Start, or End broadcast while one is live here. */
function useEnding(roomId: string): "finish" | "end-broadcast" | "close" {
  const live = useHostView(useBroadcastController());
  const kind = sessionKindOf(roomId);
  if (kind === "recording") return "finish";
  if (kind === "broadcast" || (live.kind === "live" && live.roomId === roomId)) return "end-broadcast";
  return "close";
}

/** Close room, End broadcast or Finish and save, with a confirmation that says it ends the session for everyone. */
function EndSession({ roomId, label }: { roomId: string; label: "finish" | "end-broadcast" | "close" }) {
  const t = useStrings();
  const host = useHost();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const word = label === "finish" ? t.finishAndSave : label === "end-broadcast" ? t.endBroadcast : t.closeRoom;
  if (!asking)
    return (
      <button
        type="button"
        className={`${kit.button} ${kit.secondary} ${kit.small}`}
        data-action="end-session"
        data-ending={label}
        onClick={() => setAsking(true)}
      >
        {word}
      </button>
    );
  return (
    <div role="group" aria-label={word} data-end-confirm="" className={styles.confirm}>
      <p className={styles.line}>{label === "finish" ? t.finishConfirm : t.closeConfirm}</p>
      <button
        type="button"
        className={`${kit.button} ${kit.primary} ${kit.small}`}
        data-action="confirm-end-session"
        disabled={busy || !host}
        onClick={() => {
          if (!host) return;
          setBusy(true);
          void closeSession(host, roomId).finally(() => setBusy(false));
        }}
      >
        {word}
      </button>
      <button
        type="button"
        className={`${kit.button} ${kit.ghost} ${kit.small}`}
        data-action="cancel-end-session"
        disabled={busy}
        onClick={() => setAsking(false)}
      >
        {t.cancel}
      </button>
    </div>
  );
}

/** Spec 050 AC-002: the room the viewer was in was closed; a notice with the room's page, until dismissed. */
export function ClosedNotice() {
  const t = useStrings();
  const { controller } = useRoomController();
  const roomId = controller?.closedRoom() ?? null;
  if (!roomId) return null;
  return (
    <div role="status" data-room-closed={roomId} className={`${styles.window} ${styles.notice}`}>
      <p className={styles.line}>{t.roomClosed}</p>
      <div className={styles.actions}>
        <HostLink to={`/social/r/${roomId}`} className={kit.link}>
          {t.backToRoom}
        </HostLink>
        <button
          type="button"
          className={`${kit.button} ${kit.ghost} ${kit.small}`}
          data-action="dismiss-closed"
          onClick={() => controller?.dismissClosed()}
        >
          {t.dismissNotice}
        </button>
      </div>
    </div>
  );
}

/** Shown in the persistent mount on any page while the viewer has a live room they are not in the context of (R12): the same card, compact. */
export function MiniView({ roomIds }: { roomIds: string[] }) {
  const t = useStrings();
  const [collapsed, setCollapsed] = useCollapsed();
  return (
    <Window
      label={t.inRoom}
      collapsed={collapsed}
      onToggle={() => setCollapsed(!collapsed)}
      pill={
        <>
          <Dot tone="live" />
          <span className={styles.pillTitle}>{t.inRoom}</span>
        </>
      }
      attrs={{ "data-social-persistent": "mini" }}
    >
      {roomIds.map((roomId) => (
        <MiniRoom key={roomId} roomId={roomId} />
      ))}
    </Window>
  );
}

function MiniRoom({ roomId }: { roomId: string }) {
  const t = useStrings();
  const { controller } = useRoomController();
  const title = useRoomTitle(roomId);
  return (
    <section data-mini-room={roomId} aria-label={t.inRoom} className={styles.mini}>
      <header className={styles.header}>
        <Dot tone="live" />
        <h2 className={styles.title}>
          <bdi dir="auto">{title ?? t.untitledRoom}</bdi>
        </h2>
      </header>
      <p className={styles.line}>
        <span>{t.inRoom}</span>{" "}
        <HostLink to={`/social/r/${roomId}`} className={kit.link}>
          {t.backToRoom}
        </HostLink>
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${kit.button} ${kit.primary} ${kit.small}`}
          data-action="enlarge"
          onClick={() => void controller?.enlarge(roomId)}
        >
          {t.enlarge}
        </button>
        <button
          type="button"
          className={`${kit.button} ${kit.ghost} ${kit.small}`}
          data-action="leave"
          onClick={() => controller?.leave(roomId)}
        >
          {t.leave}
        </button>
      </div>
    </section>
  );
}

/** The card and its pill: a labelled region fixed at the bottom inline-start corner, above the reader's bottom chrome. */
function Window({
  label,
  collapsed,
  onToggle,
  pill,
  attrs,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  pill: ReactNode;
  attrs: Record<string, string | undefined>;
  children: ReactNode;
}) {
  const t = useStrings();
  const insets = useChromeInsets();
  const place = { insetBlockEnd: `${insets.bottom + 16}px`, insetInlineStart: `${insets.inlineStart + 16}px` };
  return (
    <section
      {...attrs}
      role="region"
      aria-label={label}
      className={collapsed ? `${styles.window} ${styles.collapsed}` : styles.window}
      style={place}
      data-room-window={collapsed ? "collapsed" : "open"}
    >
      {collapsed ? (
        <button
          type="button"
          className={styles.pill}
          aria-expanded={false}
          aria-label={t.showRoomWindow}
          onClick={onToggle}
          data-action="show-room-window"
        >
          {pill}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`${kit.iconButton} ${styles.toggle}`}
            aria-expanded={true}
            aria-label={t.hideRoomWindow}
            title={t.hideRoomWindow}
            onClick={onToggle}
            data-action="hide-room-window"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 6l5 5 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {children}
        </>
      )}
    </section>
  );
}

function Dot({ tone }: { tone: "live" | "own" | "waiting" }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden="true" />;
}

/** The viewer is the room's owner: the relay marks only the owner's join as a host (spec 048 AC-005). */
export const isOwner = (s: SessionState) => !!s.participants.find((p) => p.id === s.self.id)?.isHost;

const COLLAPSED_KEY = "social.roomWindow";
let collapsedNow: boolean | null = null;
const collapsedSubs = new Set<(v: boolean) => void>();

/** Whether the room window is folded into its pill, for this browser session (sessionStorage, read and written in try/catch). */
function useCollapsed(): [boolean, (v: boolean) => void] {
  if (collapsedNow === null) {
    try {
      collapsedNow = typeof sessionStorage !== "undefined" && sessionStorage.getItem(COLLAPSED_KEY) === "collapsed";
    } catch {
      collapsedNow = false;
    }
  }
  const [value, setValue] = useState(collapsedNow);
  useEffect(() => {
    collapsedSubs.add(setValue);
    return () => void collapsedSubs.delete(setValue);
  }, []);
  const set = (v: boolean) => {
    collapsedNow = v;
    try {
      sessionStorage.setItem(COLLAPSED_KEY, v ? "collapsed" : "open");
    } catch {
      // private windows and blocked storage: the choice lasts for this page only
    }
    collapsedSubs.forEach((cb) => cb(v));
  };
  return [value, set];
}

const titles = new Map<string, Promise<string | null>>();
const known = new Map<string, string>();

/** The room's title from the rooms API, once per room per page; null until it arrives or when it cannot be read. */
function useRoomTitle(roomId: string): string | null {
  const api = useRoomsApi();
  const [title, setTitle] = useState<string | null>(known.get(roomId) ?? null);
  useEffect(() => {
    if (!api || known.has(roomId)) return;
    let live = true;
    let pending = titles.get(roomId);
    if (!pending) {
      pending = api.getRoom(roomId).then(
        (r) => (r.kind === "member" ? r.room.title : null),
        () => null,
      );
      titles.set(roomId, pending);
    }
    void pending.then((v) => {
      if (v) known.set(roomId, v);
      else titles.delete(roomId);
      if (live) setTitle(v);
    });
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return title;
}
