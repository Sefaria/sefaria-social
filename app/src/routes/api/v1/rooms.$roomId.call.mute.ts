import { createFileRoute } from "@tanstack/react-router";
import { muteCallParticipant } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}/call/mute: the room's owner mutes a participant's track (spec 039).
export const Route = createFileRoute("/api/v1/rooms/$roomId/call/mute")({
  server: {
    handlers: serve({
      POST: bind(muteCallParticipant, async ({ identity, params, body }) => {
        await roomsService.muteParticipant(identity, params.roomId, body.participant, body.source);
        return reply(204, undefined);
      }),
    }),
  },
});
