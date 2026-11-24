import { createFileRoute } from "@tanstack/react-router";
import { removeCallParticipant } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/call/remove: the room's owner removes a participant from the call (spec 039).
export const Route = createFileRoute("/api/v1/rooms/$roomId/call/remove")({
  server: {
    handlers: serve({
      POST: bind(removeCallParticipant, async ({ identity, params, body }) => {
        await roomsService.removeParticipant(identity, params.roomId, body.participant);
        return reply(204, undefined);
      }),
    }),
  },
});
