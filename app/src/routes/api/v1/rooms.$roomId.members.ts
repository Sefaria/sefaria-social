import { createFileRoute } from "@tanstack/react-router";
import { joinRoom } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/members: join with the room's link (spec 011).
export const Route = createFileRoute("/api/v1/rooms/$roomId/members")({
  server: {
    handlers: serve({
      POST: bind(joinRoom, async ({ identity, params }) => reply(200, await roomsService.joinRoom(identity, params.roomId))),
    }),
  },
});
