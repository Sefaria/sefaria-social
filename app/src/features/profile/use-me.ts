// The viewer's own profile (spec 025), read once per API and shared by the composer, the nav and settings; refreshed after an
// edit. Null while unknown, signed out, or when it cannot be read.
import { useEffect, useSyncExternalStore } from "react";
import type { MyProfile, SocialApi } from "~/features/api/social-api";
import { useSocialApi } from "~/features/api/social-api";
import { useViewer } from "~/features/host/use-viewer";

interface Entry {
  value: MyProfile | null;
  loading: Promise<void> | null;
  listeners: Set<() => void>;
}

const cache = new WeakMap<SocialApi, Entry>();

function entryOf(api: SocialApi): Entry {
  let e = cache.get(api);
  if (!e) {
    e = { value: null, loading: null, listeners: new Set() };
    cache.set(api, e);
  }
  return e;
}

/** Read (or read again) the viewer's profile and tell every component that shows it. */
export function refreshMe(api: SocialApi, next?: MyProfile): Promise<void> {
  const e = entryOf(api);
  const emit = () => e.listeners.forEach((l) => l());
  if (next) {
    e.value = next;
    emit();
    return Promise.resolve();
  }
  e.loading = api.me().then(
    (me) => {
      e.value = me;
      e.loading = null;
      emit();
    },
    () => {
      e.loading = null;
    },
  );
  return e.loading;
}

const noop = () => () => undefined;

export function useMe(): MyProfile | null {
  const api = useSocialApi();
  const viewer = useViewer();
  const entry = api && viewer ? entryOf(api) : null;
  useEffect(() => {
    if (api && entry && !entry.value && !entry.loading) void refreshMe(api);
  }, [api, entry]);
  return useSyncExternalStore(
    entry
      ? (cb) => {
          entry.listeners.add(cb);
          return () => entry.listeners.delete(cb);
        }
      : noop,
    () => entry?.value ?? null,
    () => null,
  );
}
