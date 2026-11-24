import { createFileRoute } from "@tanstack/react-router";
import { startBroadcast } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as broadcasts from "~/server/services/broadcasts";

// /api/v1/rooms/{roomId}/broadcasts: the room's owner starts a broadcast (spec 043).
export const Route = createFileRoute("/api/v1/rooms/$roomId/broadcasts")({
  server: {
    handlers: serve({
      POST: bind(startBroadcast, async ({ identity, params }) =>
        reply(201, await broadcasts.startBroadcast(identity, params.roomId)),
      ),
    }),
  },
});
