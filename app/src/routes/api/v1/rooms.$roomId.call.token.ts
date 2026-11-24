import { createFileRoute } from "@tanstack/react-router";
import { getCallToken } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/call/token: a LiveKit token for the room's call, for members (spec 033).
export const Route = createFileRoute("/api/v1/rooms/$roomId/call/token")({
  server: {
    handlers: serve({
      POST: bind(getCallToken, async ({ identity, params }) =>
        reply(200, await roomsService.getCallToken(identity, params.roomId)),
      ),
    }),
  },
});
