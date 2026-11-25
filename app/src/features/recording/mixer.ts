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
  // A destination with nothing connected produces no samples, and a MediaRecorder holding its track then writes nothing at
  // all (it waits for audio): a constant source through a zero gain keeps the track running when nobody's audio is mixed.
  const silence = keepRunning(ctx, destination);
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
      silence?.stop();
      void ctx.close().catch(() => undefined);
    },
  };
}

/** Feeds silence into the destination where the context can (real Web Audio); a test fake without it is left alone. */
function keepRunning(ctx: MixerAudioContext, destination: unknown): { stop(): void } | null {
  const c = ctx as Partial<{
    createConstantSource(): { offset: { value: number }; connect(n: unknown): unknown; start(): void; stop(): void };
    createGain(): { gain: { value: number }; connect(n: unknown): unknown };
  }>;
  if (typeof c.createConstantSource !== "function" || typeof c.createGain !== "function") return null;
  const source = c.createConstantSource();
  const gain = c.createGain();
  source.offset.value = 0;
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(destination);
  source.start();
  return { stop: () => source.stop() };
}
