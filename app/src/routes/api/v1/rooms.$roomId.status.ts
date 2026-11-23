import { createFileRoute } from "@tanstack/react-router";
import { getRoomStatus } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/status: the relay's status read, for members (spec 011; cards in P4).
export const Route = createFileRoute("/api/v1/rooms/$roomId/status")({
  server: {
    handlers: serve({
      GET: bind(getRoomStatus, async ({ identity, params }) =>
        reply(200, await roomsService.getRoomStatus(identity, params.roomId)),
      ),
    }),
  },
});
