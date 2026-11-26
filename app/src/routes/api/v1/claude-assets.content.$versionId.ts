import { createFileRoute } from "@tanstack/react-router";
import { getClaudeAssetContent } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import { ApiError } from "~/server/http/errors";
import { onContentOrigin, publicPolicy } from "~/server/services/asset-content";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/content/{versionId}: a version's file with the closed (sidebar and public pages) policy (spec 061).
export const Route = createFileRoute("/api/v1/claude-assets/content/$versionId")({
  server: {
    handlers: serve({
      GET: bind(getClaudeAssetContent, async ({ params, request }) => {
        if (!onContentOrigin(request)) throw new ApiError(404, "asset.not_found");
        const body = await claudeAssets.contentOf(params.versionId);
        return {
          status: 200 as const,
          body,
          contentType: "text/html; charset=utf-8",
          headers: {
            "content-security-policy": publicPolicy(),
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cache-control": "public, max-age=300",
          },
        };
      }),
    }),
  },
});
