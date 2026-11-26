import { createFileRoute } from "@tanstack/react-router";
import { unpublishClaudeAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/{assetId}/unpublish: the owner takes it off the segments it covers (spec 062).
export const Route = createFileRoute("/api/v1/claude-assets/$assetId/unpublish")({
  server: {
    handlers: serve({
      POST: bind(unpublishClaudeAsset, async ({ identity, params }) =>
        reply(200, await claudeAssets.unpublish(identity, params.assetId)),
      ),
    }),
  },
});
