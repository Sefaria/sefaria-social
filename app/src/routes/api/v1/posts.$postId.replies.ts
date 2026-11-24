import { createFileRoute } from "@tanstack/react-router";
import { createReply } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts/{postId}/replies: reply to a post (spec 024).
export const Route = createFileRoute("/api/v1/posts/$postId/replies")({
  server: {
    handlers: serve({
      POST: bind(createReply, async ({ identity, params, body }) =>
        reply(201, await postsService.createReply(identity, params.postId, body.body)),
      ),
    }),
  },
});
