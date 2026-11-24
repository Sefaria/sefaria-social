import { createFileRoute } from "@tanstack/react-router";
import { getPostFollowStatus } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts/{postId}/follow: where the follow-me session a post shares is now (spec 032).
export const Route = createFileRoute("/api/v1/posts/$postId/follow")({
  server: {
    handlers: serve({
      GET: bind(getPostFollowStatus, async ({ identity, params }) =>
        reply(200, await postsService.postFollowStatus(identity, params.postId)),
      ),
    }),
  },
});
