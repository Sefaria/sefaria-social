import { createFileRoute } from "@tanstack/react-router";
import { inviteToRoom } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as invites from "~/server/services/invites";

// /api/v1/rooms/{roomId}/invites: invite people by @handle or email (specs 058, 059).
export const Route = createFileRoute("/api/v1/rooms/$roomId/invites")({
  server: {
    handlers: serve({
      POST: bind(inviteToRoom, async ({ identity, params, body }) =>
        reply(200, { results: await invites.inviteToRoom(identity, params.roomId, body.to) }),
      ),
    }),
  },
});
