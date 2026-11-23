import { createFileRoute } from "@tanstack/react-router";
import { getMe } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";

// /api/v1/me: who the verified token says the caller is (spec 082: proves a session is authenticated).
export const Route = createFileRoute("/api/v1/me")({
  server: {
    handlers: serve({
      GET: bind(getMe, async ({ identity }) => reply(200, { userId: identity.userId, name: identity.name })),
    }),
  },
});
