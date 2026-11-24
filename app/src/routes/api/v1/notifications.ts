import { createFileRoute } from "@tanstack/react-router";
import { listNotifications } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as notificationsService from "~/server/services/notifications";

// /api/v1/notifications: the viewer's latest notifications and unread count (spec 026).
export const Route = createFileRoute("/api/v1/notifications")({
  server: {
    handlers: serve({
      GET: bind(listNotifications, async ({ identity }) => reply(200, await notificationsService.listNotifications(identity))),
    }),
  },
});
