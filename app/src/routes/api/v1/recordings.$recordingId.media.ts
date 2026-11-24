import { createFileRoute } from "@tanstack/react-router";
import { getRecordingMedia } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/recordings/{recordingId}/media: the recording's media, every chunk in order (spec 041).
export const Route = createFileRoute("/api/v1/recordings/$recordingId/media")({
  server: {
    handlers: serve({
      GET: bind(getRecordingMedia, async ({ identity, params }) => {
        const media = await recordings.getRecordingMedia(identity, params.recordingId);
        return { status: 200 as const, body: media.bytes, contentType: media.contentType };
      }),
    }),
  },
});
