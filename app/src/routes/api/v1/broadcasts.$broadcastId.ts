import { createFileRoute } from "@tanstack/react-router";
import { getBroadcast } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as broadcasts from "~/server/services/broadcasts";

// /api/v1/broadcasts/{broadcastId}: a broadcast's page data, for anyone signed in with the link (spec 043).
export const Route = createFileRoute("/api/v1/broadcasts/$broadcastId")({
  server: {
    handlers: serve({
      GET: bind(getBroadcast, async ({ identity, params }) =>
        reply(200, await broadcasts.getBroadcast(identity, params.broadcastId)),
      ),
    }),
  },
});
