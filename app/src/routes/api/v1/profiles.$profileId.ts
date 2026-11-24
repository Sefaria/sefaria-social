import { createFileRoute } from "@tanstack/react-router";
import { getProfile } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as profilesService from "~/server/services/profiles";

// /api/v1/profiles/{profileId}: a person or an institution with its latest posts (spec 025).
export const Route = createFileRoute("/api/v1/profiles/$profileId")({
  server: {
    handlers: serve({
      GET: bind(getProfile, async ({ identity, params }) =>
        reply(200, await profilesService.getProfile(identity, params.profileId)),
      ),
    }),
  },
});
