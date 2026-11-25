// The recording's video (spec 041; design 4.4): a 640×360 canvas drawn on a timer at 15 fps (not requestAnimationFrame, so a
// hidden tab slows it instead of stopping it). It draws the tiles this window shows — up to four, each registered camera's
// current frame, otherwise the person's initials — with names and the speaking ring; with nobody on a call, a card with the
// room's title and "No call", so the media spans the whole recording. Its stream is canvas.captureStream(fps).
//
// The colours are the video's own (they are burnt into the recording, not themed UI), so they are constants here.

export interface CompositorTile {
  participantId: string;
  el: HTMLVideoElement;
}

export interface CompositorParticipant {
  id: string;
  name: string;
  speaking: boolean;
}

/** The parts of a canvas the compositor uses (a fake in tests). */
export interface CompositorCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
  captureStream(fps: number): MediaStream;
}

export interface CompositorOptions {
  canvas?: CompositorCanvas;
  fps?: number;
  width?: number;
  height?: number;
  tiles: () => readonly CompositorTile[];
  participants: () => readonly CompositorParticipant[];
  title: () => string;
  /** The card's second line ("No call"), in the recorder's interface language. */
  noCall?: () => string;
  /** A name for someone without one. */
  someone?: () => string;
  setInterval?: (cb: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface Compositor {
  stream: MediaStream;
  start(): void;
  stop(): void;
  /** Draw one frame now (the timer calls it). */
  draw(): void;
}

const BACKGROUND = "#1f1f1f";
const CELL = "#333333";
const TEXT = "#ffffff";
const SPEAKING = "#4caf50";
const AVATAR = "#5a5a5a";
const MAX_TILES = 4;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

/** The grid's cells for n tiles: 1 full, 2 side by side, 3–4 in two rows. */
export function gridCells(n: number, width: number, height: number): { x: number; y: number; w: number; h: number }[] {
  if (n <= 0) return [];
  const cols = n === 1 ? 1 : 2;
  const rows = n <= 2 ? 1 : 2;
  const w = width / cols;
  const h = height / rows;
  return Array.from({ length: n }, (_, i) => ({ x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h }));
}

export function createCompositor(opts: CompositorOptions): Compositor {
  const fps = opts.fps ?? 15;
  const width = opts.width ?? 640;
  const height = opts.height ?? 360;
  const canvas: CompositorCanvas = opts.canvas ?? (document.createElement("canvas") as unknown as CompositorCanvas);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const set = opts.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
  const clear = opts.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let timer: unknown = null;

  const text = (s: string, x: number, y: number, size: number, align: CanvasTextAlign) => {
    if (!ctx) return;
    ctx.fillStyle = TEXT;
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.direction = "inherit";
    ctx.fillText(s, x, y, width - 32);
  };

  const card = () => {
    if (!ctx) return;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    text(opts.title(), width / 2, height / 2 - 16, 28, "center");
    text(opts.noCall?.() ?? "No call", width / 2, height / 2 + 24, 18, "center");
  };

  const draw = () => {
    if (!ctx) return; // no canvas support (jsdom): nothing to draw
    const people = opts.participants().slice(0, MAX_TILES);
    if (people.length === 0) return card();
    const videos = new Map<string, HTMLVideoElement>();
    for (const t of opts.tiles()) if (t.el.videoWidth > 0 && !videos.has(t.participantId)) videos.set(t.participantId, t.el);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    const cells = gridCells(people.length, width, height);
    people.forEach((p, i) => {
      const c = cells[i]!;
      const pad = 2;
      ctx.fillStyle = CELL;
      ctx.fillRect(c.x + pad, c.y + pad, c.w - 2 * pad, c.h - 2 * pad);
      const name = p.name || opts.someone?.() || "";
      const video = videos.get(p.id);
      if (video) {
        // Cover the cell, keeping the frame's aspect.
        const scale = Math.max(c.w / video.videoWidth, c.h / video.videoHeight);
        const sw = c.w / scale;
        const sh = c.h / scale;
        try {
          ctx.drawImage(
            video,
            (video.videoWidth - sw) / 2,
            (video.videoHeight - sh) / 2,
            sw,
            sh,
            c.x + pad,
            c.y + pad,
            c.w - 2 * pad,
            c.h - 2 * pad,
          );
        } catch {
          // A frame that cannot be drawn this tick: the cell stays blank until the next.
        }
      } else {
        const r = Math.min(c.w, c.h) / 5;
        ctx.fillStyle = AVATAR;
        ctx.beginPath();
        ctx.arc(c.x + c.w / 2, c.y + c.h / 2, r, 0, Math.PI * 2);
        ctx.fill();
        text(initials(name || "?"), c.x + c.w / 2, c.y + c.h / 2, Math.round(r * 0.8), "center");
      }
      text(name, c.x + 12, c.y + c.h - 16, 14, "left");
      if (p.speaking) {
        ctx.strokeStyle = SPEAKING;
        ctx.lineWidth = 4;
        ctx.strokeRect(c.x + pad + 2, c.y + pad + 2, c.w - 2 * pad - 4, c.h - 2 * pad - 4);
      }
    });
  };

  return {
    stream: canvas.captureStream(fps),
    draw,
    start() {
      if (timer !== null) return;
      draw();
      timer = set(draw, Math.round(1000 / fps));
    },
    stop() {
      if (timer === null) return;
      clear(timer);
      timer = null;
    },
  };
}
