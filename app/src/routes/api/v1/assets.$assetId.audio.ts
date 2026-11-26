import { createFileRoute } from "@tanstack/react-router";
import { getAssetAudio } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}/audio: a processed recording's audio, for anyone with its link; Sofer.ai fetches it (spec 054).
export const Route = createFileRoute("/api/v1/assets/$assetId/audio")({
  server: {
    handlers: serve({
      GET: bind(getAssetAudio, async ({ params, request }) => {
        const audio = await recordings.getAssetAudio(params.assetId, request.headers.get("range"));
        return { status: audio.status, body: audio.bytes, contentType: audio.contentType, headers: audio.headers };
      }),
    }),
  },
});
