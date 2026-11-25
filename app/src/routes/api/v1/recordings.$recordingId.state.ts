import { createFileRoute } from "@tanstack/react-router";
import { appendRecordingState, getRecordingState } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/recordings/{recordingId}/state: the state track as a Recording v1 document; the recorder appends batches (spec 041).
export const Route = createFileRoute("/api/v1/recordings/$recordingId/state")({
  server: {
    handlers: serve({
      GET: bind(getRecordingState, async ({ identity, params }) =>
        reply(200, await recordings.getRecordingState(identity, params.recordingId)),
      ),
      POST: bind(appendRecordingState, async ({ identity, params, body }) =>
        reply(200, await recordings.putState(identity, params.recordingId, body.messages)),
      ),
    }),
  },
});
