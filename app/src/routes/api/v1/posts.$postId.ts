import { createFileRoute } from "@tanstack/react-router";
import { deletePost, getPost } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts/{postId}: read one post with its replies; its author deletes it (spec 023).
export const Route = createFileRoute("/api/v1/posts/$postId")({
  server: {
    handlers: serve({
      GET: bind(getPost, async ({ identity, params }) => reply(200, await postsService.getPost(identity, params.postId))),
      DELETE: bind(deletePost, async ({ identity, params }) => {
        await postsService.deletePost(identity, params.postId);
        return reply(204, undefined);
      }),
    }),
  },
});
