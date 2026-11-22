// The enlarge / minimise lifecycle as a state machine (plan 4.3). The view is a discriminated union, so an illegal combination
// (for example "expanded" without a context) cannot be represented, and every move goes through TRANSITIONS: a move that is
// not in the table is refused and leaves the state unchanged. machine.test.ts checks every allowed and every forbidden pair.
import type { ReaderSnapshot } from "@sefaria-social/host-contract";
import type { SocialContext } from "~/lib/ctx";

/** What a card shows: a room or a shiur. */
export type SourceRef = SocialContext;
/** The context the reader is in while enlarged (the `ctx` URL parameter). */
export type ContextId = SocialContext;

export type SessionView =
  | { kind: "idle" }
  | { kind: "card"; source: SourceRef } // in a feed, no reader involved
  | { kind: "entering"; target: ContextId; ownPlace: ReaderSnapshot | null }
  | { kind: "expanded"; context: ContextId; ownPlace: ReaderSnapshot | null; following: boolean }
  | { kind: "detached"; context: ContextId; ownPlace: ReaderSnapshot | null } // broke away, still connected
  | { kind: "leaving"; context: ContextId; returnTo: string };

export type SessionEvent =
  | { type: "showCard"; source: SourceRef }
  | { type: "dismiss" }
  | { type: "enlarge"; target: ContextId; ownPlace: ReaderSnapshot | null } // R9 steps 1–3
  | { type: "contextReady"; context: ContextId } // R9 step 4: host.reader.context.get() now equals the target
  | { type: "enterFailed"; reason: string }
  | { type: "stopFollowing" }
  | { type: "startFollowing" }
  | { type: "detach" }
  | { type: "rejoin" }
  | { type: "minimise"; returnTo: string } // R12
  | { type: "contextLost" } // the ctx left the address (a plain link, Back): treat as leaving
  | { type: "left" };

export type SessionKind = SessionView["kind"];
export type SessionEventType = SessionEvent["type"];

export const SESSION_KINDS: readonly SessionKind[] = ["idle", "card", "entering", "expanded", "detached", "leaving"];
export const SESSION_EVENT_TYPES: readonly SessionEventType[] = [
  "showCard",
  "dismiss",
  "enlarge",
  "contextReady",
  "enterFailed",
  "stopFollowing",
  "startFollowing",
  "detach",
  "rejoin",
  "minimise",
  "contextLost",
  "left",
];

type Step<K extends SessionKind, T extends SessionEventType> = (
  state: Extract<SessionView, { kind: K }>,
  event: Extract<SessionEvent, { type: T }>,
) => SessionView | string; // a string is the reason the move is refused

type Table = { [K in SessionKind]: { [T in SessionEventType]?: Step<K, T> } };

const sameContext = (a: ContextId, b: ContextId) => a.kind === b.kind && a.id === b.id;

/** The allowed moves. Anything not listed here is forbidden. */
export const TRANSITIONS: Table = {
  idle: {
    showCard: (_s, e) => ({ kind: "card", source: e.source }),
    enlarge: (_s, e) => ({ kind: "entering", target: e.target, ownPlace: e.ownPlace }),
  },
  card: {
    showCard: (_s, e) => ({ kind: "card", source: e.source }),
    dismiss: () => ({ kind: "idle" }),
    enlarge: (_s, e) => ({ kind: "entering", target: e.target, ownPlace: e.ownPlace }),
  },
  entering: {
    contextReady: (s, e) =>
      sameContext(s.target, e.context)
        ? { kind: "expanded", context: s.target, ownPlace: s.ownPlace, following: true }
        : "the reader's context is not the one being entered",
    enterFailed: () => ({ kind: "idle" }),
    contextLost: () => ({ kind: "idle" }),
  },
  expanded: {
    stopFollowing: (s) => ({ ...s, following: false }),
    startFollowing: (s) => ({ ...s, following: true }),
    detach: (s) => ({ kind: "detached", context: s.context, ownPlace: s.ownPlace }),
    minimise: (s, e) => ({ kind: "leaving", context: s.context, returnTo: e.returnTo }),
    contextLost: () => ({ kind: "idle" }),
  },
  detached: {
    rejoin: (s) => ({ kind: "expanded", context: s.context, ownPlace: s.ownPlace, following: true }),
    minimise: (s, e) => ({ kind: "leaving", context: s.context, returnTo: e.returnTo }),
    contextLost: () => ({ kind: "idle" }),
  },
  leaving: {
    left: () => ({ kind: "idle" }),
  },
};

export type TransitionResult = { ok: true; state: SessionView } | { ok: false; state: SessionView; reason: string };

/** Applies `event` to `state`. A move that is not in TRANSITIONS (or that its guard refuses) returns the state unchanged. */
export function transition(state: SessionView, event: SessionEvent): TransitionResult {
  const step = (TRANSITIONS[state.kind] as Record<string, Step<SessionKind, SessionEventType> | undefined>)[event.type];
  if (!step) return { ok: false, state, reason: `"${event.type}" is not allowed in "${state.kind}"` };
  const next = step(state as never, event as never);
  return typeof next === "string" ? { ok: false, state, reason: next } : { ok: true, state: next };
}

export const INITIAL_SESSION: SessionView = { kind: "idle" };
