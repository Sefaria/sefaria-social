import { createFileRoute } from "@tanstack/react-router";
import { readNotifications } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as notificationsService from "~/server/services/notifications";

// /api/v1/notifications/read: mark everything read (spec 026).
export const Route = createFileRoute("/api/v1/notifications/read")({
  server: {
    handlers: serve({
      POST: bind(readNotifications, async ({ identity }) => reply(200, await notificationsService.markAllRead(identity))),
    }),
  },
});
