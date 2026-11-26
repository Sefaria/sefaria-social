// @vitest-environment jsdom
// Spec 058 AC-005 (and AC-002's Join): the invite bar under the room's link. A fake rooms API answers suggestions and
// invitations. The bar loads through import.meta.glob, so on a base without it the first assertion fails.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { RoomsApiContext, type RoomsApi } from "~/features/api/rooms-api";
import { HostContext } from "~/features/host/host-context";
import type * as BarModule from "./InviteBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bars = import.meta.glob<typeof BarModule>("./InviteBar.tsx");
const ROOM = "0b6f8f7e-3f43-4a36-9b8e-7e1f6c2a9d10";
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  vi.useRealTimers();
});

const wait = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(api: Partial<RoomsApi>, lang: "english" | "hebrew" = "english") {
  const mod = await bars["./InviteBar.tsx"]?.();
  expect(mod?.InviteBar, "the invite bar").toBeDefined();
  const fake = createFakeHost({ viewer: { id: 4242, name: "Rachel" }, ui: { interfaceLang: lang } });
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  await act(async () =>
    root.render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(RoomsApiContext.Provider, { value: api as RoomsApi }, createElement(mod!.InviteBar, { roomId: ROOM })),
      ),
    ),
  );
  cleanup.push(() => {
    act(() => root.unmount());
    box.remove();
  });
  const q = <E extends Element>(sel: string) => box.querySelector<E>(sel);
  const input = () => q<HTMLInputElement>("[data-invite-input]")!;
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(250);
  };
  const key = async (k: string) =>
    act(async () => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  return { box, q, input, type, key };
}

describe("spec 058: the invite bar", () => {
  // @feature ROOM-055 The invite bar in a room, and invitations in activity
  // @ac 058/AC-005
  it("offers people as you type, makes chips, sends them and marks each with what happened", async () => {
    const people = vi.fn(async (q: string) =>
      q.replace(/^@/, "").startsWith("be")
        ? [
            { id: "a1", handle: "ben", name: "Ben Levi", kind: "person" as const },
            { id: "a2", handle: "bella", name: "Bella", kind: "person" as const },
          ]
        : [],
    );
    const invite = vi.fn(async (_room: string, to: string[]) => ({
      kind: "ok" as const,
      results: to.map((t) => ({ to: t, status: t === "@nobody" ? ("not_found" as const) : ("invited" as const) })),
    }));
    const { q, input, type, key } = await mount({ people, invite });
    const label = q<HTMLLabelElement>(`label[for="${input().id}"]`);
    expect(label?.textContent, "a label above the field").toBe("Invite by @handle or email");

    await type("be");
    expect(people).toHaveBeenCalledWith("be");
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(["Ben Levi @ben", "Bella @bella"]);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await key("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    await key("ArrowUp");
    await key("Enter");
    expect(q("[data-invite-chip='@ben']"), "Ben chosen with the keyboard").not.toBeNull();
    expect(input().value).toBe("");

    await type("@nobody");
    await key(",");
    await type("dina@example.org");
    await key(" ");
    expect([...document.querySelectorAll("[data-invite-chip]")].map((c) => c.getAttribute("data-invite-chip"))).toEqual([
      "@ben",
      "@nobody",
      "dina@example.org",
    ]);
    // A chip can be removed.
    await act(async () => q<HTMLButtonElement>("[data-invite-chip='dina@example.org'] [data-action=remove-invitee]")!.click());
    expect(q("[data-invite-chip='dina@example.org']")).toBeNull();

    await act(async () => q<HTMLButtonElement>("[data-action=send-invites]")!.click());
    await wait();
    expect(invite).toHaveBeenCalledWith(ROOM, ["@ben", "@nobody"], "en");
    expect(q("[data-invite-chip='@ben']")?.getAttribute("data-status")).toBe("invited");
    expect(q("[data-invite-chip='@ben']")?.textContent).toContain("Invited");
    expect(q("[data-invite-chip='@nobody']")?.getAttribute("data-status")).toBe("not_found");
    expect(q("[data-invite-chip='@nobody']")?.textContent).toContain("No one has this handle");
    expect(q("[data-invite-notice]")?.textContent).toContain("1 invitation sent.");
    // Sending again sends only what failed.
    await act(async () => q<HTMLButtonElement>("[data-action=send-invites]")!.click());
    await wait();
    expect(invite).toHaveBeenLastCalledWith(ROOM, ["@nobody"], "en");
  });

  // @feature ROOM-056 Inviting by email
  // @ac 059/AC-004
  it("says when the hour's limit is reached, and that email is not available when the server cannot send it", async () => {
    const invite = vi
      .fn()
      .mockResolvedValueOnce({ kind: "limited", retryAfterSeconds: 3600 })
      .mockResolvedValueOnce({ kind: "ok", results: [{ to: "dina@example.org", status: "unavailable" }] });
    const { q, type, key } = await mount({ invite, people: async () => [] });
    await type("dina@example.org");
    await key("Enter");
    await act(async () => q<HTMLButtonElement>("[data-action=send-invites]")!.click());
    await wait();
    expect(q("[data-invite-notice]")?.textContent).toMatch(/Try again later/);
    await act(async () => q<HTMLButtonElement>("[data-action=send-invites]")!.click());
    await wait();
    expect(q("[data-invite-notice]")?.textContent).toMatch(/Inviting by email is not available here/);
    expect(q("[data-invite-chip='dina@example.org']")?.textContent).toContain("Email not available");
  });

  it("speaks Hebrew in a Hebrew interface", async () => {
    const { q } = await mount({ invite: vi.fn(), people: async () => [] }, "hebrew");
    expect(q("label")?.textContent).toBe("הזמנה לפי @כינוי או דוא״ל");
    expect(q("[data-action=send-invites]")?.textContent).toBe("שליחת הזמנות");
  });
});
