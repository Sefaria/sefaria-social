// @vitest-environment jsdom
// Spec 057 AC-004: the Handle field in settings, labelled above it with "@" before it and the rules under it; a taken or invalid
// handle is said under the field, in the interface's language, and what was typed stays. The form loads through
// import.meta.glob-free imports of modules that exist on the base; its first assertion (the field) fails there.
// @feature IDENT-105 The @handle in settings and beside the name
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { SocialApiContext, SocialApiError, type MyProfile, type SocialApi } from "~/features/api/social-api";
import { HostContext } from "~/features/host/host-context";
import { ProfileForm } from "./ProfileForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const ME = {
  id: "0b6f8f7e-3f43-4a36-9b8e-7e1f6c2a9d10",
  kind: "person",
  name: "Rachel Cohen",
  handle: "rachel_cohen",
  bio: "",
  followers: 0,
  following: 0,
  viewerFollows: false,
  isOwn: true,
  canManage: true,
  administers: [],
} as unknown as MyProfile;

async function mount(updateMe: SocialApi["updateMe"], lang: "english" | "hebrew" = "english") {
  const fake = createFakeHost({ viewer: { id: 4242, name: "Rachel Cohen" }, ui: { interfaceLang: lang } });
  const api = { me: vi.fn(async () => ME), updateMe } as unknown as SocialApi;
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  await act(async () =>
    root.render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(SocialApiContext.Provider, { value: api }, createElement(ProfileForm)),
      ),
    ),
  );
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  cleanup.push(() => {
    act(() => root.unmount());
    box.remove();
  });
  const q = <E extends Element>(sel: string) => box.querySelector<E>(sel);
  const typeHandle = async (value: string) => {
    const input = q<HTMLInputElement>("[data-profile-handle-input]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const save = async () => {
    await act(async () => q<HTMLButtonElement>("[data-action=save-profile]")!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
  };
  return { box, q, typeHandle, save };
}

describe("spec 057: the handle in settings", () => {
  // @ac 057/AC-004
  it("shows the Handle field with its label and rules, saves it, and says a taken handle under the field keeping the text", async () => {
    const updateMe = vi.fn(async (input: { handle?: string }) => {
      if (input.handle === "taken_one") throw new SocialApiError(409, "profile.handle_taken");
      return { ...ME, handle: input.handle!.replace(/^@/, "").toLowerCase() } as MyProfile;
    });
    const { q, typeHandle, save } = await mount(updateMe as unknown as SocialApi["updateMe"]);
    const input = q<HTMLInputElement>("[data-profile-handle-input]");
    expect(input, "the Handle field").not.toBeNull();
    expect(input!.value).toBe("rachel_cohen");
    const label = q<HTMLLabelElement>(`label[for="${input!.id}"]`);
    expect(label?.textContent).toBe("Handle");
    expect(input!.parentElement!.textContent).toContain("@");
    const hint = document.getElementById(input!.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toMatch(/3 to 30 letters/);

    await typeHandle("taken_one");
    await save();
    expect(q("[data-handle-error]")?.textContent).toBe("That handle is taken. Try another.");
    expect(input!.getAttribute("aria-invalid")).toBe("true");
    expect(q<HTMLInputElement>("[data-profile-handle-input]")!.value, "what was typed stays").toBe("taken_one");

    await typeHandle("@Rachel_C");
    expect(q("[data-handle-error]"), "typing clears the error").toBeNull();
    await save();
    expect(updateMe).toHaveBeenLastCalledWith(expect.objectContaining({ handle: "@Rachel_C", name: "Rachel Cohen" }));
    expect(q<HTMLInputElement>("[data-profile-handle-input]")!.value).toBe("rachel_c");
  });

  it("says an invalid handle in Hebrew in a Hebrew interface", async () => {
    const updateMe = vi.fn(async () => {
      throw new SocialApiError(400, "profile.handle_invalid");
    });
    const { q, typeHandle, save } = await mount(updateMe as unknown as SocialApi["updateMe"], "hebrew");
    await typeHandle("1x");
    await save();
    expect(q("[data-handle-error]")?.textContent).toMatch(/^כינוי הוא 3 עד 30/);
  });
});
