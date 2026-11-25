import { createFileRoute } from "@tanstack/react-router";
import { getAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}: a ready recording for anyone with its link (spec 051; public).
export const Route = createFileRoute("/api/v1/assets/$assetId")({
  server: {
    handlers: serve({
      GET: bind(getAsset, async ({ params }) => reply(200, await recordings.getAsset(params.assetId))),
    }),
  },
});
