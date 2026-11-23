// @vitest-environment jsdom
// L3 contract tests: the built surface entry mounted into the fake host, the way the reader mounts it (plan 4.6, 5.5).
// The entry is loaded through import.meta.glob so that, on a tree without it, each test fails on its first assertion
// (prove-red counts that as red for the right reason) instead of the whole file failing to load.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost, type FakeHost } from "@sefaria-social/host-contract/fake-host";
import type { Surface, SurfaceHost } from "@sefaria-social/host-contract";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The router scrolls the page to the top after a navigation; jsdom does not implement scrolling.
window.scrollTo = () => {};

const entryModules = import.meta.glob<typeof import("./entry")>("./entry.ts");

async function loadSurface(): Promise<Surface> {
  const mod = await entryModules["./entry.ts"]?.();
  expect(mod?.default, "app/src/surface/entry.ts default-exports the Surface").toBeDefined();
  return mod!.default;
}

const cleanups: (() => void)[] = [];
afterEach(async () => {
  await act(async () => cleanups.splice(0).forEach((fn) => fn()));
  document.body.replaceChildren();
});

async function mountPage(url: string, extra: Partial<Parameters<typeof createFakeHost>[0]> = {}) {
  const surface = await loadSurface();
  const fake = createFakeHost({ url, ...extra });
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => {
    cleanups.push(surface.mountPage(el, fake.host));
  });
  return { surface, fake, el };
}

const heading = (el: HTMLElement) => el.querySelector("main h1")?.textContent ?? null;
const waitForHeading = (el: HTMLElement, text: string) => vi.waitFor(() => expect(heading(el)).toBe(text));

function link(el: HTMLElement, name: string): HTMLAnchorElement {
  const a = [...el.querySelectorAll("a")].find((x) => x.textContent === name);
  expect(a, `a link named "${name}"`).toBeDefined();
  return a!;
}

async function click(a: HTMLAnchorElement) {
  await act(async () => {
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function hostDoes(fake: FakeHost, fn: (f: FakeHost) => void) {
  await act(async () => fn(fake));
}

describe("surface mount on the fake host", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-002
  it("routes through the host-bridged history: links push through host.navigate, Back and Forward come from the reader (R4)", async () => {
    const { fake, el } = await mountPage("/social/r/room-00001");
    await waitForHeading(el, "Room");
    await click(link(el, "Settings"));
    await waitForHeading(el, "Settings");
    expect(fake.calls.navigate.map((c) => [c.to, c.replace])).toEqual([["/social/settings", false]]);
    expect(fake.url()).toBe("/social/settings");
    await hostDoes(fake, (f) => f.back());
    await waitForHeading(el, "Room");
    await hostDoes(fake, (f) => f.forward());
    await waitForHeading(el, "Settings");
    expect(fake.calls.navigate).toHaveLength(1); // Back and Forward were the reader's, not new pushes
  });

  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-005
  it("never touches window.history or window.location while navigating (R1)", async () => {
    const before = { href: window.location.href, length: window.history.length };
    const { fake, el } = await mountPage("/social");
    await waitForHeading(el, "Sefaria Social");
    await click(link(el, "Settings"));
    await waitForHeading(el, "Settings");
    await click(link(el, "Notifications"));
    await vi.waitFor(() =>
      expect(el.querySelector("[data-settings-tab]")?.getAttribute("data-settings-tab")).toBe("notifications"),
    );
    expect(fake.calls.navigate.map((c) => c.to)).toEqual(["/social/settings", "/social/settings?tab=notifications"]);
    expect({ href: window.location.href, length: window.history.length }).toEqual(before);
  });

  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-010
  it('renders the "please reload" state and reports when the host is another contract major', async () => {
    const surface = await loadSurface();
    const fake = createFakeHost({ url: "/social" });
    const reported: unknown[] = [];
    const host = { ...fake.host, contract: { major: 2, minor: 0 }, report: (e: unknown) => reported.push(e) };
    const el = document.createElement("div");
    await act(async () => {
      cleanups.push(surface.mountPage(el, host as unknown as SurfaceHost));
    });
    expect(el.querySelector("[data-social-state]")?.getAttribute("data-social-state")).toBe("reload");
    expect(reported).toEqual([expect.objectContaining({ kind: "error", name: "contract-mismatch" })]);
  });
});

describe("R6 path grammar, deep links and social's not-found page", () => {
  // @feature HOST-007 Social's own not-found page
  // @ac 002/AC-003
  it("every page of R6 loads on a cold load (a deep link) and anything else under /social is social's not-found", async () => {
    const cases: [string, string][] = [
      ["/social", "Sefaria Social"],
      ["/social/r/room-00001", "Room"],
      ["/social/s/Shiur_Abc-123", "Shiur"],
      ["/social/settings", "Settings"],
      ["/social/r/short", "Page not found"],
      ["/social/r/room-00001/extra", "Page not found"],
      ["/social/s/has.dot.id", "Page not found"],
      ["/social/unknown", "Page not found"],
    ];
    const seen: [string, string | null, number][] = [];
    for (const [url] of cases) {
      const { el, fake } = await mountPage(url);
      await vi.waitFor(() => expect(heading(el)).not.toBeNull());
      seen.push([url, heading(el), fake.calls.navigate.length]); // a deep link renders where it is; it never redirects
    }
    expect(seen).toEqual(cases.map(([url, h]) => [url, h, 0]));
  });
});

describe("placeholder pages name what they show", () => {
  // @feature ROOM-001 Room lobby page at /social/r/$roomId
  // @ac 002/AC-012
  it("the room lobby names its room id", async () => {
    const { el } = await mountPage("/social/r/room-00001");
    await waitForHeading(el, "Room");
    expect(el.querySelector("main p")?.textContent).toBe("Room id: room-00001");
  });

  // @feature SHIUR-001 Shiur page at /social/s/$shiurId
  // @ac 002/AC-013
  it("the shiur page names its shiur id", async () => {
    const { el } = await mountPage("/social/s/shiur-0001");
    await waitForHeading(el, "Shiur");
    expect(el.querySelector("main p")?.textContent).toBe("Shiur id: shiur-0001");
  });
});

describe("R7 search parameters", () => {
  // @feature HOST-006 Social settings page at /social/settings
  // @ac 002/AC-004
  it("validates search per route, drops unknown parameters and writes the reader's plain k=v format", async () => {
    const { el, fake } = await mountPage("/social/settings?tab=notifications&foo=bar");
    await vi.waitFor(() =>
      expect(el.querySelector("[data-settings-tab]")?.getAttribute("data-settings-tab")).toBe("notifications"),
    );
    expect(link(el, "Profile").getAttribute("href")).toBe("/social/settings?tab=profile");
    await click(link(el, "Profile"));
    await vi.waitFor(() => expect(el.querySelector("[data-settings-tab]")?.getAttribute("data-settings-tab")).toBe("profile"));
    expect(fake.calls.navigate.map((c) => c.to)).toEqual(["/social/settings?tab=profile"]);
  });
});

describe("R15 links", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-006
  it("renders real hrefs built by the host and hands clicks to the host; ref links go through the reader's commands", async () => {
    const { el, fake } = await mountPage("/social/s/shiur-0001");
    await waitForHeading(el, "Shiur");
    expect(link(el, "Settings").getAttribute("href")).toBe("/social/settings");
    expect(fake.calls.href).toContain("/social/settings");
    const ref = link(el, "Open Genesis 1 in the reader");
    expect(ref.getAttribute("href")).toBe("/Genesis_1");
    await click(ref);
    expect(fake.calls.go.map((g) => Object.values(g.ws.panels).map((p) => p.ref))).toEqual([["Genesis 1"]]);
    expect(fake.url()).toBe("/Genesis_1");
  });
});

describe("R18 one page surface; the persistent mount renders nothing without a context", () => {
  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-007
  it("renders nothing outside a social context, and a way back into the room inside one", async () => {
    const surface = await loadSurface();
    const fake = createFakeHost({ url: "/Genesis.1?ctx=other.thing" });
    const el = document.createElement("div");
    document.body.append(el);
    await act(async () => {
      cleanups.push(surface.mountPersistent(el, fake.host));
    });
    expect(el.innerHTML).toBe("");
    await hostDoes(fake, (f) => f.host.navigate("/Genesis.2?ctx=social.room.room-00001"));
    await vi.waitFor(() =>
      expect(el.querySelector("[data-social-persistent]")?.getAttribute("data-social-persistent")).toBe("room"),
    );
    expect(link(el, "Back to the room").getAttribute("href")).toBe("/social/r/room-00001");
    await hostDoes(fake, (f) => f.host.navigate("/Genesis.3"));
    await vi.waitFor(() => expect(el.innerHTML).toBe(""));
  });

  // @feature HOST-003 Surface entry mounts into the reader page
  // @ac 002/AC-007
  it("keeps one page surface: a second page mount replaces the first", async () => {
    const first = await mountPage("/social/r/room-00001");
    await waitForHeading(first.el, "Room");
    const second = await mountPage("/social/settings");
    await waitForHeading(second.el, "Settings");
    expect(first.el.innerHTML).toBe("");
    expect(second.fake.calls.report).toEqual([{ kind: "event", name: "page-remounted" }]);
  });
});
