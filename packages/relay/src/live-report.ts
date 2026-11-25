/**
 * The relay's reports of each room's live state to the social server (spec 056 AC-001; decision 0013). Pure: the `Room` object
 * asks `observe` after every message it delivers and on its once-a-second tick, and sends what it returns. A report goes when the
 * leader's ref, Hebrew ref, title or the number connected changes, at least once a minute while anyone is there, and once more
 * when the room empties, but never two for one room within 5 seconds: a change inside the window waits for its end and goes
 * with the latest values.
 */

export const MIN_GAP_MS = 5_000;
export const HEARTBEAT_MS = 60_000;
/** Where the server takes reports, under `SOCIAL_SERVER_URL`. */
export const REPORT_PATH = "/api/v1/internal/relay/live";
export const SIGNATURE_HEADER = "x-relay-signature";

export interface LiveState {
  ref: string | null;
  heRef: string | null;
  title: string | null;
  participants: number;
}

export interface LiveReportBody extends LiveState {
  /** The relay room id: a room's uuid, or `b_<broadcast id>`. */
  room: string;
  /** When the relay made the report (ms since the epoch); the server refuses one older than 5 minutes. */
  at: number;
}

const same = (a: LiveState, b: LiveState | null) =>
  b !== null && a.ref === b.ref && a.heRef === b.heRef && a.title === b.title && a.participants === b.participants;

export class LiveReporter {
  private sent: LiveState | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  /** The state to report now, or null (nothing new, or the last report was under 5 seconds ago: ask again later). */
  observe(state: LiveState, now: number): LiveState | null {
    if (this.sent === null && state.participants === 0) return null; // never reported and nobody there: nothing to say
    const changed = !same(state, this.sent);
    const heartbeat = state.participants > 0 && now - this.lastAt >= HEARTBEAT_MS;
    if (!changed && !heartbeat) return null;
    if (now - this.lastAt < MIN_GAP_MS) return null;
    this.sent = { ...state };
    this.lastAt = now;
    return this.sent;
  }

  /** Whether a change is waiting for the 5 seconds to pass (the room keeps ticking until it has gone). */
  pending(state: LiveState): boolean {
    return this.sent !== null && !same(state, this.sent);
  }
}

const enc = new TextEncoder();

/** `sha256=<hex HMAC-SHA256 of the raw body>`: the format of Django's webhook signature, which the server already checks. */
export async function signReport(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
