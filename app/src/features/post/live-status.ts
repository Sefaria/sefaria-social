// Live cards' status (spec 056 AC-004): one poller per API object asks `GET /api/v1/live` for the cards on screen, in one
// request (50 ids at most per request) every 15 seconds, and never while the tab is hidden. A card that comes into view
// without a status, or a tab that becomes visible again, is read at once. The browser keeps the answer and revalidates it with
// its ETag (the endpoint says `no-cache`), so an unchanged answer is a 304. No socket (plan 4.7).
import { useEffect, useState, type RefObject } from "react";
import { useSocialApi } from "~/features/api/social-api";

export const POLL_MS = 15_000;
export const BATCH = 50;
/** How long a newly visible card waits, so cards that appear together are read together. */
const SOON_MS = 50;

export interface LiveStatus {
  id: string;
  kind: "room" | "broadcast" | "recording";
  live: boolean;
  ref: string | null;
  heRef: string | null;
  here: number;
  updatedAt: string | null;
}

export interface LiveSource {
  liveStatus(ids: string[]): Promise<LiveStatus[]>;
}

interface ObserverLike {
  observe(el: object): void;
  unobserve(el: object): void;
  disconnect(): void;
}

/** The page around the poller: its visibility and the viewport (IntersectionObserver); tests give a fake. */
export interface PollerEnv {
  isHidden(): boolean;
  onVisibilityChange(cb: () => void): () => void;
  observe(cb: (entries: { target: object; isIntersecting: boolean }[]) => void): ObserverLike;
}

export class LivePoller {
  private watchers = new Map<object, { id: string; cb: (s: LiveStatus) => void }>();
  private onScreen = new Set<object>();
  private known = new Map<string, LiveStatus>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reading = false;
  /** A card came into view during a read: read again as soon as it ends. */
  private again = false;
  private observer: ObserverLike;
  private stopVisibility: () => void;

  constructor(
    private source: LiveSource,
    private env: PollerEnv,
  ) {
    this.observer = env.observe((entries) => {
      let fresh = false;
      let entered = false;
      for (const e of entries) {
        const w = this.watchers.get(e.target);
        if (!w) continue;
        if (e.isIntersecting) {
          if (!this.onScreen.has(e.target)) entered = true;
          this.onScreen.add(e.target);
          if (!this.known.has(w.id)) fresh = true;
        } else this.onScreen.delete(e.target);
      }
      // A card never read is read at once; one coming back into view restarts the reads if they had stopped (nothing on screen).
      if (this.reading && fresh) this.again = true;
      else if (fresh || (entered && this.timer === null && !this.reading)) this.schedule(SOON_MS);
    });
    this.stopVisibility = env.onVisibilityChange(() => {
      if (env.isHidden()) this.clear();
      else this.schedule(SOON_MS);
    });
  }

  /** Follow one card's status; returns the function that stops. */
  watch(id: string, el: object, cb: (s: LiveStatus) => void): () => void {
    this.watchers.set(el, { id, cb });
    this.observer.observe(el);
    const last = this.known.get(id);
    if (last) cb(last);
    return () => {
      this.watchers.delete(el);
      this.onScreen.delete(el);
      this.observer.unobserve(el);
    };
  }

  dispose(): void {
    this.clear();
    this.observer.disconnect();
    this.stopVisibility();
    this.watchers.clear();
    this.onScreen.clear();
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.env.isHidden()) return;
    this.clear();
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private visibleIds(): string[] {
    const ids = new Set<string>();
    for (const el of this.onScreen) {
      const w = this.watchers.get(el);
      if (w) ids.add(w.id);
    }
    return [...ids];
  }

  private async tick() {
    this.timer = null;
    if (this.env.isHidden()) return; // becoming visible schedules the next read
    const ids = this.visibleIds();
    if (!ids.length) return; // a card coming into view schedules the next read
    if (this.reading) {
      this.again = true; // the read under way schedules this one when it ends
      return;
    }
    {
      this.reading = true;
      try {
        for (let i = 0; i < ids.length; i += BATCH) {
          const answer = await this.source.liveStatus(ids.slice(i, i + BATCH)).catch(() => [] as LiveStatus[]);
          for (const s of answer) {
            this.known.set(s.id, s);
            for (const w of this.watchers.values()) if (w.id === s.id) w.cb(s);
          }
        }
      } finally {
        this.reading = false;
      }
    }
    if (this.timer !== null) return;
    const soon = this.again;
    this.again = false;
    this.schedule(soon ? SOON_MS : POLL_MS);
  }
}

/** The real page: `document.visibilityState` and an IntersectionObserver (everything counts as on screen without one). */
export function browserEnv(): PollerEnv {
  return {
    isHidden: () => document.visibilityState === "hidden",
    onVisibilityChange(cb) {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    observe(cb) {
      if (typeof IntersectionObserver === "undefined")
        return { observe: (el) => cb([{ target: el, isIntersecting: true }]), unobserve() {}, disconnect() {} };
      const io = new IntersectionObserver((entries) => cb(entries));
      return {
        observe: (el) => io.observe(el as Element),
        unobserve: (el) => io.unobserve(el as Element),
        disconnect: () => io.disconnect(),
      };
    },
  };
}

const pollers = new WeakMap<LiveSource, LivePoller>();

/** A card's live status, polled while it is on screen; null until the first answer (or when nothing posted it). */
export function useLiveStatus(id: string | null, el: RefObject<HTMLElement | null>): LiveStatus | null {
  const api = useSocialApi();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  useEffect(() => {
    const node = el.current;
    if (!id || !node || !api || typeof api.liveStatus !== "function" || typeof document === "undefined") return;
    let poller = pollers.get(api);
    if (!poller) {
      poller = new LivePoller(api, browserEnv());
      pollers.set(api, poller);
    }
    return poller.watch(id, node, setStatus);
  }, [api, id, el]);
  return status;
}
