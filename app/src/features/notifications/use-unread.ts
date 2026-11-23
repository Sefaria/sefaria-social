// The unread count in social's navigation (spec 026 AC-003): read when social opens and every 60 seconds, shared by every
// component that shows it, and set to zero when the activity page marks everything read.
import { useEffect, useSyncExternalStore } from "react";
import type { SocialApi } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useViewer } from "~/features/host/use-viewer";

export const UNREAD_REFRESH_MS = 60_000;

interface Entry {
  unread: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  users: number;
}

const entries = new WeakMap<SocialApi, Entry>();

function entryOf(api: SocialApi): Entry {
  let e = entries.get(api);
  if (!e) {
    e = { unread: 0, listeners: new Set(), timer: null, users: 0 };
    entries.set(api, e);
  }
  return e;
}

export function setUnread(api: SocialApi, n: number): void {
  const e = entryOf(api);
  if (e.unread === n) return;
  e.unread = n;
  e.listeners.forEach((l) => l());
}

function read(api: SocialApi) {
  api.notifications().then(
    (list) => setUnread(api, list.unread),
    () => undefined,
  );
}

const noop = () => () => undefined;

export function useUnread(): number {
  const api = useSocialApi();
  const viewer = useViewer();
  const entry = api && viewer ? entryOf(api) : null;
  useEffect(() => {
    if (!api || !entry) return;
    entry.users++;
    if (!entry.timer) {
      read(api);
      entry.timer = setInterval(() => read(api), UNREAD_REFRESH_MS);
    }
    return () => {
      entry.users--;
      if (entry.users === 0 && entry.timer) {
        clearInterval(entry.timer);
        entry.timer = null;
      }
    };
  }, [api, entry]);
  return useSyncExternalStore(
    entry
      ? (cb) => {
          entry.listeners.add(cb);
          return () => entry.listeners.delete(cb);
        }
      : noop,
    () => entry?.unread ?? 0,
    () => 0,
  );
}
