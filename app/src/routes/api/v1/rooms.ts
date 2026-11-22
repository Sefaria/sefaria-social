import { createFileRoute } from "@tanstack/react-router";
import { createRoom, listRooms } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as roomsService from "~/server/services/rooms";

// /api/v1/rooms: the caller's rooms; create one.
export const Route = createFileRoute("/api/v1/rooms")({
  server: {
    handlers: serve({
      GET: bind(listRooms, async ({ identity }) => reply(200, { rooms: await roomsService.listRooms(identity) })),
      POST: bind(createRoom, async ({ identity, body }) => reply(201, await roomsService.createRoom(identity, body.title))),
    }),
  },
});
