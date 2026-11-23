import { createFileRoute } from "@tanstack/react-router";
import { getMyProfile, updateMyProfile } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as profilesService from "~/server/services/profiles";

// /api/v1/profiles/me: the viewer's own profile, created on first use; name and bio edits (spec 025).
export const Route = createFileRoute("/api/v1/profiles/me")({
  server: {
    handlers: serve({
      GET: bind(getMyProfile, async ({ identity }) => reply(200, await profilesService.getMe(identity))),
      PATCH: bind(updateMyProfile, async ({ identity, body }) => reply(200, await profilesService.updateMe(identity, body))),
    }),
  },
});
