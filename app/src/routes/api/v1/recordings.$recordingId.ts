import { createFileRoute } from "@tanstack/react-router";
import { deleteRecording, getRecording } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/recordings/{recordingId}: members of its room read it; its recorder or the room's owner deletes it (spec 041).
export const Route = createFileRoute("/api/v1/recordings/$recordingId")({
  server: {
    handlers: serve({
      GET: bind(getRecording, async ({ identity, params }) =>
        reply(200, await recordings.getRecording(identity, params.recordingId)),
      ),
      DELETE: bind(deleteRecording, async ({ identity, params }) => {
        await recordings.deleteRecording(identity, params.recordingId);
        return reply(204, undefined);
      }),
    }),
  },
});
