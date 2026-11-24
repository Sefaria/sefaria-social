import { createFileRoute } from "@tanstack/react-router";
import { getBroadcastTicket } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as broadcasts from "~/server/services/broadcasts";

// /api/v1/broadcasts/{broadcastId}/ticket: a signed relay ticket naming the caller's role (spec 043).
export const Route = createFileRoute("/api/v1/broadcasts/$broadcastId/ticket")({
  server: {
    handlers: serve({
      POST: bind(getBroadcastTicket, async ({ identity, params }) =>
        reply(200, await broadcasts.broadcastTicket(identity, params.broadcastId)),
      ),
    }),
  },
});
