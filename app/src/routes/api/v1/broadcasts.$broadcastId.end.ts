import { createFileRoute } from "@tanstack/react-router";
import { endBroadcast } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as broadcasts from "~/server/services/broadcasts";

// /api/v1/broadcasts/{broadcastId}/end: the host ends the broadcast (spec 043).
export const Route = createFileRoute("/api/v1/broadcasts/$broadcastId/end")({
  server: {
    handlers: serve({
      POST: bind(endBroadcast, async ({ identity, params }) =>
        reply(200, await broadcasts.endBroadcast(identity, params.broadcastId)),
      ),
    }),
  },
});
