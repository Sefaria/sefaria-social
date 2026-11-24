import { createFileRoute } from "@tanstack/react-router";
import { createPost } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/posts: write a post (spec 023).
export const Route = createFileRoute("/api/v1/posts")({
  server: {
    handlers: serve({
      POST: bind(createPost, async ({ identity, body }) => reply(201, await postsService.createPost(identity, body))),
    }),
  },
});
