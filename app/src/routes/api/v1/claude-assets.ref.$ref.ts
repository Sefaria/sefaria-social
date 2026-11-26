import { createFileRoute } from "@tanstack/react-router";
import { getClaudeAssetsForRef } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/ref/{ref}: published assets on a section or segment, for the reader's sidebar (spec 062; public).
export const Route = createFileRoute("/api/v1/claude-assets/ref/$ref")({
  server: {
    handlers: serve({
      GET: bind(getClaudeAssetsForRef, async ({ params }) =>
        reply(200, await claudeAssets.assetsForRef(params.ref), { "cache-control": "public, max-age=60" }),
      ),
    }),
  },
});
