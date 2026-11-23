import { createFileRoute } from "@tanstack/react-router";
import { deleteRoom, getRoom, renameRoom } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms/{roomId}: members read; the owner renames or deletes. Non-members get 404.
export const Route = createFileRoute("/api/v1/rooms/$roomId")({
  server: {
    handlers: serve({
      GET: bind(getRoom, async ({ identity, params }) => reply(200, await roomsService.getRoom(identity, params.roomId))),
      PATCH: bind(renameRoom, async ({ identity, params, body }) =>
        reply(200, await roomsService.renameRoom(identity, params.roomId, body.title)),
      ),
      DELETE: bind(deleteRoom, async ({ identity, params }) => {
        await roomsService.deleteRoom(identity, params.roomId);
        return reply(204, undefined);
      }),
    }),
  },
});
