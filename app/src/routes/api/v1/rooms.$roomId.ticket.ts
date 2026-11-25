import { createFileRoute } from "@tanstack/react-router";
import { getRoomTicket } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/ticket: a signed relay ticket naming the caller's role in the room, owner or member (spec 048).
export const Route = createFileRoute("/api/v1/rooms/$roomId/ticket")({
  server: {
    handlers: serve({
      POST: bind(getRoomTicket, async ({ identity, params }) =>
        reply(200, await roomsService.roomTicket(identity, params.roomId)),
      ),
    }),
  },
});
