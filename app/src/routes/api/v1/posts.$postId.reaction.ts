import { createFileRoute } from "@tanstack/react-router";
import { addReaction, removeReaction } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts/{postId}/reaction: the viewer's Yasher koach on a post (spec 024).
export const Route = createFileRoute("/api/v1/posts/$postId/reaction")({
  server: {
    handlers: serve({
      PUT: bind(addReaction, async ({ identity, params }) => reply(200, await postsService.react(identity, params.postId))),
      DELETE: bind(removeReaction, async ({ identity, params }) =>
        reply(200, await postsService.unreact(identity, params.postId)),
      ),
    }),
  },
});
