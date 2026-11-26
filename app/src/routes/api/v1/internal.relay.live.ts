import { createFileRoute } from "@tanstack/react-router";
import { relayLiveReport } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import { receiveReport } from "~/server/services/live";

// /api/v1/internal/relay/live: the relay's live reports (spec 056). The wrapper checked the relay's signature over the raw body.
export const Route = createFileRoute("/api/v1/internal/relay/live")({
  server: {
    handlers: serve({
      POST: bind(relayLiveReport, async ({ body }) => {
        await receiveReport(body);
        return reply(204, undefined);
      }),
    }),
  },
});
