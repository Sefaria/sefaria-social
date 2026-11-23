import { createFileRoute } from "@tanstack/react-router";
import { followProfile, unfollowProfile } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as profilesService from "~/server/services/profiles";

// /api/v1/profiles/{profileId}/follow: follow and unfollow (spec 025).
export const Route = createFileRoute("/api/v1/profiles/$profileId/follow")({
  server: {
    handlers: serve({
      PUT: bind(followProfile, async ({ identity, params }) =>
        reply(200, await profilesService.follow(identity, params.profileId)),
      ),
      DELETE: bind(unfollowProfile, async ({ identity, params }) =>
        reply(200, await profilesService.unfollow(identity, params.profileId)),
      ),
    }),
  },
});
