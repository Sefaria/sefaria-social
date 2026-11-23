import { createFileRoute } from "@tanstack/react-router";
import { getFeed } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as feedService from "~/server/services/feed";

// /api/v1/feed: what is live, scheduled and recent for the viewer (spec 015).
export const Route = createFileRoute("/api/v1/feed")({
  server: {
    handlers: serve({
      GET: bind(getFeed, async ({ identity }) => reply(200, await feedService.getFeed(identity))),
    }),
  },
});
