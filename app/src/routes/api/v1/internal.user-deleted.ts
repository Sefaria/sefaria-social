import { createFileRoute } from "@tanstack/react-router";
import { userDeleted } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import { receiveUserDeleted } from "~/server/webhooks/user-deleted";

// POST /api/v1/internal/user-deleted: Django's signed account-deletion webhook (not public: the signature is its credential).
export const Route = createFileRoute("/api/v1/internal/user-deleted")({
  server: {
    handlers: serve({
      POST: bind(userDeleted, async ({ body, request }) =>
        reply(200, { status: await receiveUserDeleted(body, request.headers.get("x-sefaria-event-id")) }),
      ),
    }),
  },
});
