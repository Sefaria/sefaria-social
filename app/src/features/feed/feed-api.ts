// What the feed page needs from the social API (spec 015), behind a small interface like features/api/rooms-api.ts: the
// surface builds it from the host (host.config.apiOrigin, host.viewer.identityToken()); component tests give a fake.
import { createContext, useContext } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { createApiClient, type Feed } from "@sefaria-social/api-client";
import { useHost } from "~/features/host/host-context";

export type { Feed };
export type LiveRoom = Feed["live"][number];
export type ScheduledShiur = Feed["scheduled"][number];
export type RecentRoom = Feed["recent"][number];

export interface FeedApi {
  /** The viewer's feed; rejects when the API does not answer 200. */
  getFeed(): Promise<Feed>;
}

export function createFeedApi(host: SurfaceHost): FeedApi {
  const client = createApiClient({
    baseUrl: host.config.apiOrigin,
    getToken: async () => (host.viewer.get() ? host.viewer.identityToken().catch(() => null) : null),
    correlationId: () => crypto.randomUUID(),
  });
  return {
    async getFeed() {
      const { data, response } = await client.GET("/api/v1/feed");
      if (!data) throw new Error(`social API answered ${response.status}`);
      return data;
    },
  };
}

/** Lets tests provide the API; the surface leaves it empty and gets one built from the host. */
export const FeedApiContext = createContext<FeedApi | null>(null);

const built = new WeakMap<SurfaceHost, FeedApi>();

/** The feed API for this host, or null in standalone mode with nothing provided. */
export function useFeedApi(): FeedApi | null {
  const provided = useContext(FeedApiContext);
  const host = useHost();
  if (provided) return provided;
  if (!host) return null;
  let api = built.get(host);
  if (!api) {
    api = createFeedApi(host);
    built.set(host, api);
  }
  return api;
}
