import { createFileRoute } from "@tanstack/react-router";
import { putRecordingMedia } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/recordings/{recordingId}/media/{seq}: the recorder uploads the next media chunk (spec 041).
export const Route = createFileRoute("/api/v1/recordings/$recordingId/media/$seq")({
  server: {
    handlers: serve({
      PUT: bind(putRecordingMedia, async ({ identity, params, bytes }) => {
        await recordings.putMedia(identity, params.recordingId, Number(params.seq), bytes);
        return reply(204, undefined);
      }),
    }),
  },
});
