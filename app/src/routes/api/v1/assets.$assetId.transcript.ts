import { createFileRoute } from "@tanstack/react-router";
import { getAssetTranscript } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}/transcript: a ready recording's transcript with word times, for anyone with its link (spec 054).
export const Route = createFileRoute("/api/v1/assets/$assetId/transcript")({
  server: {
    handlers: serve({
      GET: bind(getAssetTranscript, async ({ params }) =>
        reply(200, (await recordings.getAssetTranscript(params.assetId)) as never),
      ),
    }),
  },
});
