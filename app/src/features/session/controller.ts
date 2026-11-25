// Entering and leaving a room's reader context (routing rules R8–R12; spec 013), through the session state machine (spec 004)
// and the host. One controller per host, shared by the page mount (the lobby's Enter) and the persistent mount (mini view,
// follow bar). The address is the source of truth: `ctx=social.room.<id>` in the reader's URL means "in the room" (R11), so
// the controller reacts to host.reader.context and never to its own memory alone.
//
//   Enlarge (R9):  own place (only from a reader page) → target snapshot (what the followed stream holds) → push with ctx →
//                  on contextReady, the follow gate opens and the target is applied with origin "follow".
//   In context (R10): the stream applies through applySnapshot, which replaces: one enlarge, one history entry.
//   Back / ctx gone: contextLost → idle; nothing more is applied. A reader page reached without ctx while in the room (a link,
//                  a search) gets the ctx back instead (spec 045): the room stays until Minimise, Leave, Back or a Social page.
//   Minimise (R12): push the own place without ctx (then restore it), else the lobby; the connection stays ("live").
import type { ReaderSnapshot, SurfaceHost } from "@sefaria-social/host-contract";
import { decodeCtx, withCtx, withoutCtx } from "~/lib/ctx";
import { INITIAL_SESSION, transition, type SessionEvent, type SessionView } from "./machine";
import { roomSessionsFor, type RoomSessions } from "./sessions";
import { documentHostFor } from "~/features/host/document-host";

/** How long Enlarge waits for the followed person's state before entering without it (they may be idle in their lobby). */
export const TARGET_WAIT_MS = 1_500;
/** Where a viewer lands when nobody in the room is publishing yet: the library. */
export const FALLBACK_URL = "/texts";
/** An enter whose context never shows up in the address is abandoned after this long. */
export const ENTER_TIMEOUT_MS = 10_000;
/** A press on a card holds the room's session this long; an enlarge within it takes over (spec 017 AC-004). */
export const PREFETCH_MS = 10_000;

export interface EnlargeOptions {
  /** Where to land when the room's stream has no state yet: a card passes its ref's reader address (spec 018). */
  fallbackUrl?: string;
}

export interface RoomController {
  view(): SessionView;
  subscribe(cb: () => void): () => void;
  /** Rooms the viewer entered and has not left (their connection stays while they browse elsewhere). */
  liveRooms(): string[];
  enlarge(roomId: string, opts?: EnlargeOptions): Promise<void>;
  /** Resolves true once the viewer is in this room's context (expanded or detached), false after `ms`. */
  whenEntered(roomId: string, ms: number): Promise<boolean>;
  /** Prepare a room's session on a press (one socket, held PREFETCH_MS unless an enlarge follows). Signed out: nothing. */
  prefetch(roomId: string): void;
  minimise(): void;
  /** Leave the room's session: out of its context if in it, and close its connection. */
  leave(roomId: string): void;
  /** Run `cb(roomId)` at the start of every leave, before the room's holds are released (a call ends first, spec 034). */
  onLeave(cb: (roomId: string) => void): () => void;
  /** Spec 050 AC-002: the room whose session was closed while the viewer was in it (for the notice); null when none. */
  closedRoom(): string | null;
  dismissClosed(): void;
  /**
   * Spec 050 AC-002: the owner ends the session for everyone (the relay's `end`). The caller finishes a recording and ends a
   * broadcast first (features/room/close.ts); this leaves the room and its call here.
   */
  close(roomId: string): void;
  /** Follow a participant; null follows the room's leader again (spec 048). */
  follow(participantId: string | null): void;
  /**
   * The viewer clicked a person, in who is here or on their call tile (spec 048 AC-007): follow them; the one already followed,
   * or the leader, takes the viewer back to the leader. Clicking oneself does nothing.
   */
  pick(participantId: string): void;
  followAgain(): void;
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
  const leaveListeners = new Set<(roomId: string) => void>();
  const live = new Map<string, () => void>();
  let contextHold: { roomId: string; release: () => void } | null = null;
  let offClient: (() => void) | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreAfterLeave: ReaderSnapshot | null = null;
  let closed: string | null = null;
  /** Spec 050 AC-002: a watch on each live room's session, so a minimised room that closes is left and reported too. */
  const endWatch = new Map<string, () => void>();
  const prefetched = new Map<string, { release: () => void; timer: ReturnType<typeof setTimeout> }>();
  const dropPrefetch = (roomId: string) => {
    const p = prefetched.get(roomId);
    if (!p) return;
    clearTimeout(p.timer);
    prefetched.delete(roomId);
    p.release();
  };

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
      const { status, room } = session.client.getState();
      // The room ended (not this viewer leaving, which ends their client too).
      if (status === "ended" && room.ended) {
        offClient?.();
        offClient = null;
        roomEnded(roomId);
        return;
      }
      if (status === "paused" && view.kind === "expanded") step({ type: "detach" });
      else if (status !== "paused" && view.kind === "detached") step({ type: "rejoin" });
      const following = status !== "leading";
      if (view.kind === "expanded" && view.following !== following)
        step({ type: following ? "startFollowing" : "stopFollowing" });
    };
    offClient = session.client.subscribe(sync);
    sync();
  }

  /** Spec 050 AC-002: the room was closed (or its owner was gone too long): out of it and its call, with a notice. */
  function roomEnded(roomId: string) {
    if (!live.has(roomId) && roomOf(view) !== roomId) return; // already left
    closed = roomId;
    controller.leave(roomId);
  }

  function watchEnd(roomId: string) {
    if (endWatch.has(roomId)) return;
    const client = sessions.get(roomId)?.client;
    if (!client) return;
    endWatch.set(
      roomId,
      client.subscribe(() => {
        const { status, room } = client.getState();
        if (status === "ended" && room.ended) roomEnded(roomId);
      }),
    );
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
      // Spec 045 AC-001: reading around in the reader keeps the viewer in the room. A reader page reached without any ctx (a
      // link, a search) gets the room's ctx back, replacing the entry. Back to the page they entered from, a Social page, or
      // another room's address still leaves (spec 013 AC-002, R10).
      if (!ctx && current && stayInRoom(view.ownPlace?.url ?? null)) {
        const { pathname, search, hash } = host.location.get();
        host.navigate(withCtx(`${pathname}${search}${hash}`, { kind: "room", id: current }), { replace: true });
        return;
      }
      step({ type: "contextLost" }); // Back, a Social page, another room's link: out of this room's context
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

  /** Whether the address the reader is now on is a reader page to keep the room on (not Social's, not where they entered from). */
  function stayInRoom(ownUrl: string | null): boolean {
    const { pathname, search } = host.location.get();
    if (pathname === "/social" || pathname.startsWith("/social/")) return false;
    if (ownUrl && samePlace(withoutCtx(ownUrl), `${pathname}${search}`)) return false;
    return true;
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

  const controller: RoomController = {
    view: () => view,
    closedRoom: () => closed,
    dismissClosed() {
      if (closed === null) return;
      closed = null;
      emit();
    },
    close(roomId) {
      sessions.get(roomId)?.client.end();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    liveRooms: () => [...live.keys()],

    async enlarge(roomId, opts) {
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
      watchEnd(roomId);
      dropPrefetch(roomId); // the live hold keeps the prepared session (and its socket) open from here
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
      host.navigate(withCtx(target?.url ?? opts?.fallbackUrl ?? FALLBACK_URL, { kind: "room", id: roomId }));
    },

    whenEntered(roomId, ms) {
      const inRoom = () => (view.kind === "expanded" || view.kind === "detached") && view.context.id === roomId;
      if (inRoom()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => finish(false), ms);
        listeners.add(check);
        function check() {
          if (inRoom()) finish(true);
        }
        function finish(ok: boolean) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(ok);
        }
      });
    },

    prefetch(roomId) {
      if (!host.viewer.get() || live.has(roomId) || prefetched.has(roomId)) return;
      const release = sessions.acquire(roomId, "prefetch");
      prefetched.set(roomId, { release, timer: setTimeout(() => dropPrefetch(roomId), PREFETCH_MS) });
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
      for (const cb of [...leaveListeners]) cb(roomId);
      if (roomOf(view) === roomId) this.minimise();
      live.get(roomId)?.();
      live.delete(roomId);
      endWatch.get(roomId)?.();
      endWatch.delete(roomId);
      emit();
    },

    onLeave(cb) {
      leaveListeners.add(cb);
      return () => void leaveListeners.delete(cb);
    },

    follow(participantId) {
      const roomId = roomOf(view);
      if (roomId) sessions.get(roomId)?.client.follow(participantId);
    },
    pick(participantId) {
      const roomId = roomOf(view);
      const client = roomId ? sessions.get(roomId)?.client : null;
      if (!client) return;
      const s = client.getState();
      if (participantId === s.self.id) return;
      client.follow(participantId === s.chosen || participantId === s.room.spotlight ? null : participantId);
    },
    followAgain() {
      const roomId = roomOf(view);
      if (roomId) sessions.get(roomId)?.client.followAgain();
    },

    dispose() {
      offContext();
      offViewer();
      dropContext();
      for (const release of live.values()) release();
      live.clear();
      for (const off of endWatch.values()) off();
      endWatch.clear();
      for (const roomId of [...prefetched.keys()]) dropPrefetch(roomId);
      if (enterTimer) clearTimeout(enterTimer);
    },
  };
  return controller;
}

const perHost = new WeakMap<SurfaceHost, RoomController>();

/** The one controller of this host (page mount and persistent mount share it). */
export function roomControllerFor(rawHost: SurfaceHost): RoomController {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let c = perHost.get(host);
  if (!c) {
    c = createRoomController(host);
    perHost.set(host, c);
  }
  return c;
}

/** Two same-site addresses name the same place: same path and the same query parameters in any order (the fragment aside). */
function samePlace(a: string, b: string): boolean {
  const norm = (u: string) => {
    const url = new URL(u, "https://x.invalid");
    const params = [...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort();
    return `${decodeURIComponent(url.pathname)}?${params.join("&")}`;
  };
  return norm(a) === norm(b);
}
