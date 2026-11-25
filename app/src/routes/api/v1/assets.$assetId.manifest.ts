import { createFileRoute } from "@tanstack/react-router";
import { getAssetManifest } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}/manifest: a processed recording's manifest, for anyone with its link (spec 052; public).
export const Route = createFileRoute("/api/v1/assets/$assetId/manifest")({
  server: {
    handlers: serve({
      GET: bind(getAssetManifest, async ({ params }) => reply(200, (await recordings.getAssetManifest(params.assetId)) as never)),
    }),
  },
});
