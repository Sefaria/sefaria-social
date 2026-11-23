// The fake host (plan 4.6): an in-memory SurfaceHost for unit, contract and harness tests. It behaves like the reader where
// the surface can observe it (docs/CONTRACT.md, and the reader seam's notes) and records every call so tests can assert what
// the reader was told to do.
//
// It is typed from the pinned contract: `host` is an object literal of type SurfaceHost, so a member the pin removes is an
// excess property and a member it renames is missing; either way this file stops compiling. Never widen it to make a test pass.
import type {
  ApplyContext,
  ApplyResult,
  ReaderSnapshot,
  SliceFilter,
  SnapshotChange,
  SurfaceHost,
  Unsubscribe,
  Workspace,
  NavState,
} from "./contract";
import { SURFACE_HOST_CONTRACT } from "./contract";
import { READER_CONTEXT_RE, SAME_SITE_PATH_RE, readerSnapshotSchema } from "./schemas";

export type HostLocation = ReturnType<SurfaceHost["location"]["get"]>;
export type Viewer = ReturnType<SurfaceHost["viewer"]["get"]>;
export type HostUi = Pick<SurfaceHost["ui"], "interfaceLang" | "theme">;
export type ReportEvent = Parameters<SurfaceHost["report"]>[0];

/**
 * Where the fake keeps its history. The default is in memory; the harness passes one backed by the browser's own history,
 * because there the fake plays the reader, and the reader owns the address bar.
 */
export interface FakeHistory {
  get(): HostLocation;
  push(path: string, state: unknown): void;
  replace(path: string, state: unknown): void;
  back(): void;
  forward(): void;
  /** Fires after every change, including back and forward. */
  subscribe(cb: () => void): Unsubscribe;
}

/** A history kept in an array, like the browser's: push drops the forward entries. */
export function createMemoryFakeHistory(initial = "/social"): FakeHistory {
  const entries: { path: string; state: unknown }[] = [{ path: initial, state: null }];
  let index = 0;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((cb) => cb());
  return {
    get() {
      const e = entries[index] ?? { path: "/", state: null };
      const url = new URL(e.path, "http://fake.invalid");
      return { pathname: url.pathname, search: url.search, hash: url.hash, state: e.state };
    },
    push(path, state) {
      entries.splice(index + 1, entries.length, { path, state });
      index = entries.length - 1;
      emit();
    },
    replace(path, state) {
      entries[index] = { path, state };
      emit();
    },
    back() {
      if (index === 0) return;
      index--;
      emit();
    },
    forward() {
      if (index >= entries.length - 1) return;
      index++;
      emit();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Test-only key for the fake identity token (HMAC-SHA256). It signs tokens for the fake host and nothing else; the real token
 * comes from Django (plan 6.1). Not a secret.
 */
export const FAKE_TOKEN_KEY = "fake-host-test-key-not-a-secret";

export interface FakeHostOptions {
  /** Starting address when no `history` is given. Default "/social". */
  url?: string;
  history?: FakeHistory;
  viewer?: Viewer;
  ui?: Partial<HostUi>;
  config?: Partial<SurfaceHost["config"]>;
  /** The reader's slices before anything is applied. */
  slices?: ReaderSnapshot["slices"];
  /**
   * Each slice's scope, as the reader registers it ("personal": the reader's own preference such as settings; "moment": what
   * is on screen). `getSnapshot({ scope: "moment" })` returns only moment slices, like the reader. Unlisted slices are moment.
   */
  sliceScopes?: Record<string, "personal" | "moment">;
  /** Token lifetime in seconds. Default 300. */
  tokenTtl?: number;
}

export interface FakeHostCalls {
  navigate: { to: string; replace: boolean; state: unknown }[];
  refused: string[];
  href: string[];
  applied: { snapshot: ReaderSnapshot; ctx: ApplyContext }[];
  go: { ws: Workspace; replace: boolean; state?: NavState }[];
  report: ReportEvent[];
  signIn: number;
  tokens: number;
}

export interface FakeHost {
  host: SurfaceHost;
  calls: FakeHostCalls;
  /** The full current address: pathname + search + hash. */
  url(): string;
  back(): void;
  forward(): void;
  setViewer(viewer: Viewer): void;
  setUi(ui: Partial<HostUi>): void;
  /** Simulates the user scrolling or clicking in the reader (fires onLocalInput subscribers). */
  localInput(): void;
  /**
   * Simulates the person moving in the reader themselves, the way the reader's own navigation does: input first, then a push
   * that keeps the current `ctx` (the reader keeps it through its own workspace changes), then the state subscribers hear it.
   * `slices` are merged into the reader's slices.
   */
  localMove(path: string, slices?: ReaderSnapshot["slices"]): void;
}

const SNAPSHOT_V = 1 as const;

/** Removes the reserved `ctx` parameter from a path; the reader never puts it in a snapshot url. */
export function stripCtx(path: string): string {
  const url = new URL(path, "http://fake.invalid");
  url.searchParams.delete("ctx");
  return `${url.pathname}${url.search}`;
}

function withCtx(path: string, ctx: string | null): string {
  if (!ctx) return path;
  const url = new URL(path, "http://fake.invalid");
  url.searchParams.set("ctx", ctx);
  return `${url.pathname}${url.search}${url.hash}`;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Signs `payload` as a compact JWT (HS256) with FAKE_TOKEN_KEY. */
export async function mintFakeToken(payload: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(FAKE_TOKEN_KEY), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(sig)}`;
}

/** The error identityToken() rejects with when nobody is signed in (the reader uses the same name). */
export class SignedOutError extends Error {
  override name = "SignedOutError";
}

export function createFakeHost(opts: FakeHostOptions = {}): FakeHost {
  const history = opts.history ?? createMemoryFakeHistory(opts.url ?? "/social");
  const calls: FakeHostCalls = { navigate: [], refused: [], href: [], applied: [], go: [], report: [], signIn: 0, tokens: 0 };
  let viewer: Viewer = opts.viewer ?? null;
  const ui: HostUi = { interfaceLang: opts.ui?.interfaceLang ?? "english", theme: opts.ui?.theme ?? "light" };
  let slices: ReaderSnapshot["slices"] = { ...(opts.slices ?? {}) };
  let applying = false;
  let workspace: Workspace = { panels: {}, layout: null };

  const viewerSubs = new Set<() => void>();
  const uiSubs = new Set<() => void>();
  const inputSubs = new Set<() => void>();
  const stateSubs = new Set<(change: SnapshotChange, snapshot: ReaderSnapshot) => void>();

  const url = () => {
    const l = history.get();
    return `${l.pathname}${l.search}${l.hash}`;
  };
  const currentCtx = (): string | null => {
    const value = new URL(url(), "http://fake.invalid").searchParams.get("ctx");
    return value && READER_CONTEXT_RE.test(value) ? value : null;
  };
  const scopeOf = (id: string) => opts.sliceScopes?.[id] ?? "moment";
  const snapshot = (filter?: SliceFilter): ReaderSnapshot => {
    const picked = Object.entries(slices).filter(
      ([id]) =>
        (filter?.scope !== "moment" || scopeOf(id) === "moment") &&
        (!filter?.include || filter.include.includes(id)) &&
        !filter?.exclude?.includes(id),
    );
    return { v: SNAPSHOT_V, url: stripCtx(url()), nav: null, slices: Object.fromEntries(picked) };
  };

  // Snapshot subscribers hear about every address change, like the reader's state API.
  history.subscribe(() => {
    const s = snapshot();
    stateSubs.forEach((cb) => cb({ url: s.url }, s));
  });

  const isSameSite = (to: string) => SAME_SITE_PATH_RE.test(to);

  const navigate: SurfaceHost["navigate"] = (to, o) => {
    if (!isSameSite(to)) {
      calls.refused.push(to);
      calls.report.push({ kind: "error", name: "navigate-refused", data: { to } });
      return;
    }
    const replace = o?.replace ?? false;
    calls.navigate.push({ to, replace, state: o?.state });
    (replace ? history.replace : history.push)(to, o?.state ?? null);
  };

  const host: SurfaceHost = {
    contract: { major: SURFACE_HOST_CONTRACT.major, minor: SURFACE_HOST_CONTRACT.minor },
    location: {
      get: () => history.get(),
      subscribe: (cb) => history.subscribe(cb),
    },
    navigate,
    href(to) {
      calls.href.push(to);
      return isSameSite(to) ? to : "#";
    },
    reader: {
      state: {
        getSnapshot: (filter) => snapshot(filter),
        async applySnapshot(s, ctx): Promise<ApplyResult> {
          const parsed = readerSnapshotSchema.safeParse(s);
          if (!parsed.success) return { warnings: [{ code: 103, detail: "snapshot refused" }] };
          calls.applied.push({ snapshot: parsed.data, ctx });
          applying = true;
          try {
            // Like the reader: a snapshot restores the slices it carries; the reader's other slices stay as they are.
            slices = { ...slices, ...parsed.data.slices };
            // Like the reader: follow and playback navigate with replace and keep the current ctx.
            const to = withCtx(parsed.data.url, currentCtx());
            if (to !== url()) history.replace(to, history.get().state);
          } finally {
            applying = false;
          }
          return { warnings: [] };
        },
        subscribe(onChange, filter) {
          // Filtered like the reader: the subscriber's snapshot holds only the slices its filter asks for.
          const cb = (change: SnapshotChange, _s: ReaderSnapshot) => onChange(change, snapshot(filter));
          stateSubs.add(cb);
          return () => stateSubs.delete(cb);
        },
        onLocalInput(cb) {
          inputSubs.add(cb);
          return () => inputSubs.delete(cb);
        },
        get applying() {
          return applying;
        },
      },
      commands: {
        current: () => ({ ...workspace, ...(currentCtx() ? { ctx: currentCtx() ?? undefined } : {}) }),
        async go(ws, o) {
          calls.go.push({ ws, replace: o?.replace ?? false, state: o?.state });
          workspace = ws;
          navigate(host.reader.commands.href(ws), { replace: o?.replace ?? false });
        },
        href(ws) {
          const first = Object.values(ws.panels)[0];
          const path = first ? `/${first.ref.replace(/ /g, "_")}` : "/texts";
          return withCtx(path, ws.ctx ?? null);
        },
        canonicalize: async () => false,
      },
      context: {
        get: () => currentCtx(),
        subscribe(cb) {
          let last = currentCtx();
          return history.subscribe(() => {
            const next = currentCtx();
            if (next !== last) {
              last = next;
              cb();
            }
          });
        },
      },
    },
    viewer: {
      get: () => viewer,
      subscribe(cb) {
        viewerSubs.add(cb);
        return () => viewerSubs.delete(cb);
      },
      async identityToken() {
        if (!viewer) throw new SignedOutError("signed out");
        calls.tokens++;
        const now = Math.floor(Date.now() / 1000);
        return mintFakeToken({ sub: String(viewer.id), name: viewer.name, iat: now, exp: now + (opts.tokenTtl ?? 300) });
      },
      requestSignIn() {
        calls.signIn++;
        // The reader opens its sign-in page and returns to the current address afterwards.
        navigate(`/login?next=${encodeURIComponent(url())}`);
      },
    },
    ui: {
      get interfaceLang() {
        return ui.interfaceLang;
      },
      get theme() {
        return ui.theme;
      },
      subscribe(cb) {
        uiSubs.add(cb);
        return () => uiSubs.delete(cb);
      },
    },
    config: {
      apiOrigin: opts.config?.apiOrigin ?? "http://localhost:3200",
      relayOrigin: opts.config?.relayOrigin ?? "ws://localhost:8787",
      environment: opts.config?.environment ?? "local",
    },
    report(event) {
      calls.report.push(event);
    },
  };

  return {
    host,
    calls,
    url,
    back: () => history.back(),
    forward: () => history.forward(),
    setViewer(v) {
      viewer = v;
      viewerSubs.forEach((cb) => cb());
    },
    setUi(next) {
      Object.assign(ui, next);
      uiSubs.forEach((cb) => cb());
    },
    localInput() {
      inputSubs.forEach((cb) => cb());
    },
    localMove(path, moved) {
      inputSubs.forEach((cb) => cb());
      if (moved) slices = { ...slices, ...moved };
      const to = withCtx(stripCtx(path), currentCtx());
      if (to !== url()) history.push(to, null);
      else {
        const s = snapshot();
        stateSubs.forEach((cb) => cb({ slices: moved ?? {} }, s));
      }
    },
  };
}
