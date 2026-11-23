// The surface's entry module: its default export is the Surface the reader mounts (SurfaceHost v1, docs/CONTRACT.md). It is
// the entry of the surface build (app/vite.surface.config.ts), which emits it as an ES module with its chunks, one CSS file
// and manifest.json. Client only: it reaches the server only through packages/api-client.
import { createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { surfaceHostShapeSchema, type Surface, type SurfaceHost } from "@sefaria-social/host-contract";
import { SURFACE } from "~/lib/surface-info";
import { SurfaceHostProvider } from "./host-context";
import { PersistentView } from "./persistent";
import { createSurfaceRouter } from "./router";

/** Shown when the reader hands us a host we were not built for (another major, or members missing). */
const RELOAD_MESSAGE = "Sefaria was updated. Please reload the page to use Social.";

/**
 * Checks the host before anything touches it (plan 4.2: the surface checks host.contract.major on mount). A host that fails
 * gets the "please reload" state instead of a crash inside the reader's page.
 */
function checkHost(el: HTMLElement, host: unknown): host is SurfaceHost {
  const result = surfaceHostShapeSchema.safeParse(host);
  if (result.success) return true;
  const report = (host as { report?: unknown } | null)?.report;
  if (typeof report === "function") {
    try {
      report({ kind: "error", name: "contract-mismatch", data: { message: result.error.issues[0]?.message ?? "" } });
    } catch (_e) {
      // the host is already broken; reporting is best effort and the reload notice below still renders
      void _e;
    }
  }
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.dataset.socialState = "reload";
  notice.textContent = RELOAD_MESSAGE;
  el.replaceChildren(notice);
  return false;
}

let activePage: { el: HTMLElement; unmount: () => void } | null = null;

function mountPage(el: HTMLElement, host: SurfaceHost) {
  if (!checkHost(el, host)) return () => el.replaceChildren();
  // R18: one page surface at a time. A second mount replaces the first.
  if (activePage) {
    host.report({ kind: "event", name: "page-remounted" });
    activePage.unmount();
  }
  const router = createSurfaceRouter(host);
  const root: Root = createRoot(el);
  root.render(
    createElement(
      StrictMode,
      null,
      createElement(SurfaceHostProvider, { host, children: createElement(RouterProvider, { router }) }),
    ),
  );
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    root.unmount();
    router.history.destroy();
    if (activePage?.el === el) activePage = null;
  };
  activePage = { el, unmount };
  return unmount;
}

function mountPersistent(el: HTMLElement, host: SurfaceHost) {
  if (!checkHost(el, host)) return () => el.replaceChildren();
  const root = createRoot(el);
  root.render(
    createElement(
      StrictMode,
      null,
      createElement(SurfaceHostProvider, { host, children: createElement(PersistentView, { host }) }),
    ),
  );
  return () => root.unmount();
}

const surface: Surface = {
  id: SURFACE.id,
  contract: SURFACE.contract.major,
  mountPage,
  mountPersistent,
};

export default surface;
