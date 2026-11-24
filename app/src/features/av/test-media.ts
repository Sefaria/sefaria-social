// Test support: a fake MediaEngine that records every call and lets a test play the media server (participants joining,
// speaking, the connection dropping). Not production code; the panel and controller tests use it instead of WebRTC.
import {
  MediaPermissionError,
  type CallMedia,
  type CallParticipant,
  type ConnectOptions,
  type ConnectionState,
  type DeviceList,
  type DisconnectReason,
  type MediaEngine,
  type Preview,
  type TrackSource,
} from "./media";

export interface FakeCall extends CallMedia {
  options: ConnectOptions;
  disconnected: boolean;
  visible: readonly string[];
  attached: { participantId: string; source: TrackSource }[];
  calls: { mic: boolean[]; camera: boolean[]; screen: boolean[]; startAudio: number };
  /** Play the server: someone joins, changes, leaves. */
  setRemote(participants: Omit<CallParticipant, "local">[]): void;
  /** Play the network: reconnecting, back, or gone (with the server's reason). */
  drop(state: ConnectionState, reason?: DisconnectReason): void;
  blockAudio(blocked: boolean): void;
}

export interface FakeEngine extends MediaEngine {
  calls: {
    listDevices: number;
    previews: (string | null)[];
    previewsStopped: number;
    connects: ConnectOptions[];
  };
  /** The calls this engine connected, in order. */
  connections: FakeCall[];
  /** The latest connection. */
  last(): FakeCall;
  /** The next N connects fail (a network error, or permission). */
  failNextConnects(n: number, error?: Error): void;
  denyDevices(deny: boolean): void;
  devices: DeviceList;
}

export function createFakeEngine(opts: { canShareScreen?: boolean; self?: { id: string; name: string } } = {}): FakeEngine {
  const self = opts.self ?? { id: "u:4242", name: "Test Learner" };
  let failures: { n: number; error: Error } = { n: 0, error: new Error("connect failed") };
  let deny = false;
  const connections: FakeCall[] = [];
  const engine: FakeEngine = {
    calls: { listDevices: 0, previews: [], previewsStopped: 0, connects: [] },
    connections,
    devices: {
      audioInputs: [
        { deviceId: "mic-1", label: "Built-in microphone" },
        { deviceId: "mic-2", label: "Headset" },
      ],
      videoInputs: [
        { deviceId: "cam-1", label: "Built-in camera" },
        { deviceId: "cam-2", label: "USB camera" },
      ],
    },
    last() {
      const c = connections.at(-1);
      if (!c) throw new Error("no connection yet");
      return c;
    },
    failNextConnects(n, error = new Error("connect failed")) {
      failures = { n, error };
    },
    denyDevices(d) {
      deny = d;
    },
    async listDevices() {
      engine.calls.listDevices++;
      return engine.devices;
    },
    async preview(deviceId): Promise<Preview> {
      engine.calls.previews.push(deviceId);
      if (deny) throw new MediaPermissionError("denied");
      return {
        attach: () => () => undefined,
        stop: () => void engine.calls.previewsStopped++,
      };
    },
    canShareScreen: () => opts.canShareScreen ?? true,
    async connect(options) {
      engine.calls.connects.push(options);
      if (failures.n > 0) {
        failures.n--;
        throw failures.error;
      }
      const local: CallParticipant = {
        ...self,
        local: true,
        mic: options.mic && !deny,
        camera: options.camera && !deny,
        screen: false,
        speaking: false,
      };
      let remote: CallParticipant[] = [];
      let audioBlocked = false;
      const listeners = new Set<() => void>();
      const connListeners = new Set<(s: ConnectionState, r?: DisconnectReason) => void>();
      const emit = () => [...listeners].forEach((cb) => cb());
      const call: FakeCall = {
        options,
        disconnected: false,
        visible: [],
        attached: [],
        calls: { mic: [], camera: [], screen: [], startAudio: 0 },
        participants: () => [{ ...local }, ...remote.map((p) => ({ ...p }))],
        subscribe(cb) {
          listeners.add(cb);
          return () => void listeners.delete(cb);
        },
        onConnection(cb) {
          connListeners.add(cb);
          return () => void connListeners.delete(cb);
        },
        async setMicrophone(on) {
          call.calls.mic.push(on);
          local.mic = on;
          emit();
        },
        async setCamera(on) {
          call.calls.camera.push(on);
          if (on && deny) throw new MediaPermissionError("denied");
          local.camera = on;
          emit();
        },
        async setScreenShare(on) {
          call.calls.screen.push(on);
          local.screen = on;
          emit();
        },
        attach(participantId, source) {
          const entry = { participantId, source };
          call.attached.push(entry);
          return () => {
            call.attached = call.attached.filter((a) => a !== entry);
          };
        },
        setVisible(ids) {
          call.visible = [...ids];
        },
        audioBlocked: () => audioBlocked,
        async startAudio() {
          call.calls.startAudio++;
          audioBlocked = false;
          emit();
        },
        async disconnect() {
          call.disconnected = true;
          local.mic = false;
          local.camera = false;
          local.screen = false;
        },
        setRemote(ps) {
          remote = ps.map((p) => ({ ...p, local: false }));
          emit();
        },
        drop(state, reason) {
          if (state === "disconnected") call.disconnected = true;
          [...connListeners].forEach((cb) => cb(state, reason));
        },
        blockAudio(b) {
          audioBlocked = b;
          emit();
        },
      };
      connections.push(call);
      return call;
    },
  };
  return engine;
}
