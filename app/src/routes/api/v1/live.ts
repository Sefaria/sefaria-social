import { createFileRoute } from "@tanstack/react-router";
import { getLiveStatus } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import { etagOf, liveStatuses, matches } from "~/server/services/live";

// /api/v1/live?ids=…: the live state of posted rooms, broadcasts and recordings (spec 056). Public; only posted ids are
// answered. `no-cache` lets the browser keep the answer and revalidate it with If-None-Match, which answers 304 when unchanged.
export const Route = createFileRoute("/api/v1/live")({
  server: {
    handlers: serve({
      GET: bind(getLiveStatus, async ({ query, request }) => {
        const body = await liveStatuses(query.ids);
        const etag = etagOf(body);
        const headers = { etag, "cache-control": "no-cache" };
        return matches(request.headers.get("if-none-match"), etag) ? reply(304, undefined, headers) : reply(200, body, headers);
      }),
    }),
  },
});
