// React hooks over the replay controller and the recordings API (spec 042). The controller lives outside React, one per host.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { useHost } from "~/features/host/host-context";
import { withoutAnyCtx } from "~/features/session/room-reader";
import { createReplayApi, type ReplayApi } from "./replay-api";
import { recordingCtx, replayControllerFor, type ReplayController, type ReplayView } from "./replay-controller";

/** Lets tests provide the recordings API; the surface leaves it empty and gets one built from the host. */
export const ReplayApiContext = createContext<ReplayApi | null>(null);

const built = new WeakMap<SurfaceHost, ReplayApi>();

/** The recordings API for this host, or null in standalone mode with nothing provided. */
export function useReplayApi(): ReplayApi | null {
  const provided = useContext(ReplayApiContext);
  const host = useHost();
  if (provided) return provided;
  if (!host) return null;
  let api = built.get(host);
  if (!api) {
    api = createReplayApi(host);
    built.set(host, api);
  }
  return api;
}

const CLOSED: ReplayView = { kind: "closed" };
const noop = () => () => undefined;

/** The host's replay controller, or null in standalone mode. */
export function useReplayController(): ReplayController | null {
  const host = useHost();
  return host ? replayControllerFor(host) : null;
}

export function useReplayView(controller: ReplayController | null): ReplayView {
  return useSyncExternalStore(
    controller ? (cb) => controller.subscribe(cb) : noop,
    () => controller?.view() ?? CLOSED,
    () => CLOSED,
  );
}

/** `url` (a reader address) in a recording's context: any earlier ctx is replaced by `ctx=social.rec.<id>`. */
export function withRecordingCtx(url: string, recordingId: string): string {
  const plain = withoutAnyCtx(url);
  const hashAt = plain.indexOf("#");
  const hash = hashAt >= 0 ? plain.slice(hashAt) : "";
  const rest = hashAt >= 0 ? plain.slice(0, hashAt) : plain;
  return `${rest}${rest.includes("?") ? "&" : "?"}ctx=${recordingCtx(recordingId)}${hash}`;
}

/** A length in ms as m:ss, or h:mm:ss from an hour. */
export function formatLength(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A recording's date in the interface language, or "" for a value that is not a date. */
export function formatDate(iso: string | undefined, lang: "english" | "hebrew"): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "hebrew" ? "he" : "en", { dateStyle: "medium" }).format(d);
}
