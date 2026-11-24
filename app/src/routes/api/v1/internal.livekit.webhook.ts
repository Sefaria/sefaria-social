import { createFileRoute } from "@tanstack/react-router";
import { livekitWebhook } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import { receiveLivekitEvent } from "~/server/services/calls";

// /api/v1/internal/livekit/webhook: LiveKit's signed webhooks keep each room's call status (spec 038). The wrapper verified
// the signature over the raw body and parsed it with the contract's schema.
export const Route = createFileRoute("/api/v1/internal/livekit/webhook")({
  server: {
    handlers: serve({
      POST: bind(livekitWebhook, async ({ body }) => reply(200, { status: await receiveLivekitEvent(body) })),
    }),
  },
});
