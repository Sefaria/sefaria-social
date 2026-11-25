import { createFileRoute } from "@tanstack/react-router";
import { getBroadcastCallToken } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as broadcasts from "~/server/services/broadcasts";

// /api/v1/broadcasts/{broadcastId}/call/token: a LiveKit token for the broadcast's call, view only for viewers (spec 043).
export const Route = createFileRoute("/api/v1/broadcasts/$broadcastId/call/token")({
  server: {
    handlers: serve({
      POST: bind(getBroadcastCallToken, async ({ identity, params }) =>
        reply(200, await broadcasts.broadcastCallToken(identity, params.broadcastId)),
      ),
    }),
  },
});
