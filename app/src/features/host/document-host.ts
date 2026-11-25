// One host for what belongs to the whole page, not to one mount (the call, the room's connection, recording, broadcast, replay).
// The reader may hand each mount its own SurfaceHost object (the page mount's location stays on the social page while a text
// is open beside it; the persistent mount's is always the reader's). Controllers kept per host would then exist twice: Join
// call in the lobby would start a call the persistent mount, where the call window renders, never hears about, and each mount
// would open its own connection to a room. The surface's entry registers both mounts' hosts here; `documentHostFor` maps
// either to one object for the page, whose parts come from the persistent mount's host once it exists, else the page's.
// Hosts that were never registered (tests, the harness's single host) are returned unchanged.
import type { SurfaceHost } from "@sefaria-social/host-contract";

const members = new WeakSet<SurfaceHost>();
let pageHost: SurfaceHost | null = null;
let persistentHost: SurfaceHost | null = null;
let shared: SurfaceHost | null = null;

const current = (): SurfaceHost => (persistentHost ?? pageHost)!;

/** Called by the surface's entry when it mounts with `host`. */
export function registerMountHost(host: SurfaceHost, kind: "page" | "persistent"): void {
  members.add(host);
  if (kind === "persistent") persistentHost = host;
  else pageHost = host;
}

/** The page-wide host for `host`: one object for every host the entry registered, or `host` itself. */
export function documentHostFor(host: SurfaceHost): SurfaceHost {
  if (!members.has(host)) return host;
  shared ??= new Proxy({} as SurfaceHost, {
    get: (_t, key) => Reflect.get(current(), key),
    has: (_t, key) => Reflect.has(current(), key),
  });
  return shared;
}
