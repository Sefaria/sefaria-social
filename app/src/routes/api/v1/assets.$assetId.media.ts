import { createFileRoute } from "@tanstack/react-router";
import { getAssetMedia } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}/media: a ready recording's media, for anyone with its link (spec 051; public).
export const Route = createFileRoute("/api/v1/assets/$assetId/media")({
  server: {
    handlers: serve({
      GET: bind(getAssetMedia, async ({ params }) => {
        const media = await recordings.getAssetMedia(params.assetId);
        return { status: 200 as const, body: media.bytes, contentType: media.contentType };
      }),
    }),
  },
});
