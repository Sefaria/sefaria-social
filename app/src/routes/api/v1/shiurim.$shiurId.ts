import { createFileRoute } from "@tanstack/react-router";
import { getShiur } from "~/server/api/contracts";
import { bind, reply, serve } from "~/server/http/endpoint";
import * as shiurim from "~/server/services/shiurim";

// /api/v1/shiurim/{shiurId}: an unlisted or public shiur for anyone with its link (spec 063; public).
export const Route = createFileRoute("/api/v1/shiurim/$shiurId")({
  server: {
    handlers: serve({
      GET: bind(getShiur, async ({ params }) => reply(200, await shiurim.getShiur(params.shiurId))),
    }),
  },
});
