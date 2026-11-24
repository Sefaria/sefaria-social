import { createFileRoute } from "@tanstack/react-router";
import { listRecordings, startRecording } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/rooms/{roomId}/recordings: members list the room's session recordings; the owner starts one (spec 041).
export const Route = createFileRoute("/api/v1/rooms/$roomId/recordings")({
  server: {
    handlers: serve({
      GET: bind(listRecordings, async ({ identity, params }) =>
        reply(200, { recordings: await recordings.listRecordings(identity, params.roomId) }),
      ),
      POST: bind(startRecording, async ({ identity, params, body }) =>
        reply(201, await recordings.startRecording(identity, params.roomId, body)),
      ),
    }),
  },
});
