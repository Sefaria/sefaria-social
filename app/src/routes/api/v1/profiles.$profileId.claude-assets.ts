import { createFileRoute } from "@tanstack/react-router";
import { getProfileClaudeAssets } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/profiles/{profileId}/claude-assets: a person's published Claude assets (spec 063; public).
export const Route = createFileRoute("/api/v1/profiles/$profileId/claude-assets")({
  server: {
    handlers: serve({
      GET: bind(getProfileClaudeAssets, async ({ params }) => reply(200, await claudeAssets.publicAssetsOf(params.profileId))),
    }),
  },
});
