import { createFileRoute } from "@tanstack/react-router";
import { getProfileByHandle } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as profilesService from "~/server/services/profiles";

// /api/v1/profiles/by-handle/{handle}: the profile with this @handle (spec 057).
export const Route = createFileRoute("/api/v1/profiles/by-handle/$handle")({
  server: {
    handlers: serve({
      GET: bind(getProfileByHandle, async ({ identity, params }) =>
        reply(200, await profilesService.getProfileByHandle(identity, params.handle)),
      ),
    }),
  },
});
