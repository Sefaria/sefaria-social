import { createFileRoute } from "@tanstack/react-router";
import { leaveRoom } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/members/me: leave a room (spec 011).
export const Route = createFileRoute("/api/v1/rooms/$roomId/members/me")({
  server: {
    handlers: serve({
      DELETE: bind(leaveRoom, async ({ identity, params }) => {
        await roomsService.leaveRoom(identity, params.roomId);
        return reply(204, undefined);
      }),
    }),
  },
});
