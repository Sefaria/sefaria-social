import { createFileRoute } from "@tanstack/react-router";
import { deleteClaudeAsset, getClaudeAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/{assetId}: an asset for anyone with its id (public), and its owner's delete (spec 060).
export const Route = createFileRoute("/api/v1/claude-assets/$assetId")({
  server: {
    handlers: serve({
      GET: bind(getClaudeAsset, async ({ params }) => reply(200, await claudeAssets.getAsset(params.assetId))),
      DELETE: bind(deleteClaudeAsset, async ({ identity, params }) => {
        await claudeAssets.deleteAsset(identity, params.assetId);
        return reply(204, undefined);
      }),
    }),
  },
});
