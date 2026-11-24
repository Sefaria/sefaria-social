import { createFileRoute } from "@tanstack/react-router";
import { deleteReply } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as postsService from "~/server/services/posts";

// /api/v1/replies/{replyId}: its author deletes it (spec 024).
export const Route = createFileRoute("/api/v1/replies/$replyId")({
  server: {
    handlers: serve({
      DELETE: bind(deleteReply, async ({ identity, params }) => {
        await postsService.deleteReply(identity, params.replyId);
        return reply(204, undefined);
      }),
    }),
  },
});
