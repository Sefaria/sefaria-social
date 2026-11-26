import { createFileRoute } from "@tanstack/react-router";
import { unpinShiurAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as shiurim from "~/server/services/shiurim";

// /api/v1/shiurim/{shiurId}/assets/{assetId}: remove a Claude asset from the caller's shiur (spec 063).
export const Route = createFileRoute("/api/v1/shiurim/$shiurId/assets/$assetId")({
  server: {
    handlers: serve({
      DELETE: bind(unpinShiurAsset, async ({ identity, params }) =>
        reply(200, await shiurim.unpinAsset(identity, params.shiurId, params.assetId)),
      ),
    }),
  },
});
