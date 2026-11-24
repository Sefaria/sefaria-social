// @vitest-environment jsdom
// A broadcast's page and the viewer's bar (spec 043 AC-007, AC-008), with the fake host, the test relay playing the broadcast's
// room (the host is a peer in it), a fake broadcast API and a fake call controller. App modules load through import.meta.glob so
// that, on a base without them, the first assertion fails.
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import type * as PageModule from "./WatchPage";
import type * as BarModule from "./WatchBar";
import type * as ApiModule from "./broadcast-api";
import type * as ControllerModule from "./broadcast-controller";
import type * as RelayModule from "~/features/session/test-relay";
import type * as SurfaceModule from "~/features/session/test-surface";
import type * as HostContextModule from "~/features/host/host-context";
import type { CallSource } from "~/features/av/call-controller";
import type { CallView } from "~/features/av/machine";

const mods = {
  page: import.meta.glob<typeof PageModule>("./WatchPage.tsx"),
  bar: import.meta.glob<typeof BarModule>("./WatchBar.tsx"),
  api: import.meta.glob<typeof ApiModule>("./broadcast-api.ts"),
  controller: import.meta.glob<typeof ControllerModule>("./broadcast-controller.ts"),
  relay: import.meta.glob<typeof RelayModule>("../session/test-relay.ts"),
  surface: import.meta.glob<typeof SurfaceModule>("../session/test-surface.tsx"),
  host: import.meta.glob<typeof HostContextModule>("../host/host-context.tsx"),
};

const BID = "0b1c2d3e-4f5a-4b6c-8d7e-00112233aabb";
const RELAY_ROOM = `b_${BID}`;
const WATCH = `ctx=social.watch.${BID}`;

const teardown: (() => void)[] = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
});

async function setup(opts: { signedIn: boolean; status?: "live" | "ended" }) {
  const pageMod = await mods.page["./WatchPage.tsx"]?.();
  expect(pageMod, "app/src/features/broadcast/WatchPage.tsx exists").toBeDefined();
  const { WatchBar } = (await mods.bar["./WatchBar.tsx"]!())!;
  const { BroadcastApiContext } = (await mods.api["./broadcast-api.ts"]!())!;
  const { broadcastControllerFor } = (await mods.controller["./broadcast-controller.ts"]!())!;
  const { installTestRelay } = (await mods.relay["../session/test-relay.ts"]!())!;
  const { render } = (await mods.surface["../session/test-surface.tsx"]!())!;
  const { HostContext } = (await mods.host["../host/host-context.tsx"]!())!;
  const relay = installTestRelay();
  teardown.push(() => relay.restore());

  const fake = createFakeHost({
    url: `/social/b/${BID}`,
    viewer: opts.signedIn ? { id: 4242, name: "Test Learner" } : null,
  });
  const state = { status: opts.status ?? "live" };
  const broadcast = () => ({
    id: BID,
    roomId: "6f1c2d3e-4b5a-4c6d-8e7f-001122334455",
    title: "Daf Yomi live",
    hostName: "Avi Host",
    status: state.status,
    startedAt: "2026-11-25T08:00:00.000Z",
    link: `/social/b/${BID}`,
  });
  const api = {
    start: vi.fn(async () => ({ kind: "forbidden" as const })),
    end: vi.fn(async () => undefined),
    get: vi.fn(async (_id: string) => ({ kind: "ok" as const, broadcast: broadcast() })),
    ticket: vi.fn(async (_id: string) =>
      state.status === "ended"
        ? { kind: "ended" as const }
        : {
            kind: "ok" as const,
            ticket: {
              ticket: "tkt-viewer",
              role: "viewer" as const,
              relayRoom: RELAY_ROOM,
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
            },
          },
    ),
    callToken: vi.fn(async (_id: string) => ({ kind: "not-found" as const })),
  };
  let view: CallView = { kind: "off" };
  const calls = {
    view: () => view,
    open: vi.fn(async () => undefined),
    joinWith: vi.fn(async (key: string, _source: CallSource) => {
      view = { kind: "in-call", roomId: key, mic: false, camera: false, screen: false, switchTo: null };
    }),
    leave: vi.fn(async () => {
      view = { kind: "off" };
    }),
    dismiss: vi.fn(),
  };
  const controller = broadcastControllerFor(fake.host, { api, calls, windowOwner: { request: async () => true } });
  teardown.push(() => controller.dispose());

  const hostPeer = relay.peer(RELAY_ROOM, "5151", "Avi Host");
  hostPeer.send({
    ch: "state",
    body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: "/Genesis.3", nav: null, slices: {} } },
  });

  const wrap = (child: ReactNode) =>
    createElement(HostContext.Provider, { value: fake.host }, createElement(BroadcastApiContext.Provider, { value: api }, child));
  const page = await render(wrap(createElement(pageMod!.WatchPage, { broadcastId: BID })));
  teardown.push(page.unmount);
  const bar = await render(wrap(createElement(WatchBar)));
  teardown.push(bar.unmount);
  const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
  const press = async (sel: string) => {
    const el = $(sel);
    expect(el, `${sel} is on the page`).not.toBeNull();
    await act(async () => el!.click());
  };
  return { fake, api, calls, relay, hostPeer, $, press };
}

describe("watch page", () => {
  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("Watch takes the reader to the host's text in the watch context, follows, and offers Back to live after breaking away", async () => {
    const { $, press, fake, calls, hostPeer } = await setup({ signedIn: true });
    await vi.waitFor(() => expect($("[data-social-page=broadcast] h1")?.textContent).toBe("Daf Yomi live"));
    expect($("[data-broadcast-host]")?.textContent).toBe("Broadcast by Avi Host");
    await press('[data-action="watch"]');
    await vi.waitFor(() => expect(fake.calls.navigate.map((n) => n.to)).toEqual([`/Genesis.3?${WATCH}`]));
    await vi.waitFor(() => expect($("[data-watch-line]")?.textContent).toBe("Watching Avi Host"));
    expect($('[data-action="back-to-live"]')).toBeNull();
    await vi.waitFor(() =>
      expect(calls.joinWith).toHaveBeenCalledWith(`bcast_${BID}`, expect.objectContaining({ viewer: true })),
    );

    fake.localInput();
    await vi.waitFor(() => expect($('[data-action="back-to-live"]')?.textContent).toBe("Back to live"));
    hostPeer.send({ ch: "state", body: { type: "change", seq: 1, t: 1, change: { url: "/Genesis.6" } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.url()).toBe(`/Genesis.3?${WATCH}`);
    await press('[data-action="back-to-live"]');
    await vi.waitFor(() => expect(fake.url()).toBe(`/Genesis.6?${WATCH}`));
    expect($('[data-action="back-to-live"]')).toBeNull();
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-007
  it("asks a signed-out visitor to sign in to watch", async () => {
    const { $, press, fake, api } = await setup({ signedIn: false });
    await vi.waitFor(() => expect($("[data-broadcast-state=signed-out] p")?.textContent).toBe("Sign in to watch"));
    await press('[data-action="watch"]');
    expect(fake.calls.signIn).toBe(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-008
  it("tells the viewer the broadcast has ended when its host ends it, and stops following and the media", async () => {
    const { $, press, fake, calls, hostPeer } = await setup({ signedIn: true });
    await vi.waitFor(() => expect($('[data-action="watch"]')).not.toBeNull());
    await press('[data-action="watch"]');
    await vi.waitFor(() => expect(calls.view().kind).toBe("in-call"));
    hostPeer.send({ ch: "control", body: { type: "end" } });
    await vi.waitFor(() =>
      expect([...document.querySelectorAll("[data-broadcast-ended]")].map((e) => e.textContent)).toEqual([
        "The broadcast has ended",
        "The broadcast has ended",
      ]),
    );
    expect($('[data-action="watch"]')).toBeNull();
    expect(calls.leave).toHaveBeenCalledTimes(1);
    expect(fake.url()).toBe(`/Genesis.3?${WATCH}`);
  });

  // @feature SESS-066 Broadcast a session and watch it as a view-only viewer
  // @ac 043/AC-008
  it("says the broadcast has ended when the server reports it ended, with no Watch", async () => {
    const { $ } = await setup({ signedIn: true, status: "ended" });
    await vi.waitFor(() => expect($("[data-broadcast-ended]")?.textContent).toBe("The broadcast has ended"));
    expect($('[data-action="watch"]')).toBeNull();
  });
});
