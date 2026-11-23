// What the session client sees as "the reader" (routing rules R13 and R14; spec 013). The client from @sefaria-social/session
// reads the reader's state to publish it and applies others' state to follow them, through one ReaderStateApi. This file
// builds that api from the host's real one:
//   - Reading (publish view, R14): the url without any `ctx`, only the slices that are moment-scoped in this reader, no
//     search words in `nav`, plus the `social.summary` slice ({ref, heRef, title}) so the relay and cards never read
//     snapshots (plan 4.5). heRef and title come from the text API's answer for the ref (spec 016); until it has answered
//     they are null and the ref, and the stream is republished when it lands.
//   - Applying (follow gate, R13): only the slices that are moment-scoped in THIS reader are kept (personal slices such as
//     settings, and slices this reader does not have, are dropped), with origin "follow". While the gate is closed (the
//     viewer is in the lobby, or broke away) nothing is applied: the state is held, so entering can apply it at once (R9).
import { diff, isEmptyChange, parseSnapshot } from "@sefaria-social/session";
import type { ApplyResult, ReaderSnapshot, ReaderStateApi, SnapshotChange } from "@sefaria-social/session";
import type { ReaderStateApi as HostReaderStateApi, WorkspaceCommands } from "@sefaria-social/host-contract";
import type { TextSource } from "~/lib/sefaria-text";

export const SUMMARY_SLICE = "social.summary";
const CTX_PARAM = "ctx";

/** The slice ids this reader treats as "what is on screen" (moment scope). */
export function momentSliceIds(api: Pick<HostReaderStateApi, "getSnapshot">): Set<string> {
  return new Set(Object.keys(api.getSnapshot({ scope: "moment" }).slices));
}

/** `url` with every `ctx` parameter removed (R14: an outgoing snapshot never carries the reader's context). */
export function withoutAnyCtx(url: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = rest.indexOf("?");
  if (q < 0) return url;
  const kept = rest
    .slice(q + 1)
    .split("&")
    .filter((p) => p && (p.split("=")[0] ?? "").replace(/\+/g, " ") !== CTX_PARAM);
  return `${rest.slice(0, q)}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

/** History state without search words (the reader puts them in nav.terms to highlight a match). */
function withoutTerms(nav: unknown): unknown {
  if (!nav || typeof nav !== "object" || Array.isArray(nav) || !("terms" in nav)) return nav;
  const { terms: _terms, ...rest } = nav as Record<string, unknown>;
  return rest;
}

export interface Summary {
  ref: string;
  heRef: string | null;
  title: string;
}

/** Where a summary's names come from: the page's text source (lib/sefaria-text.ts). */
export type RefTitles = Pick<TextSource, "titles" | "prefetch" | "subscribe">;

/**
 * The summary slice: `ref` from the reader's first panel, else the address's first path segment; `heRef` and `title` from
 * the text API's answer for that ref when it has landed (asking for it otherwise), else null and the ref.
 */
export function summaryOf(url: string, commands?: Pick<WorkspaceCommands, "current">, titles?: RefTitles): Summary | null {
  let ref: string | undefined;
  try {
    ref = Object.values(commands?.current().panels ?? {})[0]?.ref;
  } catch {
    ref = undefined;
  }
  if (!ref) {
    const segment = url.split(/[?#]/)[0]!.split("/").filter(Boolean)[0];
    if (!segment) return null;
    try {
      ref = decodeURIComponent(segment).replace(/_/g, " ").replace(/\./g, " ");
    } catch {
      return null;
    }
  }
  const clipped = ref.slice(0, 300);
  const named = titles?.titles(clipped) ?? null;
  if (titles && !named) titles.prefetch(clipped);
  return { ref: clipped, heRef: named?.heRef?.slice(0, 300) ?? null, title: (named?.title ?? clipped).slice(0, 300) };
}

/**
 * The outgoing form of a snapshot (R14): no ctx, only `moment` slices, no search words, and the summary slice. Exported for
 * the unit test that proves it on a fixture holding both a ctx and a personal slice.
 */
export function outgoing(
  snapshot: ReaderSnapshot,
  moment: ReadonlySet<string>,
  commands?: Pick<WorkspaceCommands, "current">,
  titles?: RefTitles,
): ReaderSnapshot {
  const url = withoutAnyCtx(snapshot.url);
  const slices: ReaderSnapshot["slices"] = {};
  for (const [id, value] of Object.entries(snapshot.slices)) if (moment.has(id) && id !== SUMMARY_SLICE) slices[id] = value;
  const summary = summaryOf(url, commands, titles);
  if (summary) slices[SUMMARY_SLICE] = { v: 1, value: summary };
  return { v: 1, url, nav: withoutTerms(snapshot.nav), slices };
}

/** The incoming form (R13): only what this reader has as moment slices; the summary slice is for the relay, never applied. */
export function incoming(snapshot: ReaderSnapshot, moment: ReadonlySet<string>): ReaderSnapshot {
  const slices: ReaderSnapshot["slices"] = {};
  for (const [id, value] of Object.entries(snapshot.slices)) if (moment.has(id) && id !== SUMMARY_SLICE) slices[id] = value;
  return { ...snapshot, slices };
}

export interface RoomReader {
  /** What the session client is given. */
  api: ReaderStateApi;
  /** The latest state that arrived (validated, filtered), whether or not it was applied; null before anything arrived. */
  held(): ReaderSnapshot | null;
  /** Re-check the gate; when it is open and something is held that was not applied, apply it now (entering, R9 step 4). */
  release(): Promise<ApplyResult | null>;
}

export interface RoomReaderOptions {
  /** Apply what arrives now? (expanded in this room's context and following) */
  isOpen(): boolean;
  commands?: Pick<WorkspaceCommands, "current">;
  /** Names for the summary (heRef, title); without it the summary has heRef null and the ref as its title. */
  titles?: RefTitles;
}

/**
 * `real` is the host's reader state API (the pinned contract's type: its warning codes are plain numbers); the result is the
 * session package's type, which the client takes.
 */
export function roomReader(real: HostReaderStateApi, opts: RoomReaderOptions): RoomReader {
  let held: ReaderSnapshot | null = null;
  let heldApplied = true;

  const apply = async (s: ReaderSnapshot): Promise<ApplyResult> => {
    heldApplied = true;
    // The reader's codes are the documented ones (100–300); the contract types them as number.
    return (await real.applySnapshot(s, { origin: "follow", persist: false })) as ApplyResult;
  };

  const publish = (): ReaderSnapshot =>
    outgoing(real.getSnapshot({ scope: "moment" }), momentSliceIds(real), opts.commands, opts.titles);

  const api: ReaderStateApi = {
    getSnapshot: () => publish(),
    async applySnapshot(raw) {
      const parsed = parseSnapshot(raw); // untrusted until parsed (plan 4.2), even though the stream reader checked it
      if (!parsed) return { warnings: [{ code: 103, detail: "snapshot refused" }] };
      const s = incoming(parsed, momentSliceIds(real));
      // A change applies only the slices that differ; keep the whole picture so entering can apply all of it.
      held = held ? { ...s, slices: { ...held.slices, ...s.slices } } : s;
      if (!opts.isOpen()) {
        heldApplied = false;
        return { warnings: [] };
      }
      return apply(s);
    },
    subscribe(onChange, _filter) {
      let last = publish();
      const check = () => {
        const now = publish();
        const change: SnapshotChange = diff(last, now);
        last = now;
        if (!isEmptyChange(change)) onChange(change, now);
      };
      const offReader = real.subscribe(check, { scope: "moment" });
      // The summary's names land later than the move that asked for them: publish them without waiting for another move.
      const offTitles = opts.titles?.subscribe(check);
      return () => {
        offReader();
        offTitles?.();
      };
    },
    onLocalInput: (cb) => real.onLocalInput(cb),
    get applying() {
      return real.applying;
    },
  };

  return {
    api,
    held: () => held,
    async release() {
      if (!held || heldApplied || !opts.isOpen()) return null;
      return apply(held);
    },
  };
}
