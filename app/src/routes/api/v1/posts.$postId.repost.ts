import { createFileRoute } from "@tanstack/react-router";
import { addRepost, removeRepost } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts/{postId}/repost: the viewer's repost of a post (spec 030).
export const Route = createFileRoute("/api/v1/posts/$postId/repost")({
  server: {
    handlers: serve({
      PUT: bind(addRepost, async ({ identity, params }) => reply(200, await postsService.repost(identity, params.postId))),
      DELETE: bind(removeRepost, async ({ identity, params }) =>
        reply(200, await postsService.unrepost(identity, params.postId)),
      ),
    }),
  },
});
