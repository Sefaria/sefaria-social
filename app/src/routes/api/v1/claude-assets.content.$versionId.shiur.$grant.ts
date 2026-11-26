import { createFileRoute } from "@tanstack/react-router";
import { getClaudeAssetShiurContent } from "~/server/api/contracts";
import { bind, serve } from "~/server/http/endpoint";
import { ApiError } from "~/server/http/errors";
import { checkGrant, onContentOrigin, shiurPolicy } from "~/server/services/asset-content";
import * as claudeAssets from "~/server/services/claude-assets";

// /api/v1/claude-assets/content/{versionId}/shiur/{grant}: a version's file with a shiur's open policy (spec 061). The grant
// is signed for this version, expires, and holds only while the shiur pins the version.
export const Route = createFileRoute("/api/v1/claude-assets/content/$versionId/shiur/$grant")({
  server: {
    handlers: serve({
      GET: bind(getClaudeAssetShiurContent, async ({ params, request }) => {
        if (!onContentOrigin(request)) throw new ApiError(404, "asset.not_found");
        const shiurId = checkGrant(params.grant, params.versionId);
        if (!shiurId || !(await claudeAssets.pinnedIn(shiurId, params.versionId))) throw new ApiError(404, "asset.not_found");
        const body = await claudeAssets.contentOf(params.versionId);
        return {
          status: 200 as const,
          body,
          contentType: "text/html; charset=utf-8",
          headers: {
            "content-security-policy": shiurPolicy(),
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "cache-control": "private, max-age=300",
          },
        };
      }),
    }),
  },
});
