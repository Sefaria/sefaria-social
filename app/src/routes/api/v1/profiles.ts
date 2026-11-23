import { createFileRoute } from "@tanstack/react-router";
import { listProfiles } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as profilesService from "~/server/services/profiles";

// /api/v1/profiles?suggested=1: whom to follow (spec 025).
export const Route = createFileRoute("/api/v1/profiles")({
  server: {
    handlers: serve({
      GET: bind(listProfiles, async ({ identity }) => reply(200, { profiles: await profilesService.suggested(identity) })),
    }),
  },
});
