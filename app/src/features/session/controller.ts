// Entering and leaving a room's reader context (routing rules R8–R12; spec 013), through the session state machine (spec 004)
// and the host. One controller per host, shared by the page mount (the lobby's Enter) and the persistent mount (mini view,
// follow bar). The address is the source of truth: `ctx=social.room.<id>` in the reader's URL means "in the room" (R11), so
// the controller reacts to host.reader.context and never to its own memory alone.
//
//   Enlarge (R9):  own place (only from a reader page) → target snapshot (what the followed stream holds) → push with ctx →
//                  on contextReady, the follow gate opens and the target is applied with origin "follow".
//   In context (R10): the stream applies through applySnapshot, which replaces: one enlarge, one history entry.
//   Back / ctx gone: contextLost → idle; nothing more is applied.
//   Minimise (R12): push the own place without ctx (then restore it), else the lobby; the connection stays ("live").
import type { ReaderSnapshot, SurfaceHost } from "@sefaria-social/host-contract";
import { decodeCtx, withCtx, withoutCtx } from "~/lib/ctx";
import { INITIAL_SESSION, transition, type SessionEvent, type SessionView } from "./machine";
import { roomSessionsFor, type RoomSessions } from "./sessions";

/** How long Enlarge waits for the followed person's state before entering without it (they may be idle in their lobby). */
export const TARGET_WAIT_MS = 1_500;
/** Where a viewer lands when nobody in the room is publishing yet: the library. */
export const FALLBACK_URL = "/texts";
/** An enter whose context never shows up in the address is abandoned after this long. */
export const ENTER_TIMEOUT_MS = 10_000;

export interface RoomController {
  view(): SessionView;
  subscribe(cb: () => void): () => void;
  /** Rooms the viewer entered and has not left (their connection stays while they browse elsewhere). */
  liveRooms(): string[];
  enlarge(roomId: string): Promise<void>;
  minimise(): void;
  /** Leave the room's session: out of its context if in it, and close its connection. */
  leave(roomId: string): void;
  follow(participantId: string | null): void;
  followAgain(): void;
  lead(): void;
  dispose(): void;
}

const isReaderPage = (pathname: string) => !/^\/social(?:[/?#]|$)/.test(pathname);
const roomOf = (v: SessionView): string | null =>
  v.kind === "expanded" || v.kind === "detached" || v.kind === "leaving"
    ? v.context.id
    : v.kind === "entering"
      ? v.target.id
      : null;

export function createRoomController(host: SurfaceHost, sessions: RoomSessions = roomSessionsFor(host)): RoomController {
  let view: SessionView = INITIAL_SESSION;
  const listeners = new Set<() => void>();
  const live = new Map<string, () => void>();
  let contextHold: { roomId: string; release: () => void } | null = null;
  let offClient: (() => void) | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreAfterLeave: ReaderSnapshot | null = null;

  const emit = () => [...listeners].forEach((cb) => cb());
  const step = (event: SessionEvent) => {
    const r = transition(view, event);
    if (!r.ok) return false;
    view = r.state;
    sessions.refresh();
    emit();
    return true;
  };

  sessions.setPolicy({
    isOpen: (roomId) => view.kind === "expanded" && view.context.id === roomId,
    canPublish: (roomId) => (view.kind === "expanded" || view.kind === "detached") && view.context.id === roomId,
  });

  function holdContext(roomId: string) {
    if (contextHold?.roomId === roomId) return;
    contextHold?.release();
    contextHold = { roomId, release: sessions.acquire(roomId, "context") };
  }
  function dropContext() {
    contextHold?.release();
    contextHold = null;
    offClient?.();
    offClient = null;
  }

  /** Breaking away is the client's call (the person's own input pauses it); mirror it in the machine. */
  function watchClient(roomId: string) {
    offClient?.();
    const session = sessions.get(roomId);
    if (!session) return;
    const sync = () => {
      const status = session.client.getState().status;
      if (status === "paused" && view.kind === "expanded") step({ type: "detach" });
      else if (status !== "paused" && view.kind === "detached") step({ type: "rejoin" });
      const following = status !== "leading";
      if (view.kind === "expanded" && view.following !== following)
        step({ type: following ? "startFollowing" : "stopFollowing" });
    };
    offClient = session.client.subscribe(sync);
    sync();
  }

  function entered(roomId: string) {
    if (enterTimer) clearTimeout(enterTimer);
    enterTimer = null;
    holdContext(roomId);
    step({ type: "contextReady", context: { kind: "room", id: roomId } });
    const session = sessions.get(roomId);
    session?.client.followAgain(); // input in the lobby may have paused it; entering means following
    void session?.reader.release(); // R9 step 4: apply the target now that the reader is in the context
    watchClient(roomId);
  }

  function onContext() {
    const ctx = decodeCtx(host.reader.context.get());
    const inRoom = ctx?.kind === "room" ? ctx.id : null;
    const current = roomOf(view);
    if (view.kind === "entering") {
      if (inRoom === view.target.id) entered(inRoom);
      return; // the push may not have landed yet; the timeout abandons an enter that never does
    }
    if (view.kind === "leaving") {
      if (inRoom !== view.context.id) {
        step({ type: "left" });
        dropContext();
        if (restoreAfterLeave) {
          // R12: back to the viewer's own place, as they left it (scroll and slices), without any ctx.
          const own = { ...restoreAfterLeave, url: withoutCtx(restoreAfterLeave.url) };
          restoreAfterLeave = null;
          void host.reader.state.applySnapshot(own, { origin: "external", persist: false });
        }
      }
      return;
    }
    if ((view.kind === "expanded" || view.kind === "detached") && inRoom !== current) {
      step({ type: "contextLost" }); // Back, a plain link, another room's link: out of this room's context
      dropContext();
    }
    if (inRoom && (view.kind === "idle" || view.kind === "card") && host.viewer.get()) {
      // A ctx address with no enlarge behind it: a cold load, a refresh, Forward, a shared link (R11). Reconnect from the
      // ctx value alone; the stream's keyframe then applies through the open gate.
      holdContext(inRoom);
      step({ type: "enlarge", target: { kind: "room", id: inRoom }, ownPlace: null });
      entered(inRoom);
    }
  }

  const offContext = host.reader.context.subscribe(onContext);
  // The reader may learn who is signed in after mounting us; a ctx address waits for that.
  const offViewer = host.viewer.subscribe(onContext);
  onContext();

  /** The followed stream's state, waiting a little for it if the room has someone to follow. */
  async function targetFor(roomId: string): Promise<ReaderSnapshot | null> {
    const session = sessions.get(roomId);
    if (!session) return null;
    const ready = () => {
      const s = session.client.getState();
      if (session.reader.held()) return true;
      // Known to have nothing to wait for: this viewer leads, or nobody does.
      return s.status === "leading" || s.status === "no-leader" || s.status === "ended";
    };
    if (!ready())
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, TARGET_WAIT_MS);
        const off = session.client.subscribe(() => ready() && done());
        function done() {
          clearTimeout(timer);
          off();
          resolve();
        }
      });
    return session.reader.held();
  }

  return {
    view: () => view,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    liveRooms: () => [...live.keys()],

    async enlarge(roomId) {
      if (roomOf(view) === roomId && view.kind !== "leaving") return;
      if (view.kind !== "idle" && view.kind !== "card") return;
      if (!host.viewer.get()) {
        host.viewer.requestSignIn(); // R17
        return;
      }
      // R9 (1): the viewer's own place, only if they are on a reader page now.
      const location = host.location.get();
      const ownPlace = isReaderPage(location.pathname) ? host.reader.state.getSnapshot() : null;
      if (!live.has(roomId)) live.set(roomId, sessions.acquire(roomId, "live"));
      emit();
      // R9 (2): the target, validated by the follow gate when it arrived.
      const target = await targetFor(roomId);
      if (view.kind !== "idle" && view.kind !== "card") return; // something else happened while we waited
      if (!step({ type: "enlarge", target: { kind: "room", id: roomId }, ownPlace })) return;
      enterTimer = setTimeout(
        () => step({ type: "enterFailed", reason: "the context never reached the address" }),
        ENTER_TIMEOUT_MS,
      );
      // R9 (3): one push, with ctx. (4) happens in onContext once the reader reports the context.
      host.navigate(withCtx(target?.url ?? FALLBACK_URL, { kind: "room", id: roomId }));
    },

    minimise() {
      if (view.kind !== "expanded" && view.kind !== "detached") return;
      const own = view.ownPlace;
      const returnTo = own ? withoutCtx(own.url) : `/social/r/${view.context.id}`;
      restoreAfterLeave = own;
      if (!step({ type: "minimise", returnTo })) return;
      host.navigate(returnTo);
    },

    leave(roomId) {
      if (roomOf(view) === roomId) this.minimise();
      live.get(roomId)?.();
      live.delete(roomId);
      emit();
    },

    follow(participantId) {
      const roomId = roomOf(view);
      if (roomId) sessions.get(roomId)?.client.follow(participantId);
    },
    followAgain() {
      const roomId = roomOf(view);
      if (roomId) sessions.get(roomId)?.client.followAgain();
    },
    lead() {
      const roomId = roomOf(view);
      const session = roomId ? sessions.get(roomId) : null;
      session?.client.spotlight(session.client.getState().self.id);
    },

    dispose() {
      offContext();
      offViewer();
      dropContext();
      for (const release of live.values()) release();
      live.clear();
      if (enterTimer) clearTimeout(enterTimer);
    },
  };
}

const perHost = new WeakMap<SurfaceHost, RoomController>();

/** The one controller of this host (page mount and persistent mount share it). */
export function roomControllerFor(host: SurfaceHost): RoomController {
  let c = perHost.get(host);
  if (!c) {
    c = createRoomController(host);
    perHost.set(host, c);
  }
  return c;
}
