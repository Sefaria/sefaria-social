// Broadcasting and watching (spec 043; design docs/design/session-recording-and-broadcast.md 6.3). One controller per host,
// shared by the lobby's panel, the watch page and the persistent mount's bar.
//
//   Host:   start(room) → POST → ticket → second session connection to b_<id> (role host, publishing while on a reader page,
//           never applying) holding the spotlight → live { id, link, viewers }; joinCall() opens the broadcast's call with
//           the normal pre-join step; end() → tell the room, POST end, close the connection, leave the broadcast's call.
//   Viewer: watch(id) → GET (ended → ended) → ticket → connection to b_<id> (never publishes, never leads) → the host's first
//           state → navigate there with ctx=social.watch.<id> → follow; local input breaks away (paused) and backToLive()
//           follows again; the call is joined view only (no pre-join, no devices). The room ending, or the server saying the
//           broadcast is over, ends watching: no more following and no media. A ctx address with no watch behind it (a cold
//           load, a refresh) rejoins as a viewer without navigating.
//
// Tickets are bearer credentials for 10 minutes: kept in memory, and fetched again before a connect when the one held is
// about to expire (the relay checks a ticket only when a socket connects, so a reconnect needs a fresh one).
import type { SurfaceHost } from "@sefaria-social/host-contract";
import type { ReaderSnapshot } from "@sefaria-social/session";
import type { CallController } from "~/features/av/call-controller";
import { callControllerFor } from "~/features/av/call-controller";
import { callRoom } from "~/features/av/machine";
import { windowOwnerFor } from "~/features/av/window-owner";
import { FALLBACK_URL, TARGET_WAIT_MS } from "~/features/session/controller";
import { withoutAnyCtx } from "~/features/session/room-reader";
import { roomSessionsFor, type RoomSession, type RoomSessions } from "~/features/session/sessions";
import { ID_RE } from "~/lib/ids";
import { broadcastApiFor, type BroadcastApi, type BroadcastTicket } from "./broadcast-api";

/** A ticket this close to its expiry is replaced before the next connect. */
export const TICKET_MARGIN_MS = 60_000;
/** How long End broadcast waits for the room to confirm the end before closing its connection anyway. */
export const END_WAIT_MS = 2_000;

export type HostView =
  | { kind: "idle" }
  | { kind: "starting"; roomId: string }
  | { kind: "live"; roomId: string; id: string; link: string; viewers: number | null }
  | { kind: "ending"; roomId: string; id: string }
  | { kind: "failed"; roomId: string; reason: "already-live" | "forbidden" | "error" };

export type WatchView =
  | { kind: "idle" }
  | { kind: "connecting"; id: string }
  | { kind: "watching"; id: string; following: boolean; hostName: string | null }
  | { kind: "ended"; id: string }
  | { kind: "failed"; id: string; reason: "not-found" | "error" };

export interface BroadcastController {
  hostView(): HostView;
  watchView(): WatchView;
  subscribe(cb: () => void): () => void;
  start(roomId: string): Promise<void>;
  /** The host's panel found its room's live broadcast after a reload: reconnect as its host and publish again. */
  resume(roomId: string, live: { id: string; link: string }): Promise<void>;
  /** The host joins the broadcast's call through the normal pre-join step. */
  joinCall(): Promise<void>;
  end(): Promise<void>;
  /** `navigate: false` when the address is already in the watch context (a cold load). */
  watch(broadcastId: string, opts?: { navigate?: boolean }): Promise<void>;
  backToLive(): void;
  /** Stop watching: the connection, the call and the watch context go. */
  leave(): void;
  dispose(): void;
}

export interface BroadcastDeps {
  host: SurfaceHost;
  api: BroadcastApi;
  sessions: Pick<RoomSessions, "acquire" | "get">;
  calls: Pick<CallController, "open" | "joinWith" | "leave" | "view" | "dismiss">;
  /** Who owns the floating window (features/av/window-owner.ts): asked before any call is joined. */
  windowOwner?: { request(owner: "call"): Promise<boolean> };
  now?: () => number;
}

const WATCH_PREFIX = "social.watch.";

/** The relay room of a broadcast. */
export const relayRoomOf = (broadcastId: string) => `b_${broadcastId}`;
/** The LiveKit room key of a broadcast's call. */
export const callKeyOf = (broadcastId: string) => `bcast_${broadcastId}`;

/** The reader context value for watching a broadcast. */
export function watchCtx(broadcastId: string): string {
  if (!ID_RE.test(broadcastId)) throw new Error("not a broadcast id");
  return `${WATCH_PREFIX}${broadcastId}`;
}

/** The broadcast id in a ctx value `social.watch.<id>`, or null. */
export function readWatchCtx(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(WATCH_PREFIX)) return null;
  const id = value.slice(WATCH_PREFIX.length);
  return ID_RE.test(id) ? id : null;
}

/** `url` (a reader address) in a broadcast's watch context: any earlier ctx is replaced. */
export function withWatchCtx(url: string, broadcastId: string): string {
  const plain = withoutAnyCtx(url);
  const hashAt = plain.indexOf("#");
  const hash = hashAt >= 0 ? plain.slice(hashAt) : "";
  const rest = hashAt >= 0 ? plain.slice(0, hashAt) : plain;
  return `${rest}${rest.includes("?") ? "&" : "?"}ctx=${watchCtx(broadcastId)}${hash}`;
}

const isReaderPage = (pathname: string) => !/^\/social(?:[/?#]|$)/.test(pathname);

export function createBroadcastController(deps: BroadcastDeps): BroadcastController {
  const { host, api, sessions, calls } = deps;
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let hostView: HostView = { kind: "idle" };
  let watchView: WatchView = { kind: "idle" };
  let hostGen = 0;
  let watchGen = 0;
  const hostOffs: (() => void)[] = [];
  const watchOffs: (() => void)[] = [];
  /** The watch context has reached the address since watching began (until then, its absence means nothing). */
  let entered = false;

  const emit = () => [...listeners].forEach((cb) => cb());
  const setHost = (v: HostView) => {
    hostView = v;
    emit();
  };
  const setWatch = (v: WatchView) => {
    watchView = v;
    emit();
  };
  const report = (name: string, data: Record<string, string | number | boolean> = {}) =>
    host.report({ kind: "error", name, data });

  /** The subprotocol carrying the ticket, fetched again when the one held is about to expire. */
  function tickets(broadcastId: string, first: BroadcastTicket, onEnded: () => void) {
    let held = first;
    return async (): Promise<string[]> => {
      if (Date.parse(held.expiresAt) - now() < TICKET_MARGIN_MS) {
        const r = await api.ticket(broadcastId);
        if (r.kind === "ended") {
          onEnded();
          throw new Error("the broadcast has ended");
        }
        held = r.ticket;
      }
      return [`ticket.${held.ticket}`];
    };
  }

  const leaveCall = async (broadcastId: string) => {
    const view = calls.view();
    if (callRoom(view) !== callKeyOf(broadcastId)) return;
    if (view.kind === "ended") calls.dismiss();
    else await calls.leave();
  };

  // ── Host ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

  function stopHosting() {
    hostGen++;
    for (const off of hostOffs.splice(0).reverse()) off(); // listeners before the connection's release
  }

  /** Hold the spotlight whenever the room is known and someone else (or nobody) holds it; count who is watching. */
  function hostSession(session: RoomSession, roomId: string, id: string, link: string) {
    let asked = "";
    const sync = () => {
      const s = session.client.getState();
      if (s.status === "ended") {
        if (hostView.kind === "live" && hostView.id === id) {
          stopHosting();
          void leaveCall(id);
          setHost({ kind: "idle" });
        }
        return;
      }
      const known = s.status !== "connecting" && s.status !== "reconnecting";
      const key = `${s.room.term}:${s.room.spotlight}`;
      if (known && s.room.spotlight !== s.self.id && asked !== key) {
        asked = key;
        session.client.spotlight(s.self.id);
      }
      const viewers = known ? s.participants.filter((p) => p.id !== s.self.id).length : null;
      if (hostView.kind === "live" && hostView.id === id && hostView.viewers !== viewers)
        setHost({ kind: "live", roomId, id, link, viewers });
    };
    hostOffs.push(session.client.subscribe(sync));
    // Publishing depends on where the host is: only a reader page is worth following.
    hostOffs.push(host.location.subscribe(() => session.client.refresh()));
    sync();
  }

  /** Resolves when the room has answered the end (so it reaches viewers before the socket closes), or after a short wait. */
  function roomEnded(session: RoomSession): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, END_WAIT_MS);
      const off = session.client.subscribe(() => session.client.getState().status === "ended" && done());
      if (session.client.getState().status === "ended") done();
      function done() {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  }

  // ── Viewer ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

  function stopWatching() {
    watchGen++;
    entered = false;
    for (const off of watchOffs.splice(0).reverse()) off(); // listeners before the connection's release
  }

  function ended(id: string) {
    if ((watchView.kind !== "connecting" && watchView.kind !== "watching") || watchView.id !== id) return;
    stopWatching();
    void leaveCall(id);
    setWatch({ kind: "ended", id });
  }

  const gateOpen = (id: string) =>
    watchView.kind === "watching" && watchView.id === id && readWatchCtx(host.reader.context.get()) === id;

  /** The host's state, waiting a little for it (the room answers a join with the spotlight's keyframe). */
  async function firstState(session: RoomSession): Promise<ReaderSnapshot | null> {
    if (session.reader.held()) return session.reader.held();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, TARGET_WAIT_MS);
      const off = session.client.subscribe(() => {
        if (session.reader.held() || session.client.getState().status === "ended") done();
      });
      function done() {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
    return session.reader.held();
  }

  function watchSession(session: RoomSession, id: string, hostName: string | null) {
    const sync = () => {
      const s = session.client.getState();
      if (s.status === "ended") return ended(id);
      if (watchView.kind !== "watching" || watchView.id !== id) return;
      const following = s.status !== "paused";
      const name = hostName ?? s.participants.find((p) => p.isHost)?.name ?? null;
      if (watchView.following !== following || watchView.hostName !== name)
        setWatch({ kind: "watching", id, following, hostName: name });
    };
    watchOffs.push(session.client.subscribe(sync));
    return sync;
  }

  async function joinMedia(id: string) {
    if (deps.windowOwner && !(await deps.windowOwner.request("call"))) return;
    if (watchView.kind !== "watching" || watchView.id !== id) return;
    await calls.joinWith(callKeyOf(id), { tokenSource: () => api.callToken(id), viewer: true });
  }

  function onContext() {
    const id = readWatchCtx(host.reader.context.get());
    const current = watchView.kind === "idle" ? null : watchView.id;
    if (current && (watchView.kind === "connecting" || watchView.kind === "watching")) {
      if (id === current) {
        entered = true;
        const session = sessions.get(relayRoomOf(current));
        void session?.reader.release(); // the gate opened: apply what arrived while the address caught up
      } else if (entered) controller.leave(); // Back, or a link out of the broadcast: stop watching
      return;
    }
    if (id && id !== current && host.viewer.get()) void controller.watch(id, { navigate: false });
  }

  /** Connects the host to a live broadcast's relay room and publishes the reader (after a start, or a reload: resume). */
  async function attachHost(roomId: string, id: string, link: string, gen: number, endOnFailure: boolean) {
    const t = await api.ticket(id);
    if (gen !== hostGen) return;
    if (t.kind !== "ok") return setHost({ kind: "failed", roomId, reason: "error" });
    const release = sessions.acquire(relayRoomOf(id), "broadcast", {
      extraProtocols: tickets(id, t.ticket, () => undefined),
      canPublish: () => isReaderPage(host.location.get().pathname),
      isOpen: () => false, // the host never follows anyone
      role: { isHost: true, canLead: true },
    });
    hostOffs.push(release);
    const session = sessions.get(relayRoomOf(id));
    if (!session) {
      stopHosting();
      if (endOnFailure) await api.end(id).catch(() => undefined);
      return setHost({ kind: "failed", roomId, reason: "error" });
    }
    setHost({ kind: "live", roomId, id, link, viewers: null });
    hostSession(session, roomId, id, link);
  }

  const controller: BroadcastController = {
    hostView: () => hostView,
    watchView: () => watchView,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },

    async start(roomId) {
      if (hostView.kind === "starting" || hostView.kind === "live" || hostView.kind === "ending") return;
      if (!host.viewer.get()) {
        host.viewer.requestSignIn();
        return;
      }
      stopHosting();
      const gen = hostGen;
      setHost({ kind: "starting", roomId });
      try {
        const r = await api.start(roomId);
        if (gen !== hostGen) return;
        if (r.kind !== "ok") return setHost({ kind: "failed", roomId, reason: r.kind });
        await attachHost(roomId, r.broadcast.id, r.broadcast.link, gen, true);
      } catch {
        if (gen === hostGen) setHost({ kind: "failed", roomId, reason: "error" });
        report("broadcast-start-failed");
      }
    },

    async resume(roomId, live) {
      if (hostView.kind !== "idle" && hostView.kind !== "failed") return;
      stopHosting();
      const gen = hostGen;
      setHost({ kind: "starting", roomId });
      try {
        await attachHost(roomId, live.id, live.link, gen, false);
      } catch {
        if (gen === hostGen) setHost({ kind: "failed", roomId, reason: "error" });
        report("broadcast-resume-failed");
      }
    },

    async joinCall() {
      if (hostView.kind !== "live") return;
      const id = hostView.id;
      if (deps.windowOwner && !(await deps.windowOwner.request("call"))) return;
      await calls.open(callKeyOf(id), { tokenSource: () => api.callToken(id) });
    },

    async end() {
      if (hostView.kind !== "live") return;
      const { id, roomId } = hostView;
      setHost({ kind: "ending", roomId, id });
      const session = sessions.get(relayRoomOf(id));
      session?.client.end(); // viewers hear it at once
      await Promise.all([api.end(id).catch(() => report("broadcast-end-failed")), session && roomEnded(session)]);
      stopHosting();
      await leaveCall(id);
      setHost({ kind: "idle" });
    },

    async watch(id, opts = {}) {
      if ((watchView.kind === "connecting" || watchView.kind === "watching") && watchView.id === id) return;
      if (!host.viewer.get()) {
        host.viewer.requestSignIn();
        return;
      }
      if (watchView.kind === "connecting" || watchView.kind === "watching") controller.leave();
      stopWatching();
      const gen = watchGen;
      if (opts.navigate === false) entered = true;
      setWatch({ kind: "connecting", id });
      try {
        const b = await api.get(id);
        if (gen !== watchGen) return;
        if (b.kind !== "ok") return setWatch({ kind: "failed", id, reason: "not-found" });
        if (b.broadcast.status === "ended") return setWatch({ kind: "ended", id });
        const t = await api.ticket(id);
        if (gen !== watchGen) return;
        if (t.kind !== "ok") return setWatch({ kind: "ended", id });
        watchOffs.push(
          sessions.acquire(relayRoomOf(id), "broadcast", {
            extraProtocols: tickets(id, t.ticket, () => ended(id)),
            canPublish: () => false,
            isOpen: () => gateOpen(id),
            role: { isHost: false, canLead: false },
          }),
        );
        const session = sessions.get(relayRoomOf(id));
        if (!session) {
          stopWatching();
          return setWatch({ kind: "failed", id, reason: "error" });
        }
        const sync = watchSession(session, id, b.broadcast.hostName);
        const enteredBefore = entered;
        const target = opts.navigate === false ? null : await firstState(session);
        if (gen !== watchGen) return;
        if (session.client.getState().status === "ended") return ended(id);
        setWatch({ kind: "watching", id, following: true, hostName: b.broadcast.hostName });
        if (!enteredBefore) host.navigate(withWatchCtx(target?.url ?? FALLBACK_URL, id));
        if (readWatchCtx(host.reader.context.get()) === id) entered = true;
        sync();
        void session.reader.release();
        void joinMedia(id);
      } catch {
        if (gen === watchGen) {
          stopWatching();
          setWatch({ kind: "failed", id, reason: "error" });
        }
      }
    },

    backToLive() {
      if (watchView.kind !== "watching") return;
      sessions.get(relayRoomOf(watchView.id))?.client.followAgain();
    },

    leave() {
      if (watchView.kind === "idle") return;
      const id = watchView.id;
      stopWatching();
      void leaveCall(id);
      setWatch({ kind: "idle" });
      if (readWatchCtx(host.reader.context.get()) === id) {
        const { pathname, search, hash } = host.location.get();
        host.navigate(withoutAnyCtx(`${pathname}${search}${hash}`), { replace: true });
      }
    },

    dispose() {
      offContext();
      offViewer();
      stopHosting();
      stopWatching();
      listeners.clear();
    },
  };

  const offContext = host.reader.context.subscribe(onContext);
  // The reader may learn who is signed in after mounting us; a watch address waits for that.
  const offViewer = host.viewer.subscribe(onContext);
  onContext();
  return controller;
}

const perHost = new WeakMap<SurfaceHost, BroadcastController>();

/** The broadcast controller of this host (lobby, watch page and persistent mount share it). */
export function broadcastControllerFor(host: SurfaceHost, overrides: Partial<Omit<BroadcastDeps, "host">> = {}) {
  let c = perHost.get(host);
  if (!c) {
    c = createBroadcastController({
      host,
      api: overrides.api ?? broadcastApiFor(host),
      sessions: overrides.sessions ?? roomSessionsFor(host),
      calls: overrides.calls ?? callControllerFor(host),
      windowOwner: overrides.windowOwner ?? windowOwnerFor(host),
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    perHost.set(host, c);
  }
  return c;
}
