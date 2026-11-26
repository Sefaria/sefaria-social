import { createFileRoute } from "@tanstack/react-router";
import { getAssetState } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as recordings from "~/server/services/recordings";

// /api/v1/assets/{assetId}/state: a ready recording's reader timeline, for anyone with its link (spec 051; public).
export const Route = createFileRoute("/api/v1/assets/$assetId/state")({
  server: {
    handlers: serve({
      GET: bind(getAssetState, async ({ params }) => reply(200, await recordings.getAssetState(params.assetId))),
    }),
  },
});
