// The recording's audio (spec 041; design 4.4): every audio track in the call mixed by Web Audio into one destination node, whose
// stream the MediaRecorder takes. Tracks are added and removed by id as people join and leave; with no tracks the destination
// is silent, so the media keeps running for the whole recording.

/** The parts of Web Audio the mixer uses (a fake in tests). */
export interface MixerAudioContext {
  createMediaStreamDestination(): { stream: MediaStream };
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): unknown; disconnect(): void };
  close(): Promise<void>;
}

export interface Mixer {
  /** The mixed audio. */
  stream: MediaStream;
  /** The tracks to mix from now on (the call's `audioTracks()`). */
  setTracks(tracks: readonly MediaStreamTrack[]): void;
  dispose(): void;
}

export function createMixer(
  opts: { audioContext?: MixerAudioContext; makeStream?: (tracks: MediaStreamTrack[]) => MediaStream } = {},
): Mixer {
  const ctx: MixerAudioContext = opts.audioContext ?? (new AudioContext() as unknown as MixerAudioContext);
  const makeStream = opts.makeStream ?? ((tracks: MediaStreamTrack[]) => new MediaStream(tracks));
  const destination = ctx.createMediaStreamDestination();
  const sources = new Map<string, { disconnect(): void }>();
  let disposed = false;
  return {
    stream: destination.stream,
    setTracks(tracks) {
      if (disposed) return;
      const wanted = new Map(tracks.filter((t) => t.readyState !== "ended").map((t) => [t.id, t]));
      for (const [id, source] of sources)
        if (!wanted.has(id)) {
          source.disconnect();
          sources.delete(id);
        }
      for (const [id, track] of wanted)
        if (!sources.has(id)) {
          const source = ctx.createMediaStreamSource(makeStream([track]));
          source.connect(destination);
          sources.set(id, source);
        }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources.values()) source.disconnect();
      sources.clear();
      void ctx.close().catch(() => undefined);
    },
  };
}
