// Test support for surface component tests: render React into jsdom inside act(), and wait for the DOM. Not production code.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export async function render(node: ReactNode): Promise<{ el: HTMLElement; unmount: () => void }> {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  let done = false;
  return {
    el,
    unmount() {
      if (done) return;
      done = true;
      act(() => root.unmount());
      el.remove();
    },
  };
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!(el instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => el.click());
}
