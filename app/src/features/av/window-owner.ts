// Who owns the floating window (spec 042 AC-007): the call or a recording's replay, never both. The holder is read from the two
// controllers (a call that is not off, a replay that is not closed). `request(owner)` resolves true at once when the other does
// not hold the window; otherwise it asks first (the holder's window shows the question, WindowPrompt.tsx) and, on Confirm,
// leaves the call or closes the replay before resolving true. Cancel resolves false and changes nothing. One question at a
// time: a newer request answers the older one with false.
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { replayControllerFor, type ReplayController } from "~/features/replay/replay-controller";
import { callControllerFor, type CallController } from "./call-controller";

export type WindowOwner = "call" | "replay";

export interface WindowOwnerControl {
  /** Who holds the window now, or null. */
  holder(): WindowOwner | null;
  /** Who is asking for the window while the other holds it, or null. */
  asking(): WindowOwner | null;
  subscribe(cb: () => void): () => void;
  request(owner: WindowOwner): Promise<boolean>;
  confirm(): Promise<void>;
  cancel(): void;
}

export interface WindowOwnerDeps {
  call: () => CallController;
  replay: () => ReplayController;
}

export function createWindowOwner({ call, replay }: WindowOwnerDeps): WindowOwnerControl {
  const listeners = new Set<() => void>();
  let pending: { owner: WindowOwner; resolve: (ok: boolean) => void } | null = null;
  const emit = () => {
    for (const cb of [...listeners]) cb();
  };
  const settle = (ok: boolean) => {
    const p = pending;
    pending = null;
    emit();
    p?.resolve(ok);
  };

  const control: WindowOwnerControl = {
    holder() {
      if (call().view().kind !== "off") return "call";
      if (replay().view().kind !== "closed") return "replay";
      return null;
    },
    asking: () => pending?.owner ?? null,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    request(owner) {
      const holder = control.holder();
      if (holder === null || holder === owner) return Promise.resolve(true);
      if (pending) settle(false);
      return new Promise<boolean>((resolve) => {
        pending = { owner, resolve };
        emit();
      });
    },
    async confirm() {
      if (!pending) return;
      if (pending.owner === "replay") {
        const c = call();
        if (c.view().kind === "ended") c.dismiss();
        else await c.leave();
        if (c.view().kind === "ended") c.dismiss();
      } else replay().close();
      settle(true);
    },
    cancel() {
      if (pending) settle(false);
    },
  };
  return control;
}

const perHost = new WeakMap<SurfaceHost, WindowOwnerControl>();

/** The window's owner for this host (one per host, like the controllers it reads). */
export function windowOwnerFor(host: SurfaceHost): WindowOwnerControl {
  let w = perHost.get(host);
  if (!w) {
    w = createWindowOwner({ call: () => callControllerFor(host), replay: () => replayControllerFor(host) });
    perHost.set(host, w);
  }
  return w;
}
