// @vitest-environment jsdom
// Spec 029 AC-001: a post's source opens beside the page when the reader offers openBeside (contract 1.1), and falls back to
// commands.go on a 1.0 reader. The link stays a real <a href>; a modified click is the browser's.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { HostContext } from "./host-context";
import { ReaderRefLink } from "./ReaderRefLink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function render(besideSupported: boolean, beside = true) {
  const fake = createFakeHost({ besideSupported });
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      createElement(
        HostContext.Provider,
        { value: fake.host },
        createElement(ReaderRefLink, { textRef: "Genesis 1:3", beside, children: "Genesis 1:3" }),
      ),
    ),
  );
  cleanup.push(() => {
    act(() => root.unmount());
    el.remove();
  });
  return { fake, link: el.querySelector("a")! };
}

const click = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => void a.dispatchEvent(e));
  return e;
};

describe("a source link beside the page", () => {
  // @feature FEED-069 Open a source beside the feed
  // @ac 029/AC-001
  it("asks the reader to open the source beside the page, keeps a real href, and leaves modified clicks to the browser", async () => {
    const { fake, link } = await render(true);
    const href = link.getAttribute("href")!;
    expect(href).toMatch(/^\/Genesis/);
    const plain = click(link);
    expect(plain.defaultPrevented).toBe(true);
    expect(fake.calls.openBeside).toEqual([href]);
    expect(fake.calls.go).toEqual([]);
    expect(fake.url()).toBe("/social");
    const modified = click(link, { metaKey: true });
    expect(modified.defaultPrevented).toBe(false);
    expect(fake.calls.openBeside).toHaveLength(1);
  });

  // A guard, not an acceptance test: a 1.0 reader keeps today's behaviour (it passes without spec 029 by design).
  // @feature FEED-069 Open a source beside the feed
  it("on a 1.0 reader (no openBeside) sends the reader to the source with commands.go, as before", async () => {
    const { fake, link } = await render(false);
    expect(fake.host.contract.minor).toBe(0);
    expect("openBeside" in fake.host).toBe(false);
    click(link);
    expect(fake.calls.go).toHaveLength(1);
    expect(fake.calls.openBeside).toEqual([]);
  });
});
