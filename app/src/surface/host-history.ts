// The host-bridged history for the surface router (routing rule R4). The reader's router owns the address bar (R1), so this
// history never touches window.history or location: it reads the address from host.location.get(), changes it only through
// host.navigate(), builds hrefs with host.href(), and tells the router about changes the reader made (Back, Forward, the
// reader's own navigation) when host.location.subscribe fires. Built on TanStack Router's createHistory (@tanstack/history;
// API checked against the installed version, see docs/decisions/0003-two-builds.md).
import { createHistory, type HistoryLocation, type RouterHistory } from "@tanstack/react-router";
import { z } from "zod";
import type { SurfaceHost } from "@sefaria-social/host-contract";

/** The router's bookkeeping in each history entry's state. Arrives through the host, so it is validated (plan 4.2). */
const routerStateSchema = z.looseObject({
  __TSR_index: z.number().int().nonnegative(),
  __TSR_key: z.string().max(64).optional(),
  key: z.string().max(64).optional(),
});

type Blockers = ReturnType<RouterHistory["_getBlockers"]>;

/** The host's location as the router's HistoryLocation. Entries the surface did not create get a stable key from their href. */
export function readHostLocation(host: SurfaceHost): HistoryLocation {
  const { pathname, search, hash, state } = host.location.get();
  const href = `${pathname}${search}${hash}`;
  const parsed = routerStateSchema.safeParse(state);
  const key = parsed.success ? (parsed.data.__TSR_key ?? parsed.data.key ?? `host:${href}`) : `host:${href}`;
  const index = parsed.success ? parsed.data.__TSR_index : 0;
  return {
    href,
    pathname,
    search,
    hash,
    state: { ...(parsed.success ? parsed.data : {}), __TSR_index: index, __TSR_key: key, key },
  };
}

const sameEntry = (a: HistoryLocation, b: HistoryLocation) => a.href === b.href && a.state.__TSR_key === b.state.__TSR_key;

/**
 * A RouterHistory backed by the host. `go`, `back` and `forward` are not in the SurfaceHost contract: the user moves through
 * history with the browser (the reader notifies us); a programmatic call is reported to the host and does nothing.
 */
export function createHostHistory(host: SurfaceHost): RouterHistory {
  let blockers: Blockers = [];
  let selfNavigating = false;

  const unsupported = (what: string) => () =>
    host.report({ kind: "error", name: "surface-history-unsupported", data: { message: `${what} is not in SurfaceHost v1` } });

  const navigateThroughHost = (path: string, state: unknown, replace: boolean) => {
    selfNavigating = true;
    try {
      host.navigate(path, { replace, state });
    } finally {
      selfNavigating = false;
    }
  };

  const history = createHistory({
    getLocation: () => readHostLocation(host),
    getLength: () => readHostLocation(host).state.__TSR_index + 1,
    pushState: (path, state) => navigateThroughHost(path, state, false),
    replaceState: (path, state) => navigateThroughHost(path, state, true),
    go: unsupported("history.go"),
    back: unsupported("history.back"),
    forward: unsupported("history.forward"),
    createHref: (path) => host.href(path),
    getBlockers: () => blockers,
    setBlockers: (next) => {
      blockers = next;
    },
    destroy: () => unsubscribe(),
  });

  // The reader changed the address (Back, Forward, its own navigation). createHistory already notifies for our own push and
  // replace, so a change we caused, or one that leaves the entry as the router already has it, is not announced twice.
  const unsubscribe = host.location.subscribe(() => {
    if (selfNavigating) return;
    const before = history.location;
    const next = readHostLocation(host);
    if (sameEntry(before, next)) return;
    const delta = next.state.__TSR_index - before.state.__TSR_index;
    history.notify(delta < 0 ? { type: "BACK" } : delta > 0 ? { type: "FORWARD" } : { type: "REPLACE" });
  });

  return history;
}
