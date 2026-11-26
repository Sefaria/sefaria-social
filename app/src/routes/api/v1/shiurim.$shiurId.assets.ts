import { createFileRoute } from "@tanstack/react-router";
import { pinShiurAsset } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as shiurim from "~/server/services/shiurim";

// /api/v1/shiurim/{shiurId}/assets: pin a Claude asset's version in the caller's shiur, or move its pin (spec 063).
export const Route = createFileRoute("/api/v1/shiurim/$shiurId/assets")({
  server: {
    handlers: serve({
      POST: bind(pinShiurAsset, async ({ identity, params, body }) =>
        reply(200, await shiurim.pinAsset(identity, params.shiurId, body)),
      ),
    }),
  },
});
