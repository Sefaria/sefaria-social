// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { HostContext } from "~/features/host/host-context";
import { render } from "~/features/session/test-surface";
import { ReplayApiContext } from "./use-replay";
import type { ReplayApi, AssetManifest } from "./replay-api";
import type * as Artifacts from "./RecordingArtifacts";

const modules = import.meta.glob<typeof Artifacts>("./RecordingArtifacts.tsx");

// @feature SHIUR-008 Revisit a finished shiur through its texts and transcript
// @ac 061/AC-006
it("shows the complete class artifact taxonomy and switches the selected reading", async () => {
  const s = await setup();
  expect(s.el.textContent).toContain("Texts & margins");
  expect(s.el.textContent).toContain("Chiddushim");
  expect(s.el.textContent).toContain("Open questions");
  expect(s.el.textContent).toContain("Continue learning");
  expect(s.el.textContent).toContain("No shared annotations are saved for this class.");
  const next = s.el.querySelector<HTMLButtonElement>("[data-next-source]");
  expect(next).not.toBeNull();
  await act(async () => next!.click());
  expect(s.el.querySelector("[data-reading-ref]")?.textContent).toBe("Kiddushin 81a");
  expect(s.el.querySelectorAll("[data-chapter]")).toHaveLength(3);
});
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});
const manifest: AssetManifest = {
  chapters: [
    { t: 0, ref: "Menachot 37a" },
    { t: 5000, ref: "Kiddushin 81a" },
    { t: 10000, ref: "Menachot 37a" },
  ],
  transcript: { status: "ready" },
};
async function setup(value: AssetManifest | null = manifest, fail = false) {
  const module = await modules["./RecordingArtifacts.tsx"]?.();
  expect(module, "recording artifacts component exists").toBeDefined();
  const host = createFakeHost({ url: "/social/rec/9b1c2d3e-4b5a-4c6d-8e7f-001122334455" });
  const api: ReplayApi = {
    listRecordings: vi.fn(),
    deleteRecording: vi.fn(),
    getRecording: vi.fn(),
    getState: vi.fn(),
    getMedia: vi.fn(),
    getManifest: vi.fn(async () => {
      if (fail) throw new Error("offline");
      return value;
    }),
    getTranscript: vi.fn(async () => ({
      words: [
        { w: "A question", s: 1000, e: 2000 },
        { w: "about courage.", s: 6000, e: 7000 },
      ],
    })),
  };
  const seek = vi.fn(async () => undefined);
  const view = await render(
    createElement(
      HostContext.Provider,
      { value: host.host },
      createElement(
        ReplayApiContext.Provider,
        { value: api },
        createElement(module!.RecordingArtifacts, { recordingId: "recording", onSeek: seek }),
      ),
    ),
  );
  cleanup.push(view.unmount);
  await vi.waitFor(() => expect(view.el.querySelector("[data-assets-loading]")).toBeNull());
  return { ...view, api, seek, host };
}
// @feature SHIUR-008 Revisit a finished shiur through its texts and transcript
// @ac 061/AC-001
it("preserves repeated visits and deduplicates the bibliography", async () => {
  const s = await setup();
  expect(s.el.querySelectorAll("[data-chapter]")).toHaveLength(3);
  expect(s.el.querySelectorAll("[data-bibliography] a")).toHaveLength(2);
  await act(async () => s.el.querySelector<HTMLAnchorElement>("[data-bibliography] a")!.click());
  expect(s.host.calls.openBeside).toHaveLength(1);
});
// @ac 061/AC-002
it("searches transcript text and seeks to the selected line", async () => {
  const s = await setup();
  await vi.waitFor(() => expect(s.el.querySelectorAll("[data-transcript-line]")).toHaveLength(2));
  const input = s.el.querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "courage");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(s.el.querySelectorAll("[data-transcript-line]")).toHaveLength(1);
  await act(async () => s.el.querySelector<HTMLButtonElement>("[data-transcript-line] button")!.click());
  expect(s.seek).toHaveBeenCalledWith(6000);
});
// @ac 061/AC-003
it("shows processing without requesting an unavailable transcript", async () => {
  const s = await setup(null);
  expect(s.el.textContent).toContain("preparing");
  expect(s.api.getTranscript).not.toHaveBeenCalled();
});
// @ac 061/AC-003
it("shows an unavailable transcript without inventing content", async () => {
  const s = await setup({ ...manifest, transcript: { status: "unavailable" } });
  expect(s.el.textContent).toContain("A transcript isn’t available for this recording.");
  expect(s.api.getTranscript).not.toHaveBeenCalled();
});
// @ac 061/AC-001
it("removes navigation pages from older manifests without removing repeat text visits", async () => {
  const s = await setup({
    ...manifest,
    chapters: [{ t: 0, ref: "texts" }, { t: 1, ref: "social/r/example" }, ...manifest.chapters!],
  });
  expect(s.el.querySelectorAll("[data-chapter]")).toHaveLength(3);
  expect(s.el.querySelectorAll("[data-bibliography] a")).toHaveLength(2);
});
// @ac 061/AC-003
it.each([
  ["submitted", "Your transcript is being prepared."],
  ["failed", "We couldn’t generate the transcript."],
  ["none", "A transcript isn’t available for this recording."],
])("shows the specific %s transcript status", async (status, label) => {
  const s = await setup({ ...manifest, transcript: { status } });
  expect(s.el.textContent).toContain(label);
});
// @ac 061/AC-003
it("offers retry after an asset read fails", async () => {
  const s = await setup(manifest, true);
  expect(s.el.querySelector("[role=alert]")?.textContent).toContain("load");
  expect(s.el.querySelector("button")?.textContent).toContain("Retry");
});
