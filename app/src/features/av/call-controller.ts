// The call controller (spec 034; design docs/design/audio-video.md section 4). One per host, like the room controller. It
// drives the call machine (./machine.ts), loads the media engine only when the pre-join step opens (AC-003), and ties the call
// to the room: the call holds the room's session ("call") so it survives every navigation (AV1, AV3), and leaving the room
// ends the call first (AC-007). It never touches the reader's state, URL or snapshots (AV6).
//
//   open → (engine loaded, devices listed) prejoin → join → token from the API → connect → in-call
//   connection lost → reconnecting → fresh token, new connection, backoff 1, 2, 4, 8 s … → in-call, or after 30 s: ended
//   leave → disconnect (every local track stops) → release the hold → off
//
// Reports carry counts, durations and error kinds only: never names, identities, device labels or tokens (AC-012).
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { roomsApiFor, type CallTokenResult } from "~/features/api/rooms-api";
import { roomControllerFor } from "~/features/session/controller";
import { roomSessionsFor } from "~/features/session/sessions";
import { loadLiveKit } from "./load-livekit";
import { INITIAL_CALL, callRoom, transition, type CallEvent, type CallView, type DeviceChoice } from "./machine";
import { MediaPermissionError, type CallMedia, type DeviceList, type LoadEngine, type MediaEngine, type Preview } from "./media";
import { documentHostFor } from "~/features/host/document-host";
import { rememberChoice, type CallChoice } from "./device-memory";

/** How long a lost call keeps trying before it ends with Rejoin (AC-011). */
export const RECONNECT_GIVE_UP_MS = 30_000;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

export interface CallDeps {
  host: SurfaceHost;
  api: {
    getCallToken?(roomId: string): Promise<CallTokenResult>;
    moderate?(
      roomId: string,
      action: "mute" | "remove",
      participant: string,
      source?: "microphone" | "camera" | "screen_share",
    ): Promise<"ok" | "not-in-call" | "forbidden" | "unavailable">;
  };
  loadEngine: LoadEngine;
  sessions: { acquire(roomId: string, hold: "call"): () => void };
  rooms: { onLeave(cb: (roomId: string) => void): () => void };
}

/**
 * A call that is not a room's (a broadcast's, spec 043): where its token comes from instead of the room's call-token endpoint.
 * Such a call holds no room session (its owner keeps its own connection). `viewer`: view only, joined with `joinWith`: no
 * pre-join, no devices, nothing published; the window shows the others with Leave only.
 */
export interface CallSource {
  tokenSource: () => Promise<CallTokenResult>;
  viewer?: boolean;
}

/** What kind of call this is: a room's, a broadcast's host's, or a broadcast's view-only viewer's. */
export type CallMode = "room" | "broadcast" | "viewer";

export interface CallController {
  view(): CallView;
  subscribe(cb: () => void): () => void;
  /** The pre-join step's choices (all off outside it). */
  devices(): DeviceChoice;
  /** The devices the engine listed, once the pre-join step has loaded it. */
  deviceList(): DeviceList | null;
  /** The camera preview in the pre-join step, when the camera is on there. */
  preview(): Preview | null;
  canShareScreen(): boolean;
  /** The connected call, for tiles and controls. */
  media(): CallMedia | null;
  /** The viewer's role in the call, from the token's metadata (display only; the server checks every action). */
  role(): "owner" | "member" | null;
  /** A notice for the viewer: the owner muted them (spec 039), cleared when they turn the microphone on. */
  notice(): "muted-by-host" | null;
  /** The owner mutes a participant's track or removes them from the call (spec 039). */
  moderate(action: "mute" | "remove", participant: string, source?: "microphone" | "camera" | "screen_share"): Promise<void>;
  /** Opens the pre-join step for a room's call, or (with `source`) another call such as a broadcast's. */
  open(roomId: string, source?: CallSource): Promise<void>;
  /**
   * Spec 049: straight into a room's call with this microphone and camera, without the pre-join step (entering a room joins its
   * call). Leaves any other call first; nothing happens if the viewer is already in (or joining) this room's call.
   */
  enter(roomId: string, choice: CallChoice): Promise<void>;
  /** Joins `key`'s call view only, straight through the pre-join step with every device off (a broadcast's viewer). */
  joinWith(key: string, source: CallSource): Promise<void>;
  mode(): CallMode;
  choose(devices: DeviceChoice): void;
  cancel(): void;
  join(): Promise<void>;
  leave(): Promise<void>;
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreen(on: boolean): Promise<void>;
  confirmSwitch(): Promise<void>;
  cancelSwitch(): void;
  dismiss(): void;
  dispose(): void;
}

/** The role the server wrote into the call token's metadata (spec 033); null if it cannot be read. Not a security check. */
function roleOf(token: string): "owner" | "member" | null {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const meta = JSON.parse((JSON.parse(json) as { metadata?: string }).metadata ?? "{}") as { role?: unknown };
    return meta.role === "owner" || meta.role === "member" ? meta.role : null;
  } catch {
    return null;
  }
}

const ALL_OFF: DeviceChoice = { mic: false, camera: false, audioDeviceId: null, videoDeviceId: null, permission: "unknown" };

export function createCallController({ host, api, loadEngine, sessions, rooms }: CallDeps): CallController {
  let view: CallView = INITIAL_CALL;
  const listeners = new Set<() => void>();
  let engine: MediaEngine | null = null;
  let deviceList: DeviceList | null = null;
  let preview: Preview | null = null;
  let previewFor: string | null | undefined; // the device the preview shows (undefined: none)
  let media: CallMedia | null = null;
  let offMedia: (() => void)[] = [];
  let release: (() => void) | null = null;
  let leaving = false;
  let startedAt = 0;
  let peak = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let generation = 0; // bumps on every leave or switch, so a late connect from an old attempt is dropped
  let role: "owner" | "member" | null = null;
  let notice: "muted-by-host" | null = null;
  const sources = new Map<string, CallSource>();

  const emit = () => [...listeners].forEach((cb) => cb());
  const step = (event: CallEvent) => {
    const r = transition(view, event);
    if (!r.ok) return false;
    view = r.state;
    emit();
    return true;
  };
  const report = (name: string, data: Record<string, string | number | boolean> = {}) =>
    host.report({ kind: name === "av.error" ? "error" : "event", name, data });

  async function ensureEngine(): Promise<MediaEngine> {
    if (!engine) engine = await loadEngine();
    return engine;
  }

  function stopPreview() {
    preview?.stop();
    preview = null;
    previewFor = undefined;
  }

  function clearTimers() {
    if (retry) clearTimeout(retry);
    if (deadline) clearTimeout(deadline);
    retry = deadline = null;
  }

  /** Close the current connection and give back the room hold. Synchronous up to the disconnect call (AC-007's order). */
  function teardown(): Promise<void> {
    generation++;
    clearTimers();
    offMedia.forEach((off) => off());
    offMedia = [];
    const m = media;
    media = null;
    const done = m ? m.disconnect().catch(() => undefined) : Promise.resolve();
    release?.();
    release = null;
    return done;
  }

  async function token(roomId: string): Promise<CallTokenResult | { kind: "network" }> {
    const source = sources.get(roomId);
    if (!source && !api.getCallToken) return { kind: "unavailable" };
    try {
      return source ? await source.tokenSource() : await api.getCallToken!(roomId);
    } catch {
      return { kind: "network" };
    }
  }

  function watch(m: CallMedia, roomId: string) {
    const count = () => {
      peak = Math.max(peak, m.participants().length);
      const self = m.participants().find((p) => p.local);
      if (
        self &&
        view.kind === "in-call" &&
        (self.mic !== view.mic || self.camera !== view.camera || self.screen !== view.screen)
      )
        step({ type: "toggle", mic: self.mic, camera: self.camera, screen: self.screen });
      else emit();
    };
    offMedia.push(m.subscribe(count));
    offMedia.push(
      m.onMutedByHost((source) => {
        if (source === "microphone") {
          notice = "muted-by-host";
          emit();
        }
      }),
    );
    offMedia.push(
      m.onConnection((state, reason) => {
        if (leaving || media !== m) return;
        if (state === "reconnecting") step({ type: "connectionLost", at: Date.now() });
        else if (state === "connected") step({ type: "connected" });
        else if (reason === "removed") {
          void teardown();
          step({ type: "removed" });
          report("av.leave", { durationS: seconds(), peakParticipants: peak, reason: "removed" });
        } else if (reason === "room-closed") {
          void teardown();
          step({ type: "roomClosed" });
          report("av.leave", { durationS: seconds(), peakParticipants: peak, reason: "room-closed" });
        } else if (reason !== "left") reconnect(roomId);
      }),
    );
    count();
  }

  const seconds = () => Math.round((Date.now() - startedAt) / 1000);

  async function connect(roomId: string, opts: { mic: boolean; camera: boolean }, devices: DeviceChoice) {
    const gen = generation;
    const t = await token(roomId);
    if (gen !== generation) return "stale" as const;
    if (t.kind !== "ok") return t.kind;
    role = roleOf(t.token);
    try {
      const e = await ensureEngine();
      const m = await e.connect({
        url: t.url,
        token: t.token,
        mic: opts.mic,
        camera: opts.camera,
        audioDeviceId: devices.audioDeviceId,
        videoDeviceId: devices.videoDeviceId,
      });
      if (gen !== generation) {
        void m.disconnect();
        return "stale" as const;
      }
      media = m;
      watch(m, roomId);
      return "ok" as const;
    } catch (e) {
      return e instanceof MediaPermissionError ? ("permission" as const) : ("connect" as const);
    }
  }

  let lastDevices: DeviceChoice = ALL_OFF;

  function reconnect(roomId: string) {
    offMedia.forEach((off) => off());
    offMedia = [];
    media = null;
    if (view.kind === "in-call") step({ type: "connectionLost", at: Date.now() });
    if (view.kind !== "reconnecting" || retry) return;
    attempt = 0;
    const since = view.since;
    deadline = setTimeout(() => giveUp(), Math.max(0, since + RECONNECT_GIVE_UP_MS - Date.now()));
    const tryOnce = () => {
      retry = null;
      if (view.kind !== "reconnecting") return;
      const { mic, camera } = view;
      void connect(roomId, { mic, camera }, lastDevices).then((r) => {
        if (r === "stale" || view.kind !== "reconnecting") return;
        if (r === "ok") {
          clearTimers();
          step({ type: "connected" });
          report("av.reconnect", { attempt: attempt + 1 });
          return;
        }
        attempt++;
        retry = setTimeout(tryOnce, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      });
    };
    retry = setTimeout(tryOnce, BACKOFF_MS[0]);
  }

  function giveUp() {
    if (view.kind !== "reconnecting") return;
    void teardown();
    step({ type: "failed" });
    report("av.error", { kind: "reconnect_timeout" });
  }

  const offRooms = rooms.onLeave((roomId) => {
    if (callRoom(view) !== roomId) return;
    if (view.kind === "prejoin") {
      stopPreview();
      step({ type: "cancel" });
    } else void controller.leave();
  });

  async function startPreview(deviceId: string | null) {
    if (previewFor === deviceId && preview) return;
    stopPreview();
    previewFor = deviceId;
    try {
      const e = await ensureEngine();
      const p = await e.preview(deviceId);
      if (view.kind !== "prejoin" || !view.devices.camera || previewFor !== deviceId) {
        p.stop();
        return;
      }
      preview = p;
      if (view.devices.permission !== "granted") step({ type: "choose", devices: { ...view.devices, permission: "granted" } });
      else emit();
    } catch (e) {
      previewFor = undefined;
      if (view.kind !== "prejoin") return;
      if (e instanceof MediaPermissionError) {
        step({ type: "choose", devices: { ...view.devices, camera: false, permission: "denied" } });
        report("av.error", { kind: `camera_${e.kind}` });
      }
    }
  }

  /** From `connecting`: hold the room (a room's call only), connect, and settle. */
  async function joined(roomId: string, devices: DeviceChoice) {
    leaving = false;
    lastDevices = devices;
    startedAt = Date.now();
    peak = 0;
    release = sources.has(roomId) ? null : sessions.acquire(roomId, "call");
    const r = await connect(roomId, { mic: devices.mic, camera: devices.camera }, devices);
    if (r === "stale" || controller.view().kind !== "connecting") return;
    if (r === "ok") {
      step({ type: "connected" });
      report("av.join", { participants: media?.participants().length ?? 1 });
      return;
    }
    void teardown();
    step({ type: "failed" });
    report("av.error", { kind: `join_${r}` });
  }

  const controller: CallController = {
    view: () => view,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    devices: () => (view.kind === "prejoin" ? view.devices : ALL_OFF),
    deviceList: () => deviceList,
    preview: () => preview,
    canShareScreen: () => engine?.canShareScreen() ?? false,
    media: () => media,
    role: () => role,
    notice: () => notice,
    async moderate(action, participant, source) {
      const roomId = callRoom(view);
      if (!roomId || !api.moderate) return;
      const r = await api.moderate(roomId, action, participant, source).catch(() => "error" as const);
      if (r !== "ok" && r !== "not-in-call") report("av.error", { kind: `moderate_${r}` });
    },

    async open(roomId, source) {
      if (callRoom(view) !== roomId) {
        if (source) sources.set(roomId, source);
        else sources.delete(roomId);
      }
      if (!step({ type: "open", roomId })) return;
      if (view.kind !== "prejoin") return; // a switch is waiting for confirmation
      try {
        const e = await ensureEngine();
        deviceList = await e.listDevices();
        emit();
      } catch {
        report("av.error", { kind: "engine_load" });
      }
    },

    choose(devices) {
      if (view.kind !== "prejoin") return;
      if (!step({ type: "choose", devices })) return;
      if (devices.camera) void startPreview(devices.videoDeviceId);
      else if (preview) {
        stopPreview();
        emit();
      }
    },

    cancel() {
      stopPreview();
      step({ type: "cancel" });
    },

    async join() {
      if (view.kind !== "prejoin") return;
      const devices = view.devices;
      const roomId = view.roomId;
      stopPreview();
      if (!step({ type: "join" })) return;
      await joined(roomId, devices);
    },

    async enter(roomId, choice) {
      if (callRoom(view) === roomId && view.kind !== "ended" && view.kind !== "prejoin") return;
      if (view.kind === "ended") step({ type: "dismiss" });
      else if (view.kind === "prejoin") controller.cancel();
      else if (view.kind !== "off") await controller.leave();
      sources.delete(roomId);
      const devices: DeviceChoice = { ...ALL_OFF, mic: choice.mic, camera: choice.camera };
      if (!step({ type: "open", roomId }) || !step({ type: "choose", devices }) || !step({ type: "join" })) return;
      await joined(roomId, devices);
    },

    async joinWith(key, source) {
      if (callRoom(view) === key && view.kind !== "ended") return;
      if (view.kind === "ended") step({ type: "dismiss" });
      else if (view.kind !== "off") await controller.leave();
      sources.set(key, { ...source, viewer: true });
      // Straight through the pre-join step: nothing to choose, and no device is ever asked for.
      if (!step({ type: "open", roomId: key }) || !step({ type: "join" })) return;
      await joined(key, ALL_OFF);
    },

    mode() {
      const key = callRoom(view);
      const source = key ? sources.get(key) : undefined;
      return !source ? "room" : source.viewer ? "viewer" : "broadcast";
    },

    async leave() {
      if (view.kind === "prejoin") return controller.cancel();
      if (view.kind !== "connecting" && view.kind !== "in-call" && view.kind !== "reconnecting") return;
      leaving = true;
      const done = teardown(); // disconnects before anything else (AC-007)
      report("av.leave", { durationS: seconds(), peakParticipants: peak });
      step({ type: "leave" });
      await done;
      leaving = false;
    },

    async setMic(on) {
      if (view.kind !== "in-call" || !media) return;
      if (on && notice) {
        notice = null;
        emit();
      }
      await media.setMicrophone(on).catch(() => report("av.error", { kind: "microphone" }));
      if (view.kind === "in-call" && media) {
        const self = media.participants().find((p) => p.local);
        step({ type: "toggle", mic: self?.mic ?? on });
        if (role === "owner") rememberChoice({ mic: self?.mic ?? on }); // spec 049 AC-006
      }
    },
    async setCamera(on) {
      if (view.kind !== "in-call" || !media) return;
      await media.setCamera(on).catch(() => report("av.error", { kind: "camera" }));
      if (view.kind === "in-call" && media) {
        const self = media.participants().find((p) => p.local);
        step({ type: "toggle", camera: self?.camera ?? on });
        if (role === "owner") rememberChoice({ camera: self?.camera ?? on }); // spec 049 AC-006
      }
    },
    async setScreen(on) {
      if (view.kind !== "in-call" || !media) return;
      await media.setScreenShare(on).catch(() => report("av.error", { kind: "screen_share" }));
      if (view.kind === "in-call" && media) {
        const self = media.participants().find((p) => p.local);
        step({ type: "toggle", screen: self?.screen ?? on });
      }
    },

    async confirmSwitch() {
      if (view.kind !== "in-call" || !view.switchTo) return;
      leaving = true;
      const done = teardown();
      report("av.leave", { durationS: seconds(), peakParticipants: peak });
      step({ type: "confirmSwitch" });
      await done;
      leaving = false;
      if (controller.view().kind === "prejoin") {
        try {
          deviceList = await (await ensureEngine()).listDevices();
          emit();
        } catch {
          report("av.error", { kind: "engine_load" });
        }
      }
    },
    cancelSwitch() {
      step({ type: "cancelSwitch" });
    },
    dismiss() {
      step({ type: "dismiss" });
    },

    dispose() {
      offRooms();
      stopPreview();
      void teardown();
      listeners.clear();
    },
  };
  return controller;
}

const perHost = new WeakMap<SurfaceHost, CallController>();

/**
 * The call controller for this host. The first call creates it; `overrides` (tests, the harness) replace the rooms API or the
 * media engine and are ignored once it exists.
 */
export function callControllerFor(rawHost: SurfaceHost, overrides: Partial<Omit<CallDeps, "host">> = {}): CallController {
  const host = documentHostFor(rawHost); // one per page, whichever mount asks (features/host/document-host.ts)
  let c = perHost.get(host);
  if (!c) {
    c = createCallController({
      host,
      api: overrides.api ?? roomsApiFor(host),
      loadEngine: overrides.loadEngine ?? loadLiveKit,
      sessions: overrides.sessions ?? roomSessionsFor(host),
      rooms: overrides.rooms ?? roomControllerFor(host),
    });
    perHost.set(host, c);
  }
  return c;
}
