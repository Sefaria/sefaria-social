// The harness: a fake reader page (plan 4.6). It creates the fake host over the browser's history, shows what the reader
// would show (the address, the ctx, the snapshot, every call the surface made), loads the built surface through its manifest
// and mounts it like the reader does: the page mount under /social and /social/*, the persistent mount on every page.
//
// Tests configure it before load with `window.__HARNESS_CONFIG__ = { interfaceLang, viewer }` (Playwright addInitScript).
import type { Unmount } from "@sefaria-social/host-contract";
import { createFakeHost, type Viewer } from "@sefaria-social/host-contract/fake-host";
import { createBrowserFakeHistory } from "./browser-history";
import { loadSurface } from "./load-surface";

declare global {
  interface Window {
    __HARNESS_CONFIG__?: {
      interfaceLang?: "english" | "hebrew";
      viewer?: Viewer;
      /** An identity token for the viewer (end-to-end tests with the local server and relay). */
      token?: string;
      apiOrigin?: string;
      relayOrigin?: string;
      /** The fake reader's slices and their scopes (personal settings vs what is on screen). */
      slices?: Record<string, { v: number; value: unknown }>;
      sliceScopes?: Record<string, "personal" | "moment">;
    };
  }
}

const SAMPLE_VIEWER = { id: 1, name: "Test Learner" } as const;
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const config = window.__HARNESS_CONFIG__ ?? {};
const fake = createFakeHost({
  history: createBrowserFakeHistory(),
  ui: { interfaceLang: config.interfaceLang ?? "english" },
  viewer: config.viewer ?? null,
  ...(config.token ? { token: async () => config.token! } : {}),
  config: {
    ...(config.apiOrigin ? { apiOrigin: config.apiOrigin } : {}),
    ...(config.relayOrigin ? { relayOrigin: config.relayOrigin } : {}),
  },
  ...(config.slices ? { slices: config.slices } : {}),
  ...(config.sliceScopes ? { sliceScopes: config.sliceScopes } : {}),
});
const { host } = fake;
// The harness itself is visible for debugging in the browser console.
Object.assign(window, { __fakeHost: fake });

const isSocialPath = (pathname: string) => pathname === "/social" || pathname.startsWith("/social/");

function renderReaderPane() {
  const loc = host.location.get();
  $("[data-harness=location]").textContent = fake.url();
  $("[data-harness=ctx]").textContent = host.reader.context.get() ?? "(none)";
  $("[data-harness=viewer]").textContent = host.viewer.get()?.name ?? "(signed out)";
  $("[data-harness=snapshot]").textContent = JSON.stringify(host.reader.state.getSnapshot(), null, 2);
  const readerPage = $<HTMLElement>("[data-harness=reader-page]");
  readerPage.hidden = isSocialPath(loc.pathname);
  readerPage.textContent = `Reader page: ${loc.pathname}`;
  const calls = [
    ...fake.calls.navigate.map((c) => `navigate ${c.replace ? "replace" : "push"} ${c.to}`),
    ...fake.calls.go.map((c) => `commands.go ${host.reader.commands.href(c.ws)}`),
    ...fake.calls.report.map((r) => `report ${r.kind} ${r.name}`),
  ];
  $("[data-harness=calls]").replaceChildren(
    ...calls.map((text) => Object.assign(document.createElement("li"), { textContent: text })),
  );
  $("[data-harness=sign]").textContent = host.viewer.get() ? "Sign out" : "Sign in";
  $<HTMLSelectElement>("[data-harness=lang]").value = host.ui.interfaceLang;
}

function wireControls() {
  $("[data-harness=back]").addEventListener("click", () => fake.back());
  $("[data-harness=forward]").addEventListener("click", () => fake.forward());
  $<HTMLSelectElement>("[data-harness=lang]").addEventListener("change", (e) =>
    fake.setUi({ interfaceLang: (e.target as HTMLSelectElement).value === "hebrew" ? "hebrew" : "english" }),
  );
  $("[data-harness=sign]").addEventListener("click", () => {
    fake.setViewer(host.viewer.get() ? null : SAMPLE_VIEWER);
    renderReaderPane();
  });
  // The harness's own links navigate like the reader's router: through the fake host, without a page load.
  document.querySelectorAll<HTMLAnchorElement>("a[data-harness-link]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      host.navigate(a.getAttribute("href") ?? "/");
    }),
  );
  host.location.subscribe(renderReaderPane);
  host.ui.subscribe(renderReaderPane);
}

async function start() {
  wireControls();
  renderReaderPane();
  const surfaceOut = $("[data-harness=surface]");
  try {
    const { surface, version } = await loadSurface("/surface/manifest.json");
    surfaceOut.textContent = `social@${version}`;
    document.body.dataset.surfaceState = "loaded";
    const pageEl = $<HTMLElement>("[data-surface-mount=page]");
    let unmountPage: Unmount | null = null;
    const syncPage = () => {
      const inSocial = isSocialPath(host.location.get().pathname);
      if (inSocial && !unmountPage) unmountPage = surface.mountPage(pageEl, host);
      if (!inSocial && unmountPage) {
        unmountPage();
        unmountPage = null;
        pageEl.replaceChildren();
      }
    };
    host.location.subscribe(syncPage);
    syncPage();
    surface.mountPersistent($<HTMLElement>("[data-surface-mount=persistent]"), host);
  } catch (e) {
    surfaceOut.textContent = `failed: ${(e as Error).message}`;
    document.body.dataset.surfaceState = "failed";
  }
}

void start();
