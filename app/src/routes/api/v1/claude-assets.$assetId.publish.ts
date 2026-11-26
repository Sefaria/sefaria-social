import { createFileRoute } from "@tanstack/react-router";
import { publishClaudeAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/{assetId}/publish: a verified owner publishes a version to the segments it covers (spec 062).
export const Route = createFileRoute("/api/v1/claude-assets/$assetId/publish")({
  server: {
    handlers: serve({
      POST: bind(publishClaudeAsset, async ({ identity, params, body }) =>
        reply(200, await claudeAssets.publish(identity, params.assetId, body.versionId)),
      ),
    }),
  },
});
