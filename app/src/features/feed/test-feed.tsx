// Test support for the feed's component tests: a feed fixture (invented rooms, public refs), a fake feed API with the real
// one's method, recorded text answers, and a render of the feed inside the fake host. Not production code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { createFakeHost, type FakeHostOptions } from "@sefaria-social/host-contract/fake-host";
import { createTextSource } from "~/lib/sefaria-text";
import { HostContext } from "~/features/host/host-context";
import { TextSourceContext } from "~/ui/SourceText";
import { Feed } from "./Feed";
import { FeedApiContext, type Feed as FeedData, type FeedApi } from "./feed-api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ROOMS = {
  bereshit: "6f1c2d3e-4b5a-4c6d-8e7f-000000000001",
  shemot: "6f1c2d3e-4b5a-4c6d-8e7f-000000000002",
  tehillim: "6f1c2d3e-4b5a-4c6d-8e7f-000000000003",
  mishnah: "6f1c2d3e-4b5a-4c6d-8e7f-000000000004",
} as const;
export const SHIUR = "6f1c2d3e-4b5a-4c6d-8e7f-0000000000aa";

export const FEED: FeedData = {
  live: [
    {
      id: ROOMS.bereshit,
      title: "Bereshit together",
      ref: "Genesis 1",
      heRef: "בראשית א׳",
      sourceTitle: "Genesis",
      participants: 3,
    },
    { id: ROOMS.shemot, title: "Shemot study", ref: "Exodus 3", heRef: "שמות ג׳", sourceTitle: "Exodus", participants: 1 },
    { id: ROOMS.tehillim, title: "Tehillim", ref: "Psalms 23", heRef: null, sourceTitle: null, participants: 2 },
  ],
  scheduled: [{ id: SHIUR, title: "Daf Yomi", ref: "Berakhot 2a", roomId: null, scheduledAt: "2030-01-01T18:00:00.000Z" }],
  recent: [{ id: ROOMS.mishnah, title: "Mishnah circle", updatedAt: "2026-11-20T10:00:00.000Z" }],
};

const FIXTURES = path.resolve(import.meta.dirname, "../../../../harness/fixtures/texts");

/** Recorded answers of the public text API, served like the harness serves them. */
export function recordedTexts() {
  return createTextSource({
    fetch: async (url) => {
      const ref = decodeURIComponent(url.split("/api/v3/texts/")[1]!.split("?")[0]!);
      try {
        return new Response(readFileSync(path.join(FIXTURES, `${ref.replace(/[^A-Za-z0-9.-]+/g, "_")}.json`), "utf8"));
      } catch {
        return new Response("{}", { status: 404 });
      }
    },
  });
}

export interface FeedSetup {
  feed?: FeedData | (() => Promise<FeedData>);
  host?: FakeHostOptions;
}

export async function renderFeed(opts: FeedSetup = {}) {
  const fake = createFakeHost({ url: "/social", viewer: { id: 4242, name: "Test Learner" }, ...opts.host });
  const feed = opts.feed ?? FEED;
  const api: FeedApi = { getFeed: vi.fn(typeof feed === "function" ? feed : async () => structuredClone(feed)) };
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const tree = createElement(
    HostContext.Provider,
    { value: fake.host },
    createElement(
      FeedApiContext.Provider,
      { value: api },
      createElement(TextSourceContext.Provider, { value: recordedTexts() }, createElement(Feed)),
    ),
  );
  await act(async () => root.render(tree));
  const unmount = () => {
    act(() => root.unmount());
    el.remove();
  };
  return { fake, api, el, unmount };
}
