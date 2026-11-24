import { createFileRoute } from "@tanstack/react-router";
import { getTimeline } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/timeline: posts newest first, a page at a time (spec 023).
export const Route = createFileRoute("/api/v1/timeline")({
  server: {
    handlers: serve({
      GET: bind(getTimeline, async ({ identity, query }) =>
        reply(200, await postsService.timeline(identity, query.tab, query.before)),
      ),
    }),
  },
});
