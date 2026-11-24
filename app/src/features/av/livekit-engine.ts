// The MediaEngine on LiveKit (spec 034). The only file that imports livekit-client; reached only through ./load-livekit.ts,
// so it is a separate chunk. Kept thin: it maps LiveKit's room to the CallMedia interface and nothing else. It runs only in a
// real browser; spec 040's two-browser journey exercises it end to end.
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  createLocalVideoTrack,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import {
  asPermissionError,
  type CallMedia,
  type CallParticipant,
  type ConnectionState,
  type ConnectOptions,
  type DisconnectReason as Reason,
  type MediaEngine,
  type Preview,
  type TrackSource,
} from "./media";

const SOURCE: Record<TrackSource, Track.Source> = { camera: Track.Source.Camera, screen: Track.Source.ScreenShare };

function reasonOf(r: DisconnectReason | undefined): Reason {
  if (r === DisconnectReason.CLIENT_INITIATED) return "left";
  if (r === DisconnectReason.PARTICIPANT_REMOVED) return "removed";
  const name = r === undefined ? "" : String(DisconnectReason[r] ?? "");
  if (r === DisconnectReason.ROOM_DELETED || name === "ROOM_CLOSED") return "room-closed";
  return "other";
}

function participant(p: Participant, local: boolean): CallParticipant {
  return {
    id: p.identity,
    name: p.name ?? "",
    local,
    mic: p.isMicrophoneEnabled,
    camera: p.isCameraEnabled,
    screen: p.isScreenShareEnabled,
    speaking: p.isSpeaking,
  };
}

async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    throw asPermissionError(e);
  }
}

function connected(room: Room): CallMedia & { attachExisting(): void } {
  const listeners = new Set<() => void>();
  const connectionListeners = new Set<(s: ConnectionState, r?: Reason) => void>();
  const audioEls = new Map<string, HTMLMediaElement>();
  const emit = () => [...listeners].forEach((cb) => cb());
  const emitConnection = (s: ConnectionState, r?: Reason) => [...connectionListeners].forEach((cb) => cb(s, r));
  // A local track muted that the viewer did not mute here: the room's owner muted it through the server (spec 039).
  const hostMuteListeners = new Set<(s: "microphone" | "camera" | "screen_share") => void>();
  let selfMuting = 0;

  // Remote audio plays through one hidden element per track, created inside the Join click's task where possible.
  const onSubscribed = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio && track.sid) {
      const el = track.attach();
      el.hidden = true;
      document.body.append(el);
      audioEls.set(track.sid, el);
    }
    emit();
  };
  const onUnsubscribed = (track: RemoteTrack) => {
    const el = track.sid ? audioEls.get(track.sid) : undefined;
    if (el && track.sid) {
      track.detach(el);
      el.remove();
      audioEls.delete(track.sid);
    }
    emit();
  };

  room
    .on(RoomEvent.TrackSubscribed, onSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
    .on(RoomEvent.ParticipantConnected, emit)
    .on(RoomEvent.ParticipantDisconnected, emit)
    .on(RoomEvent.TrackMuted, (pub, participant) => {
      if (participant.isLocal && selfMuting === 0) {
        const source =
          pub.source === Track.Source.Microphone ? "microphone" : pub.source === Track.Source.Camera ? "camera" : "screen_share";
        [...hostMuteListeners].forEach((cb) => cb(source));
      }
      emit();
    })
    .on(RoomEvent.TrackUnmuted, emit)
    .on(RoomEvent.LocalTrackPublished, emit)
    .on(RoomEvent.LocalTrackUnpublished, emit)
    .on(RoomEvent.ActiveSpeakersChanged, emit)
    .on(RoomEvent.AudioPlaybackStatusChanged, emit)
    .on(RoomEvent.Reconnecting, () => emitConnection("reconnecting"))
    .on(RoomEvent.Reconnected, () => emitConnection("connected"))
    .on(RoomEvent.Disconnected, (r?: DisconnectReason) => {
      for (const el of audioEls.values()) el.remove();
      audioEls.clear();
      emitConnection("disconnected", reasonOf(r));
    });

  /** A change the viewer makes: its TrackMuted is not a host mute. */
  const self = async (work: () => Promise<unknown>) => {
    selfMuting++;
    try {
      await work();
    } finally {
      selfMuting--;
    }
  };

  return {
    /** Play any remote audio already subscribed (belt and braces with listening before connect). */
    attachExisting() {
      for (const p of room.remoteParticipants.values())
        for (const pub of p.audioTrackPublications.values())
          if (pub.track && pub.track.sid && !audioEls.has(pub.track.sid)) onSubscribed(pub.track as RemoteTrack);
    },
    participants: () => [
      participant(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => participant(p, false)),
    ],
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    onConnection(cb) {
      connectionListeners.add(cb);
      return () => void connectionListeners.delete(cb);
    },
    onMutedByHost(cb) {
      hostMuteListeners.add(cb);
      return () => void hostMuteListeners.delete(cb);
    },
    setMicrophone: (on) => self(() => guard(room.localParticipant.setMicrophoneEnabled(on))),
    setCamera: (on) => self(() => guard(room.localParticipant.setCameraEnabled(on))),
    setScreenShare: (on) => self(() => room.localParticipant.setScreenShareEnabled(on)),
    attach(participantId, source, el) {
      const p =
        room.localParticipant.identity === participantId ? room.localParticipant : room.remoteParticipants.get(participantId);
      const track = p?.getTrackPublication(SOURCE[source])?.track;
      if (!track) return null;
      track.attach(el);
      return () => void track.detach(el);
    },
    setVisible(ids) {
      const visible = new Set(ids);
      for (const p of room.remoteParticipants.values())
        for (const pub of p.videoTrackPublications.values()) pub.setEnabled(visible.has(p.identity));
    },
    audioBlocked: () => !room.canPlaybackAudio,
    startAudio: () => room.startAudio(),
    async disconnect() {
      await room.disconnect(true); // stops every local track
    },
  };
}

export function createLiveKitEngine(): MediaEngine {
  return {
    async listDevices() {
      const [audio, video] = await Promise.all([
        Room.getLocalDevices("audioinput", false),
        Room.getLocalDevices("videoinput", false),
      ]);
      const map = (d: MediaDeviceInfo) => ({ deviceId: d.deviceId, label: d.label });
      return { audioInputs: audio.map(map), videoInputs: video.map(map) };
    },
    async preview(deviceId): Promise<Preview> {
      const track = await guard(createLocalVideoTrack(deviceId ? { deviceId } : {}));
      return {
        attach(el) {
          track.attach(el);
          return () => void track.detach(el);
        },
        stop: () => track.stop(),
      };
    },
    async connect(o: ConnectOptions) {
      const room = new Room({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } });
      // Listen before connecting: LiveKit subscribes a newcomer to the tracks already in the call during connect(), and
      // those TrackSubscribed events would otherwise be missed (no audio from people who were there first).
      const media = connected(room);
      await room.connect(o.url, o.token);
      media.attachExisting();
      // Devices turn on after the connection, not before it returns: a getUserMedia that waits (an operating-system
      // permission prompt, a busy device) must not leave the viewer on "Connecting…". The panel follows the local
      // participant, so a microphone or camera shows as on once it is published. A refused device leaves the viewer in
      // the call, listening (AC-005); the browser's own error reaches nobody else.
      const enable = (work: () => Promise<unknown>) => work().catch(() => undefined);
      void (async () => {
        if (o.mic)
          await enable(() =>
            room.localParticipant.setMicrophoneEnabled(true, o.audioDeviceId ? { deviceId: o.audioDeviceId } : {}),
          );
        if (o.camera)
          await enable(() => room.localParticipant.setCameraEnabled(true, o.videoDeviceId ? { deviceId: o.videoDeviceId } : {}));
      })();
      return media;
    },
    canShareScreen: () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
  };
}
