import { createFileRoute } from "@tanstack/react-router";
import { finishRecording } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/recordings/{recordingId}/finish: the recorder finishes the recording (spec 041).
export const Route = createFileRoute("/api/v1/recordings/$recordingId/finish")({
  server: {
    handlers: serve({
      POST: bind(finishRecording, async ({ identity, params, body }) =>
        reply(200, await recordings.finishRecording(identity, params.recordingId, body.durationMs)),
      ),
    }),
  },
});
