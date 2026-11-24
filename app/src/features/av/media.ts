// What a call needs from a media library (spec 034). The LiveKit implementation is ./livekit-engine.ts, loaded on demand by
// ./load-livekit.ts; tests use ./test-media.ts. Nothing here imports livekit-client, so the rest of the call code (controller,
// panel) is testable without WebRTC and costs readers nothing until they join.

export interface Device {
  deviceId: string;
  label: string;
}

export interface DeviceList {
  audioInputs: Device[];
  videoInputs: Device[];
}

export type TrackSource = "camera" | "screen";

export interface CallParticipant {
  /** LiveKit identity: `u:<sefaria user id>`. */
  id: string;
  name: string;
  local: boolean;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  speaking: boolean;
}

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
/** Why a connection ended, when the media server says. */
export type DisconnectReason = "left" | "removed" | "room-closed" | "other";

/** A camera preview for the pre-join step. */
export interface Preview {
  attach(el: HTMLVideoElement): () => void;
  stop(): void;
}

export interface ConnectOptions {
  url: string;
  token: string;
  mic: boolean;
  camera: boolean;
  audioDeviceId: string | null;
  videoDeviceId: string | null;
}

/** One connected call. */
export interface CallMedia {
  participants(): CallParticipant[];
  /** Fires on any participant or track change. */
  subscribe(cb: () => void): () => void;
  onConnection(cb: (state: ConnectionState, reason?: DisconnectReason) => void): () => void;
  /** The room's owner muted one of the viewer's own tracks through the server (spec 039). */
  onMutedByHost(cb: (source: "microphone" | "camera" | "screen_share") => void): () => void;
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreenShare(on: boolean): Promise<void>;
  /**
   * Show a participant's camera or screen in a video element; returns the detach, or null when the track has not arrived yet
   * (a camera can be on before its track is subscribed): try again on the next change.
   */
  attach(participantId: string, source: TrackSource, el: HTMLVideoElement): (() => void) | null;
  /** Whether hidden tiles may stop receiving video (adaptive stream): the panel says which participants are visible. */
  setVisible(participantIds: readonly string[]): void;
  /** True when the browser blocked audio until a user gesture; `startAudio` must run inside one. */
  audioBlocked(): boolean;
  startAudio(): Promise<void>;
  /** Leave: stops every local track and closes the connection. */
  disconnect(): Promise<void>;
}

export interface MediaEngine {
  /** Lists devices; labels may be empty until the person allows access. */
  listDevices(): Promise<DeviceList>;
  preview(deviceId: string | null): Promise<Preview>;
  connect(options: ConnectOptions): Promise<CallMedia>;
  canShareScreen(): boolean;
}

export type LoadEngine = () => Promise<MediaEngine>;

/** The browser refused camera or microphone access (or the device is missing). */
export class MediaPermissionError extends Error {
  constructor(readonly kind: "denied" | "no-device") {
    super(kind === "denied" ? "media permission denied" : "media device not found");
    this.name = "MediaPermissionError";
  }
}

/** Map a getUserMedia failure to a MediaPermissionError when it is one; anything else is rethrown as is. */
export function asPermissionError(e: unknown): unknown {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return new MediaPermissionError("denied");
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError")
    return new MediaPermissionError("no-device");
  return e;
}
